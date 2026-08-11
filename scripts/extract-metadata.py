#!/usr/bin/env python3
# Extract include/*_settings.php into per-entity manifests -> src/meta/entities/<Entity>.json
# Also writes src/meta/virtual-entities.json (entities that are views over base tables).
# Usage: python3 scripts/extract-metadata.py "<php source root>"
#
# The PHPRunner settings file is code, not data: field sets are built with
# append syntax ($tdataX[".listFields"][] = "Feld";), keys/orderby travel
# through PHP variables, and every field carries a $fdata block with
# ViewFormats/EditFormats sub-blocks. This extractor evaluates all of that
# into plain JSON so the Node side never has to parse PHP.
import json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)

# ------------------------------------------------------------ PHP literals

def parse_scalar(expr, variables):
    """Parse a PHP literal: string, number, bool, null, or $var reference."""
    expr = expr.strip()
    if not expr:
        return None
    # string concatenation: "a" . $var . 'b'
    if '.' in expr and ('"' in expr or "'" in expr) and not expr.startswith(('"', "'")):
        parts = split_concat(expr)
        if parts is not None:
            return ''.join(str(resolve_value(p, variables) or '') for p in parts)
    if expr.startswith('"') and expr.endswith('"') and len(expr) >= 2:
        return unescape_php(expr[1:-1], '"')
    if expr.startswith("'") and expr.endswith("'") and len(expr) >= 2:
        return unescape_php(expr[1:-1], "'")
    if re.fullmatch(r'-?\d+', expr):
        return int(expr)
    if re.fullmatch(r'-?\d+\.\d+', expr):
        return float(expr)
    if expr == 'true':
        return True
    if expr == 'false':
        return False
    if expr == 'null':
        return None
    if expr.startswith('$'):
        return variables.get(expr[1:])
    return None

def split_concat(expr):
    """Split 'a' . $b . 'c' on top-level dots (not inside quotes)."""
    parts, buf, q = [], '', None
    i = 0
    while i < len(expr):
        c = expr[i]
        if q:
            buf += c
            if c == '\\' and i + 1 < len(expr):
                buf += expr[i + 1]; i += 2; continue
            if c == q:
                q = None
        elif c in '"\'':
            q = c; buf += c
        elif c == '.':
            parts.append(buf.strip()); buf = ''
        else:
            buf += c
        i += 1
    parts.append(buf.strip())
    if len(parts) < 2:
        return None
    return parts

def resolve_value(part, variables):
    part = part.strip()
    if part.startswith('$'):
        return variables.get(part[1:])
    return parse_scalar(part, variables)

def unescape_php(s, quote):
    out = []
    i = 0
    while i < len(s):
        c = s[i]
        if c == '\\' and i + 1 < len(s):
            n = s[i + 1]
            out.append({'n': '\n', 'r': '\r', 't': '\t', '\\': '\\', '"': '"', "'": "'"}.get(n, n))
            i += 2
            continue
        out.append(c)
        i += 1
    return ''.join(out)

def parse_inline_array(expr, variables):
    """array("K" => v, ...) -> dict. Only top-level scalar pairs."""
    m = re.match(r'array\s*\((.*)\)\s*$', expr.strip(), re.S)
    if not m:
        return None
    body = m.group(1)
    out = {}
    for pm in re.finditer(r'["\']([^"\']+)["\']\s*=>\s*((?:"(?:\\.|[^"\\])*")|(?:\'(?:\\.|[^\'\\])*\')|-?\d+(?:\.\d+)?|true|false|null)', body):
        out[pm.group(1)] = parse_scalar(pm.group(2), variables)
    return out

# ------------------------------------------------------------ file parsing

TDATA_RE   = re.compile(r'^\s*\$tdata\w+\["\.([A-Za-z0-9_]+)"\](\[\])?\s*=\s*(.+?);\s*$')
VAR_SET    = re.compile(r'^\s*\$(\w+)\s*=\s*(.+?);\s*$')
VAR_APPEND = re.compile(r'^\s*\$(\w+)\[\]\s*=\s*(.+?);\s*$')
LABEL_RE   = re.compile(r'^\s*\$fieldLabels\w+\["German"\]\["([^"]+)"\]\s*=\s*(.+?);\s*$')
FDATA_RE   = re.compile(r'^\s*\$fdata\["([^"]+)"\]\s*=\s*(.+?);\s*$', re.M)
VDATA_RE   = re.compile(r'^\s*\$vdata\["([^"]+)"\]\s*=\s*(.+?);\s*$', re.M)
EDATA_RE   = re.compile(r'^\s*\$edata\["([^"]+)"\]\s*=\s*(.+?);\s*$', re.M)
VDATA_INIT = re.compile(r'^\s*\$vdata\s*=\s*(array\s*\(.+\));\s*$', re.S)
EDATA_INIT = re.compile(r'^\s*\$edata\s*=\s*(array\s*\(.+\));\s*$', re.S)

