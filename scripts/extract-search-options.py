#!/usr/bin/env python3
"""Extract per-field search operators from the PHP settings files.

Every field block in include/<Entity>_settings.php declares how the list-page
search treats that field:

    $fdata["defaultSearchOption"] = "Contains";
    $fdata["searchOptionsList"] = array("Contains", "Equals", "Starts with",
        "More than", "Less than", "Between", "Empty", NOT_EMPTY);

NOT_EMPTY and EMPTY_SEARCH are constants from include/appsettings.php
("NOT Empty" / "Empty"). The block ends at `$tdata<Table>["<Field>"] = $fdata;`
— the same terminator the lookup extractor uses.

Output: src/meta/search-options.json
"""
import io
import json
import os
import re
import sys
from collections import OrderedDict

PHP_DIR = sys.argv[1] if len(sys.argv) > 1 else "/data/src_php/hausverwaltungplus version 1812 vorlage/include"
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "src", "meta", "search-options.json")

DEFAULT_OPT = re.compile(r'\$fdata\["defaultSearchOption"\]\s*=\s*"([^"]*)"\s*;')
OPTIONS_LIST = re.compile(r'\$fdata\["searchOptionsList"\]\s*=\s*array\((.*?)\)\s*;')
FLUSH = re.compile(r'\$tdata\w*\["([^"]+)"\]\s*=\s*\$fdata\s*;')

CONSTANTS = {
    "NOT_EMPTY": "NOT Empty",
    "EMPTY_SEARCH": "Empty",
}


def parse_options(raw):
    options = []
    for token in raw.split(","):
        token = token.strip()
        if not token:
            continue
        if token.startswith('"') and token.endswith('"') and len(token) >= 2:
            options.append(token[1:-1])
        elif token in CONSTANTS:
            options.append(CONSTANTS[token])
        # anything else is dynamic PHP and is skipped
    return options


def parse_file(path, entity, entities, stats):
    pending = {}
    text = io.open(path, encoding="utf-8", errors="replace").read()
    for line in text.split("\n"):
        m = FLUSH.search(line)
        if m:
            if pending:
                record = {}
                if pending.get("options"):
                    record["options"] = pending["options"]
                    stats["options"] = stats.get("options", 0) + 1
                if pending.get("default"):
                    record["default"] = pending["default"]
                    stats["default"] = stats.get("default", 0) + 1
                if record:
                    entities.setdefault(entity, OrderedDict())[m.group(1)] = record
            pending = {}
            continue

        m = DEFAULT_OPT.search(line)
        if m:
            pending["default"] = m.group(1)
            continue

        m = OPTIONS_LIST.search(line)
        if m:
            pending["options"] = parse_options(m.group(1))


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
    counts = OrderedDict([
        ("settingsFiles", len(files)),
        ("entitiesWithOptions", len(entities)),
        ("fieldsWithOptions", field_count),
        ("withOptionsList", stats.get("options", 0)),
        ("withDefault", stats.get("default", 0)),
    ])

    payload = OrderedDict()
    payload["generatedFrom"] = "include/*_settings.php"
    payload["counts"] = counts
    payload["entities"] = entities

    out = os.path.abspath(OUT)
    if not os.path.isdir(os.path.dirname(out)):
        os.makedirs(os.path.dirname(out))
    io.open(out, "w", encoding="utf-8").write(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n"
    )
    print("wrote", out)
    for key, value in counts.items():
        print(" ", key, value)


if __name__ == "__main__":
    main()
