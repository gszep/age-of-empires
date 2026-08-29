#!/usr/bin/env python3
"""Paint a map: a PNG becomes a committed map descriptor.

    tools/paint_map.py <image.png> <out.json>

One pixel is one tile. Dark green (a green channel that leads but stays
under 100) is forest; everything else is grass. The output carries the
image's own hash, so the descriptor can always say what it was painted
from -- the same discipline `content.json` applies to the owned assets.

This is the whole of the offline half of the conditioning pipeline
(docs/map-conditioning-design.md): anything that can produce a label
image -- a hand painting, a satellite classification, a georeferenced
survey sheet -- can produce a board, and the simulation only ever sees
the committed JSON.
"""
import hashlib
import json
import sys
from pathlib import Path

from PIL import Image

TERRAIN_GRASS = 0
TERRAIN_FOREST = 10

source, out = Path(sys.argv[1]), Path(sys.argv[2])
image = Image.open(source).convert("RGB")
width, height = image.size
terrain = []
for y in range(height):
    for x in range(width):
        r, g, b = image.getpixel((x, y))
        forest = g > r and g > b and g < 100
        terrain.append(TERRAIN_FOREST if forest else TERRAIN_GRASS)

out.write_text(json.dumps({
    "width": width,
    "height": height,
    "terrain": terrain,
    "source": {
        "file": source.name,
        "sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
    },
}) + "\n")
print(f"{out}: {width}x{height}, {sum(1 for t in terrain if t == TERRAIN_FOREST)} forest tiles")
