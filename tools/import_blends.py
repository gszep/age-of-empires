#!/usr/bin/env python3
"""Import classic blendomatic masks and DE's square water-family windows.

DE's waterwater/watershore/shallowswater PNGs are sampled in tile-axis space.
Their inferred window layout is recorded by `de_masks`; the classic masks
remain published for land transitions, farms and older-import compatibility.

Terrain-to-terrain edges in the reference are not hard tile boundaries: where
two terrains meet, the higher-priority one is drawn over its neighbour through
a soft mask, which is what makes a farm fade into grass instead of stopping at
a line.

**The format, proven rather than assumed.** The file is an 8-byte header
(`nr_blending_modes`, `nr_tiles`) followed by one mode per blending mode, each
exactly 82,390 bytes; the ninth ends on the last byte of the file. A mode is
its own `tile_size` (2353), `nr_tiles` flag bytes, and then 35 chunks of
`tile_size`. 2353 is the pixel count of the reference's own isometric tile: a
97x49 diamond whose rows run 1, 5, 9 ... 97 ... 5, 1, which sums to exactly
2353 and to nothing else. The first four chunks are dither patterns; the
remaining **31 are the masks, and 31 is the `nr_tiles` the header states**.
Alpha runs 0..128, the classic range.

**What a byte means.** A mask byte is how much of the *base* tile to keep,
not how much of the neighbour to draw: mask 30, the one for a tile with a
higher terrain on all four sides, keeps its centre and gives up its edges,
and every other mask reads the same way once that is known. The atlas is
published as overlay alpha -- 255 minus twice the byte -- because that is
what a renderer multiplies the neighbour's texture by.

**Which mask for which neighbour.** The 31 masks are the reference's own
table, as documented by the openage project's reverse engineering of the
engine (doc/media/blendomatic.md; the table is the engine's, reimplemented
here, not their code): ids 0-15 are four interchangeable variants apiece
for a single higher neighbour across one edge, 16-19 across one corner,
20-25 two edges, 26-29 three, 30 all four. Their orientation in this
decode is *measured* rather than trusted -- each single-edge group must keep
least of the quadrant that faces its neighbour -- and it comes out with the
neighbour across the south-east edge (world +y) for masks 0-3, the
north-east (-x) for 4-7, the south-west (+x) for 8-11 and the north-west
(-y) for 12-15 -- world axes as AoE2 lays them, +x down-left on screen.

    uv run --locked python tools/import_blends.py
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image

from depot import depot_root

MODE_BYTES = 82_390
TILE_SIZE = 2353
DITHER_CHUNKS = 4
TILE_W, TILE_H = 97, 49
#: Pixels of gutter either side of each mask column in the atlas. A quad's
#: west and east corners sample the very edge of a column, and bilinear
#: filtering there mixes in the neighbouring column's edge; the gutter is
#: the mask's own edge value carried outward, so the sample is the mask's.
GUTTER = 2
#: Quadrant order is the world neighbour each one faces.
NEIGHBOURS = ("+x", "+y", "-x", "-y")

# DE's square blend families, using the existing engine family indices.
DE_FAMILIES = {0: "waterwater", 1: "watershore", 7: "shallowswater"}
DE_TILE = 64


def de_masks(path: Path) -> list[np.ndarray]:
    """Window the owned 512-square sheet in tile-axis space, not screen space.

    Window interpretation is inferred (ledger #148). The sheet supplies four
    border fades, outside corners, the four quarters of its inner diamond,
    and an isolated centre hole. Opposite/three-edge masks union the authored
    edge fades: no new noise or hand-painted coastline is synthesized.
    """
    with Image.open(path) as image:
        if image.size != (512, 512):
            raise ValueError(f"unexpected DE blend sheet size: {path}: {image.size}")
        source = np.asarray(image.convert("RGB"))[:, :, 0]
    def window(x: int, y: int) -> np.ndarray:
        return source[y:y + DE_TILE, x:x + DE_TILE].copy()
    masks = [
        # +y, -x, +x, -y: alpha rises toward that world-tile edge.
        *[window(x, 0) for x in (64, 128, 192, 320)],
        *[window(448, y) for y in (64, 192, 320, 384)],
        *[window(0, y) for y in (64, 128, 192, 320)],
        *[window(x, 448) for x in (64, 192, 320, 384)],
        # Diagonal neighbour: -x/+y, +x/+y, -x/-y, +x/-y.
        window(448, 0), window(0, 0), window(448, 448), window(0, 448),
    ]
    masks.extend([
        np.maximum(masks[4], masks[8]),  # opposite x edges
        np.maximum(masks[0], masks[12]),  # opposite y edges
        window(320, 256),  # +x/-y: three white corners, low -x/+y corner
        window(256, 256),  # -x/-y
        window(320, 320),  # +x/+y
        window(256, 320),  # -x/+y
        np.maximum.reduce([masks[0], masks[4], masks[8]]),
        np.maximum.reduce([masks[0], masks[8], masks[12]]),
        np.maximum.reduce([masks[4], masks[8], masks[12]]),
        np.maximum.reduce([masks[0], masks[4], masks[12]]),
        window(128, 128),  # four higher neighbours, low centre
    ])
    return masks


def publish_de_masks(directory: Path, out: Path) -> tuple[dict, dict[str, str]]:
    """Keep original alpha bytes in square windows, with edge-replicated gutters."""
    modes, hashes = {}, {}
    pitch = DE_TILE + 2 * GUTTER
    for mode, name in DE_FAMILIES.items():
        path = directory / f"{name}.png"
        masks = de_masks(path)
        masks.append(np.full((DE_TILE, DE_TILE), 255, dtype=np.uint8))
        sheet = np.concatenate([np.pad(mask, ((0, 0), (GUTTER, GUTTER)), mode="edge") for mask in masks], axis=1)
        assert sheet.shape == (DE_TILE, pitch * len(masks))
        image = f"blends/de-{name}.png"
        Image.fromarray(sheet).save(out / image, optimize=True)
        modes[str(mode)] = {"image": image, "masks": len(masks), "source": f"{name}.png"}
        hashes[f"blend-{name}"] = hashlib.sha256(path.read_bytes()).hexdigest()
    return {"tile": [DE_TILE, DE_TILE], "gutter": GUTTER, "modes": modes}, hashes


def row_widths() -> list[int]:
    """The diamond's rows: 1, 5, 9 ... 97 ... 5, 1."""
    return [1 + 4 * r if r < 25 else 97 - 4 * (r - 24) for r in range(TILE_H)]


ROWS = row_widths()
assert sum(ROWS) == TILE_SIZE, "the diamond must hold exactly one tile_size of pixels"


def unpack(buffer: np.ndarray) -> np.ndarray:
    """One mask's alpha bytes laid into a 97x49 diamond."""
    image = np.zeros((TILE_H, TILE_W), dtype=np.uint8)
    at = 0
    for row, width in enumerate(ROWS):
        left = (TILE_W - width) // 2
        image[row, left:left + width] = buffer[at:at + width]
        at += width
    return image


def extend(diamond: np.ndarray) -> np.ndarray:
    """The diamond's edge values carried out to the rectangle's edges.

    Outside the diamond the file has nothing, and a zero there is not "no
    opinion": the quad's edges run exactly along the diamond's, so bilinear
    filtering at every tile seam mixed the mask with the transparent outside
    and drew a stair-stepped dotted line of the underlying terrain along
    every blended edge. Each row's first and last pixel now continue to the
    rectangle's edge, so a sample on the seam is the mask's own edge value.
    """
    out = diamond.copy()
    for row, width in enumerate(ROWS):
        left = (TILE_W - width) // 2
        out[row, :left] = diamond[row, left]
        out[row, left + width:] = diamond[row, left + width - 1]
    return out


def quadrant_masks() -> dict[str, np.ndarray]:
    """Which pixels of the diamond face each world neighbour."""
    ys, xs = np.mgrid[0:TILE_H, 0:TILE_W]
    u = (xs - (TILE_W - 1) / 2) / ((TILE_W - 1) / 2)
    v = (ys - (TILE_H - 1) / 2) / ((TILE_H - 1) / 2)
    inside = np.abs(u) + np.abs(v) <= 1.0001
    return {
        "+y": inside & (u >= 0) & (v >= 0),   # down-right
        "+x": inside & (u <= 0) & (v >= 0),   # down-left
        "-y": inside & (u <= 0) & (v <= 0),   # up-left
        "-x": inside & (u >= 0) & (v <= 0),   # up-right
    }


def read_modes(path: Path) -> list[list[np.ndarray]]:
    raw = np.frombuffer(path.read_bytes(), dtype=np.uint8)
    modes, tiles = np.frombuffer(raw[:8].tobytes(), dtype="<u4")
    if (len(raw) - 8) != modes * MODE_BYTES:
        raise ValueError(f"blendomatic does not walk to its end: {len(raw)} bytes, {modes} modes")
    out: list[list[np.ndarray]] = []
    for index in range(int(modes)):
        base = 8 + index * MODE_BYTES
        tile_size = int(np.frombuffer(raw[base:base + 4].tobytes(), dtype="<u4")[0])
        if tile_size != TILE_SIZE:
            raise ValueError(f"mode {index} states tile_size {tile_size}, not {TILE_SIZE}")
        body = raw[base + 4 + int(tiles): base + MODE_BYTES]
        chunks = len(body) // TILE_SIZE
        if chunks != DITHER_CHUNKS + int(tiles):
            raise ValueError(f"mode {index} holds {chunks} chunks, not {DITHER_CHUNKS} + {tiles}")
        out.append([
            unpack(body[i * TILE_SIZE:(i + 1) * TILE_SIZE])
            for i in range(DITHER_CHUNKS, chunks)
        ])
    return out


def coverages(masks: list[np.ndarray]) -> list[dict[str, float]]:
    """Each mask's mean alpha within each of the diamond's four quadrants."""
    quadrants = quadrant_masks()
    out: list[dict[str, float]] = []
    for mask in masks:
        total = {}
        for name, region in quadrants.items():
            area = int(region.sum())
            total[name] = float(mask[region].sum()) / (area * 128) if area else 0.0
        out.append(total)
    return out


#: The reference's single-edge masks per world neighbour, in this decode's
#: orientation (see the module docstring). Verified against the pixels by
#: `single_edge_groups`, never assumed.
EDGE_GROUPS: dict[str, list[int]] = {
    "+y": [0, 1, 2, 3], "-x": [4, 5, 6, 7], "+x": [8, 9, 10, 11], "-y": [12, 13, 14, 15],
}


def single_edge_groups(masks: list[np.ndarray]) -> dict[str, list[int]]:
    """The masks that face one neighbour, grouped by which -- the reference's
    table, checked against the bytes: a mask facing a neighbour keeps the
    least of the quadrant on that neighbour's side and the most of the
    quadrant opposite, or the decode is misread."""
    cover = coverages(masks)
    opposite = {"+x": "-x", "-x": "+x", "+y": "-y", "-y": "+y"}
    for name, indexes in EDGE_GROUPS.items():
        for index in indexes:
            ranked = sorted(cover[index].items(), key=lambda kv: kv[1])
            if ranked[0][0] != name or ranked[-1][0] != opposite[name]:
                raise ValueError(
                    f"mask {index} keeps least of {ranked[0][0]} and most of {ranked[-1][0]}, "
                    f"not a {name} edge")
    return {name: list(indexes) for name, indexes in EDGE_GROUPS.items()}


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--blendomatic",
        type=Path,
        default=depot_root() / "depot_813781/resources/_common/dat/blendomatic_x1.dat",
    )
    parser.add_argument("--out", type=Path, default=root / "public/imported/aoe2")
    parser.add_argument("--de-blends", type=Path,
                        default=depot_root() / "depot_813782/resources/_common/terrain/blends")
    args = parser.parse_args()
    if not args.blendomatic.is_file():
        raise SystemExit(f"no blendomatic at {args.blendomatic}; see docs/owned-assets-setup.md")

    modes = read_modes(args.blendomatic)
    groups = single_edge_groups(modes[0])

    # One atlas per mode, masks laid left to right: the renderer samples a
    # column by index, so the geometry is a multiply rather than a lookup.
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "blends").mkdir(exist_ok=True)
    # One extra column past the owned masks: the diamond, solid. It is ours,
    # not the DAT's, and it exists so a mesh that is mostly unmasked -- a
    # farm's own tiles, against the fading ring around them -- can carry both
    # in one material instead of needing a second draw.
    #
    # Opaque across the whole rectangle, not just the inscribed diamond: a
    # quad's corners sample the diamond's four extreme points, so anything
    # that falls off at the diamond's edge is filtered to half alpha exactly
    # along every tile seam -- which drew a faint grid over the farm.
    entries = []
    pitch = TILE_W + 2 * GUTTER
    for index, masks in enumerate(modes):
        columns = len(masks) + 1
        sheet = np.zeros((TILE_H, pitch * columns), dtype=np.uint8)
        for i, mask in enumerate(masks):
            # 0..128 is the file's range, and it is how much base to keep:
            # stretched to 8 bits and inverted, so the atlas is overlay alpha.
            stretched = (255 - np.minimum(extend(mask).astype(np.uint16) * 2, 255)).astype(np.uint8)
            column = np.zeros((TILE_H, pitch), dtype=np.uint8)
            column[:, GUTTER:GUTTER + TILE_W] = stretched
            column[:, :GUTTER] = stretched[:, :1]
            column[:, GUTTER + TILE_W:] = stretched[:, -1:]
            sheet[:, i * pitch:(i + 1) * pitch] = column
        sheet[:, len(masks) * pitch:] = 255
        name = f"blends/mode-{index}.png"
        Image.fromarray(sheet, mode="L").save(args.out / name, optimize=True)
        entries.append({"image": name, "masks": columns})

    manifest_path = args.out / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.is_file() else {}
    manifest["blends"] = {
        "tile": [TILE_W, TILE_H],
        # Each column is the tile plus this many pixels of gutter each side,
        # so a column's u range is (column * pitch + gutter .. + tile) / width.
        "gutter": GUTTER,
        "modes": entries,
        # Mask columns to sample for a neighbour in this direction. Four
        # interchangeable variants apiece: the reference varies them so a long
        # boundary does not repeat one silhouette.
        "edges": groups,
        # The column past the owned masks: the whole diamond, opaque. Ours.
        "solid": len(modes[0]),
    }
    native, source_hashes = publish_de_masks(args.de_blends, args.out)
    manifest["blends"]["native"] = native
    manifest.setdefault("source", {}).setdefault("sha256", {}).update(source_hashes)
    print(f"{len(native['modes'])} DE water families x 31 square windows -> {args.out / 'blends'}")
    manifest.setdefault("source", {}).setdefault("sha256", {})["blendomatic"] = hashlib.sha256(
        args.blendomatic.read_bytes()).hexdigest()
    manifest_path.write_text(json.dumps(manifest, separators=(",", ":"), sort_keys=True) + "\n")

    print(f"{len(modes)} modes x {len(modes[0])} masks -> {args.out / 'blends'}")
    for name in NEIGHBOURS:
        print(f"  neighbour {name:<3} -> masks {groups[name]}")
    print(manifest_path)


if __name__ == "__main__":
    main()
