#!/usr/bin/env python3
"""Turn the logical master/detail relations into real Prisma relations.

src/meta/relations.json holds the 102 master/detail relations the source
declares (extracted by scripts/extract-relations.py). This generator adds the
physical ones to prisma/schema.prisma:

  detail side:  rel_<Master>_<fk>  <Master>? @relation("rel_<Master>_<Detail>_<fk>", fields: [<fk>], references: [ID])
  master side:  rel_<Detail>_<fk>  <Detail>[] @relation("rel_<Master>_<Detail>_<fk>")

Rules:
  - virtual masters resolve to their base table (Angebote -> Verkauf, ...)
  - only true foreign keys become relations: masterKeys == ["ID"]
  - Buchfuehrungen/Kontenrahmen keep their SQLite rowid @id; their business
    key ID is marked @unique so relations can reference it (documented)
  - everything else is skipped WITH A REASON, never silently:
      composite_key          4 relations with multi-column keys
      non_unique_master_key  business-key masters (e.g. Kalender.Tag)
      audit_detail           the four *Historie details live in the audit table
      fk_column_missing      the detail model has no such column
  - several entity relations can share one physical FK (DirekteKosten and
    Vorauszahlungen both base on Kosten); those are deduped, not duplicated

Idempotent: an existing relation name is not written twice.
Writes src/meta/relation-report.json with the full account.
"""
import glob
import io
import json
import os
import re
from collections import OrderedDict

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
SCHEMA = os.path.join(ROOT, "prisma", "schema.prisma")
RELATIONS = os.path.join(ROOT, "src", "meta", "relations.json")
ENTITIES = os.path.join(ROOT, "src", "meta", "entities")
REPORT = os.path.join(ROOT, "src", "meta", "relation-report.json")

UNIQUE_ID_MODELS = ("Buchfuehrungen", "Kontenrahmen")

MODEL_RE = re.compile(r"model\s+(\w+)\s*\{([\s\S]*?)\n\}")
FIELD_RE = re.compile(r"^(\w+)\s+(\w+)(\[\])?(\?)?")


def load_base_tables():
    base = {}
    for path in glob.glob(os.path.join(ENTITIES, "*.json")):
        try:
            meta = json.load(io.open(path, encoding="utf-8"))
        except Exception:
            continue
        entity = meta.get("entity")
        if entity:
            base[entity] = meta.get("baseTable")
    return base


def parse_models(schema_text):
    models = OrderedDict()
    for m in MODEL_RE.finditer(schema_text):
        name, body = m.group(1), m.group(2)
        fields = OrderedDict()
        for raw in body.split("\n"):
            line = raw.strip()
            if not line or line.startswith("//") or line.startswith("@@"):
                continue
            fm = FIELD_RE.match(line)
            if fm:
                fields[fm.group(1)] = {"type": fm.group(2), "optional": bool(fm.group(4)), "line": line}
        models[name] = {"fields": fields, "span": (m.start(), m.end())}
    return models


def main():
    schema = io.open(SCHEMA, encoding="utf-8").read()
    relations = json.load(io.open(RELATIONS, encoding="utf-8"))
    base_tables = load_base_tables()
    models = parse_models(schema)

    generated = []
    deduped = []
    skipped = []
    seen = {}  # (masterModel, detailModel, fk) -> relation name

    # relation lines to insert per model
    inserts = {name: [] for name in models}

    for master, rels in relations.items():
        master_model = master if master in models else base_tables.get(master)
        for rel in rels:
            detail = rel.get("detail")
            detail_model = rel.get("originalTable") or detail
            master_keys = rel.get("masterKeys") or []
            detail_keys = rel.get("detailKeys") or []

            entry = {"master": master, "detail": detail, "masterKeys": master_keys, "detailKeys": detail_keys}

            if detail_model not in models:
                skipped.append({**entry, "reason": "audit_detail"})
                continue
            if not master_model or master_model not in models:
                skipped.append({**entry, "reason": "no_master_model"})
                continue
            if len(master_keys) > 1 or len(detail_keys) > 1:
                skipped.append({**entry, "reason": "composite_key"})
                continue
            if master_keys != ["ID"]:
                skipped.append({**entry, "reason": "non_unique_master_key"})
                continue
            if not detail_keys:
                skipped.append({**entry, "reason": "no_detail_key"})
                continue

            fk = detail_keys[0]
            fk_field = models[detail_model]["fields"].get(fk)
            if not fk_field:
                skipped.append({**entry, "reason": "fk_column_missing"})
                continue
            if fk_field["type"] != "Int":
                skipped.append({**entry, "reason": "fk_not_int"})
                continue

            dedupe_key = (master_model, detail_model, fk)
            if dedupe_key in seen:
                deduped.append({**entry, "relation": seen[dedupe_key]})
                continue

            rel_name = "rel_%s_%s_%s" % (master_model, detail_model, fk)
            seen[dedupe_key] = rel_name

            if rel_name in schema:
                deduped.append({**entry, "relation": rel_name, "alreadyInSchema": True})
                continue

            rel_mark = "?" if fk_field["optional"] else ""
            detail_line = (
                "  rel_%s_%s %s%s @relation(\"%s\", fields: [%s], references: [ID])"
                % (master_model, fk, master_model, rel_mark, rel_name, fk)
            )
            master_line = (
                "  rel_%s_%s %s[] @relation(\"%s\")"
                % (detail_model, fk, detail_model, rel_name)
            )
            inserts[detail_model].append(detail_line)
            inserts[master_model].append(master_line)
            generated.append({**entry, "relation": rel_name, "masterModel": master_model, "detailModel": detail_model, "fk": fk})

    # rebuild the schema, inserting relation lines before each closing brace
    out = []
    last = 0
    for m in MODEL_RE.finditer(schema):
        name = m.group(1)
        body = m.group(2)
        new_body = body
        if name in UNIQUE_ID_MODELS and "@unique" not in body:
            # ID stays the business key; rowid is only the SQLite identity shim
            new_body = re.sub(r"(?m)^(\s*ID\s+Int)(\s*)$", r"\1 @unique\2", new_body)
        lines = inserts.get(name) or []
        if lines:
            new_body = new_body.rstrip("\n") + "\n" + "\n".join(lines) + "\n"
        out.append(schema[last:m.start()])
        out.append("model %s {%s\n}" % (name, new_body))
        last = m.end()
    out.append(schema[last:])
    new_schema = "".join(out)

    if new_schema != schema:
        io.open(SCHEMA, "w", encoding="utf-8").write(new_schema)

    report = OrderedDict([
        ("generatedFrom", "src/meta/relations.json"),
        ("counts", OrderedDict([
            ("relations", sum(len(v) for v in relations.values())),
            ("generated", len(generated)),
            ("deduped", len(deduped)),
            ("skipped", len(skipped)),
            ("uniqueBusinessKeys", list(UNIQUE_ID_MODELS)),
        ])),
        ("generated", generated),
        ("deduped", deduped),
        ("skipped", skipped),
    ])
    io.open(REPORT, "w", encoding="utf-8").write(json.dumps(report, indent=2, ensure_ascii=False) + "\n")

    print("relations total:", report["counts"]["relations"])
    print("generated:", len(generated))
    print("deduped:", len(deduped))
    reasons = {}
    for s in skipped:
        reasons[s["reason"]] = reasons.get(s["reason"], 0) + 1
    print("skipped:", len(skipped), reasons)
    print("relation attributes in schema:", new_schema.count("@relation"))


if __name__ == "__main__":
    main()
