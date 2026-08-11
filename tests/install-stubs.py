#!/usr/bin/env python3
"""Install the local test stubs into node_modules.

The sandbox has no network access, so `npm install` cannot fetch the real
packages. To still run meaningful tests we drop minimal, purpose-built stubs
into node_modules. They are only ever used for testing: the real dependencies
are declared in package.json and take precedence on a normal machine.

Run:  python3 tests/install-stubs.py
"""
import json, os, shutil, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
NM = os.path.join(ROOT, "node_modules")
STUBS = os.path.join(HERE, "stubs")

# stub file -> package name
PACKAGES = {
    "prisma-client.js": "@prisma/client",
    "express.js": "express",
    "pdfkit.js": "pdfkit",
    "exceljs.js": "exceljs",
    "sharp.js": "sharp",
    "bcryptjs.js": "bcryptjs",
    "express-session.js": "express-session",
    "multer.js": "multer",
}


def install(stub_file, pkg):
    src = os.path.join(STUBS, stub_file)
    if not os.path.exists(src):
        return "missing stub: " + stub_file
    dest_dir = os.path.join(NM, *pkg.split("/"))
    existing = os.listdir(dest_dir) if os.path.isdir(dest_dir) else []
    # empty leftover folders from a partial npm install do not count as a real
    # package; only actual files (or a populated nested tree) do
    real = []
    for e in existing:
        if e in ("index.js", "package.json"):
            continue
        p = os.path.join(dest_dir, e)
        if os.path.isfile(p):
            real.append(e)
        elif os.path.isdir(p) and any(
                fnames for _, _, fnames in os.walk(p) if fnames):
            real.append(e)
    if real:
        return "skipped (real package present): " + pkg
    os.makedirs(dest_dir, exist_ok=True)
    shutil.copyfile(src, os.path.join(dest_dir, "index.js"))
    with open(os.path.join(dest_dir, "package.json"), "w", encoding="utf-8") as fh:
        json.dump({
            "name": pkg,
            "version": "0.0.0-local-test-stub",
            "type": "module",
            "main": "index.js",
            "exports": {".": "./index.js"},
        }, fh, indent=2)
    return "installed: " + pkg


def main():
    if not os.path.isdir(NM):
        os.makedirs(NM, exist_ok=True)
    for stub_file, pkg in PACKAGES.items():
        print("  " + install(stub_file, pkg))
    print("stub install complete")


if __name__ == "__main__":
    main()
