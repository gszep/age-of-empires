#!/usr/bin/env python3
"""Convert every animation in the extracted content with pinned openage decoder code."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


def convert(source: Path, output: Path, expected_frames: int) -> dict[str, Any]:
    from openage.convert.entity_object.export.texture import Texture
    from openage.convert.processor.export.texture_merge import merge_frames
    from openage.convert.value_object.read.media.sld import SLD

    texture = Texture(SLD(source.read_bytes()), layer=0)
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


def convert_animations(
    animations: dict[str, Any], graphics_dir: Path, out_dir: Path, key: str, prefix: str = ""
) -> dict[str, Any]:
    atlases: dict[str, Any] = {}
    for state, animation in animations.items():
        expected = animation["frames"] * animation["directions"]
        name = f"{prefix}{state}"
        atlas = convert(graphics_dir / animation["source"], out_dir / f"{name}.png", expected)
        atlas["image"] = f"{key}/{name}.png"
        atlases[name] = atlas
    return atlases


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser()
    parser.add_argument("--content", type=Path, default=root / ".local/aoe2de/content.json")
    parser.add_argument(
        "--graphics",
        type=Path,
        default=Path.home() / "Steam/steamapps/content/app_813780/depot_813784/resources/_common/drs/graphics",
    )
    parser.add_argument("--out", type=Path, default=root / "public/imported/aoe2")
    args = parser.parse_args()

    imported = json.loads(args.content.read_text())
    entities: dict[str, Any] = {}
    for key, entity in imported["entities"].items():
        out_dir = args.out / key
        entity = dict(entity)
        entity["atlases"] = convert_animations(entity["animations"], args.graphics, out_dir, key)
        for index, annex in enumerate(entity.get("annexes", [])):
            annex["atlases"] = convert_animations(
                annex["animations"], args.graphics, out_dir, key, prefix=f"annex{index}-"
            )
        entities[key] = entity
        print(key)

    manifest = {
        "schemaVersion": imported["schemaVersion"],
        "source": imported["source"],
        "entities": entities,
    }
    args.out.mkdir(parents=True, exist_ok=True)
    manifest_path = args.out / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, separators=(",", ":"), sort_keys=True) + "\n")
    print(manifest_path)


if __name__ == "__main__":
    main()
