#!/usr/bin/env python3
# Extract buttonhandler.php into a dispatch catalogue, then compile each
# handler's custom snippet into a declarative op -> src/meta/handler-ops.json
# Usage: python3 scripts/extract-button-handlers.py "<php source root>"
#
# Every one of the 139 handlers is the same PHPRunner shell: push a context,
# run a short custom snippet, echo my_json_encode($result). The catalogue
# stores the snippet classification (op) plus what the op needs at runtime
# (page, field, SQL with bind placeholders — never $params embedded in SQL).
import json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)

# The 11 handlers the planning doc names as deliberately manual (huge seed
# blocks, mail fetching, checksums, webhook plumbing).
MANUAL = {
    'SKR03', 'SKR04', 'Immobilien', 'Wohnungswirtschaft', 'Mails_ziehen1',
    'Mails_ziehen11', 'Markierte_buchen', 'Kontrollsummen', 'Webhook',
    'BKVo1', 'BKVo2',
}

# ------------------------------------------------------------ php utilities

def strip_noise(src):
    """Blank comments and string CONTENTS with spaces, preserving length so
    every index in the result still points at the same byte in src."""
    out = list(src)
    i = 0
    n = len(src)
    while i < n:
        c = src[i]
        if c == '/' and i + 1 < n and src[i + 1] == '/':
            j = src.find('\n', i)
            j = n if j == -1 else j
            for k in range(i, j):
                out[k] = ' '
            i = j
            continue
        if c == '#':
            j = src.find('\n', i)
            j = n if j == -1 else j
            for k in range(i, j):
                out[k] = ' '
            i = j
            continue
        if c == '/' and i + 1 < n and src[i + 1] == '*':
            j = src.find('*/', i + 2)
            j = n if j == -1 else j + 2
            for k in range(i, j):
                if src[k] != '\n':
                    out[k] = ' '
            i = j
            continue
        if c in "'\"":
            q = c
            j = i + 1
            while j < n:
                if src[j] == '\\':
                    j += 2
                    continue
                if src[j] == q:
                    j += 1
                    break
                j += 1
            for k in range(i + 1, min(j - 1, n)):
                if src[k] != '\n':
                    out[k] = ' '
            i = j
            continue
        i += 1
    return ''.join(out)

def php_string(expr):
    """Decode a single- or double-quoted PHP literal."""
    expr = expr.strip()
    if len(expr) < 2 or expr[0] not in '"\'' or expr[-1] != expr[0]:
        return None
    body = expr[1:-1]
    out = []
    i = 0
    while i < len(body):
        if body[i] == '\\' and i + 1 < len(body):
            n = body[i + 1]
            out.append({'n': '\n', 'r': '\r', 't': '\t', '\\': '\\',
                        '"': '"', "'": "'", '$': '$'}.get(n, n))
            i += 2
            continue
        out.append(body[i])
        i += 1
    return ''.join(out)

def find_functions(masked, src):
    """name -> (params, body) for every top-level function."""
    funcs = {}
    for m in re.finditer(r'function\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)', masked):
        brace = masked.find('{', m.end())
        if brace == -1:
            continue
        depth = 0
        end = None
        for j in range(brace, len(masked)):
            if masked[j] == '{':
                depth += 1
            elif masked[j] == '}':
                depth -= 1
                if depth == 0:
                    end = j
                    break
        if end is None:
            continue
        funcs[m.group(1)] = (m.group(2).strip(), src[brace:end + 1])
    return funcs

# ------------------------------------------------------------ dispatch table

DISP_RE = re.compile(r'if\s*\(\s*\$buttId\s*==\s*(["\'])\s*\1\s*\)')
BUTTID_RE = re.compile(r'\$buttId\s*==\s*(["\'])(.*?)\1')

