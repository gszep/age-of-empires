#!/usr/bin/env python3
"""Convert every animation in the extracted content with pinned openage decoder code."""

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


# SLD layers: 0 main graphics, 1 shadow, 4 player-color mask. Only the main
# layer is converted: the pinned openage decoder segfaults nondeterministically
# on supplemental shadow/mask layers (recorded evidence, see tools/README.md),
# which would break byte-identical regeneration.
LAYERS = {"": 0}


def convert(source: Path, output: Path, expected_frames: int, layer: int = 0) -> dict[str, Any]:
    from openage.convert.entity_object.export.texture import Texture
    from openage.convert.processor.export.texture_merge import merge_frames
    from openage.convert.value_object.read.media.sld import SLD

    sld = SLD(source.read_bytes())
    if layer != 0 and len(sld.get_frames(layer)) == 0:
        return {}
    texture = Texture(sld, layer=layer)
    texture.image_metadata = {}
    merge_frames(texture)
    metadata = texture.image_metadata
    frames = metadata["subtex_metadata"]
    playable = min(expected_frames, len(frames))
    if playable == 0:
        raise ValueError(f"{source.name}: no frames decoded")

    output.parent.mkdir(parents=True, exist_ok=True)
    texture.image_data.get_pil_image().save(output, optimize=True)
    return {
        "image": output.name,
        "size": metadata["size"],
        "framesInFile": len(frames),
        "frames": frames[:playable],
    }


def convert_shadow(source: Path, output: Path, expected_frames: int) -> dict[str, Any]:
    """Decode and pack an SLD's shadow layer.

    Uses tools/sld_shadow.py rather than the openage decoder, whose BC4 path
    corrupts the heap on this layer. Pure Python, so a bad file raises here
    instead of taking the process down with it.
    """
    from sld_shadow import decode_shadows, pack_shadow_atlas

    frames = decode_shadows(source.read_bytes())
    playable = min(expected_frames, len(frames))
    if playable == 0 or not any(f is not None and not f.empty for f in frames[:playable]):
        return {}
    image, atlas = pack_shadow_atlas(frames, playable)
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


def extra_layer_states(category: str) -> set[str]:
    """States whose shadow/player-color layers are exported.

    Building destruction shadow layers hit pathological packing times in the
    pinned openage packer and carry no player color, so they are skipped.
    """
    if category in ("unit", "unit-variant"):
        return {"idle", "walk", "work", "carry", "attack", "death"}
    if category == "building":
        return {"idle", "construction"}
    return {"idle"}


def convert_animations(
    animations: dict[str, Any], graphics_dir: Path, out_dir: Path, key: str,
    category: str, prefix: str = ""
) -> dict[str, Any]:
    atlases: dict[str, Any] = {}
    with_layers = extra_layer_states(category)
    for state, animation in animations.items():
        expected = animation["frames"] * animation["directions"]
        for suffix, layer in LAYERS.items():
            if suffix and state not in with_layers:
                continue
            name = f"{prefix}{state}" + (f"-{suffix}" if suffix else "")
            atlas = convert(graphics_dir / animation["source"], out_dir / f"{name}.png", expected, layer)
            if not atlas:
                continue
            atlas["image"] = f"{key}/{name}.png"
            atlases[name] = atlas
    return atlases


def atlas_jobs(imported: dict[str, Any]) -> list[dict[str, Any]]:
    """Every atlas to produce: (key, name, source, expected frames, layer)."""
    jobs: list[dict[str, Any]] = []

    def add(key: str, category: str, animations: dict[str, Any], prefix: str = "") -> None:
        with_layers = extra_layer_states(category)
        for state, animation in animations.items():
            for suffix, layer in LAYERS.items():
                if suffix and state not in with_layers:
                    continue
                name = f"{prefix}{state}" + (f"-{suffix}" if suffix else "")
                jobs.append({
                    "key": key,
                    "name": name,
                    "source": animation["source"],
                    "expected": animation["frames"] * animation["directions"],
                    "layer": layer,
                })

    for key, entity in imported["entities"].items():
        add(key, entity["category"], entity["animations"])
        for index, annex in enumerate(entity.get("annexes", [])):
            add(key, "building", annex["animations"], prefix=f"annex{index}-")
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
    parser.add_argument("--atlas", help="worker mode: convert one atlas, format key:name:layer")
    args = parser.parse_args()

    imported = json.loads(args.content.read_text())
    jobs = atlas_jobs(imported)

    if args.atlas:
        job = next(
            j for j in jobs
            if f"{j['key']}:{j['name']}:{j['layer']}" == args.atlas
        )
        out_dir = args.out / job["key"]
        atlas = convert(
            args.graphics / job["source"], out_dir / f"{job['name']}.png", job["expected"], job["layer"]
        )
        if atlas:
            atlas["image"] = f"{job['key']}/{job['name']}.png"
        (out_dir / f"{job['name']}.atlas.json").write_text(
            json.dumps(atlas, separators=(",", ":"), sort_keys=True)
        )
        return

    # The pinned openage native decoder aborts/hangs unpredictably inside a
    # long-lived process, so every atlas converts in an isolated subprocess
    # with one retry before failing the pipeline.
    import subprocess
    import sys

    args.out.mkdir(parents=True, exist_ok=True)
    atlases: dict[str, dict[str, Any]] = {}
    skipped: list[str] = []
    for job in jobs:
        identifier = f"{job['key']}:{job['name']}:{job['layer']}"
        marker = args.out / job["key"] / f"{job['name']}.atlas.json"
        command = [
            sys.executable, __file__,
            "--content", str(args.content),
            "--graphics", str(args.graphics),
            "--out", str(args.out),
            "--atlas", identifier,
        ]
        failed = False
        for attempt in (1, 2):
            failed = False
            try:
                subprocess.run(command, check=True, timeout=600)
                break
            except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
                failed = True
        if failed:
            if job["layer"] == 0:
                raise RuntimeError(f"required atlas conversion failed twice: {identifier}")
            # Supplemental shadow/mask layers that the pinned decoder cannot
            # convert are recorded and skipped rather than failing the import.
            skipped.append(identifier)
            (args.out / job["key"] / f"{job['name']}.png").unlink(missing_ok=True)
            print(f"skipped {identifier}")
            continue
        atlas = json.loads(marker.read_text())
        marker.unlink()
        if atlas:
            atlases.setdefault(job["key"], {})[job["name"]] = atlas
        print(identifier)

    # Shadow layers decode in-process: tools/sld_shadow.py is pure Python, so
    # unlike the native main-layer decoder it cannot take the run down. A
    # failure costs that entity its shadow and is recorded, never fatal.
    shadow_skipped: list[str] = []
    for job in jobs:
        if job["layer"] != 0:
            continue
        identifier = f"{job['key']}:{job['name']}:shadow"
        try:
            atlas = convert_shadow(
                args.graphics / job["source"],
                args.out / job["key"] / f"{job['name']}-shadow.png",
                job["expected"],
            )
        except Exception as error:  # noqa: BLE001 - one bad layer must not stop the import
            shadow_skipped.append(identifier)
            print(f"skipped {identifier}: {error}")
            continue
        if atlas:
            atlas["image"] = f"{job['key']}/{job['name']}-shadow.png"
            atlases.setdefault(job["key"], {})[f"{job['name']}-shadow"] = atlas
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
        "terrain": terrain,
        "skippedAtlases": sorted(skipped),
        "skippedShadows": sorted(shadow_skipped),
    }
    manifest_path = args.out / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, separators=(",", ":"), sort_keys=True) + "\n")
    print(manifest_path)


if __name__ == "__main__":
    main()
