"""Lossless, deterministic subset of DE's RGB multi-channel distance font.

No font rasterisation and no assets in git. The two-texel gutter preserves
bilinear samples/forward differences at each original glyph box boundary.
"""
from __future__ import annotations

import hashlib
import re
import string
from pathlib import Path

from PIL import Image


def hud_characters(content: dict, layouts: dict, tree_strings: dict) -> set[str]:
    # Printable ASCII includes dynamic numbers, separators and project labels.
    chars = set(string.ascii_letters + string.digits + string.punctuation + " ")

    def collect(value):
        if isinstance(value, str):
            chars.update(c for c in value if c.isprintable())
        elif isinstance(value, dict):
            for child in value.values():
                collect(child)
        elif isinstance(value, list):
            for child in value:
                collect(child)

    for profile in [content, *content.get("civilizations", {}).values()]:
        collect(profile.get("strings", {}))
        collect(profile.get("ages", []))
        # Only display text, not sprite filenames or simulation metadata.
        for group in ("entities", "technologies"):
            for entry in profile.get(group, {}).values():
                for field in ("name", "help", "description"):
                    collect(entry.get(field, ""))
        collect(profile.get("civilization", {}).get("displayName", ""))
    collect(tree_strings)

    def widgets(value):
        if isinstance(value, dict):
            collect(value.get("Text", ""))
            for child in value.values():
                widgets(child)
        elif isinstance(value, list):
            for child in value:
                widgets(child)
    widgets(layouts)
    return chars


def parse_glyphs(text: str) -> tuple[int, dict[int, list]]:
    size = int(re.search(r"Source Font Pixel Size\s*:\s*(\d+)", text)[1])
    glyphs = {}
    for line in text.splitlines():
        if not line.startswith("Glyph - "):
            continue
        match = re.match(r"Glyph - (.+?)\s{2,}W\((\d+)\), H\((\d+)\), "
                         r"UV\(([^,]+), ([^)]+)\), ST\(([^,]+), ([^)]+)\), "
                         r"Atlas\((\d+)\), XO\(([^)]+)\), YO\(([^)]+)\), HAdvance\(([^)]+)\)", line)
        if not match:
            raise ValueError(f"unparsed glyph: {line}")
        identifier, *fields = match.groups()
        code = ord(identifier[1:-1]) if identifier.startswith("'") else int(identifier)
        values = [float(v) for v in fields]
        for i in (0, 1, 6):
            values[i] = int(values[i])
        glyphs[code] = values
    return size, glyphs


def extract_sdf_font(fonts: Path, characters: set[str], out: Path, hashes: dict) -> dict:
    def record(path):
        hashes[f"fonts/{path.name}"] = hashlib.sha256(path.read_bytes()).hexdigest()
    descriptor = fonts / "combined.txt"
    record(descriptor)
    size, source = parse_glyphs(descriptor.read_text(encoding="utf-8"))
    missing = sorted(c for c in characters if ord(c) not in source)
    if missing:
        raise ValueError(f"HUD characters absent from combined.txt: {missing!r}")
    selected = {str(ord(c)): source[ord(c)].copy() for c in sorted(characters)}
    pages = {}
    for page in sorted({g[6] for g in selected.values()}):
        path = fonts / f"combined_{page:04}.png"
        record(path)
        with Image.open(path) as image:
            pages[page] = image.convert("RGB")
    width, x, y, row_height = 512, 0, 0, 0
    crops = []
    for glyph in selected.values():
        w, h, u, v, _, _, page, *_ = glyph
        if w + 4 > width:
            raise ValueError("glyph exceeds packing width")
        if x + w + 4 > width:
            x, y, row_height = 0, y + row_height, 0
        image = pages[page]
        sx, sy = round(u * image.width), round(v * image.height)
        crops.append((image.crop((sx - 2, sy - 2, sx + w + 2, sy + h + 2)), x, y))
        glyph[2:7] = [x + 2, y + 2, x + 2 + w, y + 2 + h, 0]
        row_height = max(row_height, h + 4)
        x += w + 4
    height = y + row_height
    packed = Image.new("RGB", (width, height))
    for crop, x, y in crops:
        packed.paste(crop, (x, y))
    for glyph in selected.values():
        glyph[2:6] = [glyph[2] / width, glyph[3] / height,
                      glyph[4] / width, glyph[5] / height]
    relative = "fonts/hud-msdf.png"
    (out / "fonts").mkdir(parents=True, exist_ok=True)
    packed.save(out / relative, optimize=True)
    return {"sourceSize": size, "glyphs": selected, "pages": [relative],
            "sourcePages": sorted(pages), "size": [width, height]}
