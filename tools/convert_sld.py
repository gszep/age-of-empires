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


MASK_LAYERS = ("shadow", "playercolor", "outline", "damage")


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
    up in the player's palette ramp. A damage sheet is white with the layer's
    per-pixel weight as alpha: how much of the soot a pixel takes as the
    building loses hit points (issue #73).
    """
    from sld_layers import (LAYER_DAMAGE, LAYER_PLAYERCOLOR, LAYER_SHADOW, decode_colors,
                            decode_masks, decode_outlines, pack_mask_atlas, pack_playercolor_atlas)

    data = source.read_bytes()
    if layer == "outline":
        frames = decode_outlines(data)
    else:
        wanted = {"playercolor": LAYER_PLAYERCOLOR, "damage": LAYER_DAMAGE}.get(layer, LAYER_SHADOW)
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
            rgba = image.convert("RGBA")
            rgba.save(target, optimize=True)
        hashes[f"terrain/{source.name}"] = sha256(source)
        converted[key] = {**slot, "image": relative}
    return converted


def convert_water(
    water: dict[str, Any], terrain_dir: Path, out_dir: Path, hashes: dict[str, str]
) -> dict[str, Any]:
    """The water presets' textures: the normal map, the sky dome and the sea
    floor each preset names, as PNG beside the terrain. `terrain_dir` is
    the `textures/2x` directory; the water textures live in `../../water`
    and a sea floor may be an ordinary terrain texture."""
    from PIL import Image

    if not water:
        return {}
    common = terrain_dir.parent.parent
    converted: dict[str, Any] = {}
    done: dict[str, str] = {}
    for index, preset in water.items():
        entry = dict(preset)
        for key in ("normal", "sky", "seaFloor"):
            named = preset[key]
            if named in done:
                entry[key] = done[named]
                continue
            source = common / named
            if not source.is_file():
                raise FileNotFoundError(f"water texture missing: {source}")
            relative = "water/" + Path(named).with_suffix(".png").name
            target = out_dir / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            with Image.open(source) as image:
                image.load()
                # The sky dome and some sea floors are 2048 square; half
                # that is more than a reflection or a floor eight tiles to
                # the repeat resolves, and a quarter of the download.
                if image.width > 1024:
                    image = image.resize((1024, 1024), Image.LANCZOS)
                image.convert("RGBA").save(target, optimize=True)
            hashes[f"water/{source.name}"] = sha256(source)
            done[named] = relative
            entry[key] = relative
        converted[index] = entry
    return converted


def decoder_fingerprint() -> str:
    """What the conversion code itself would produce, in one hash.

    The cache below reuses an atlas only when its source, its frame count and
    this fingerprint all match, so any edit to the decoder or the packing
    regenerates everything rather than leaving stale art behind. It covers
    the decoder module and the two functions here that turn a source into an
    atlas -- not this whole file, which used to cost a twenty-minute
    re-decode for adding one key to the manifest dict below.
    """
    import inspect

    digest = hashlib.sha256()
    digest.update(Path(__file__).with_name("sld_layers.py").read_bytes())
    for function in (convert, convert_mask):
        digest.update(inspect.getsource(function).encode())
    digest.update(repr(MASK_LAYERS).encode())
    return digest.hexdigest()


def convert_particles(particles: dict[str, Any], out_dir: Path) -> dict[str, Any]:
    """Cut each particle flipbook out of the reference's TexturePacker atlas.

    A frame is trimmed art inside a `sourceW` x `sourceH` canvas, packed
    rotated 90 degrees clockwise when `rotated`, and the effect draws it at
    `scale` about its pivot, mirrored when `flipHorizontal`. All of that is
    applied here, so the game draws a flame frame exactly as it draws a
    sprite frame: an atlas rectangle with a hotspot, at 1:1.
    """
    from PIL import Image

    from sld_layers import ColorFrame, pack_color_atlas

    converted: dict[str, Any] = {}
    sheets: dict[str, Any] = {}
    for name, effect in sorted(particles.items()):
        atlas_path = Path(effect["atlas"])
        if atlas_path.name not in sheets:
            sheets[atlas_path.name] = Image.open(atlas_path).convert("RGBA")
        sheet = sheets[atlas_path.name]
        scale = float(effect["scale"])
        frames: list[ColorFrame] = []
        for frame in effect["frames"]:
            width, height = frame["w"], frame["h"]
            if frame["rotated"]:
                cut = sheet.crop((frame["x"], frame["y"], frame["x"] + height, frame["y"] + width))
                cut = cut.transpose(Image.Transpose.ROTATE_90)
            else:
                cut = sheet.crop((frame["x"], frame["y"], frame["x"] + width, frame["y"] + height))
            # The pivot is a fraction of the untrimmed canvas; the hotspot is
            # where it lands inside the trimmed art.
            hotspot_x = frame["pivotX"] * frame["sourceW"] - frame["sourceX"]
            hotspot_y = frame["pivotY"] * frame["sourceH"] - frame["sourceY"]
            if effect["flipHorizontal"]:
                cut = cut.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
                hotspot_x = width - hotspot_x
            if scale != 1.0:
                cut = cut.resize((max(1, round(width * scale)), max(1, round(height * scale))), Image.LANCZOS)
                hotspot_x *= scale
                hotspot_y *= scale
            frames.append(ColorFrame(cut.width, cut.height, round(hotspot_x), round(hotspot_y),
                                     bytearray(cut.tobytes())))
        image, atlas = pack_color_atlas(frames, len(frames))
        relative = f"particles/{name}.png"
        target = out_dir / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        image.save(target, optimize=True)
        converted[name] = {
            "atlas": {**atlas, "image": relative},
            "loop": effect["loop"],
            "cycleSeconds": effect["cycleSeconds"],
            "fadeInSeconds": effect["fadeInSeconds"],
            "fadeOutSeconds": effect["fadeOutSeconds"],
        }
    return converted


def atlas_jobs(imported: dict[str, Any]) -> list[dict[str, Any]]:
    """Every main-layer atlas to produce."""
    jobs: list[dict[str, Any]] = []

    def add(key: str, animations: dict[str, Any], category: str, prefix: str = "") -> None:
        for state, animation in animations.items():
            jobs.append({
                "key": key,
                "name": f"{prefix}{state}",
                "source": animation["source"],
                "expected": animation["frames"] * animation["directions"],
                # The damage layer is soot on a standing building; nothing
                # else asks for it, and a unit's sheet carries one too.
                "layers": MASK_LAYERS if category == "building" and state.startswith("idle")
                          else tuple(layer for layer in MASK_LAYERS if layer != "damage"),
            })

    for key, entity in imported["entities"].items():
        add(key, entity["animations"], entity["category"])
        for index, annex in enumerate(entity.get("annexes", [])):
            add(key, annex["animations"], entity["category"], prefix=f"annex{index}-")
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
    parser.add_argument("--terrain-only", action="store_true",
                        help="update terrain textures in an existing manifest without decoding SLDs")
    args = parser.parse_args()

    imported = json.loads(args.content.read_text())
    source_hashes = imported["source"]["sha256"]
    if args.terrain_only:
        manifest_path = args.out / "manifest.json"
        if not manifest_path.is_file():
            raise FileNotFoundError("--terrain-only needs an existing manifest")
        manifest = json.loads(manifest_path.read_text())
        hashes = dict(manifest.get("source", {}).get("sha256", {}))
        manifest["terrain"] = convert_terrain(
            imported.get("terrain", {}), args.terrain, args.out, hashes,
        )
        manifest.setdefault("source", {})["sha256"] = hashes
        manifest_path.write_text(json.dumps(manifest, separators=(",", ":"), sort_keys=True) + "\n")
        print(manifest_path)
        return

    jobs = atlas_jobs(imported)

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
        for layer in job["layers"]:
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
    water = convert_water(imported.get("water", {}), args.terrain, args.out, hashes)
    particles = convert_particles(imported.get("particles", {}), args.out)
    source["sha256"] = hashes

    manifest = {
        "schemaVersion": imported["schemaVersion"],
        "source": source,
        "entities": entities,
        # Technologies have no art of their own, so they pass through
        # untouched -- but they have to pass through. Left out of this dict,
        # `rulesFromManifest` found no key and the game ran on the hand-written
        # fallback rules instead of the DAT's, and matched them closely enough
        # that nothing failed.
        "technologies": imported["technologies"],
        "civilization": imported["civilization"],
        "skippedTechnologies": imported["skippedTechnologies"],
        "playerColors": imported["playerColors"],
        # Neither of these has art either, and `playerAttributes` was left
        # out of this list from the day it was added: the farm's food read
        # off the DAT never reached the game, which ran on the fallback's
        # identical 175. `test_the_published_manifest_carries_the_technologies`
        # now asserts every rule-bearing key.
        "playerAttributes": imported.get("playerAttributes", {}),
        "ages": imported.get("ages", []),
        "terrain": terrain,
        # The water presets and their textures (issue: the surface).
        "water": water,
        # The DAT's passability table, per restriction row: which of the
        # shipped terrains each may stand on. Rules, not art, so it passes
        # through -- and, like `playerAttributes`, has to be listed here.
        "terrainRestrictions": imported.get("terrainRestrictions", {}),
        # The fires a damaged building burns with (issue #73).
        "particles": particles,
        # The reference's words for a refused order (issue #70).
        "strings": imported.get("strings", {}),
        "skippedAtlases": sorted(skipped),
        "skippedMasks": sorted(mask_skipped),
    }
    manifest_path = args.out / "manifest.json"
    # `blends` is written by tools/import_blends.py, which runs after this
    # step; rebuilding the dict from scratch dropped it whenever this step was
    # re-run on its own, and every terrain edge went hard without an error.
    if manifest_path.is_file():
        previous = json.loads(manifest_path.read_text())
        if "blends" in previous:
            manifest["blends"] = previous["blends"]
    manifest_path.write_text(json.dumps(manifest, separators=(",", ":"), sort_keys=True) + "\n")
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(json.dumps({"decoder": fingerprint, "atlases": cache},
                                     separators=(",", ":"), sort_keys=True) + "\n")
    print(f"{reused} atlases reused from {cache_path.name}")
    print(manifest_path)


if __name__ == "__main__":
    main()
