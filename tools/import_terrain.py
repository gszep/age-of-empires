#!/usr/bin/env python3
"""Real ground into a map descriptor: the offline half of C2.

    uv run --locked python tools/import_terrain.py \
        --centre 496744.18 176864.98 --tiles 168 --pitch 35 \
        --openmap-grid SU --name windsor --out src/sim/maps/windsor.json

Britain first (docs/map-conditioning-design.md): the Environment Agency's
LIDAR Composite DTM gives bare ground at 1 m and its Vegetation Object Model
canopy height. Optional OS OpenMap Local vectors add surveyed surface-water
polygons and roads (including named private roads such as the Long Walk). All
are Open Government Licence sources in EPSG:27700. A tile is `pitch` metres on
a side; its elevation is mean bare-earth height and it is forest when enough
of it sits under canopy taller than 2.5 m, the VOM's tree threshold.

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
import os
import urllib.parse
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from pathlib import Path

import numpy as np
import rasterio
import shapefile
from affine import Affine
from rasterio.features import rasterize

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
TERRAIN_WATER = 1       # DAT: Water, Shallow (`g_wtr`)
TERRAIN_FOREST = 10
TERRAIN_ROAD = 24       # DAT: Road (`g_rd1`)
CANOPY_METRES = 2.5
FOREST_FRACTION = 0.3
ELEVATION_LEVELS = 8
START_CLEARING = 12

CACHE = Path(".local/geo-cache")
OPENMAP_URL = "https://api.os.uk/downloads/v1/products/OpenMapLocal/downloads"
OPENMAP_ATTRIBUTION = "Contains OS data © Crown copyright and database right 2026."


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


def fetch_openmap(grid: str) -> tuple[Path, str]:
    query = urllib.parse.urlencode({
        "area": grid.upper(), "format": "ESRI® Shapefile", "redirect": "true",
    })
    url = f"{OPENMAP_URL}?{query}"
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / f"openmap-local-{grid.lower()}.zip"
    if not path.is_file():
        print(f"fetching OS OpenMap Local {grid.upper()}...")
        urllib.request.urlretrieve(url, path)
    return path, url


def openmap_records(archive: Path, grid: str, layer: str, bbox):
    base = f"OS OpenMap Local (ESRI Shape File) {grid.upper()}/data/{grid.upper()}_{layer}"
    with zipfile.ZipFile(archive) as zipped:
        with shapefile.Reader(
            shp=BytesIO(zipped.read(base + ".shp")),
            shx=BytesIO(zipped.read(base + ".shx")),
            dbf=BytesIO(zipped.read(base + ".dbf")),
        ) as reader:
            yield from reader.iterShapeRecords(bbox=bbox)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--centre", nargs=2, type=float, required=True,
                        metavar=("E", "N"), help="diamond centre, EPSG:27700")
    parser.add_argument("--tiles", type=int, default=120, help="board edge, tiles")
    parser.add_argument("--pitch", type=float, default=10.0, help="metres per tile")
    parser.add_argument("--name", required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--jobs", type=int, default=os.cpu_count() or 1,
                        help="parallel fetch/processing workers (default: all CPUs)")
    parser.add_argument("--openmap-grid", metavar="SQUARE",
                        help="OS OpenMap Local 100 km square (for water and roads)")
    parser.add_argument("--landmark", nargs=3, action="append", default=[],
                        metavar=("KIND", "E", "N"),
                        help="place an owned-art landmark at an EPSG:27700 point")
    args = parser.parse_args()
    if args.jobs < 1:
        parser.error("--jobs must be at least 1")

    width = height = args.tiles
    ce, cn = args.centre
    half = args.tiles * args.pitch / math.sqrt(2)  # centre to any diamond corner
    bbox = (math.floor(ce - half), math.floor(cn - half),
            math.ceil(ce + half), math.ceil(cn + half))

    # The independent DTM and VOM coverages are large. Fetch them concurrently;
    # cap at the number of layers rather than leaving the machine's cores idle
    # while two network-bound requests run serially.
    with ThreadPoolExecutor(max_workers=min(args.jobs, len(COVERAGES))) as pool:
        futures = {kind: pool.submit(fetch, kind, bbox) for kind in COVERAGES}
        paths = {kind: future.result() for kind, future in futures.items()}
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

    # NumPy releases the GIL in these indexed reductions, so sample the two
    # independent layers in parallel as well. Memory use remains bounded to two
    # tile grids; the source rasters and index grids already dominate it.
    with ThreadPoolExecutor(max_workers=min(args.jobs, 2)) as pool:
        ground_future = pool.submit(per_tile, ground)
        canopy_future = pool.submit(per_tile, canopy)
        ground_tiles = ground_future.result()
        canopy_tiles = canopy_future.result()
    missing = int(np.isnan(ground_tiles).sum())
    if missing:
        raise SystemExit(f"{missing} tiles have no DTM coverage -- move the window")
    metres = [float(m) for m in ground_tiles.ravel()]
    terrain_grid = np.where(canopy_tiles >= FOREST_FRACTION,
                            TERRAIN_FOREST, TERRAIN_GRASS).astype(np.uint8)

    openmap_source = None
    if args.openmap_grid:
        archive, openmap_url = fetch_openmap(args.openmap_grid)
        # The board grid itself is a rotated EPSG:27700 raster. Rasterising
        # directly into it preserves the same diamond transform as DTM/VOM.
        step = args.pitch / math.sqrt(2)
        board_transform = Affine(step, -step, ce, -step, -step, cn + half)
        layers = {
            "SurfaceWater_Area": TERRAIN_WATER,
            "Road": TERRAIN_ROAD,
        }
        counts = {}
        for layer, terrain_id in layers.items():
            records = list(openmap_records(
                archive, args.openmap_grid, layer, bbox))
            counts[layer] = len(records)
            burned = rasterize(
                ((record.shape.__geo_interface__, 1) for record in records),
                out_shape=(height, width), transform=board_transform,
                fill=0, all_touched=True, dtype=np.uint8,
            )
            terrain_grid[burned != 0] = terrain_id
        openmap_source = {
            "product": "OS OpenMap Local", "gridSquare": args.openmap_grid.upper(),
            "url": openmap_url, "sha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
            "layers": counts,
        }
    terrain = terrain_grid.ravel().tolist()

    # Playability: starts scale with boards larger than the original 120 tiles.
    starts = [(round(width * 0.25), round(height * 0.5)),
              (round(width * 0.75), round(height * 0.5))]
    for sx, sy in starts:
        for ty in range(height):
            for tx in range(width):
                if (tx - sx) ** 2 + (ty - sy) ** 2 <= START_CLEARING ** 2:
                    terrain[ty * width + tx] = TERRAIN_GRASS

    low, high = min(metres), max(metres)
    per_level = max(1e-9, (high - low) / (ELEVATION_LEVELS - 1))
    elevation = [round((m - low) / per_level) for m in metres]

    landmarks = []
    for kind, east_raw, north_raw in args.landmark:
        east, north = float(east_raw), float(north_raw)
        difference = (east - ce) * math.sqrt(2) / args.pitch
        total = width - 1 - (north - cn) * math.sqrt(2) / args.pitch
        landmarks.append({
            "kind": kind,
            "x": round((total + difference) / 2, 3),
            "y": round((total - difference) / 2, 3),
            "sourcePoint": [east, north],
        })

    args.out.write_text(json.dumps({
        "width": width,
        "height": height,
        "terrain": terrain,
        # Real relief the renderer cannot draw yet: kept so the day it can,
        # the ridge is already here. Levels are (metres - datum) / perLevel.
        "elevation": elevation,
        "landmarks": landmarks,
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
            "clearedStarts": {"tiles": starts, "radius": START_CLEARING},
            **({"openMapLocal": openmap_source} if openmap_source else {}),
        },
        "attribution": ATTRIBUTION + (" " + OPENMAP_ATTRIBUTION if openmap_source else ""),
    }) + "\n")
    forest = sum(1 for t in terrain if t == TERRAIN_FOREST)
    print(f"{args.out}: {width}x{height}, {forest} forest tiles, "
          f"ground {low:.1f}-{high:.1f} m over {ELEVATION_LEVELS} levels")


if __name__ == "__main__":
    main()
