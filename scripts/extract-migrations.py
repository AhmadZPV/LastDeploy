#!/usr/bin/env python3
"""Extract the revision ladder from include/events.php.

The source migrates its database inside the application start event: each step
is guarded by the revision stored in Einstellungen.Revision and ends by
setting the next one:

    if(DBLookup($sql)=="1806")
    {
      $sql="UPDATE Abrechnungen SET Team='Team'"; CustomQuery($sql);
      ...
      $sql="Update Einstellungen set Revision='1807' where ID=1";
      CustomQuery($sql);
    }

SQL strings may span several lines inside the quotes. The first step (1804)
has no numeric guard: it checks `show columns ... like 'Revision'` instead.

Output: src/meta/migrations.json with the ordered steps and their statements.
"""
import io
import json
import os
import re
import sys
from collections import OrderedDict

EVENTS = sys.argv[1] if len(sys.argv) > 1 else "/data/src_php/hausverwaltungplus version 1812 vorlage/include/events.php"
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "src", "meta", "migrations.json")

GUARD = re.compile(r'if\s*\(\s*DBLookup\(\$sql\)\s*==\s*"(\d+)"\s*\)')
SET_REV = re.compile(r"Update\s+Einstellungen\s+set\s+Revision='(\d+)'", re.I)
SQL_START = re.compile(r'\$sql\w*\s*=[^=]*?"(.*)$')


def collect_statement(lines, i):
    """Collect a (possibly multi-line) double-quoted PHP string from line i.

    Returns (text, next_index_after_statement)."""
    buf = []
    while i < len(lines):
        line = lines[i]
        j = 0
        while j < len(line):
            ch = line[j]
            if ch == '\\' and j + 1 < len(line):
                buf.append(line[j:j + 2])
                j += 2
                continue
            if ch == '"':
                # end of the string literal
                return "".join(buf), i + 1
            buf.append(ch)
            j += 1
        buf.append("\n")
        i += 1
    return "".join(buf), i


def main():
    if not os.path.isfile(EVENTS):
        raise SystemExit("events.php not found: " + EVENTS)
    lines = io.open(EVENTS, encoding="utf-8", errors="replace").read().split("\n")

    steps = []
    i = 0
    current = None
    while i < len(lines):
        line = lines[i]

        m = GUARD.search(line)
        if m:
            current = {"from": m.group(1), "to": None, "sql": []}
            i += 1
            continue

        if current is not None:
            m = SET_REV.search(line)
            if m and "CustomQuery" in (lines[i + 1] if i + 1 < len(lines) else ""):
                current["to"] = m.group(1)
                steps.append(current)
                current = None
                i += 1
                continue

            m = SQL_START.search(line)
            if m and "CustomQuery" not in line:
                rest = m.group(1)
                if '"' in rest:
                    # single-line string
                    stmt = rest[:rest.index('"')]
                    if stmt.strip():
                        current["sql"].append(stmt)
                else:
                    stmt, nxt = collect_statement([rest] + lines[i + 1:], 0)
                    if stmt.strip():
                        current["sql"].append(stmt.strip())
                    i = i + nxt - 1  # sliced-frame index -> absolute line
                i += 1
                continue

            # leaving the guarded block without a revision update
            if line.strip() == "}" and current is not None and not current["sql"]:
                current = None

        i += 1

    payload = OrderedDict([
        ("generatedFrom", "include/events.php"),
        ("revisionColumn", "Einstellungen.Revision (ID=1)"),
        ("steps", steps),
        ("counts", OrderedDict([
            ("steps", len(steps)),
            ("statements", sum(len(s["sql"]) for s in steps)),
        ])),
    ])

    out = os.path.abspath(OUT)
    io.open(out, "w", encoding="utf-8").write(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
    print("wrote", out)
    print("steps:", [(s["from"], s["to"], len(s["sql"])) for s in steps])


if __name__ == "__main__":
    main()