def parse_dispatch(masked, src):
    out = []
    for m in DISP_RE.finditer(masked):
        block_src = src[m.start():m.end()]
        id_m = BUTTID_RE.search(block_src)
        if not id_m:
            continue
        butt_id = id_m.group(2)
        brace = masked.find('{', m.end())
        if brace == -1:
            continue
        depth = 0
        end = None
        for j in range(brace, len(masked)):
            if masked[j] == '{':
                depth += 1
            elif masked[j] == '}':
                depth -= 1
                if depth == 0:
                    end = j
                    break
        block = src[brace:end + 1] if end else ''
        table_m = (re.search(r'require_once\(\s*"include/([A-Za-z0-9_]+)_', block)
                   or re.search(r'RunnerCipherer\(\s*"([A-Za-z0-9_]+)"', block))
        fn_m = re.search(r'(buttonHandler_\w+)\s*\(', block)
        out.append({
            'buttId': butt_id,
            'table': table_m.group(1) if table_m else None,
            'function': fn_m.group(1) if fn_m else None,
        })
    return out

# ------------------------------------------------------------- snippet ops

def snippet_of(body):
    push = body.find('RunnerContext::push')
    pop = body.find('RunnerContext::pop')
    if push == -1:
        return body
    start = body.find(';', push)
    start = start + 1 if start != -1 else push
    return body[start:pop if pop != -1 else len(body)]

SHELL_PREFIXES = ('$data = $button->getCurrentRecord()', "$result['record'] = $data")

def clean_snippet(snippet):
    lines = []
    for line in snippet.split('\n'):
        s = line.strip()
        if not s or s == ';' or s.startswith('//'):
            continue
        if any(s.startswith(sh) for sh in SHELL_PREFIXES):
            continue
        lines.append(s)
    return '\n'.join(lines)

def call_args(text, fname):
    """Return inner text of fname(...), string-aware so parens inside quotes
    do not end the call."""
    i = text.find(fname + '(')
    if i == -1:
        return None
    depth = 0
    j = i + len(fname)
    n = len(text)
    while j < n:
        c = text[j]
        if c in '"\'':
            q = c
            j += 1
            while j < n:
                if text[j] == '\\':
                    j += 2
                    continue
                if text[j] == q:
                    j += 1
                    break
                j += 1
            continue
        if c == '(':
            depth += 1
        elif c == ')':
            depth -= 1
            if depth == 0:
                return text[i + len(fname) + 1:j]
        j += 1
    return None

PARAM_REF = re.compile(r'\$params\[\s*["\']([^"\']+)["\']\s*\]')

PHP_ESCAPES = {'n': '\n', 'r': '\r', 't': '\t', '\\': '\\', '"': '"', "'": "'", '$': '$'}

def sql_with_binds(inner):
    """Join the string fragments of a query expression, scanning manually.
    $params[..] references become '?' placeholders with bind entries — the
    runtime binds real values, the SQL never embeds them."""
    parts = []
    binds = []
    i = 0
    n = len(inner)
    while i < n:
        c = inner[i]
        if c in '"\'':
            q = c
            j = i + 1
            buf = []
            while j < n:
                if inner[j] == '\\' and j + 1 < n:
                    buf.append(PHP_ESCAPES.get(inner[j + 1], inner[j + 1]))
                    j += 2
                    continue
                if inner[j] == q:
                    j += 1
                    break
                buf.append(inner[j])
                j += 1
            parts.append(''.join(buf))
            i = j
            continue
        m = PARAM_REF.match(inner, i)
        if m:
            binds.append({'from': 'param', 'name': m.group(1)})
            parts.append('?')
            i = m.end()
            continue
        i += 1
    return ''.join(parts).strip(), binds

def read_php_expr(text, start):
    """Read until the terminating ';' outside quotes; returns the raw expression."""
    i = start
    n = len(text)
    while i < n:
        c = text[i]
        if c in '"\'':
            q = c
            i += 1
            while i < n:
                if text[i] == '\\':
                    i += 2
                    continue
                if text[i] == q:
                    i += 1
                    break
                i += 1
            continue
        if c == ';':
            return text[start:i]
        i += 1
    return None

