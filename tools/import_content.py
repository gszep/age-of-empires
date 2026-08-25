#!/usr/bin/env python3
"""Extract the Dark Age vertical-slice content from a locally owned AoE2DE install.

Every value is read from the patch-matched DAT through the declarative
``import-spec.json``; graphic IDs are resolved from semantic slots or task
fields, never transcribed by hand.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

from genieutils.datfile import DatFile

RESOURCE_NAMES = {0: "food", 1: "wood", 2: "stone", 3: "gold"}
POPULATION_TYPE = 4


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def rounded(value: float) -> float:
    return round(value, 6)


def find_task(unit: Any, selector: dict[str, Any]) -> Any:
    for task in unit.bird.tasks or []:
        if task.action_type != selector["actionType"]:
            continue
        if "classId" in selector and task.class_id != selector["classId"]:
            continue
        if "unitId" in selector and task.unit_id != selector["unitId"]:
            continue
        return task
    raise ValueError(f"unit {unit.id}: no task matches {selector}")


def resolve_graphic_id(unit: Any, animation: dict[str, Any]) -> int:
    if "slot" in animation:
        slot = animation["slot"]
        if slot == "standing":
            return unit.standing_graphic[0]
        if slot == "walking":
            return unit.dead_fish.walking_graphic
        if slot == "attack":
            return unit.type_50.attack_graphic
        if slot == "dying":
            return unit.dying_graphic
        if slot == "construction":
            return unit.building.construction_graphic_id
        raise ValueError(f"unknown slot {slot}")
    task = find_task(unit, animation["task"])
    return getattr(task, f"{animation['graphic']}_graphic_id")


def animation_entry(
    dat: DatFile, graphics_dir: Path, graphic_id: int, hashes: dict[str, str]
) -> dict[str, Any]:
    graphic = dat.graphics[graphic_id]
    if graphic is None or not graphic.file_name or graphic.file_name == "None":
        raise ValueError(f"graphic {graphic_id} has no source file")
    sld = graphics_dir / f"{graphic.file_name}.sld"
    if not sld.is_file():
        raise FileNotFoundError(sld)
    hashes[sld.name] = sha256(sld)
    return {
        "graphicId": graphic_id,
        "source": sld.name,
        "frames": graphic.frame_count,
        "directions": graphic.angle_count,
        "frameSeconds": rounded(graphic.frame_duration),
        "mirroringMode": graphic.mirroring_mode,
    }


def costs_of(creatable: Any) -> tuple[dict[str, int], int]:
    paid: dict[str, int] = {}
    population = 0
    for cost in creatable.resource_costs:
        if cost.type == POPULATION_TYPE:
            population = int(cost.amount)
        elif cost.flag and cost.type in RESOURCE_NAMES:
            paid[RESOURCE_NAMES[cost.type]] = int(cost.amount)
    return paid, population


def extract_entity(
    dat: DatFile,
    civ_units: Any,
    spec: dict[str, Any],
    graphics_dir: Path,
    hashes: dict[str, str],
) -> dict[str, Any]:
    unit = civ_units[spec["unitId"]]
    if unit is None:
        raise ValueError(f"unit {spec['unitId']} missing for {spec['key']}")
    category = spec["category"]

    entity: dict[str, Any] = {
        "id": unit.id,
        "internalName": unit.name,
        "category": category,
        "hitPoints": unit.hit_points,
        "lineOfSight": rounded(unit.line_of_sight),
        "collision": [rounded(unit.collision_size_x), rounded(unit.collision_size_y)],
        "clearance": [rounded(value) for value in unit.clearance_size],
    }
    if unit.icon_id >= 0:
        entity["iconId"] = unit.icon_id
    if unit.speed and unit.speed > 0:
        entity["speedTilesPerSecond"] = rounded(unit.speed)

    if unit.creatable is not None:
        cost, population = costs_of(unit.creatable)
        if cost:
            entity["cost"] = cost
        if population:
            entity["populationCost"] = population
        train = unit.creatable.train_locations[0]
        if category == "building":
            entity["build"] = {"builderId": train.unit_id, "seconds": train.train_time}
        elif train.unit_id >= 0:
            entity["train"] = {"buildingId": train.unit_id, "seconds": train.train_time}

    combat = unit.type_50
    if combat is not None and any(attack.amount for attack in combat.attacks):
        entity["combat"] = {
            "reloadSeconds": rounded(combat.reload_time),
            "frameDelay": combat.frame_delay,
            "minimumRange": rounded(combat.min_range),
            "maximumRange": rounded(combat.max_range),
            "attacks": [{"class": a.class_, "amount": a.amount} for a in combat.attacks],
            "armors": [{"class": a.class_, "amount": a.amount} for a in combat.armours],
        }
        # Ranged shooters name the projectile they launch; the arrow's own
        # entry carries its travel speed and art.
        if combat.projectile_unit_id is not None and combat.projectile_unit_id >= 0:
            entity["combat"]["projectileUnitId"] = combat.projectile_unit_id
        # Where the shot leaves the shooter. The z component is what puts a
        # tower's arrows at its top, so a close shot points down rather than up.
        if combat.graphic_displacement:
            entity["combat"]["launchOffset"] = [rounded(v) for v in combat.graphic_displacement]

    if category == "projectile" and unit.projectile is not None:
        # `projectile_arc` is a fraction of the shot's distance. Its sign varies
        # between units in ways this import does not interpret; the renderer
        # uses the magnitude for the visual arc height.
        entity["projectile"] = {"arc": rounded(unit.projectile.projectile_arc)}

    if category == "unit-variant":
        task = find_task(unit, spec["task"])
        resource_type = task.resource_out if task.resource_out >= 0 else task.resource_in
        if resource_type in RESOURCE_NAMES:
            entity["gather"] = {
                "resource": RESOURCE_NAMES[resource_type],
                "ratePerSecond": rounded(unit.bird.work_rate),
                "capacity": int(unit.resource_capacity),
                "task": spec["task"],
            }
        else:
            entity["work"] = {"task": spec["task"]}
    if category in ("unit", "unit-variant") and unit.bird is not None:
        drop_sites = [site for site in unit.bird.drop_sites if site >= 0]
        if drop_sites:
            entity["dropSites"] = drop_sites

    if category == "resource":
        storage = {
            RESOURCE_NAMES[s.type]: int(s.amount)
            for s in unit.resource_storages
            if s.type in RESOURCE_NAMES and s.amount > 0
        }
        entity["storage"] = storage
    if category == "building":
        for s in unit.resource_storages:
            if s.type == POPULATION_TYPE and s.flag == 4 and s.amount > 0:
                entity["popSupport"] = int(s.amount)

    entity["animations"] = {
        name: animation_entry(dat, graphics_dir, resolve_graphic_id(unit, animation), hashes)
        for name, animation in spec["animations"].items()
    }

    if spec.get("includeAnnexes") and unit.building is not None:
        annexes = []
        for annex in unit.building.annexes:
            if annex.unit_id < 0:
                continue
            annex_unit = civ_units[annex.unit_id]
            if annex_unit is None or annex_unit.standing_graphic[0] < 0:
                continue
            annexes.append(
                {
                    "unitId": annex.unit_id,
                    "misplacement": [annex.misplacement_x, annex.misplacement_y],
                    "animations": {
                        "idle": animation_entry(
                            dat, graphics_dir, annex_unit.standing_graphic[0], hashes
                        )
                    },
                }
            )
        entity["annexes"] = annexes

    return entity


def terrain_entry(dat: DatFile, terrain_id: int) -> dict[str, Any]:
    """Texture name, tile span, and minimap color for one DAT terrain slot."""
    terrain = dat.terrain_block.terrains[terrain_id]
    if not terrain.name_2:
        raise ValueError(f"terrain {terrain_id} has no texture name")
    width, height = terrain.terrain_dimensions
    return {
        "terrainId": terrain_id,
        "name": terrain.name,
        "texture": terrain.name_2,
        # Tiles covered by one repeat of the texture, so the view can lay it out
        # at the authored scale instead of guessing a tiling rate.
        "dimensions": [width, height],
        "minimapColor": list(terrain.colors),
    }


def extract(dat_path: Path, graphics_dir: Path, spec: dict[str, Any], source: dict[str, Any]) -> dict[str, Any]:
    dat = DatFile.parse(dat_path)
    hashes: dict[str, str] = {"dat": sha256(dat_path)}
    entities: dict[str, Any] = {}
    for entity_spec in spec["entities"]:
        civ_index = spec["gaiaIndex"] if entity_spec.get("civ") == "gaia" else spec["civIndex"]
        entities[entity_spec["key"]] = extract_entity(
            dat, dat.civs[civ_index].units, entity_spec, graphics_dir, hashes
        )
    terrain = {
        key: terrain_entry(dat, slot["terrainId"])
        for key, slot in spec.get("terrain", {}).items()
    }
    return {
        "terrain": terrain,
        "schemaVersion": spec["schemaVersion"],
        "source": {
            "game": "aoe2de",
            "datVersion": dat.version.strip(),
            "appId": source["appId"],
            "depots": source["depots"],
            "sha256": hashes,
        },
        "entities": entities,
    }


def main() -> None:
    home = Path.home()
    content = home / "Steam/steamapps/content/app_813780/depot_813781"
    resources = home / "Steam/steamapps/content/app_813780/depot_813784"
    parser = argparse.ArgumentParser()
    parser.add_argument("--dat", type=Path, default=content / "resources/_common/dat/empires2_x2_p1.dat")
    parser.add_argument("--graphics", type=Path, default=resources / "resources/_common/drs/graphics")
    parser.add_argument("--spec", type=Path, default=Path(__file__).with_name("import-spec.json"))
    parser.add_argument("--source", type=Path, default=Path(__file__).with_name("aoe2-source.json"))
    parser.add_argument("--out", type=Path, default=Path(".local/aoe2de/content.json"))
    args = parser.parse_args()

    result = extract(
        args.dat,
        args.graphics,
        json.loads(args.spec.read_text()),
        json.loads(args.source.read_text()),
    )
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
    print(args.out)


if __name__ == "__main__":
    main()
