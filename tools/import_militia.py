#!/usr/bin/env python3
"""Extract the vertical-slice militia from a locally owned AoE2DE install."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

from genieutils.datfile import DatFile

UNIT_ID = 74
GRAPHICS = {"idle": 1102, "walk": 1106, "attack": 1096, "death": 1099}
RESOURCE_NAMES = {0: "food", 1: "wood", 2: "stone", 3: "gold", 4: "population"}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def rounded(value: float) -> float:
    return round(value, 6)


def extract(dat_path: Path, graphics_dir: Path, source: dict[str, Any]) -> dict[str, Any]:
    dat = DatFile.parse(dat_path)
    unit = dat.civs[1].units[UNIT_ID]
    combat = unit.type_50
    creatable = unit.creatable

    animations: dict[str, Any] = {}
    source_files: dict[str, str] = {"dat": sha256(dat_path)}
    for state, graphic_id in GRAPHICS.items():
        graphic = dat.graphics[graphic_id]
        if graphic is None or not graphic.file_name:
            raise ValueError(f"missing graphic {graphic_id} for {state}")
        sld = graphics_dir / f"{graphic.file_name}.sld"
        if not sld.is_file():
            raise FileNotFoundError(sld)
        source_files[sld.name] = sha256(sld)
        animations[state] = {
            "graphicId": graphic_id,
            "source": sld.name,
            "frames": graphic.frame_count,
            "directions": graphic.angle_count,
            "frameSeconds": rounded(graphic.frame_duration),
            "mirroringMode": graphic.mirroring_mode,
        }

    costs = {
        RESOURCE_NAMES[cost.type]: cost.amount
        for cost in creatable.resource_costs
        if cost.flag and cost.type in RESOURCE_NAMES and cost.type != 4
    }
    train = creatable.train_locations[0]

    return {
        "schemaVersion": 1,
        "source": {
            "game": "aoe2de",
            "datVersion": dat.version.strip(),
            "appId": source["appId"],
            "depots": source["depots"],
            "sha256": source_files,
        },
        "unit": {
            "id": unit.id,
            "key": "militia",
            "internalName": unit.name,
            "hitPoints": unit.hit_points,
            "speedTilesPerSecond": rounded(unit.speed),
            "lineOfSight": rounded(unit.line_of_sight),
            "collision": [rounded(unit.collision_size_x), rounded(unit.collision_size_y)],
            "cost": costs,
            "train": {
                "buildingId": train.unit_id,
                "seconds": train.train_time,
                "population": next(
                    (cost.amount for cost in creatable.resource_costs if cost.type == 4), 0
                ),
            },
            "combat": {
                "reloadSeconds": rounded(combat.reload_time),
                "frameDelay": combat.frame_delay,
                "minimumRange": rounded(combat.min_range),
                "maximumRange": rounded(combat.max_range),
                "attacks": [
                    {"class": value.class_, "amount": value.amount}
                    for value in combat.attacks
                    if value.amount
                ],
                "armors": [
                    {"class": value.class_, "amount": value.amount}
                    for value in combat.armours
                    if value.amount
                ],
            },
            "animations": animations,
        },
    }


def main() -> None:
    home = Path.home()
    content = home / "Steam/steamapps/content/app_813780/depot_813781"
    resources = home / "Steam/steamapps/content/app_813780/depot_813784"
    parser = argparse.ArgumentParser()
    parser.add_argument("--dat", type=Path, default=content / "resources/_common/dat/empires2_x2_p1.dat")
    parser.add_argument("--graphics", type=Path, default=resources / "resources/_common/drs/graphics")
    parser.add_argument("--source", type=Path, default=Path(__file__).with_name("aoe2-source.json"))
    parser.add_argument("--out", type=Path, default=Path(".local/aoe2de/militia.json"))
    args = parser.parse_args()

    result = extract(args.dat, args.graphics, json.loads(args.source.read_text()))
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
    print(args.out)


if __name__ == "__main__":
    main()
