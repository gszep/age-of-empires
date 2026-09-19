#!/usr/bin/env python3
"""Which owned files has nobody opened, and which DAT unit fields does no
importer read?

The 2026-09-17 session asked this by hand and found sixteen things in an
hour -- a miss radius the DAT states, the blast rule its rows settle, the
strings file, the female villager -- five of them recorded as approximations
"because the owned files do not say". Run this at the start of a planning
session, before writing "not in the owned files" anywhere.

Usage:
    uv run --locked python tools/survey.py            # files and fields
    uv run --locked python tools/survey.py --files    # files only (no DAT load)
    uv run --locked python tools/survey.py --importers  # fields against the importers alone

A name counts as cited if any tracked text mentions it -- so a field on the
cheat-sheet counts, whether or not an importer reads it. `--importers` asks
the stricter question against `tools/import_*.py` only.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

from depot import depot_root

ROOT = Path(__file__).resolve().parent.parent
SEARCHED = ["tools", "src", "docs", "AGENTS.md", "README.md"]
# Directories whose file basenames are the things a reader might cite.
SURVEYED = {
    "dat": "depot_813781/resources/_common/dat",
    "xs": "depot_813781/resources/_common/xs",
    "particles": "depot_813781/resources/_common/particles",
    "widgetui": "depot_813782/widgetui/*.json",  # the layouts; the textures are art
    "shaders": "depot_813781/resources/_common/shaders/d3d11",
}
# Fields of a DAT unit that are bookkeeping rather than gameplay; not worth listing.
IGNORED_FIELDS = {"id", "name", "language_dll_name", "language_dll_creation", "language_dll_help",
                  "language_dll_hotkey_text", "hotkey_id", "icon_id", "portrait_pict", "type",
                  "old_portrait_pict", "unit_technology", "vanish_mode", "combat_level"}


def repo_text(paths: list[str] = SEARCHED) -> str:
    """Everything a reader of this repo could have cited, as one string."""
    out = subprocess.run(["git", "ls-files", *paths], cwd=ROOT, capture_output=True, text=True, check=True)
    parts = []
    for rel in out.stdout.split():
        path = ROOT / rel
        if path.suffix in {".png", ".json"} and path.stat().st_size > 2_000_000:
            continue
        try:
            parts.append(path.read_text(errors="ignore"))
        except OSError:
            pass
    return "\n".join(parts)


def unread_files(corpus: str) -> dict[str, list[str]]:
    root = depot_root()
    report: dict[str, list[str]] = {}
    for label, rel in SURVEYED.items():
        pattern = None
        if "*" in rel:
            rel, pattern = rel.rsplit("/", 1)
        base = root / rel
        if not base.is_dir():
            report[label] = [f"(missing: {base})"]
            continue
        files = base.rglob(pattern) if pattern else base.rglob("*")
        names = sorted({p.stem for p in files if p.is_file()})
        unread = [n for n in names if len(n) > 2 and n.lower() not in corpus.lower()]
        report[label] = unread
    return report


def unread_fields(corpus: str) -> list[str]:
    from datq import load_dat  # slow: loads the whole DAT
    dat = load_dat()
    unit = dat.civs[1].units[83]  # the villager carries every unit-level field
    names: set[str] = set()

    import dataclasses

    def walk(obj, prefix=""):
        # genieutils models are slotted dataclasses: `vars()` is empty.
        attrs = [f.name for f in dataclasses.fields(obj)] if dataclasses.is_dataclass(obj) else []
        for attr in attrs:
            if attr.startswith("_") or attr in IGNORED_FIELDS:
                continue
            value = getattr(obj, attr)
            full = f"{prefix}{attr}"
            if dataclasses.is_dataclass(value) and not isinstance(value, type):
                walk(value, full + ".")
            else:
                names.add(full)

    walk(unit)
    # An importer names a field by its last segment (`accuracy_dispersion`),
    # sometimes camel-cased in the manifest; both spellings count as read.
    def cited(name: str) -> bool:
        leaf = name.split(".")[-1]
        camel = re.sub(r"_([a-z])", lambda m: m.group(1).upper(), leaf)
        return leaf in corpus or camel in corpus

    return sorted(n for n in names if not cited(n))


def main() -> None:
    corpus = repo_text()
    for label, unread in unread_files(corpus).items():
        print(f"== {label}: {len(unread)} basenames never cited in the repo ==")
        for name in unread[:60]:
            print(f"  {name}")
        if len(unread) > 60:
            print(f"  … and {len(unread) - 60} more")
    if "--files" in sys.argv:
        return
    strict = "--importers" in sys.argv
    fields = unread_fields(repo_text(["tools/import_content.py", "tools/import-spec.json"]) if strict else corpus)
    print(f"== DAT unit fields (villager 83) {'the importer does not read' if strict else 'no importer or doc names'}: {len(fields)} ==")
    for name in fields:
        print(f"  {name}")


if __name__ == "__main__":
    main()