VAR_REF = re.compile(r'\$(params|_SESSION|data)\[\s*["\']([^"\']+)["\']\s*\]|\$(\w+)')
VAR_REF_FROM = {'params': 'param', '_SESSION': 'session', 'data': 'record'}

def sql_expr_with_binds(expr):
    """Tolerant variant of sql_with_binds: string fragments are joined and
    every PHP reference ($params/$_SESSION/$data/local $var) becomes a bound
    '?' placeholder with its real source recorded."""
    parts = []
    binds = []
    i = 0
    n = len(expr)
    while i < n:
        c = expr[i]
        if c in '"\'':
            q = c
            j = i + 1
            buf = []
            while j < n:
                if expr[j] == '\\' and j + 1 < n:
                    buf.append(PHP_ESCAPES.get(expr[j + 1], expr[j + 1]))
                    j += 2
                    continue
                if expr[j] == q:
                    j += 1
                    break
                buf.append(expr[j])
                j += 1
            parts.append(''.join(buf))
            i = j
            continue
        m = VAR_REF.match(expr, i)
        if m:
            src, name, local = m.group(1), m.group(2), m.group(3)
            if local:
                binds.append({'from': 'local', 'name': local})
            else:
                binds.append({'from': VAR_REF_FROM[src], 'name': name})
            parts.append('?')
            i = m.end()
            continue
        i += 1
    return ''.join(parts).strip(), binds

def resolve_sql_variable(snippet):
    """$sql="select ..."; CustomQuery($sql) -> (sql, binds), or None.
    Mass-operation loops (getNextSelectedRecord) are deliberately left to
    the unrecognised set — they are batch jobs, not scalar lookups."""
    if 'getNextSelectedRecord' in snippet:
        return None
    assigns = {}
    for m in re.finditer(r'\$(\w+)\s*=\s*', snippet):
        expr = read_php_expr(snippet, m.end())
        if expr is not None:
            assigns[m.group(1)] = expr
    calls = re.findall(r'(?:CustomQuery|DB::Query|db_query)\(\s*\$(\w+)', snippet)
    ordered = [assigns[c] for c in calls if c in assigns] + list(assigns.values())
    for expr in ordered:
        sql, binds = sql_expr_with_binds(expr)
        if re.search(r'\b(select|insert|update|delete|truncate)\b', sql, re.I):
            return sql, binds
    return None

