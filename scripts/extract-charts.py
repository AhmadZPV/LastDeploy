#!/usr/bin/env python3
"""Extract the chart catalogue from the PHPRunner source (phase 6).

Each *_chart.php file is ~5,500 lines of identical boilerplate; the real
configuration lives in include/<Name>_settings.php as:

  $tdata<Name>[".chartType"] = "2DDoughnut";
  $tdata<Name>[".sqlHead"]   = "SELECT ...";
  $tdata<Name>[".chartXml"]  = '<chart> ... </chart>';   (PHP concatenation)

The chartXml is built by concatenating single-quoted literals with calls to
xmlencode(...) and GetFieldLabel(...). We rebuild the string, parse the
<attr value="k"> tree, and emit a declarative spec per chart.

Key semantics, taken from classes/charts.php:220:
    for ($i = 0; $i < count($parameters) - 1; $i++)
so the LAST parameter is the category (label) axis and every parameter before
it is a value series.

Output: src/meta/charts.json
Run:    python3 scripts/extract-charts.py [php-source-dir]
"""
import json
import os
import re
import sys
import xml.etree.ElementTree as ET

DEFAULT_SOURCE = "/data/hv/hausverwaltungplus version 1812 vorlage"
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "src", "meta", "charts.json")

# SQL constructs that MySQL accepts but SQLite does not.
MYSQL_ONLY = [
    (r"@\w+\s*:=", "session variables (@x := ...)"),
    (r"\bdate_format\s*\(", "date_format()"),
    (r"\bdatediff\s*\(", "datediff()"),
    (r"\bconcat\s*\(", "concat()"),
    (r"\bif\s*\(", "if()"),
    (r"\bcurdate\s*\(", "curdate()"),
    (r"\byear\s*\(", "year()"),
    (r"\bmonth\s*\(", "month()"),
]


def php_unquote(lit):
    """Unescape a PHP single-quoted string literal body."""
    return lit.replace("\\\\", "\x00").replace("\\'", "'").replace("\x00", "\\")


def statement_text(src, start):
    """Return the PHP statement starting at `start`, up to its terminating ';'.

    Quote-aware so that semicolons inside string literals do not end it.
    """
    i = start
    n = len(src)
    quote = None
    while i < n:
        c = src[i]
        if quote:
            if c == "\\":
                i += 2
                continue
            if c == quote:
                quote = None
        elif c in "'\"":
            quote = c
        elif c == ";":
            return src[start:i]
        i += 1
    return src[start:]


TOKEN_RE = re.compile(
    r"'((?:[^'\\]|\\.)*)'"                      # single-quoted literal
    r"|xmlencode\s*\(\s*\"((?:[^\"\\]|\\.)*)\"\s*\)"   # xmlencode("text")
    r"|xmlencode\s*\(\s*GetFieldLabel\s*\(\s*\"([^\"]*)\"\s*,\s*\"([^\"]*)\"\s*\)\s*\)"
    r"|GetFieldLabel\s*\(\s*\"([^\"]*)\"\s*,\s*\"([^\"]*)\"\s*\)",
    re.S,
)


def build_chart_xml(src, var):
    """Rebuild the concatenated .chartXml string for one chart."""
    marker = '$%s[".chartXml"]' % var
    out = []
    pos = 0
    while True:
        idx = src.find(marker, pos)
        if idx == -1:
            break
        stmt = statement_text(src, idx)
        pos = idx + len(stmt)
        for m in TOKEN_RE.finditer(stmt):
            if m.group(1) is not None:
                out.append(php_unquote(m.group(1)))
            elif m.group(2) is not None:
                out.append(m.group(2))
            elif m.group(4) is not None:
                # xmlencode(GetFieldLabel(table, field)) -> keep the field name;
                # the runtime resolves the real German label from metadata
                out.append(m.group(4))
            elif m.group(6) is not None:
                out.append(m.group(6))
    return "".join(out)


def attr_tree(elem):
    """Convert PHPRunner's <attr value="k">...</attr> nesting into dict/str."""
    children = list(elem)
    if not children:
        return (elem.text or "").strip()
    out = {}
    for child in children:
        key = child.get("value")
        out[key] = attr_tree(child)
    return out


def parse_chart_xml(xml_text):
    if not xml_text.strip():
        return None
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as exc:
        return {"__parse_error__": str(exc)}
    return attr_tree(root)


