#!/usr/bin/env python3
"""Convert the imported militia SLDs with pinned openage decoder code."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def convert(source: Path, output: Path, playable_frames: int) -> dict:
    from openage.convert.entity_object.export.texture import Texture
    from openage.convert.processor.export.texture_merge import merge_frames
    from openage.convert.value_object.read.media.sld import SLD

    texture = Texture(SLD(source.read_bytes()), layer=0)
    texture.image_metadata = {}
    merge_frames(texture)
    metadata = texture.image_metadata
    frames = metadata["subtex_metadata"]
    if len(frames) < playable_frames:
        raise ValueError(f"{source.name}: DAT expects {playable_frames} frames, SLD has {len(frames)}")

    output.parent.mkdir(parents=True, exist_ok=True)
    texture.image_data.get_pil_image().save(output, optimize=True)
    return {"image": output.name, "size": metadata["size"], "frames": frames[:playable_frames]}


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser()
    parser.add_argument("--unit", type=Path, default=root / ".local/aoe2de/militia.json")
    parser.add_argument(
        "--graphics",
        type=Path,
        default=Path.home() / "Steam/steamapps/content/app_813780/depot_813784/resources/_common/drs/graphics",
    )
    parser.add_argument("--out", type=Path, default=root / "public/imported/aoe2/militia")
    args = parser.parse_args()

    imported = json.loads(args.unit.read_text())
    unit = imported["unit"]
    atlases = {}
    for state, animation in unit["animations"].items():
        count = animation["frames"] * animation["directions"]
        atlases[state] = convert(
            args.graphics / animation["source"], args.out / f"{state}.png", count
        )

    manifest = {"schemaVersion": 1, "unit": unit, "atlases": atlases}
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "manifest.json").write_text(json.dumps(manifest, separators=(",", ":")) + "\n")
    print(args.out / "manifest.json")


if __name__ == "__main__":
    main()
