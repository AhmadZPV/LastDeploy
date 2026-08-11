#!/usr/bin/env python3
# Compile include/*_events.php handler bodies into declarative ops.
import json, os, re, sys

SESSION_ASSIGN = re.compile(r'\$values\[\s*["\'](?P<f>[^"\']+)["\']\s*\]\s*=\s*\$_SESSION\[\s*["\'](?P<k>[^"\']+)["\']\s*\]\s*;')
NOW_ASSIGN = re.compile(r'\$values\[\s*["\'](?P<f>[^"\']+)["\']\s*\]\s*=\s*now\(\)\s*;', re.I)
CONST_ASSIGN = re.compile(r'\$values\[\s*["\'](?P<f>[^"\']+)["\']\s*\]\s*=\s*["\'](?P<v>[^"\']*)["\']\s*;')
NUM_ASSIGN = re.compile(r'\$values\[\s*["\'](?P<f>[^"\']+)["\']\s*\]\s*=\s*(?P<v>-?\d+(?:\.\d+)?)\s*;')
RAW_COPY = re.compile(r'\$values\[\s*["\'](?P<f>[^"\']+)["\']\s*\]\s*=\s*\$rawvalues\[\s*["\'](?P<s>[^"\']+)["\']\s*\]\s*;')
MAXSEQ = re.compile(r'select\s+max\(\s*(?P<col>[A-Za-z0-9_]+)\s*\)\s+as\s+(?P<alias>[A-Za-z0-9_]+)\s+from\s+(?P<tbl>[A-Za-z0-9_]+)(?P<rest>[^"\']*)', re.I)
VAR_FROM_MAX = re.compile(r'\$(?P<var>[A-Za-z0-9_]+)\s*=\s*\(\s*\$data\[\s*["\'](?P<alias>[^"\']+)["\']\s*\]\s*\+\s*1\s*\)')
TEAM_FILTER = re.compile(r"Team", re.I)

def body_of(src, fn):
    m = re.search(r'function\s+' + re.escape(fn) + r'\s*\([^)]*\)', src)
    if not m: return ''
    b = src.find('{', m.end())
    if b == -1: return ''
    depth = 0
    for j in range(b, len(src)):
        if src[j] == '{': depth += 1
        elif src[j] == '}':
            depth -= 1
            if depth == 0: return src[b:j+1]
    return ''

def compile_body(body):
    ops = []
    for m in SESSION_ASSIGN.finditer(body):
        ops.append({'op':'sessionCopy','field':m.group('f'),'sessionKey':m.group('k')})
    for m in NOW_ASSIGN.finditer(body):
        ops.append({'op':'now','field':m.group('f')})
    for m in RAW_COPY.finditer(body):
        ops.append({'op':'copyField','field':m.group('f'),'from':m.group('s')})
    seq_vars = {v.group('var'): v.group('alias') for v in VAR_FROM_MAX.finditer(body)}
    for m in MAXSEQ.finditer(body):
        alias = m.group('alias')
        var = next((v for v,a in seq_vars.items() if a == alias), None)
        target = None
        if var:
            um = re.search(r'\$values\[\s*["\']([^"\']+)["\']\s*\]\s*=\s*\$' + re.escape(var) + r'\s*;', body)
            if um: target = um.group(1)
        if not target:
            um = re.search(r'\$values\[\s*["\']([^"\']+)["\']\s*\]\s*=\s*\(\s*\$data\[\s*["\']' + re.escape(alias) + r'["\']\s*\]\s*\+\s*1\s*\)', body)
            if um: target = um.group(1)
        if target:
            ops.append({'op':'nextNumber','field':target,'table':m.group('tbl'),
                        'column':m.group('col'),
                        'scopeTeam': bool(TEAM_FILTER.search(m.group('rest') or ''))})
    seen = {o.get('field') for o in ops}
    for m in CONST_ASSIGN.finditer(body):
        if m.group('f') in seen: continue
        ops.append({'op':'constant','field':m.group('f'),'value':m.group('v')}); seen.add(m.group('f'))
    for m in NUM_ASSIGN.finditer(body):
        if m.group('f') in seen: continue
        ops.append({'op':'constant','field':m.group('f'),'value':float(m.group('v'))}); seen.add(m.group('f'))
    stripped = re.sub(r'//[^\n]*', '', body)
    stmts = [s.strip() for s in stripped.split(';') if s.strip() and s.strip() not in '{}']
    return ops, len(stmts)

def main():
    root = sys.argv[1] if len(sys.argv) > 1 else '.'
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    cat = json.load(open(os.path.join(here,'src/meta/events.json'), encoding='utf-8'))
    out = {}
    stats = {'hooks':0,'compiled':0,'partial':0,'manual':0,'empty':0,'ops':0}
    for entity, info in cat['entities'].items():
        try:
            src = open(os.path.join(root, info['file']), encoding='utf-8', errors='replace').read()
        except OSError:
            continue
        hooks = {}
        for h in info['hooks']:
            stats['hooks'] += 1
            if h['empty'] or not h['function']:
                stats['empty'] += 1; continue
            body = body_of(src, h['function'])
            o, sc = compile_body(body)
            stats['ops'] += len(o)
            if not o:
                if sc > 1: status='manual'; stats['manual']+=1
                else: status='noop'; stats['empty']+=1
            elif len(o) >= max(1, sc-3):
                status='compiled'; stats['compiled']+=1
            else:
                status='partial'; stats['partial']+=1
            hooks[h['hook']] = {'status':status,'ops':o,'statements':sc,'lines':h['lines'],
                                'function':h['function'],'signals':h['signals']}
        if hooks: out[entity] = hooks
    res = {'summary':stats,'entities':out}
    dest = os.path.join(here,'src/meta/event-ops.json')
    json.dump(res, open(dest,'w',encoding='utf-8'), ensure_ascii=False, indent=1)
    for k,v in stats.items(): print('%-10s: %d' % (k,v))
    print('-> ' + dest)

if __name__ == '__main__':
    main()