def scalar(src, var, key):
    m = re.search(
        r"\$%s\[\"\.%s\"\]\s*=\s*(.*?);\s*$" % (re.escape(var), re.escape(key)),
        src, re.M)
    if not m:
        return None
    tok = m.group(1).strip()
    if tok.startswith('"') and tok.endswith('"'):
        body = tok[1:-1]
        return body.replace('\\"', '"').replace("\\\\", "\\")
    if tok.startswith("'") and tok.endswith("'"):
        return php_unquote(tok[1:-1])
    if tok in ("true", "false"):
        return tok == "true"
    try:
        return int(tok)
    except ValueError:
        return tok


GROUPBY_START = re.compile(r'\["m_groupby"\]\s*=\s*array\(\s*\)\s*;')
ORDERBY_START = re.compile(r'\["m_orderby"\]\s*=\s*array\(\s*\)\s*;')
FIELD_NAME_RE = re.compile(r'"m_strName"\s*=>\s*"([^"]*)"')
FIELD_TABLE_RE = re.compile(r'"m_strTable"\s*=>\s*"([^"]*)"')
# A group-by item is not always a plain column. Leerstandsquote groups by the
# computed alias "Status" via SQLNonParsed(array("m_sql" => "Status")).
NONPARSED_RE = re.compile(r'SQLNonParsed\(array\(\s*"m_sql"\s*=>\s*"([^"]*)"')


def group_by_fields(src):
    """Extract the real GROUP BY.

    PHPRunner does not put GROUP BY in .sqlTail. It lives in the serialised
    SQLQuery object at the bottom of the settings file:

        $proto0["m_groupby"] = array();
        $obj = new SQLField(array("m_strName" => "Objektart", ...));
        $proto17["m_column"] = $obj;
        $obj = new SQLGroupByItem($proto17);
        $proto0["m_groupby"][] = $obj;
        $proto0["m_orderby"] = array();

    Without this the charts would collapse to a single aggregated row.
    """
    start = GROUPBY_START.search(src)
    if not start:
        return []
    tail = src[start.end():]
    end = ORDERBY_START.search(tail)
    block = tail[: end.start()] if end else tail

    fields = []
    for chunk in block.split("SQLGroupByItem"):
        # only chunks that actually precede a group-by item carry a column
        if chunk is block.split("SQLGroupByItem")[-1] and "SQLGroupByItem" not in block:
            break
        names = FIELD_NAME_RE.findall(chunk)
        tables = FIELD_TABLE_RE.findall(chunk)
        raw = [r for r in NONPARSED_RE.findall(chunk) if r.strip()]
        if names:
            fields.append({"name": names[-1],
                           "table": tables[-1] if tables else None,
                           "expression": False})
        elif raw:
            # grouped by an expression/alias rather than a real column
            fields.append({"name": raw[-1], "table": None, "expression": True})
    # the split leaves one trailing chunk after the final item; drop extras
    return fields[: block.count("SQLGroupByItem")]


def ordered(d):
    """PHPRunner keys its lists as "0","1","2"... - return them in order."""
    if not isinstance(d, dict):
        return []
    keys = [k for k in d.keys() if k.isdigit()]
    return [d[k] for k in sorted(keys, key=int)]


NORMALISE_TYPE = {
    "2d_doughnut": "doughnut",
    "2d_pie": "pie",
    "2d_column": "column",
    "2d_bar": "bar",
    "line": "line",
    "area": "area",
}


def truthy(v):
    return str(v).strip().lower() in ("true", "1")


def portability(sql):
    hits = []
    low = sql.lower()
    for pattern, label in MYSQL_ONLY:
        if re.search(pattern, low):
            hits.append(label)
    return hits


