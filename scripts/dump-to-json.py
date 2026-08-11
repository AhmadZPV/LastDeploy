#!/usr/bin/env python3
# Convert the MySQL dump into per-table JSON for the importer.
# Usage: python3 scripts/dump-to-json.py "<path to dump.sql>"
#
# Output: prisma/dump-data/<Table>.json + _manifest.json
#   - 62 tables (from CREATE TABLE), including the 23 genuinely empty ones
#   - the nine latin1 tables are decoded latin1 -> UTF-8
#   - BLOB/hex literals become {"__hex__": "..."} (the importer maps them back)
import json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
OUT_DIR = os.path.join(PROJECT, 'prisma', 'dump-data')

# latin1 tables per the planning doc (verified against the dump's CHARSET=).
LATIN1_TABLES = {
    'Kontobuch', 'Kalender', 'WV', 'Checklisten', 'Aufteilungsassistent',
    'Vorwegabzuege', 'Zeiten', 'Navigator', 'KlassifikationenKontobuch',
}

ESCAPES = {'n': '\n', 'r': '\r', 't': '\t', '0': '\0', 'Z': '\x1a',
           '\\': '\\', "'": "'", '"': '"'}

def decode_file(path):
    """utf-8 with surrogateescape: non-UTF-8 bytes stay round-trippable so the
    nine latin1 tables can be re-decoded per value."""
    return open(path, 'rb').read().decode('utf-8', errors='surrogateescape')

def fix_latin1(s):
    if not any(0xDC80 <= ord(c) <= 0xDCFF for c in s):
        return s
    try:
        return s.encode('utf-8', errors='surrogateescape').decode('latin1')
    except Exception:
        return s

# --------------------------------------------------------- INSERT scanner

def iter_inserts(text):
    """Yield (table, columns_blob, values_blob) with a string-aware scan for
    the terminating semicolon (strings may contain semicolons)."""
    for m in re.finditer(r'INSERT\s+INTO\s+`([^`]+)`\s*\(([^)]*)\)\s*VALUES\s*', text):
        i = m.end()
        n = len(text)
        while i < n:
            c = text[i]
            if c == "'":
                i += 1
                while i < n:
                    if text[i] == '\\':
                        i += 2
                        continue
                    if text[i] == "'":
                        if i + 1 < n and text[i + 1] == "'":
                            i += 2
                            continue
                        i += 1
                        break
                    i += 1
                continue
            if c == ';':
                break
            i += 1
        yield m.group(1), m.group(2), text[m.end():i]

def split_tuples(values_blob):
    """(...),(...),...  -> row blobs, string-aware."""
    rows = []
    i = 0
    n = len(values_blob)
    while i < n:
        if values_blob[i] == '(':
            depth = 0
            j = i
            while j < n:
                c = values_blob[j]
                if c == "'":
                    j += 1
                    while j < n:
                        if values_blob[j] == '\\':
                            j += 2
                            continue
                        if values_blob[j] == "'":
                            if j + 1 < n and values_blob[j + 1] == "'":
                                j += 2
                                continue
                            j += 1
                            break
                        j += 1
                    continue
                if c == '(':
                    depth += 1
                elif c == ')':
                    depth -= 1
                    if depth == 0:
                        rows.append(values_blob[i:j + 1])
                        j += 1
                        break
                j += 1
            i = j
        else:
            i += 1
    return rows

def parse_row(blob):
    """(v1,'str',NULL,0xFF,...) -> python values."""
    body = blob.strip()
    if body.startswith('(') and body.endswith(')'):
        body = body[1:-1]
    values = []
    i = 0
    n = len(body)
    while i < n:
        c = body[i]
        if c in ' \t\r\n,':
            i += 1
            continue
        if c == "'":
            out = []
            i += 1
            while i < n:
                if body[i] == '\\' and i + 1 < n:
                    out.append(ESCAPES.get(body[i + 1], body[i + 1]))
                    i += 2
                    continue
                if body[i] == "'":
                    if i + 1 < n and body[i + 1] == "'":
                        out.append("'")
                        i += 2
                        continue
                    i += 1
                    break
                out.append(body[i])
                i += 1
            values.append(''.join(out))
            continue
        j = i
        while j < n and body[j] != ',':
            j += 1
        tok = body[i:j].strip()
        i = j
        if tok.upper() == 'NULL':
            values.append(None)
        elif tok.lower().startswith('0x'):
            values.append({'__hex__': tok[2:]})
        elif re.fullmatch(r'-?\d+', tok):
            values.append(int(tok))
        elif re.fullmatch(r'-?\d+\.\d+', tok):
            values.append(float(tok))
        elif tok == '':
            values.append(None)
        else:
            values.append(tok)
    return values

CREATE_RE = re.compile(r'CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`([^`]+)`', re.I)

def main():
    if len(sys.argv) < 2:
        print('usage: dump-to-json.py <dump.sql>', file=sys.stderr)
        return 1
    text = decode_file(sys.argv[1])

    tables = []
    seen = set()
    for t in CREATE_RE.findall(text):
        if t not in seen:
            seen.add(t)
            tables.append(t)

    os.makedirs(OUT_DIR, exist_ok=True)
    data = {t: [] for t in tables}

    for table, cols_blob, values_blob in iter_inserts(text):
        cols = [c.strip().strip('`') for c in cols_blob.split(',')]
        for row_blob in split_tuples(values_blob):
            values = parse_row(row_blob)
            row = {}
            for idx, col in enumerate(cols):
                v = values[idx] if idx < len(values) else None
                if table in LATIN1_TABLES and isinstance(v, str):
                    v = fix_latin1(v)
                row[col] = v
            data.setdefault(table, []).append(row)

    manifest = {}
    total = 0
    empty = 0
    for table in tables:
        rows = data.get(table, [])
        fname = table.replace(' ', '_') + '.json'
        with open(os.path.join(OUT_DIR, fname), 'w', encoding='utf-8') as fh:
            json.dump(rows, fh, ensure_ascii=False)
        manifest[table] = {'file': fname, 'rows': len(rows)}
        total += len(rows)
        if not rows:
            empty += 1

    with open(os.path.join(OUT_DIR, '_manifest.json'), 'w', encoding='utf-8') as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=1)
    print('tables:', len(tables))
    print('rows  :', total)
    print('empty :', empty)
    print('-> ' + OUT_DIR)
    return 0

if __name__ == '__main__':
    sys.exit(main())
