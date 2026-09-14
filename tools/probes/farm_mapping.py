#!/usr/bin/env python3
"""Check the farm's furrow pitch against the reference's own count.

Issue #22 said the farm had too many rows. `terrain_dimensions` pins how each
sheet is cut into frames -- `frame_data[0].frame_count` is the product of the
dimensions for every slot -- but never says which frame a tile draws or how
much ground it covers, which is engine behaviour. It is also not readable as
tiles-per-span: it is 6x6 for the grown farm and 3x3 for the one being built,
and both sheets carry the same forty furrows across their span, so honouring it
halved a farm's furrow pitch the moment the crop came up.

The owner of the reference reports about twelve furrows across one farm, which
over three tiles against forty to the span is FARM_TILES_PER_SPAN = 10. This
draws that and measures it, so the claim stays checkable.

    uv run --locked python tools/probes/farm_mapping.py

Writes farm_pitch.png beside the imported terrain it reads.
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

Image.MAX_IMAGE_PIXELS = None

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / ".local/probes/farm_pitch.png"
TILE_W, TILE_H = 96, 48          # src/view/iso.ts
FARM_TILES = 3                    # a farm is radius 1.5
TILES_PER_SPAN = 10               # FARM_TILES_PER_SPAN in src/view/world.ts
REFERENCE_FURROWS = 12            # what the owner of the game reports


def furrows(image: Image.Image) -> int:
    """Furrows across a crop, by frequency rather than by eye.

    Measured on whichever axis actually carries them, so the answer does not
    depend on which way round the sheet is being drawn.
    """
    grey = np.asarray(image.convert("L"), dtype=np.float64)
    best, strength = 0, -1.0
    for axis in (0, 1):
        profile = grey.mean(axis=1 - axis)
        profile = (profile - profile.mean()) * np.hanning(len(profile))
        spectrum = np.abs(np.fft.rfft(profile))[2:80]
        if spectrum.max() > strength:
            best, strength = int(np.argmax(spectrum) + 2), float(spectrum.max())
    return best


def diamond(src: Image.Image, fraction: float) -> Image.Image:
    """Sample `fraction` of the sheet across the farm, sheared to dimetric.

    Turned a quarter turn first, as `createTerrainPatch` does: the furrows run
    along one world axis and the reference ploughs across the other.
    """
    n = max(2, int(src.size[0] * fraction))
    turned = src.transpose(Image.ROTATE_90)
    patch = turned.crop((0, 0, n, n)).resize((FARM_TILES * TILE_W, FARM_TILES * TILE_W), Image.LANCZOS)
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
                op[sx, sy] = (*px[int(x / FARM_TILES * span), int(y / FARM_TILES * span)], 255)
    return out


def main() -> None:
    sheets = [
        ("grown", ROOT / "public/imported/aoe2/terrain/g_fm1.png", (6, 6)),
        ("being built", ROOT / "public/imported/aoe2/terrain/g_fc1.png", (3, 3)),
    ]
    missing = [path for _, path, _ in sheets if not path.is_file()]
    if missing:
        raise SystemExit(f"no imported farm terrain at {missing[0]}; run npm run import:aoe2")

    fraction = FARM_TILES / TILES_PER_SPAN
    pad, gap = 20, 40
    sheet = Image.new(
        "RGB",
        (FARM_TILES * TILE_W + 2 * pad, len(sheets) * (FARM_TILES * TILE_H + gap) + pad),
        (70, 110, 55),
    )
    draw = ImageDraw.Draw(sheet)
    y = pad
    for label, path, dimensions in sheets:
        src = Image.open(path).convert("RGB")
        whole = furrows(src)
        side = int(src.size[0] * fraction)
        drawn = furrows(src.crop((0, 0, side, side)))
        tile = diamond(src, fraction)
        sheet.paste(tile, (pad, y), tile)
        draw.text((pad, y + FARM_TILES * TILE_H + 6),
                  f"{label}: dimensions {dimensions[0]}x{dimensions[1]}, "
                  f"{whole} furrows per span, {drawn} across the farm", fill=(255, 255, 255))
        print(f"{label:12} dimensions {dimensions}  {whole} furrows/span  -> {drawn} across the farm")
        if abs(drawn - REFERENCE_FURROWS) > 2:
            print(f"  WARNING: {drawn} is not the ~{REFERENCE_FURROWS} the reference shows")
        y += FARM_TILES * TILE_H + gap

    OUT.parent.mkdir(parents=True, exist_ok=True)
    sheet.resize((sheet.size[0] * 3, sheet.size[1] * 3), Image.LANCZOS).save(OUT)
    print(OUT)


if __name__ == "__main__":
    main()
