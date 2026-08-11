#!/usr/bin/env python3
"""Extract the full main + admin menu tree from the PHP source.

The generated `scripts/extract-menu.cjs` only kept label/href/icon, which lost
the two things the menu actually needs to build correct links: `pageType`
(List / Report / Chart / Dashboard / Add / Edit) and `table`. Without them every
leaf was pointed at `/{module}` even when the target is a report or a chart.

This parser walks `include/menunodes_main.php` and
`include/menunodes_adminarea.php` node by node and writes
`src/meta/menu.json`.

Usage:
    python3 scripts/extract-menu.py [php-source-root]
"""
import io
import json
import os
import re
import sys

DEFAULT_PHP_ROOT = "/data/src_php/hausverwaltungplus version 1812 vorlage"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src", "meta", "menu.json")

# $menuNode["key"] = "value";   or   = GetTableLink("tbl", "list");
ASSIGN = re.compile(r'\$menuNode\["(\w+)"\]\s*=\s*(.+?);')
STRING = re.compile(r'^"(.*)"$')
TABLELINK = re.compile(r'^GetTableLink\(\s*"([^"]*)"\s*(?:,\s*"([^"]*)")?')
PUSH = re.compile(r'menuNodes\["(\w+)"\]\[\]\s*=\s*\$menuNode')
RESET = re.compile(r'^\s*\$menuNode\s*=\s*array\(\s*\)\s*;')


def parse_value(raw):
    raw = raw.strip()
    m = STRING.match(raw)
    if m:
        return m.group(1)
    m = TABLELINK.match(raw)
    if m:
        return {"tableLink": m.group(1), "page": m.group(2) or "list"}
    return raw


def parse_file(path, menu_name):
    nodes = []
    current = {}
    with io.open(path, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            if RESET.match(line):
                current = {}
                continue
            m = ASSIGN.search(line)
            if m:
                current[m.group(1)] = parse_value(m.group(2))
                continue
            m = PUSH.search(line)
            if m and current:
                node = dict(current)
                node["menu"] = m.group(1) or menu_name
                nodes.append(node)
                current = {}
    return nodes


def slugify(table):
    """Mirror the slug rule the Node registry uses for table names."""
    s = table.strip().lower()
    for a, b in (("\u00e4", "ae"), ("\u00f6", "oe"), ("\u00fc", "ue"), ("\u00df", "ss")):
        s = s.replace(a, b)
    s = re.sub(r"[^a-z0-9]+", "_", s).strip("_")
    return s


# pageType -> the Node route that serves it
ROUTE_BY_PAGETYPE = {
    "List": "/{slug}",
    "Add": "/{slug}/add",
    "Edit": "/{slug}/edit",
    "Report": "/report/{slug}",
    "Chart": "/chart/{slug}",
    "Dashboard": "/dashboard/{slug}",
}


def build(nodes):
    out = []
    for n in nodes:
        href = n.get("href", "")
        table = n.get("table", "") or ""
        page_type = n.get("pageType", "") or ""
        link_type = n.get("linkType", "") or ""

        if isinstance(href, dict):
            table = table or href.get("tableLink", "")
            href = ""

        slug = slugify(table) if table else ""
        item = {
            "id": str(n.get("id", "")),
            "parent": str(n.get("parent", "0")),
            "menu": n.get("menu", "main"),
            "type": n.get("type", "Leaf"),
            "title": n.get("title") or n.get("name", ""),
            "name": n.get("name", ""),
            "table": table,
            "slug": slug,
            "pageType": page_type,
            "linkType": link_type,
            "icon": n.get("icon", ""),
            "params": n.get("params", ""),
        }
        if link_type == "External" and href.startswith("http"):
            item["href"] = href
            item["external"] = True
        elif item["type"] == "Leaf" and slug:
            item["href"] = ROUTE_BY_PAGETYPE.get(page_type, "/{slug}").format(slug=slug)
        elif link_type == "External" and href:
            # e.g. backup.php -> an admin utility page
            item["href"] = "/" + href.replace(".php", "")
            item["external"] = False
        else:
            item["href"] = ""
        out.append(item)
    return out


def main():
    root = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_PHP_ROOT
    nodes = parse_file(os.path.join(root, "include", "menunodes_main.php"), "main")
    nodes += parse_file(os.path.join(root, "include", "menunodes_adminarea.php"), "adminarea")
    items = build(nodes)

    by_type = {}
    by_page = {}
    for it in items:
        by_type[it["type"]] = by_type.get(it["type"], 0) + 1
        if it["type"] == "Leaf":
            by_page[it["pageType"] or "(none)"] = by_page.get(it["pageType"] or "(none)", 0) + 1

    payload = {
        "generatedFrom": "include/menunodes_main.php + include/menunodes_adminarea.php",
        "counts": {"nodes": len(items), "byType": by_type, "leafByPageType": by_page},
        "items": items,
    }
    out = os.path.normpath(OUT)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    io.open(out, "w", encoding="utf-8").write(json.dumps(payload, ensure_ascii=False, indent=2))
    print("wrote", out)
    print("nodes", len(items), by_type)
    print("leaf page types", by_page)
    missing = [i["title"] for i in items if i["type"] == "Leaf" and not i["href"]]
    print("leaves without a link:", len(missing), missing[:10])


if __name__ == "__main__":
    main()
