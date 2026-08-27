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


MASK_LAYERS = ("shadow", "playercolor", "outline")


def convert_mask(source: Path, output: Path, expected_frames: int, layer: str) -> dict[str, Any]:
    """Decode and pack one of an SLD's mask layers: shadow, playercolor, outline.

    Uses tools/sld_layers.py rather than the openage decoder, whose BC4 path
    corrupts the heap on these layers. Pure Python, so a bad file raises here
    instead of taking the process down with it.

    Each layer is packed for what it means. Shadow and outline sheets are
    neutral white with the mask as alpha: the renderer multiplies its own
    colour through them, black for a shadow and the DAT's outline colour for a
    contour. A player-colour sheet keeps the coverage in alpha but carries the
    main layer's grey in RGB, because that grey is the shade the renderer looks
    up in the player's palette ramp.
    """
    from sld_layers import (LAYER_PLAYERCOLOR, LAYER_SHADOW, decode_colors, decode_masks,
                            decode_outlines, pack_mask_atlas, pack_playercolor_atlas)

    data = source.read_bytes()
    if layer == "outline":
        frames = decode_outlines(data)
    else:
        frames = decode_masks(data, LAYER_PLAYERCOLOR if layer == "playercolor" else LAYER_SHADOW)
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


def decoder_fingerprint() -> str:
    """What the conversion code itself would produce, in one hash.

    The cache below reuses an atlas only when its source, its frame count and
    this fingerprint all match, so any edit to the decoder or the packing
    regenerates everything rather than leaving stale art behind.
    """
    digest = hashlib.sha256()
    for name in ("sld_layers.py", "convert_sld.py"):
        digest.update(Path(__file__).with_name(name).read_bytes())
    return digest.hexdigest()


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
    parser.add_argument("--cache", type=Path, default=root / ".local/aoe2de/atlas-cache.json")
    parser.add_argument("--fresh", action="store_true", help="ignore the atlas cache")
    args = parser.parse_args()

    imported = json.loads(args.content.read_text())
    jobs = atlas_jobs(imported)
    source_hashes = imported["source"]["sha256"]

    # Decoding every frame of every animation takes about twenty minutes, and
    # adding one unit re-decodes the other seventy-odd sources for nothing. An
    # atlas is reused only when its source file, its frame count and the
    # decoder's own fingerprint are all unchanged, so a decoder edit still
    # regenerates the lot. `--fresh` skips the cache entirely.
    cache_path = args.cache
    fingerprint = decoder_fingerprint()
    previous: dict[str, Any] = {}
    if cache_path.is_file() and not args.fresh:
        stored = json.loads(cache_path.read_text())
        if stored.get("decoder") == fingerprint:
            previous = stored.get("atlases", {})
    cache: dict[str, Any] = {}

    def cached(identifier: str, job: dict[str, Any], image: str) -> dict[str, Any] | None:
        entry = previous.get(identifier)
        if not entry:
            return None
        if entry["source"] != source_hashes.get(job["source"]) or entry["expected"] != job["expected"]:
            return None
        atlas = entry["atlas"]
        if atlas and not (args.out / image).is_file():
            return None
        return atlas

    args.out.mkdir(parents=True, exist_ok=True)
    atlases: dict[str, dict[str, Any]] = {}
    skipped: list[str] = []
    reused = 0
    for job in jobs:
        identifier = f"{job['key']}:{job['name']}"
        image = f"{job['key']}/{job['name']}.png"
        atlas = cached(identifier, job, image)
        if atlas is None:
            atlas = convert(
                args.graphics / job["source"], args.out / job["key"] / f"{job['name']}.png", job["expected"]
            )
            print(identifier)
        else:
            reused += 1
        cache[identifier] = {"source": source_hashes.get(job["source"]), "expected": job["expected"], "atlas": atlas}
        atlas = dict(atlas)
        atlas["image"] = image
        atlases.setdefault(job["key"], {})[job["name"]] = atlas

    # A mask failure costs that entity one mask and is recorded, never fatal.
    mask_skipped: list[str] = []
    for job in jobs:
        for layer in MASK_LAYERS:
            identifier = f"{job['key']}:{job['name']}:{layer}"
            image = f"{job['key']}/{job['name']}-{layer}.png"
            atlas = cached(identifier, job, image)
            if atlas is not None:
                reused += 1
                cache[identifier] = {
                    "source": source_hashes.get(job["source"]), "expected": job["expected"], "atlas": atlas,
                }
                if atlas:
                    atlas = dict(atlas)
                    atlas["image"] = image
                    atlases.setdefault(job["key"], {})[f"{job['name']}-{layer}"] = atlas
                continue
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
            cache[identifier] = {
                "source": source_hashes.get(job["source"]), "expected": job["expected"], "atlas": atlas,
            }
            if atlas:
                atlas = dict(atlas)
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
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(json.dumps({"decoder": fingerprint, "atlases": cache},
                                     separators=(",", ":"), sort_keys=True) + "\n")
    print(f"{reused} atlases reused from {cache_path.name}")
    print(manifest_path)


if __name__ == "__main__":
    main()
