#!/usr/bin/env python3
"""Extract dashboard element definitions from the PHP settings files.

Every dashboard page in the source is generated: <Name>_dashboard.php is thin
and the real content lives in include/<Name>_settings.php as `.dashElements`:

    $dbelement = array( "elementName" => "WV_list", "table" => "WV", "type" => 0);
    $dbelement["cellName"] = "cell_0_0";
    $dbelement["inlineEdit"] = 1 > 0;
    $dbelement["masterTable"] = "Objekte";
    ...
    $tdataHeute[".dashElements"][] = $dbelement;

Element types (include/appsettings.php):
    0 LIST, 1 CHART, 2 REPORT, 3 RECORD, 4 SEARCH, 5 DETAILS, 6 MAP, 7 SNIPPET

Also extracted: the dashboard-wide search fields

    $dashField[] = array( "table"=>"WV", "field"=>"Tag" );
    $tdataHeute[".searchFields"]["WV_Tag"] = $dashField;

Output: src/meta/dashboards.json
"""
import io
import json
import os
import re
import sys
from collections import OrderedDict

PHP_DIR = sys.argv[1] if len(sys.argv) > 1 else "/data/src_php/hausverwaltungplus version 1812 vorlage/include"
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "src", "meta", "dashboards.json")

ELEMENT_START = re.compile(r"\$dbelement\s*=\s*array\((.*?)\);")
PAIR = re.compile(r'"(\w+)"\s*=>\s*("[^"]*"|-?\d+)')
ASSIGN = re.compile(r'\$dbelement\["(\w+)"\]\s*=\s*(.*?);')
SEARCH_FIELD = re.compile(r'\$dashField\[\]\s*=\s*array\(\s*"table"\s*=>\s*"([^"]*)"\s*,\s*"field"\s*=>\s*"([^"]*)"\s*\);')
SEARCH_FLUSH = re.compile(r'\$tdata\w*\["\.searchFields"\]\["([^"]+)"\]\s*=\s*\$dashField\s*;')

BOOL_KEYS = (
    "inlineAdd", "inlineEdit", "deleteRecord",
    "popupAdd", "popupEdit", "popupView",
    "updateSelected", "updateMoved",
    "heatMap", "clustering", "isMarkerIconCustom",
)


def literal(raw, key=None):
    """Turn a PHP right-hand side into a python value, or None if dynamic."""
    raw = raw.strip()
    m = re.match(r"^(\d+)\s*>\s*0$", raw)
    if m:
        return m.group(1) != "0"
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


def parse_file(path, entity, dashboards, stats):
    elements = []
    search_fields = OrderedDict()
    current = None
    pending_dash_fields = []

    def commit():
        nonlocal current
        if current and current.get("elementName"):
            elements.append(current)
            stats["elements"] = stats.get("elements", 0) + 1
            t = current.get("type")
            stats["type_%s" % t] = stats.get("type_%s" % t, 0) + 1
        current = None

    text = io.open(path, encoding="utf-8", errors="replace").read()
    for line in text.split("\n"):
        m = ELEMENT_START.search(line)
        if m:
            commit()
            current = {}
            for key, raw in PAIR.findall(m.group(1)):
                value = literal(raw, key)
                if value is not None:
                    current[key] = value
            continue

        m = ASSIGN.search(line)
        if m and current is not None:
            key, raw = m.group(1), m.group(2)
            value = literal(raw, key)
            if value is not None:
                current[key] = value
            continue

        m = SEARCH_FIELD.search(line)
        if m:
            pending_dash_fields.append(OrderedDict([("table", m.group(1)), ("field", m.group(2))]))
            continue

        m = SEARCH_FLUSH.search(line)
        if m:
            search_fields[m.group(1)] = pending_dash_fields
            pending_dash_fields = []
            continue

    commit()
    if elements or search_fields:
        dashboards[entity] = OrderedDict([
            ("elements", elements),
            ("searchFields", search_fields),
        ])
        if search_fields:
            stats["searchFields"] = stats.get("searchFields", 0) + sum(
                len(v) for v in search_fields.values())


def main():
    if not os.path.isdir(PHP_DIR):
        raise SystemExit("php include dir not found: " + PHP_DIR)

    dashboards = OrderedDict()
    stats = {}
    files = sorted(f for f in os.listdir(PHP_DIR) if f.endswith("_settings.php"))
    for name in files:
        entity = name[: -len("_settings.php")]
        parse_file(os.path.join(PHP_DIR, name), entity, dashboards, stats)

    payload = OrderedDict()
    payload["generatedFrom"] = "include/*_settings.php"
    counts = OrderedDict()
    counts["settingsFiles"] = len(files)
    counts["dashboards"] = len(dashboards)
    counts["elements"] = stats.get("elements", 0)
    for key in sorted(k for k in stats if k.startswith("type_")):
        counts[key] = stats[key]
    if stats.get("searchFields"):
        counts["searchFields"] = stats["searchFields"]
    payload["counts"] = counts
    payload["dashboards"] = dashboards

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