def classify(butt_id, table, snippet):
    if butt_id in MANUAL:
        return 'manual', {'source': 'buttonhandler.php::' + butt_id}
    if not snippet:
        return 'noop', {}

    if 'BEGIN:VCARD' in snippet:
        return 'vcard', {}
    if 'BEGIN:VCALENDAR' in snippet:
        return 'ical', {}
    if 'mailto:' in snippet:
        m = re.search(r'\$data\["([^"]+)"\]', snippet)
        return 'mailto', {'field': m.group(1) if m else None}

    m = re.search(r'"(\w+?)_list\.php\?masterkey1=', snippet)
    if m:
        master_m = re.search(r'mastertable=(\w+)', snippet)
        field_m = re.search(r'\$data\["([^"]+)"\]', snippet)
        return 'masterDetailLink', {
            'page': m.group(1),
            'masterTable': master_m.group(1) if master_m else table,
            'masterField': field_m.group(1) if field_m else 'ID',
        }

    # keyed record field: $record=$button->getCurrentRecord(); $result["X"]=$record["Y"];
    m = re.fullmatch(
        r'\$record\s*=\s*\$button->getCurrentRecord\(\)\s*;'
        r'\s*\$result\["([^"]+)"\]\s*=\s*'
        r'(?:base64_encode\(\s*)?\$record\["([^"]+)"\]\s*\)?[\s;]*',
        snippet.strip(), re.S)
    if m:
        return 'recordField', {'resultKey': m.group(1), 'field': m.group(2)}

    # file writer: runner_save_file($path, $record-field)
    if 'runner_save_file(' in snippet:
        path_m = re.search(r'\$(\w+)\s*=\s*"((?:\\.|[^"\\])*)"', snippet)
        field_m = re.search(r'\$data\["([^"]+)"\]', snippet)
        return 'saveFile', {
            'path': php_string('"' + path_m.group(2) + '"') if path_m else None,
            'field': field_m.group(1) if field_m else None,
        }

    # SQL assembled in a variable, then run via CustomQuery/DB::Query/db_query
    resolved = resolve_sql_variable(snippet)
    if resolved:
        sql, binds = resolved
        return 'sqlScalar', {'sql': sql, 'binds': binds}

    m = re.fullmatch(r'\$result\s*=\s*\$data\["([^"]+)"\]\s*;?', snippet.strip(), re.S)
    if m:
        return 'recordField', {'field': m.group(1)}

    if 'DBLookup' in snippet:
        inner = call_args(snippet, 'DB::Query')
        sql, binds = sql_with_binds(inner) if inner else ('', [])
        return 'dbLookupScalar', {'sql': sql, 'binds': binds}

    if re.search(r'\bselect\b', snippet, re.I):
        inner = call_args(snippet, 'DB::Query') or call_args(snippet, 'CustomQuery')
        sql, binds = sql_with_binds(inner) if inner else ('', [])
        if sql:
            return 'sqlScalar', {'sql': sql, 'binds': binds}

    m = re.search(r'"(\w+?)_(list|view|edit|add|search|print|report)\.php(\?[^"]*)?"', snippet)
    if m:
        return 'filterLink', {'page': m.group(1), 'pageType': m.group(2)}

    m = re.fullmatch(
        r'\$result\s*=\s*((?:"(?:\\.|[^"\\])*")|(?:\'(?:\\.|[^\'\\])*\')|-?\d+(?:\.\d+)?)\s*;?',
        snippet.strip(), re.S)
    if m:
        raw = m.group(1)
        val = php_string(raw) if raw[0] in '"\'' else float(raw)
        return 'constant', {'value': val}

    return None, {}

def main():
    src_root = sys.argv[1] if len(sys.argv) > 1 else '.'
    path = os.path.join(src_root, 'buttonhandler.php')
    if not os.path.isfile(path):
        print('buttonhandler.php not found under ' + src_root, file=sys.stderr)
        return 1
    src = open(path, encoding='utf-8', errors='replace').read()
    masked = strip_noise(src)

    dispatch = parse_dispatch(masked, src)
    funcs = find_functions(masked, src)

    specs = {}
    unrecognised = []
    for entry in dispatch:
        butt_id = entry['buttId']
        fn = entry['function']
        body = funcs.get(fn, ('', ''))[1] if fn else ''
        snippet = clean_snippet(snippet_of(body))
        op, extra = classify(butt_id, entry['table'], snippet)
        spec = {'op': op or 'unrecognised', 'table': entry['table'], **extra}
        specs[butt_id] = spec
        if op is None:
            unrecognised.append({'buttId': butt_id, 'sample': snippet[:120]})

    automated = sum(1 for s in specs.values() if s['op'] not in ('manual', 'unrecognised'))
    manual = sum(1 for s in specs.values() if s['op'] == 'manual')
    unrec = sum(1 for s in specs.values() if s['op'] == 'unrecognised')

    result = {
        'generatedFrom': 'buttonhandler.php',
        'summary': {
            'total': len(specs),
            'automated': automated,
            'manual': manual,
            'unrecognised': unrec,
        },
        'specs': specs,
        'unrecognisedSamples': unrecognised,
    }
    dest = os.path.join(PROJECT, 'src', 'meta', 'handler-ops.json')
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    json.dump(result, open(dest, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

    from collections import Counter
    dist = Counter(s['op'] for s in specs.values())
    print('dispatch entries :', len(dispatch))
    print('handler functions:', len(funcs))
    print('total            :', len(specs))
    print('automated        :', automated)
    print('manual           :', manual)
    print('unrecognised     :', unrec)
    print('op distribution  :', dict(dist))
    print('-> ' + dest)
    return 0

if __name__ == '__main__':
    sys.exit(main())