def extract(inc_dir, settings_file):
    path = os.path.join(inc_dir, settings_file)
    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        src = fh.read()

    name = settings_file[: -len("_settings.php")]
    var = "tdata" + name
    if scalar(src, var, "tableType") != "chart":
        return None

    xml_text = build_chart_xml(src, var)
    tree = parse_chart_xml(xml_text) or {}
    if "__parse_error__" in tree:
        return {"entity": name, "error": tree["__parse_error__"]}

    params = [p.get("name") if isinstance(p, dict) else p
              for p in ordered(tree.get("parameters", {}))]
    # classes/charts.php:220 - the last parameter is the category axis
    category = params[-1] if params else None
    series = params[:-1] if len(params) > 1 else []

    appearance = tree.get("appearance", {}) or {}
    fields = []
    for f in ordered(tree.get("fields", {})):
        if isinstance(f, dict):
            fields.append({"name": f.get("name"), "label": f.get("label")})

    sql = {
        "head": scalar(src, var, "sqlHead") or "",
        "from": scalar(src, var, "sqlFrom") or "",
        "where": scalar(src, var, "sqlWhereExpr") or "",
        "tail": scalar(src, var, "sqlTail") or "",
        "orderBy": scalar(src, var, "strOrderBy") or "",
    }
    full_sql = " ".join([sql["head"], sql["from"], sql["where"], sql["tail"]])

    group_by = group_by_fields(src)
    raw_type = scalar(src, var, "chartType") or ""
    xml_type = ""
    ct = tree.get("chart_type")
    if isinstance(ct, dict):
        xml_type = ct.get("type", "")

    settings = tree.get("settings", {}) or {}

    return {
        "entity": name,
        "displayName": (settings.get("name")
                        or (ordered(tree.get("tables", {})) or [name])[0]),
        "shortTableName": settings.get("short_table_name", name),
        "baseTable": scalar(src, var, "strOriginalTableName"),
        "chartType": NORMALISE_TYPE.get(xml_type, xml_type or raw_type),
        "rawChartType": raw_type,
        "xmlChartType": xml_type,
        "category": category,
        "series": series,
        "sql": sql,
        "groupBy": group_by,
        "titles": {
            "head": appearance.get("head", ""),
            "foot": appearance.get("foot", ""),
            "yAxisLabel": appearance.get("y_axis_label", ""),
        },
        "appearance": {
            "legend": truthy(appearance.get("slegend")),
            "grid": truthy(appearance.get("sgrid")),
            "showName": truthy(appearance.get("sname")),
            "showValue": truthy(appearance.get("sval")),
            "animate": truthy(appearance.get("sanim")),
            "stacked": truthy(appearance.get("isstacked"))
                       or truthy(appearance.get("sstacked")),
            "is3d": truthy(appearance.get("is3d")),
            "logScale": truthy(appearance.get("slog")),
            "autoUpdateSeconds": (int(appearance.get("autoupmin") or 0)
                                  if truthy(appearance.get("autoupdate")) else 0),
        },
        "fields": fields,
        "pageSize": scalar(src, var, "pageSize"),
        "mysqlOnly": portability(full_sql),
    }


def main():
    source = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SOURCE
    inc = os.path.join(source, "include")
    if not os.path.isdir(inc):
        print("include dir not found: " + inc)
        return 1

    charts = []
    for fname in sorted(os.listdir(inc)):
        if not fname.endswith("_settings.php"):
            continue
        try:
            spec = extract(inc, fname)
        except Exception as exc:  # keep going, report at the end
            charts.append({"entity": fname, "error": repr(exc)})
            continue
        if spec:
            charts.append(spec)

    ok = [c for c in charts if "error" not in c]
    bad = [c for c in charts if "error" in c]

    by_type = {}
    for c in ok:
        by_type[c["chartType"]] = by_type.get(c["chartType"], 0) + 1

    needs_sql_port = [c["entity"] for c in ok if c["mysqlOnly"]]

    payload = {
        "total": len(ok),
        "byType": by_type,
        "needsSqlTranslation": needs_sql_port,
        "charts": {c["entity"]: c for c in ok},
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=1)

    print("charts            : %d" % len(ok))
    print("parse errors      : %d" % len(bad))
    for c in bad:
        print("   ! %s: %s" % (c["entity"], c["error"]))
    print("by type           : %s" % by_type)
    print("needs SQL port    : %d" % len(needs_sql_port))
    for e in needs_sql_port:
        print("   ~ %s" % e)
    missing_cat = [c["entity"] for c in ok if not c["category"]]
    print("missing category  : %d %s" % (len(missing_cat), missing_cat or ""))
    no_series = [c["entity"] for c in ok if not c["series"]]
    print("missing series    : %d %s" % (len(no_series), no_series or ""))
    print("written           : %s" % OUT)
    return 0


if __name__ == "__main__":
    sys.exit(main())
