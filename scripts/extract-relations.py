#!/usr/bin/env python3
"""Extract the master/detail relation catalogue from the PHP settings files.

Every include/<Master>_settings.php declares its detail tables as a run of
$detailsParam[...] assignments closed by
    $detailsTablesData["<Master>"][$dIndex] = $detailsParam;
followed by the key lists
    $detailsTablesData["<Master>"][$dIndex]["masterKeys"][]="ID";
    $detailsTablesData["<Master>"][$dIndex]["detailKeys"][]="Objekt";

We emit src/meta/relations.json:
    { "<Master>": [ {detail, masterKeys, detailKeys, previewOn*, ...}, ... ] }
"""
import json, os, re, sys

SRC = sys.argv[1] if len(sys.argv) > 1 else '.'
OUT = os.path.join('src', 'meta', 'relations.json')

INC = os.path.join(SRC, 'include')
if not os.path.isdir(INC):
    sys.exit('no include/ directory under ' + SRC)

PARAM = re.compile(r'\$detailsParam\["(\w+)"\]\s*=\s*([^;]+);')
COMMIT = re.compile(r'\$detailsTablesData\["([^"]+)"\]\[\$dIndex\]\s*=\s*\$detailsParam\s*;')
KEY = re.compile(r'\$detailsTablesData\["([^"]+)"\]\[\$dIndex\]\["(masterKeys|detailKeys)"\]\[\]\s*=\s*"([^"]*)"')
IDX = re.compile(r'\$dIndex\s*=\s*(\d+)\s*;')


def clean(raw):
    v = raw.strip()
    if v.startswith('"') and v.endswith('"'):
        return v[1:-1]
    if v in ('true', 'false'):
        return v == 'true'
    if re.fullmatch(r'-?\d+', v):
        return int(v)
    return v


WANTED = ('dDataSourceTable', 'dOriginalTable', 'dShortTable', 'dType',
          'dispChildCount', 'hideChild', 'proceedLink',
          'previewOnList', 'previewOnAdd', 'previewOnEdit', 'previewOnView')

relations = {}
files = sorted(f for f in os.listdir(INC) if f.endswith('_settings.php'))
scanned = 0

for fname in files:
    text = open(os.path.join(INC, fname), encoding='utf-8', errors='replace').read()
    if '$detailsTablesData' not in text:
        continue
    scanned += 1
    current = {}
    index = None
    committed = {}
    for line in text.split('\n'):
        m = IDX.search(line)
        if m:
            index = int(m.group(1))
            current = {}
            continue
        m = PARAM.search(line)
        if m:
            k, v = m.group(1), clean(m.group(2))
            if k in WANTED:
                current[k] = v
            continue
        m = COMMIT.search(line)
        if m:
            master = m.group(1)
            rec = {
                'detail': current.get('dDataSourceTable') or current.get('dOriginalTable'),
                'originalTable': current.get('dOriginalTable'),
                'shortTable': current.get('dShortTable'),
                'dType': current.get('dType'),
                'masterKeys': [], 'detailKeys': [],
                'dispChildCount': bool(current.get('dispChildCount')),
                'hideChild': bool(current.get('hideChild')),
                'previewOnList': bool(current.get('previewOnList')),
                'previewOnAdd': bool(current.get('previewOnAdd')),
                'previewOnEdit': bool(current.get('previewOnEdit')),
                'previewOnView': bool(current.get('previewOnView')),
            }
            relations.setdefault(master, [])
            slot = index if index is not None else len(relations[master])
            while len(relations[master]) <= slot:
                relations[master].append(None)
            relations[master][slot] = rec
            committed[(master, slot)] = rec
            continue
        m = KEY.search(line)
        if m:
            master, which, value = m.group(1), m.group(2), m.group(3)
            rec = committed.get((master, index))
            if rec is not None and value:
                rec[which].append(value)

for master in list(relations):
    relations[master] = [r for r in relations[master] if r and r.get('detail')]
    if not relations[master]:
        del relations[master]

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, 'w', encoding='utf-8') as fh:
    json.dump(relations, fh, ensure_ascii=False, indent=1, sort_keys=True)

total = sum(len(v) for v in relations.values())
unkeyed = sum(1 for v in relations.values() for r in v if not r['masterKeys'] or not r['detailKeys'])
print('settings files with details:', scanned)
print('masters:', len(relations))
print('relations:', total)
print('relations missing keys:', unkeyed)
print('wrote', OUT)
