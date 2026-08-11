#!/usr/bin/env python3
# Extract include/*_events.php into a declarative catalogue -> src/meta/events.json
# Usage: python3 scripts/extract-events.py "<php source root>"
import json, os, re, sys

HOOK_RE = re.compile(r'\["((?:Before|After|On|Is)[A-Za-z]*)"\]')
FUNC_RE = re.compile(r'function\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)')

SIGNALS = [
    ("sqlWrite", re.compile(r'\b(INSERT\s+INTO|UPDATE\s|DELETE\s+FROM)\b', re.I)),
    ("sqlRead", re.compile(r'\bSELECT\b', re.I)),
    ("mail", re.compile(r'runner_mail|smtp|mail\s*\(', re.I)),
    ("file", re.compile(r'fopen|file_put_contents|move_uploaded_file', re.I)),
    ("redirect", re.compile(r'header\s*\(\s*["\']Location', re.I)),
    ("session", re.compile(r'\$_SESSION')),
    ("validation", re.compile(r'\$message\s*=|return\s+false')),
    ("defaults", re.compile(r'\$values\[')),
    ("webhook", re.compile(r'Webhook|curl_', re.I)),
]

def strip_noise(src):
    out = []; i = 0; n = len(src)
    while i < n:
        c = src[i]
        if c == '/' and i+1 < n and src[i+1] == '/':
            j = src.find('\n', i); i = n if j == -1 else j; continue
        if c == '#':
            j = src.find('\n', i); i = n if j == -1 else j; continue
        if c == '/' and i+1 < n and src[i+1] == '*':
            j = src.find('*/', i+2); i = n if j == -1 else j+2; continue
        if c in "'\"":
            q = c; i += 1
            while i < n:
                if src[i] == '\\': i += 2; continue
                if src[i] == q: i += 1; break
                i += 1
            out.append('""'); continue
        out.append(c); i += 1
    return ''.join(out)

def function_bodies(src):
    masked = strip_noise(src)
    for m in FUNC_RE.finditer(masked):
        brace = masked.find('{', m.end())
        if brace == -1: continue
        depth = 0; end = None
        for j in range(brace, len(masked)):
            if masked[j] == '{': depth += 1
            elif masked[j] == '}':
                depth -= 1
                if depth == 0: end = j; break
        if end is None: continue
        yield m.group(1), m.group(2).strip(), src[brace:end+1]

def classify(body):
    return sorted({k for k, rx in SIGNALS if rx.search(body)})

def main():
    root = sys.argv[1] if len(sys.argv) > 1 else '.'
    inc = os.path.join(root, 'include')
    if not os.path.isdir(inc):
        print('include/ not found under ' + root, file=sys.stderr); return 1
    files = sorted(f for f in os.listdir(inc) if f.endswith('_events.php'))
    entities = {}; hook_totals = {}; total_hooks = 0; total_funcs = 0
    for fname in files:
        entity = fname[:-len('_events.php')]
        src = open(os.path.join(inc, fname), encoding='utf-8', errors='replace').read()
        hooks = HOOK_RE.findall(src)
        bodies = {n: (p, b) for n, p, b in function_bodies(src)}
        total_funcs += len(bodies)
        handlers = []
        for hook in hooks:
            total_hooks += 1
            hook_totals[hook] = hook_totals.get(hook, 0) + 1
            cand = [n for n in bodies if n.startswith(hook)]
            fn = cand[0] if cand else None
            body = bodies.get(fn, ('', ''))[1] if fn else ''
            handlers.append({
                'hook': hook, 'function': fn,
                'params': bodies.get(fn, ('', ''))[0] if fn else '',
                'lines': body.count('\n'),
                'signals': classify(body),
                'empty': len(re.sub(r'[\s{}]', '', body)) == 0,
            })
        entities[entity] = {'file': 'include/' + fname, 'lines': src.count('\n'),
                            'hooks': handlers, 'functionCount': len(bodies)}
    non_empty = sum(1 for e in entities.values() for h in e['hooks'] if not h['empty'])
    writes = sum(1 for e in entities.values() for h in e['hooks'] if 'sqlWrite' in h['signals'])
    result = {'summary': {'eventFiles': len(files), 'hooks': total_hooks,
              'handlerFunctions': total_funcs, 'nonEmptyHooks': non_empty,
              'emptyHooks': total_hooks - non_empty, 'hooksWithDbWrites': writes,
              'byHook': dict(sorted(hook_totals.items(), key=lambda kv: -kv[1]))},
              'entities': entities}
    out_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'src', 'meta')
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, 'events.json')
    json.dump(result, open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    s = result['summary']
    for k in ('eventFiles','hooks','handlerFunctions','nonEmptyHooks','emptyHooks','hooksWithDbWrites'):
        print('%-18s: %d' % (k, s[k]))
    print('byHook:', json.dumps(s['byHook'], indent=1))
    print('-> ' + out)
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
