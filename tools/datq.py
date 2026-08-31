#!/usr/bin/env python3
"""Query the owned DAT without guessing genieutils attribute names.

AttributeError probing costs a failed run per guess (docs/lessons.md). This
answers the questions that cause it, faster than guessing:

  fields <expr>         list an object's attributes, scalar values shown
  get <expr>            print the value at an attribute path
  grep <term> [expr]    search an object's attribute names and the
                        cheat-sheet in tools/README.md for a substring

``<expr>`` is a Python attribute path rooted at ``dat``, e.g.
``dat.civs[1].units[128]`` or ``dat.graphics[2321]``. Run through the import
venv, which has genieutils installed:

  uv run --locked python tools/datq.py fields 'dat.civs[1].units[128]'
  uv run --locked python tools/datq.py grep train 'dat.civs[1].units[128]'

When a field this repo needs is missing from the cheat-sheet, extend the
table in tools/README.md with what this tool finds.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

from genieutils.datfile import DatFile

from depot import depot_root

DAT_RELATIVE = "depot_813781/resources/_common/dat/empires2_x2_p1.dat"
CHEAT_SHEET = Path(__file__).with_name("README.md")


def load_dat() -> DatFile:
    dat_path = depot_root() / DAT_RELATIVE
    if not dat_path.is_file():
        sys.exit(f"datq: no DAT at {dat_path} (set AOE2DE_DEPOT_ROOT)")
    return DatFile.parse(dat_path)


def resolve(dat: DatFile, expr: str):
    if not re.fullmatch(r"dat[\w\[\].]*", expr):
        sys.exit(f"datq: <expr> must be an attribute path rooted at 'dat', got {expr!r}")
    try:
        return eval(expr, {"__builtins__": {}}, {"dat": dat})  # noqa: S307 - path is shape-checked above
    except Exception as error:
        sys.exit(f"datq: {expr} -> {type(error).__name__}: {error}")


def describe(value) -> str:
    if isinstance(value, (bool, int, float)):
        return repr(value)
    if isinstance(value, str):
        return repr(value if len(value) <= 60 else value[:57] + "...")
    if isinstance(value, (list, tuple)):
        inner = type(value[0]).__name__ if value else "empty"
        return f"{type(value).__name__}[{len(value)}] of {inner}"
    if value is None:
        return "None"
    return type(value).__name__


def attribute_rows(obj):
    for name in sorted(dir(obj)):
        if name.startswith("_"):
            continue
        try:
            value = getattr(obj, name)
        except Exception:
            continue
        if callable(value):
            continue
        yield name, describe(value)


def cheat_sheet_matches(term: str) -> list[str]:
    pattern = re.compile(re.escape(term), re.IGNORECASE)
    rows = []
    for line in CHEAT_SHEET.read_text().splitlines():
        if line.startswith("|") and pattern.search(line):
            rows.append(line)
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    fields = sub.add_parser("fields", help="list an object's attributes")
    fields.add_argument("expr")
    get = sub.add_parser("get", help="print the value at an attribute path")
    get.add_argument("expr")
    grep = sub.add_parser("grep", help="search attribute names and the cheat-sheet")
    grep.add_argument("term")
    grep.add_argument("expr", nargs="?", default="dat")
    args = parser.parse_args()

    if args.command == "grep":
        for row in cheat_sheet_matches(args.term):
            print(f"cheat-sheet: {row}")

    dat = load_dat()
    obj = resolve(dat, args.expr)

    if args.command == "get":
        print(describe(obj) if not isinstance(obj, (bool, int, float, str)) else obj)
        return

    pattern = re.compile(re.escape(args.term), re.IGNORECASE) if args.command == "grep" else None
    matched = False
    for name, summary in attribute_rows(obj):
        if pattern and not pattern.search(name):
            continue
        matched = True
        print(f"{args.expr}.{name} = {summary}")
    if pattern and not matched:
        print(f"datq: no attribute of {args.expr} matches {args.term!r}")


if __name__ == "__main__":
    main()
