#!/usr/bin/env python3
"""Machine comparison: the working SQLite schema vs the faithful MySQL source.

The plan's completion criterion for the schema item is a machine comparison of
every table/column/type/default/key with the dump, with no unexplained
difference. The dump itself stays on the user's machine, but
prisma/schema.mysql.prisma was generated from it as the faithful source, so
that is the reference here.

Relation fields (type = another model's name) are the additive logical layer
this project adds on top — MyISAM never enforced foreign keys, so the
faithful schema correctly has none. They are excluded from the comparison and
counted separately.

Every remaining difference must be listed under documentedExceptions with a
reason; the test suite fails on anything else.

Writes src/meta/schema-report.json.
"""
import io
import json
import os
import re
from collections import OrderedDict

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
SQLITE = os.path.join(ROOT, "prisma", "schema.prisma")
MYSQL = os.path.join(ROOT, "prisma", "schema.mysql.prisma")
REPORT = os.path.join(ROOT, "src", "meta", "schema-report.json")

MODEL_RE = re.compile(r"model\s+(\w+)\s*\{([\s\S]*?)\n\}")
FIELD_RE = re.compile(r"^(\w+)\s+(\w+)(\[\])?(\?)?")


def parse(path):
    text = io.open(path, encoding="utf-8").read()
    model_names = set(m.group(1) for m in MODEL_RE.finditer(text))
    models = OrderedDict()
    for m in MODEL_RE.finditer(text):
        name, body = m.group(1), m.group(2)
        fields = OrderedDict()
        for raw_line in body.split("\n"):
            line = raw_line.strip()
            if not line or line.startswith("//") or line.startswith("@@"):
                continue
            fm = FIELD_RE.match(line)
            if not fm:
                continue
            fields[fm.group(1)] = {
                "type": fm.group(2),
                "isList": bool(fm.group(3)),
                "optional": bool(fm.group(4)),
                "isId": "@id" in line,
                "isUnique": "@unique" in line,
                "default": (re.search(r"@default\(([^)]*)\)", line) or [None, None])[1],
                "line": line,
            }
        models[name] = fields
    return models, model_names


def main():
    sqlite, sqlite_names = parse(SQLITE)
    mysql, mysql_names = parse(MYSQL)
    model_names = sqlite_names | mysql_names

    report = OrderedDict()
    report["compares"] = "prisma/schema.prisma vs prisma/schema.mysql.prisma"
    report["models"] = OrderedDict([
        ("sqlite", len(sqlite)),
        ("mysql", len(mysql)),
        ("onlySqlite", sorted(set(sqlite) - set(mysql))),
        ("onlyMysql", sorted(set(mysql) - set(sqlite))),
    ])

    field_diffs = []
    type_diffs = []
    key_diffs = []
    default_diffs = []
    relation_fields = 0
    scalar_fields = 0

    for name in sorted(model_names):
        if name not in sqlite or name not in mysql:
            continue
        sf = sqlite[name]
        mf = mysql[name]
        for fname, fdef in sf.items():
            if fdef["type"] in model_names or fdef["isList"]:
                relation_fields += 1
                continue
            scalar_fields += 1
            if fname not in mf:
                field_diffs.append({"model": name, "field": fname, "side": "only sqlite", "line": fdef["line"]})
                continue
            mdef = mf[fname]
            if fdef["type"] != mdef["type"]:
                type_diffs.append({"model": name, "field": fname, "sqlite": fdef["type"], "mysql": mdef["type"]})
            if fdef["optional"] != mdef["optional"]:
                type_diffs.append({"model": name, "field": fname, "sqlite": "optional", "mysql": "required"})
            if fdef["isId"] != mdef["isId"] or fdef["isUnique"] != mdef["isUnique"]:
                key_diffs.append({
                    "model": name, "field": fname,
                    "sqlite": {"id": fdef["isId"], "unique": fdef["isUnique"]},
                    "mysql": {"id": mdef["isId"], "unique": mdef["isUnique"]},
                })
            if (fdef["default"] or None) != (mdef["default"] or None):
                default_diffs.append({"model": name, "field": fname, "sqlite": fdef["default"], "mysql": mdef["default"]})
        for fname, mdef in mf.items():
            if mdef["type"] in model_names or mdef["isList"]:
                continue
            if fname not in sf:
                field_diffs.append({"model": name, "field": fname, "side": "only mysql", "line": mdef["line"]})

    # Differences we know about and accept, with reasons.
    documented = [
        {"model": "Buchfuehrungen", "field": "rowid",
         "reason": "SQLite identity shim: MyISAM tables without a PK need an INTEGER PRIMARY KEY for autoincrement"},
        {"model": "Kontenrahmen", "field": "rowid",
         "reason": "SQLite identity shim: MyISAM tables without a PK need an INTEGER PRIMARY KEY for autoincrement"},
        {"model": "Buchfuehrungen", "field": "ID",
         "reason": "business key marked @unique so Prisma relations can reference it (documented decision)"},
        {"model": "Kontenrahmen", "field": "ID",
         "reason": "business key marked @unique so Prisma relations can reference it (documented decision)"},
        {"model": "Benutzer", "field": "Benutzername",
         "reason": "login identity must be unique at the database so concurrent register/admin-create cannot insert duplicate accounts"},
    ]

    def is_documented(diff):
        return any(d["model"] == diff.get("model") and d["field"] == diff.get("field") for d in documented)

    unexplained = {
        "fields": [d for d in field_diffs if not is_documented(d)],
        "types": [d for d in type_diffs if not is_documented(d)],
        "keys": [d for d in key_diffs if not is_documented(d)],
        "defaults": [d for d in default_diffs if not is_documented(d)],
    }

    report["fields"] = OrderedDict([
        ("scalarCompared", scalar_fields),
        ("relationFieldsAdded", relation_fields),
    ])
    report["documentedExceptions"] = documented
    report["unexplained"] = unexplained
    report["unexplainedCount"] = sum(len(v) for v in unexplained.values())

    io.open(REPORT, "w", encoding="utf-8").write(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    print("models sqlite/mysql:", len(sqlite), "/", len(mysql))
    print("scalar fields compared:", scalar_fields)
    print("relation fields added:", relation_fields)
    print("field diffs:", len(field_diffs), "type diffs:", len(type_diffs),
          "key diffs:", len(key_diffs), "default diffs:", len(default_diffs))
    print("UNEXPLAINED:", report["unexplainedCount"])
    for kind, diffs in unexplained.items():
        for d in diffs[:6]:
            print("  ", kind, d)


if __name__ == "__main__":
    main()
