import json
import os
import re

SOURCE = os.environ.get('PHP_SOURCE', r'C:\Users\Davoodsina\Desktop\New folder (2)\hausverwaltungplus version 1812 vorlage')
INPUT = os.path.join(SOURCE, 'buttonhandler.php')
OUTPUT = os.path.join(os.path.dirname(__file__), '..', 'src', 'meta', 'account-templates.json')
NAMES = ['Immobilien', 'Wohnungswirtschaft', 'SKR03', 'SKR04']
FIELDS = ['Buchfuehrung', 'Klasse', 'Gruppe', 'Nummer', 'Kontobezeichnung', 'GuV', 'Aktiva', 'Passiva', 'UStVA', 'Team']


def function_body(text, name):
    start = text.index('function buttonHandler_' + name)
    brace = text.index('{', start)
    depth = 0
    quote = None
    escaped = False
    for i in range(brace, len(text)):
        ch = text[i]
        if quote:
            if escaped:
                escaped = False
            elif ch == '\\':
                escaped = True
            elif ch == quote:
                quote = None
            continue
        if ch in "'\"":
            quote = ch
        elif ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                return text[brace + 1:i]
    raise ValueError(name)


def tuples(sql):
    marker = re.search(r'\bVALUES\b', sql, re.I)
    if not marker:
        return []
    text = sql[marker.end():]
    rows, row, cell = [], [], ''
    depth = 0
    quote = None
    i = 0
    while i < len(text):
        ch = text[i]
        if quote:
            if ch == quote and (i == 0 or text[i - 1] != '\\'):
                quote = None
            else:
                cell += ch
        elif ch == "'":
            quote = ch
        elif ch == '(':
            if depth:
                cell += ch
            depth += 1
        elif ch == ')' and depth:
            depth -= 1
            if depth == 0:
                row.append(cell.strip())
                rows.append(row)
                row, cell = [], ''
            else:
                cell += ch
        elif ch == ',' and depth == 1:
            row.append(cell.strip())
            cell = ''
        elif depth:
            cell += ch
        i += 1
    return rows


def clean(value):
    value = value.strip()
    if '$buchfuehrung' in value:
        return '$BUCHFUEHRUNG'
    if '$team' in value or 'SESSION["Team"]' in value:
        return '$TEAM'
    if value.upper() == 'NULL' or value == '':
        return None
    value = re.sub(r'"\.\$\w+\."', '', value)
    return value.replace('\\r', '\r').replace('\\n', '\n').replace('\\\"', '"')


with open(INPUT, 'r', encoding='utf-8', errors='replace') as handle:
    source = handle.read()

profiles = {}
for name in NAMES:
    body = function_body(source, name)
    rows = []
    for values_match in re.finditer(r'INSERT\s+INTO\s+`?Kontenrahmen`?[\s\S]*?VALUES[\s\S]*?;"', body, re.I):
        for values in tuples(values_match.group(0)):
            if len(values) >= len(FIELDS):
                rows.append(dict(zip(FIELDS, [clean(v) for v in values[:len(FIELDS)]])))
    profiles[name] = rows

with open(OUTPUT, 'w', encoding='utf-8') as handle:
    json.dump({'source': 'buttonhandler.php', 'profiles': profiles}, handle, ensure_ascii=False, indent=2)
    handle.write('\n')
print({name: len(rows) for name, rows in profiles.items()})
