#!/usr/bin/env python3
"""Render the candidate farm terrain mappings onto the real diamond.

Issue #22 says the farm has "too many rows". The DAT pins the frame layout --
`frame_data[0].frame_count` is the product of `terrain_dimensions` for every
slot -- but never says which frame a tile draws, which is engine behaviour. So
the question is which of three mappings matches the installed game, and this
draws all three at the reference's own 96x48 tile so a human can point at one.

    uv run --locked python tools/probes/farm_mapping.py

Writes farm_options.png beside the imported terrain it reads.
"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "public/imported/aoe2/terrain/g_fm1.png"
OUT = ROOT / ".local/probes/farm_options.png"
TILE_W, TILE_H = 96, 48          # src/view/iso.ts
FARM_TILES = 3                    # a farm is 3x3


def diamond(src: Image.Image, fraction: float) -> Image.Image:
    """Sample `fraction` of the texture across the farm, then shear to dimetric."""
    n = max(1, int(src.size[0] * fraction))
    patch = src.crop((0, 0, n, n)).resize((FARM_TILES * TILE_W, FARM_TILES * TILE_W), Image.LANCZOS)
    out = Image.new("RGBA", (FARM_TILES * TILE_W, FARM_TILES * TILE_H), (0, 0, 0, 0))
    px, op = patch.load(), out.load()
    span = FARM_TILES * TILE_W - 1
    for sy in range(FARM_TILES * TILE_H):
        for sx in range(FARM_TILES * TILE_W):
            # Inverse of worldToIso: sx = (x - y) * TILE_W/2, sy = (x + y) * TILE_H/2
            fx = (sx - FARM_TILES * TILE_W / 2) / (TILE_W / 2)
            fy = sy / (TILE_H / 2)
            x, y = (fy + fx) / 2, (fy - fx) / 2
            if 0 <= x < FARM_TILES and 0 <= y < FARM_TILES:
                op[sx, sy] = px[int(x / FARM_TILES * span), int(y / FARM_TILES * span)]
    return out


def main() -> None:
    if not SOURCE.is_file():
        raise SystemExit(f"no imported farm texture at {SOURCE}; run npm run import:aoe2")
    src = Image.open(SOURCE).convert("RGBA")
    options = [
        (1.0, "whole texture over 3x3  (~40 rows)"),
        (0.5, "half = one 3x3 of the 6x6 grid  (~20 rows) -- WHAT WE DRAW NOW"),
        (1 / 6, "one frame cell stretched over 3x3  (~7 rows)"),
    ]
    pad = 18
    sheet = Image.new("RGB", (FARM_TILES * TILE_W + 2 * pad,
                              len(options) * (FARM_TILES * TILE_H + 34) + pad), (70, 110, 55))
    draw = ImageDraw.Draw(sheet)
    y = pad
    for fraction, label in options:
        tile = diamond(src, fraction)
        sheet.paste(tile, (pad, y), tile)
        draw.text((pad, y + FARM_TILES * TILE_H + 4), label, fill=(255, 255, 255))
        y += FARM_TILES * TILE_H + 34
    sheet = sheet.resize((sheet.size[0] * 2, sheet.size[1] * 2), Image.NEAREST)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(OUT)
    print(OUT)


if __name__ == "__main__":
    main()
