#!/usr/bin/env python3
"""Convert every animation in the extracted content with the local SLD decoder."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def convert(source: Path, output: Path, expected_frames: int) -> dict[str, Any]:
    """Decode and pack an SLD's BC1 main graphics layer.

    tools/sld_layers.py decodes it locally (verified byte-identical to the
    previously used openage decoder over all 29,783 imported frames), which
    also handles files whose outline branch crashes openage, such as the
    stable.
    """
    from sld_layers import decode_colors, pack_color_atlas

    frames = decode_colors(source.read_bytes())
    playable = min(expected_frames, len(frames))
    if playable == 0:
        raise ValueError(f"{source.name}: no frames decoded")

    image, atlas = pack_color_atlas(frames, playable)
    output.parent.mkdir(parents=True, exist_ok=True)
    image.save(output, optimize=True)
    atlas["framesInFile"] = len(frames)
    return {"image": output.name, **atlas}


def convert_mask(source: Path, output: Path, expected_frames: int, layer: str) -> dict[str, Any]:
    """Decode and pack one of an SLD's BC4 mask layers, `shadow` or `playercolor`.

    Uses tools/sld_layers.py rather than the openage decoder, whose BC4 path
    corrupts the heap on these layers. Pure Python, so a bad file raises here
    instead of taking the process down with it.

    The two layers are packed differently because they mean different things.
    A shadow sheet is neutral white with the mask as alpha: the renderer
    multiplies black through it. A player-colour sheet keeps the coverage in
    alpha but carries the main layer's grey in RGB, because that grey is the
    shade the renderer looks up in the player's palette ramp.
    """
    from sld_layers import (LAYER_PLAYERCOLOR, LAYER_SHADOW, decode_colors, decode_masks,
                            pack_mask_atlas, pack_playercolor_atlas)

    data = source.read_bytes()
    wanted = LAYER_PLAYERCOLOR if layer == "playercolor" else LAYER_SHADOW
    frames = decode_masks(data, wanted)
    playable = min(expected_frames, len(frames))
    if playable == 0 or not any(f is not None and not f.empty for f in frames[:playable]):
        return {}
    if layer == "playercolor":
        image, atlas = pack_playercolor_atlas(frames, decode_colors(data), playable)
    else:
        image, atlas = pack_mask_atlas(frames, playable)
    output.parent.mkdir(parents=True, exist_ok=True)
    image.save(output, optimize=True)
    return atlas


def convert_terrain(
    terrain: dict[str, Any], terrain_dir: Path, out_dir: Path, hashes: dict[str, str]
) -> dict[str, Any]:
    """Terrain ships as plain DDS tiling textures, so Pillow converts them
    directly; the openage SLD decoder is not involved."""
    from PIL import Image

    converted: dict[str, Any] = {}
    for key, slot in terrain.items():
        source = terrain_dir / f"{slot['texture']}.dds"
        if not source.is_file():
            raise FileNotFoundError(f"terrain texture missing: {source}")
        relative = f"terrain/{slot['texture']}.png"
        target = out_dir / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        with Image.open(source) as image:
            image.convert("RGBA").save(target, optimize=True)
        hashes[f"terrain/{source.name}"] = sha256(source)
        converted[key] = {**slot, "image": relative}
    return converted


def atlas_jobs(imported: dict[str, Any]) -> list[dict[str, Any]]:
    """Every main-layer atlas to produce."""
    jobs: list[dict[str, Any]] = []

    def add(key: str, animations: dict[str, Any], prefix: str = "") -> None:
        for state, animation in animations.items():
            jobs.append({
                "key": key,
                "name": f"{prefix}{state}",
                "source": animation["source"],
                "expected": animation["frames"] * animation["directions"],
            })

    for key, entity in imported["entities"].items():
        add(key, entity["animations"])
        for index, annex in enumerate(entity.get("annexes", [])):
            add(key, annex["animations"], prefix=f"annex{index}-")
    return jobs


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser()
    parser.add_argument("--content", type=Path, default=root / ".local/aoe2de/content.json")
    parser.add_argument(
        "--graphics",
        type=Path,
        default=Path.home() / "Steam/steamapps/content/app_813780/depot_813784/resources/_common/drs/graphics",
    )
    parser.add_argument(
        "--terrain",
        type=Path,
        default=Path.home() / "Steam/steamapps/content/app_813780/depot_813782/resources/_common/terrain/textures/2x",
    )
    parser.add_argument("--out", type=Path, default=root / "public/imported/aoe2")
    args = parser.parse_args()

    imported = json.loads(args.content.read_text())
    jobs = atlas_jobs(imported)

    # Everything decodes in-process now: the local pure-Python decoder cannot
    # crash the run the way the previously used openage native decoder did,
    # so the per-atlas subprocess isolation is gone with it.
    args.out.mkdir(parents=True, exist_ok=True)
    atlases: dict[str, dict[str, Any]] = {}
    skipped: list[str] = []
    for job in jobs:
        identifier = f"{job['key']}:{job['name']}"
        atlas = convert(
            args.graphics / job["source"], args.out / job["key"] / f"{job['name']}.png", job["expected"]
        )
        atlas["image"] = f"{job['key']}/{job['name']}.png"
        atlases.setdefault(job["key"], {})[job["name"]] = atlas
        print(identifier)

    # A mask failure costs that entity one mask and is recorded, never fatal.
    mask_skipped: list[str] = []
    for job in jobs:
        for layer in ("shadow", "playercolor"):
            identifier = f"{job['key']}:{job['name']}:{layer}"
            try:
                atlas = convert_mask(
                    args.graphics / job["source"],
                    args.out / job["key"] / f"{job['name']}-{layer}.png",
                    job["expected"],
                    layer,
                )
            except Exception as error:  # noqa: BLE001 - one bad layer must not stop the import
                mask_skipped.append(identifier)
                print(f"skipped {identifier}: {error}")
                continue
            if atlas:
                atlas["image"] = f"{job['key']}/{job['name']}-{layer}.png"
                atlases.setdefault(job["key"], {})[f"{job['name']}-{layer}"] = atlas
            print(identifier)

    entities: dict[str, Any] = {}
    for key, entity in imported["entities"].items():
        entity = dict(entity)
        entity["atlases"] = {
            name: atlas for name, atlas in atlases.get(key, {}).items() if not name.startswith("annex")
        }
        for index, annex in enumerate(entity.get("annexes", [])):
            annex["atlases"] = {
                name: atlas
                for name, atlas in atlases.get(key, {}).items()
                if name.startswith(f"annex{index}-")
            }
        entities[key] = entity

    source = dict(imported["source"])
    hashes = dict(source.get("sha256", {}))
    terrain = convert_terrain(imported.get("terrain", {}), args.terrain, args.out, hashes)
    source["sha256"] = hashes

    manifest = {
        "schemaVersion": imported["schemaVersion"],
        "source": source,
        "entities": entities,
        "playerColors": imported["playerColors"],
        "terrain": terrain,
        "skippedAtlases": sorted(skipped),
        "skippedMasks": sorted(mask_skipped),
    }
    manifest_path = args.out / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, separators=(",", ":"), sort_keys=True) + "\n")
    print(manifest_path)


if __name__ == "__main__":
    main()
