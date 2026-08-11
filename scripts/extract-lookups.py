#!/usr/bin/env python3
"""Extract dependent-lookup and filter wiring from the PHP settings files.

src/field-format.js already reads the static half of a lookup (LookupTable,
LinkField, DisplayField, LookupWhere, LookupOrderBy). What it cannot see is the
DYNAMIC half: which dropdown narrows which other dropdown.

PHPRunner stores that in three places inside include/<Entity>_settings.php:

  $edata["DependentLookups"][]   -- the edit fields whose option list must be
                                    reloaded when THIS field changes
  $fdata["parentFilterField"]    -- the filter this field is filtered BY
  $fdata["parentFilters"][]
  $fdata["dependentFilterName"]  -- the filter this field narrows
  $fdata["dependentFilters"][]
  $edata["LookupUnique"]         -- the lookup value must stay unique

A field block ends with an assignment of the shape
    $tdata<Table>["<Field>"] = $fdata;
so values are accumulated and flushed when that terminator appears.

Output: src/meta/lookup-links.json
"""
import io
import json
import os
import re
import sys
from collections import OrderedDict

PHP_DIR = sys.argv[1] if len(sys.argv) > 1 else "/data/src_php/hausverwaltungplus version 1812 vorlage/include"
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src", "meta", "lookup-links.json")

ARR = re.compile(r'\$[a-z]data\["(\w+)"\]\[\]\s*=\s*(.+?);')
SCALAR = re.compile(r'\$[a-z]data\["(\w+)"\]\s*=\s*(.+?);')
FLUSH = re.compile(r'\$tdata\w*\["([^"]+)"\]\s*=\s*\$[fe]data\s*;')

ARRAY_KEYS = ("DependentLookups", "parentFilters", "dependentFilters")
SCALAR_KEYS = (
    "parentFilterField",
    "dependentFilterName",
    "LookupUnique",
    "LookupTable",
    "LinkField",
    "DisplayField",
    "LookupType",
    "LCType",
)


def literal(raw):
    """Turn a PHP right-hand side into a python value, or None if dynamic."""
    raw = raw.strip()
    if raw.startswith('"') and raw.endswith('"') and len(raw) >= 2:
        return raw[1:-1]
    if raw.startswith("'") and raw.endswith("'") and len(raw) >= 2:
        return raw[1:-1]
    if raw == "true":
        return True
    if raw == "false":
        return False
    if re.match(r"^-?\d+$", raw):
        return int(raw)
    return None


def parse_file(path, entity, entities, stats):
    pending = {}
    text = io.open(path, encoding="utf-8", errors="replace").read()
    for line in text.split("\n"):
        m = FLUSH.search(line)
        if m:
            field = m.group(1)
            if pending:
                record = {}
                for key in ARRAY_KEYS:
                    if pending.get(key):
                        record[key] = pending[key]
                        stats[key] = stats.get(key, 0) + len(pending[key])
                for key in SCALAR_KEYS:
                    if key in pending and pending[key] not in (None, "", False):
                        record[key] = pending[key]
                # only keep fields that actually carry dynamic wiring
                dynamic = any(k in record for k in ARRAY_KEYS) or \
                    "parentFilterField" in record or \
                    "dependentFilterName" in record or \
                    record.get("LookupUnique") is True
                if dynamic:
                    entities.setdefault(entity, OrderedDict())[field] = record
                    if record.get("LookupUnique") is True:
                        stats["LookupUnique"] = stats.get("LookupUnique", 0) + 1
            pending = {}
            continue

        m = ARR.search(line)
        if m and m.group(1) in ARRAY_KEYS:
            value = literal(m.group(2))
            if value is not None:
                pending.setdefault(m.group(1), []).append(value)
            continue

        m = SCALAR.search(line)
        if m and m.group(1) in SCALAR_KEYS:
            value = literal(m.group(2))
            if value is not None:
                pending[m.group(1)] = value


def main():
    if not os.path.isdir(PHP_DIR):
        raise SystemExit("php include dir not found: " + PHP_DIR)

    entities = OrderedDict()
    stats = {}
    files = sorted(f for f in os.listdir(PHP_DIR) if f.endswith("_settings.php"))
    for name in files:
        entity = name[: -len("_settings.php")]
        parse_file(os.path.join(PHP_DIR, name), entity, entities, stats)

    field_count = sum(len(v) for v in entities.values())
    payload = OrderedDict()
    payload["generatedFrom"] = "include/*_settings.php"
    payload["counts"] = OrderedDict([
        ("settingsFiles", len(files)),
        ("entitiesWithLinks", len(entities)),
        ("fieldsWithLinks", field_count),
        ("dependentLookups", stats.get("DependentLookups", 0)),
        ("parentFilters", stats.get("parentFilters", 0)),
        ("dependentFilters", stats.get("dependentFilters", 0)),
        ("lookupUnique", stats.get("LookupUnique", 0)),
    ])
    payload["entities"] = entities

    out = os.path.abspath(OUT)
    if not os.path.isdir(os.path.dirname(out)):
        os.makedirs(os.path.dirname(out))
    io.open(out, "w", encoding="utf-8").write(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n"
    )
    print("wrote", out)
    for key, value in payload["counts"].items():
        print(" ", key, value)


if __name__ == "__main__":
    main()