FIELD_SET_KEYS = {
    'listFields': 'list', 'viewFields': 'view', 'addFields': 'add',
    'editFields': 'edit', 'exportFields': 'export', 'printFields': 'print',
    'allSearchFields': 'search', 'masterListFields': 'masterList',
}

def parse_field_block(chunk, variables):
    """One $fdata = array(); chunk -> field dict or None."""
    name_m = re.search(r'\$fdata\["strName"\]\s*=\s*"([^"]*)"', chunk)
    if not name_m:
        return None
    field = {'name': name_m.group(1)}
    for m in FDATA_RE.finditer(chunk):
        key, raw = m.group(1), m.group(2)
        if key in ('ViewFormats', 'EditFormats'):
            continue
        val = parse_scalar(raw, variables)
        if val is not None:
            field[key] = val
    # view sub-block: the $vdata group that terminates in ViewFormats["view"]
    field['view'] = extract_subblock(chunk, 'vdata', 'view', variables)
    field['edit'] = extract_subblock(chunk, 'edata', 'edit', variables)
    return field

def extract_subblock(chunk, var, target, variables):
    """Collect the $vdata/$edata assignments of the group assigned to
    ViewFormats/EditFormats["<target>"]."""
    term = re.search(r'\$fdata\["(?:View|Edit)Formats"\]\["' + target + r'"\]\s*=\s*\$' + var, chunk)
    if not term:
        # fall back to the first group of that variable in the chunk
        start = 0
        end = len(chunk)
    else:
        end = term.start()
        start = chunk.rfind('$' + var + ' = array', 0, end)
        start = chunk.rfind('$' + var + '=array', 0, end) if start == -1 else start
        if start == -1:
            start = 0
    region = chunk[start:end]
    out = {}
    init = (VDATA_INIT if var == 'vdata' else EDATA_INIT).search(region)
    rx = VDATA_RE if var == 'vdata' else EDATA_RE
    if init:
        inline = parse_inline_array(init.group(1), variables)
        if inline:
            out.update(inline)
    for m in rx.finditer(region):
        val = parse_scalar(m.group(2), variables)
        if val is not None:
            out[m.group(1)] = val
    return out

