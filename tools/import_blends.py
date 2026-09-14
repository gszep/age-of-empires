#!/usr/bin/env python3
"""Import the owned terrain blend masks from `blendomatic_x1.dat`.

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

**Which mask for which neighbour.** The masks carry no labels, so rather than
matching names this measures them: each mask's coverage is summed over the
diamond's four quadrants, and each quadrant is the tile's neighbour along one
world axis (+x draws down-right, +y down-left). Grouping the masks by the
quadrant each covers most sorts the first sixteen into four groups of four --
one group per direction, four interchangeable variants apiece, which is where
the reference gets its variety from. The remaining fifteen are combinations
(halves, corners, three-quadrant) and are not needed: a tile with two
differing neighbours is drawn as two single-direction blends, which composes
the same edge without having to guess which combined mask means what.

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
#: Quadrant order is the world neighbour each one faces.
NEIGHBOURS = ("+x", "+y", "-x", "-y")


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


def quadrant_masks() -> dict[str, np.ndarray]:
    """Which pixels of the diamond face each world neighbour."""
    ys, xs = np.mgrid[0:TILE_H, 0:TILE_W]
    u = (xs - (TILE_W - 1) / 2) / ((TILE_W - 1) / 2)
    v = (ys - (TILE_H - 1) / 2) / ((TILE_H - 1) / 2)
    inside = np.abs(u) + np.abs(v) <= 1.0001
    return {
        "+x": inside & (u >= 0) & (v >= 0),   # down-right
        "+y": inside & (u <= 0) & (v >= 0),   # down-left
        "-x": inside & (u <= 0) & (v <= 0),   # up-left
        "-y": inside & (u >= 0) & (v <= 0),   # up-right
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


def single_edge_groups(masks: list[np.ndarray]) -> dict[str, list[int]]:
    """The masks that face one neighbour, grouped by which.

    A single-edge mask is one whose coverage is concentrated in a single
    quadrant; the combination masks cover two or more about equally. Sorting
    every mask by how far its best quadrant stands above its second sorts the
    first sixteen cleanly into four groups of four.
    """
    scored: list[tuple[float, str, int]] = []
    for index, total in enumerate(coverages(masks)):
        ranked = sorted(total.items(), key=lambda kv: kv[1], reverse=True)
        scored.append((ranked[0][1] - ranked[1][1], ranked[0][0], index))
    scored.sort(reverse=True)
    groups: dict[str, list[int]] = {name: [] for name in NEIGHBOURS}
    for _, name, index in scored:
        if len(groups[name]) < 4:
            groups[name].append(index)
    for name, found in groups.items():
        if len(found) != 4:
            raise ValueError(f"{name} found {len(found)} single-edge masks, not 4")
        found.sort()
    return groups


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--blendomatic",
        type=Path,
        default=depot_root() / "depot_813781/resources/_common/dat/blendomatic_x1.dat",
    )
    parser.add_argument("--out", type=Path, default=root / "public/imported/aoe2")
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
    solid = np.full((TILE_H, TILE_W), 255, dtype=np.uint8)

    entries = []
    for index, masks in enumerate(modes):
        columns = len(masks) + 1
        sheet = np.zeros((TILE_H, TILE_W * columns), dtype=np.uint8)
        for i, mask in enumerate(masks):
            # 0..128 is the file's range; stretch to 0..255 for an 8-bit image.
            sheet[:, i * TILE_W:(i + 1) * TILE_W] = np.minimum(mask.astype(np.uint16) * 2, 255)
        sheet[:, len(masks) * TILE_W:] = solid
        name = f"blends/mode-{index}.png"
        Image.fromarray(sheet, mode="L").save(args.out / name, optimize=True)
        entries.append({"image": name, "masks": columns})

    manifest_path = args.out / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.is_file() else {}
    manifest["blends"] = {
        "tile": [TILE_W, TILE_H],
        "modes": entries,
        # Mask columns to sample for a neighbour in this direction. Four
        # interchangeable variants apiece: the reference varies them so a long
        # boundary does not repeat one silhouette.
        "edges": groups,
        # The column past the owned masks: the whole diamond, opaque. Ours.
        "solid": len(modes[0]),
    }
    manifest.setdefault("source", {}).setdefault("sha256", {})["blendomatic"] = hashlib.sha256(
        args.blendomatic.read_bytes()).hexdigest()
    manifest_path.write_text(json.dumps(manifest, separators=(",", ":"), sort_keys=True) + "\n")

    print(f"{len(modes)} modes x {len(modes[0])} masks -> {args.out / 'blends'}")
    for name in NEIGHBOURS:
        print(f"  neighbour {name:<3} -> masks {groups[name]}")
    print(manifest_path)


if __name__ == "__main__":
    main()
