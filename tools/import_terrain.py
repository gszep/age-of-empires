#!/usr/bin/env python3
"""Real ground into a map descriptor: the offline half of C2.

    tools/import_terrain.py --centre 574950 115700 --tiles 120 \
        --pitch 10 --name senlac --out src/sim/maps/senlac.json

Britain first (docs/map-conditioning-design.md): the Environment Agency's
LIDAR Composite DTM gives the bare ground at 1 m and its Vegetation Object
Model gives canopy height above it, both under the Open Government Licence,
both served as WCS coverages an HTTP request can subset by bounding box
(EPSG:27700). A tile of the board is `pitch` metres on a side; its elevation
is the mean bare-earth height under it, and it is forest when enough of it
sits under canopy taller than 2.5 m -- the VOM's own threshold for a tree.

The board samples a *diamond* window: tile (0,0) is the window's north
corner, +x runs south-east and +y runs south-west, so the isometric renderer
(screen x ~ tx - ty, screen y ~ tx + ty) puts true north at the top of the
screen and the board sits over the map like a compass rose. The fetched
coverage is the diamond's axis-aligned bounding square.

The descriptor carries the terrain the game reads today, the quantised
elevation the renderer cannot yet draw (recorded, not invented -- see
docs/status.md), the sha256 of both fetched coverages, and the attribution
the licence asks for. Start areas are cleared of forest so the board is
playable; the clearing is recorded, because it is the one editorial mark on
otherwise real ground.
"""
import argparse
import hashlib
import json
import math
import urllib.request
from pathlib import Path

import numpy as np
import rasterio

WCS = "https://environment.data.gov.uk/spatialdata/{layer}/wcs"
COVERAGES = {
    "dtm": ("lidar-composite-digital-terrain-model-dtm-1m",
            "13787b9a-26a4-4775-8523-806d13af58fc__Lidar_Composite_Elevation_DTM_1m"),
    "vom": ("vegetation-object-model",
            "ecae3bef-1e1d-4051-887b-9dc613c928ec__Vegetation_Object_Model_Elevation_2022"),
}
ATTRIBUTION = (
    "Contains Environment Agency data (LIDAR Composite DTM 1m, Vegetation "
    "Object Model 2022) © Environment Agency and database right, licensed "
    "under the Open Government Licence v3.0."
)
TERRAIN_GRASS = 0
TERRAIN_FOREST = 10
CANOPY_METRES = 2.5
FOREST_FRACTION = 0.3
ELEVATION_LEVELS = 8
STARTS = [(30, 60), (90, 60)]
START_CLEARING = 12

CACHE = Path(".local/geo-cache")


def fetch(kind: str, bbox: tuple[float, float, float, float]) -> Path:
    layer, coverage = COVERAGES[kind]
    url = (f"{WCS.format(layer=layer)}?service=WCS&version=2.0.1&request=GetCoverage"
           f"&coverageId={coverage}&subset=E({bbox[0]},{bbox[2]})"
           f"&subset=N({bbox[1]},{bbox[3]})&format=image/tiff")
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / f"{hashlib.sha256(url.encode()).hexdigest()[:16]}-{kind}.tif"
    if not path.is_file():
        print(f"fetching {kind}...")
        urllib.request.urlretrieve(url, path)
    return path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--centre", nargs=2, type=float, required=True,
                        metavar=("E", "N"), help="diamond centre, EPSG:27700")
    parser.add_argument("--tiles", type=int, default=120, help="board edge, tiles")
    parser.add_argument("--pitch", type=float, default=10.0, help="metres per tile")
    parser.add_argument("--name", required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()

    width = height = args.tiles
    ce, cn = args.centre
    half = args.tiles * args.pitch / math.sqrt(2)  # centre to any diamond corner
    bbox = (math.floor(ce - half), math.floor(cn - half),
            math.ceil(ce + half), math.ceil(cn + half))

    paths = {kind: fetch(kind, bbox) for kind in COVERAGES}
    with rasterio.open(paths["dtm"]) as src:
        ground = src.read(1, masked=True).filled(np.nan)
        to_index = ~src.transform
    with rasterio.open(paths["vom"]) as src:
        vom = src.read(1, masked=True)
    canopy = ((~np.ma.getmaskarray(vom)) & (vom.filled(0) > CANOPY_METRES)).astype(float)

    # Supersample the diamond at 1 m along the board's own axes: pixel (v, u)
    # sits u metres down the +x edge (SE) and v metres down the +y edge (SW)
    # from the window's north corner, then block-mean back to tiles.
    per = round(args.pitch)
    u, v = np.meshgrid(np.arange(width * per) + 0.5, np.arange(height * per) + 0.5)
    east = ce + (u - v) / math.sqrt(2)
    north = cn + half - (u + v) / math.sqrt(2)
    cols, rows = to_index * (east, north)
    cols = np.clip(cols.astype(int), 0, ground.shape[1] - 1)
    rows = np.clip(rows.astype(int), 0, ground.shape[0] - 1)

    def per_tile(grid: np.ndarray) -> np.ndarray:
        return grid[rows, cols].reshape(height, per, width, per).mean(axis=(1, 3))

    ground_tiles = per_tile(ground)
    missing = int(np.isnan(ground_tiles).sum())
    if missing:
        raise SystemExit(f"{missing} tiles have no DTM coverage -- move the window")
    metres = [float(m) for m in ground_tiles.ravel()]
    terrain = [TERRAIN_FOREST if f >= FOREST_FRACTION else TERRAIN_GRASS
               for f in per_tile(canopy).ravel()]

    # Playability: the two starts get open ground, and the mark is recorded.
    for sx, sy in STARTS:
        for ty in range(height):
            for tx in range(width):
                if (tx - sx) ** 2 + (ty - sy) ** 2 <= START_CLEARING ** 2:
                    terrain[ty * width + tx] = TERRAIN_GRASS

    low, high = min(metres), max(metres)
    per_level = max(1e-9, (high - low) / (ELEVATION_LEVELS - 1))
    elevation = [round((m - low) / per_level) for m in metres]

    args.out.write_text(json.dumps({
        "width": width,
        "height": height,
        "terrain": terrain,
        # Real relief the renderer cannot draw yet: kept so the day it can,
        # the ridge is already here. Levels are (metres - datum) / perLevel.
        "elevation": elevation,
        "elevationMetres": {"datum": round(low, 2), "perLevel": round(per_level, 3)},
        "source": {
            "backend": "gb-environment-agency",
            "crs": "EPSG:27700",
            "centre": [ce, cn],
            "fetchedBbox": list(bbox),
            "pitchMetres": args.pitch,
            # tile (x, y) centre: E = centreE + (x - y) * pitch / sqrt(2),
            #                     N = centreN + (tiles - x - y - 1) * pitch / sqrt(2)
            "orientation": "diamond: tile (0,0) is the north corner; +x runs SE, +y runs SW",
            "coverages": {kind: {
                "layer": COVERAGES[kind][0],
                "coverageId": COVERAGES[kind][1],
                "sha256": hashlib.sha256(paths[kind].read_bytes()).hexdigest(),
            } for kind in COVERAGES},
            "clearedStarts": {"tiles": STARTS, "radius": START_CLEARING},
        },
        "attribution": ATTRIBUTION,
    }) + "\n")
    forest = sum(1 for t in terrain if t == TERRAIN_FOREST)
    print(f"{args.out}: {width}x{height}, {forest} forest tiles, "
          f"ground {low:.1f}-{high:.1f} m over {ELEVATION_LEVELS} levels")


if __name__ == "__main__":
    main()