def parse_settings(path, entity, physical_tables):
    text = open(path, encoding='utf-8', errors='replace').read()

    variables = {}
    tdata = {}
    field_sets = {v: [] for v in FIELD_SET_KEYS.values()}
    labels = {}

    for line in text.split('\n'):
        m = VAR_APPEND.match(line)
        if m and not line.lstrip().startswith('$tdata') and not line.lstrip().startswith('$fieldLabels'):
            variables.setdefault(m.group(1), []).append(parse_scalar(m.group(2), variables))
            continue
        m = LABEL_RE.match(line)
        if m:
            labels[m.group(1)] = parse_scalar(m.group(2), variables)
            continue
        m = TDATA_RE.match(line)
        if m:
            key, is_append, raw = m.group(1), m.group(2), m.group(3)
            if key in FIELD_SET_KEYS and is_append:
                v = parse_scalar(raw, variables)
                if v is not None:
                    field_sets[FIELD_SET_KEYS[key]].append(v)
            elif is_append:
                tdata.setdefault(key, [])
                if not isinstance(tdata[key], list):
                    tdata[key] = [tdata[key]]
                tdata[key].append(parse_scalar(raw, variables))
            elif raw.strip().startswith('$'):
                tdata[key] = variables.get(raw.strip()[1:])
            else:
                tdata[key] = parse_scalar(raw, variables)
            continue
        m = VAR_SET.match(line)
        if m:
            name, raw = m.group(1), m.group(2)
            if name.startswith('tdata') or name.startswith('fieldLabels'):
                continue
            if raw.strip() == 'array()':
                variables[name] = []
            else:
                v = parse_scalar(raw, variables)
                if v is not None:
                    variables[name] = v
            continue

    # field blocks
    fields = []
    chunks = re.split(r'(?=^\s*\$fdata\s*=\s*array\(\s*\)\s*;)', text, flags=re.M)
    for chunk in chunks[1:]:
        f = parse_field_block(chunk, variables)
        if not f:
            continue
        view = f.pop('view')
        edit = f.pop('edit')
        index = f.get('Index', len(fields) + 1)
        fields.append({
            'name': f['name'],
            'type': f.get('FieldType', 0),
            'index': index,
            'pages': {kind: f['name'] in names for kind, names in field_sets.items()},
            'view': view,
            'edit': edit,
            **({'AutoInc': f['AutoInc']} if f.get('AutoInc') else {}),
            **({'isSQLExpression': f['isSQLExpression']} if f.get('isSQLExpression') else {}),
            **({'UploadFolder': f['UploadFolder']} if f.get('UploadFolder') else {}),
        })
    fields.sort(key=lambda x: x.get('index', 0))

    keys = tdata.get('Keys') or []
    if not isinstance(keys, list):
        keys = [keys]
    short = tdata.get('ShortName') or entity
    original = tdata.get('OriginalTable') or short
    is_virtual = not (
        short.lower() in physical_tables
        or short.replace('_', ' ').lower() in physical_tables
        or original.lower() in physical_tables and short == original
    ) or (short != original and short.lower() not in physical_tables
          and short.replace('_', ' ').lower() not in physical_tables)

    capabilities = {kind: len(names) > 0 for kind, names in field_sets.items()}

    manifest = {
        'entity': entity,
        'shortName': short,
        'baseTable': original,
        'isVirtual': bool(is_virtual),
        'ownerField': tdata.get('OwnerID') or None,
        'sql': {
            'strOrderBy': tdata.get('strOrderBy') or '',
            'sqlHead': tdata.get('sqlHead') or '',
            'sqlFrom': tdata.get('sqlFrom') or '',
            'sqlWhere': tdata.get('sqlWhere') or '',
            'sqlTail': tdata.get('sqlTail') or '',
        },
        'keys': keys,
        'pageSize': tdata.get('pageSize') or 0,
        'capabilities': capabilities,
        'fieldSets': {k: v for k, v in field_sets.items() if v},
        'export': {
            'exportTo': tdata.get('exportTo'),
            'exportDelimiter': tdata.get('exportDelimiter'),
            'exportFormatting': tdata.get('exportFormatting'),
        },
        'print': {
            'printerPageOrientation': tdata.get('printerPageOrientation'),
            'nPrinterPageScale': tdata.get('nPrinterPageScale'),
            'nPrinterSplitRecords': tdata.get('nPrinterSplitRecords'),
            'nPrinterPDFSplitRecords': tdata.get('nPrinterPDFSplitRecords'),
        },
        'tabs': [],
        'labels': {'German': labels} if labels else {},
        'fields': fields,
    }
    return manifest

def physical_table_names():
    """The 62 real tables, from prisma/schema.prisma @@map names."""
    schema_path = os.path.join(PROJECT, 'prisma', 'schema.prisma')
    names = set()
    try:
        text = open(schema_path, encoding='utf-8').read()
    except OSError:
        return names
    for m in re.finditer(r'model\s+(\w+)\s*\{([\s\S]*?)\n\}', text):
        name, body = m.group(1), m.group(2)
        mm = re.search(r'@@map\("([^"]+)"\)', body)
        names.add((mm.group(1) if mm else name).lower())
    return names

def main():
    src_root = sys.argv[1] if len(sys.argv) > 1 else '.'
    inc = os.path.join(src_root, 'include')
    if not os.path.isdir(inc):
        print('include/ not found under ' + src_root, file=sys.stderr)
        return 1
    physical = physical_table_names()
    out_dir = os.path.join(PROJECT, 'src', 'meta', 'entities')
    os.makedirs(out_dir, exist_ok=True)

    files = sorted(f for f in os.listdir(inc) if f.endswith('_settings.php'))
    virtual = []
    total_fields = 0
    lookup_refs = 0
    for fname in files:
        entity = fname[:-len('_settings.php')]
        manifest = parse_settings(os.path.join(inc, fname), entity, physical)
        if manifest['isVirtual']:
            virtual.append(entity)
        total_fields += len(manifest['fields'])
        lookup_refs += sum(1 for f in manifest['fields'] if f.get('edit', {}).get('LookupTable'))
        dest = os.path.join(out_dir, entity + '.json')
        json.dump(manifest, open(dest, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

    vpath = os.path.join(PROJECT, 'src', 'meta', 'virtual-entities.json')
    json.dump(sorted(virtual), open(vpath, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

    print(f'entities      : {len(files)}')
    print(f'fields        : {total_fields}')
    print(f'lookup refs   : {lookup_refs}')
    print(f'virtual       : {len(virtual)}')
    print(f'-> {out_dir}')
    print(f'-> {vpath}')
    return 0

if __name__ == '__main__':
    sys.exit(main())
