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


def read_jasc_pal(path: Path) -> list[tuple[int, int, int]]:
    """The 256 RGB rows of a JASC-PAL palette file."""
    lines = path.read_text(errors="replace").splitlines()
    if lines[0].strip() != "JASC-PAL":
        raise ValueError(f"{path.name}: not a JASC-PAL palette")
    count = int(lines[2])
    rows = []
    for line in lines[3:3 + count]:
        red, green, blue = (int(part) for part in line.split()[:3])
        rows.append((red, green, blue))
    if len(rows) != count:
        raise ValueError(f"{path.name}: {len(rows)} rows, header says {count}")
    return rows


# The game palette carries one 8-shade block per player at the DAT's own
# `player_colours[i].player_color_base`, dark through the player's hue to a
# pale highlight - the eight shades AoE2 has always drawn player colour with.
# The blocks in `playercolor_*.pal` are a different thing (DE's editable
# hue-to-target blends) and are not what a sprite's shade indexes.
PLAYER_SHADES = 8
# The grey player's block is the identity ramp: its entries are neutral greys,
# so it is exactly the shade a sprite's own grey stands for, and inverting it
# turns that grey into a position in any other player's block.
SHADE_AXIS = "grey"


def player_colors(
    dat: DatFile, palettes_dir: Path, names: list[str], hashes: dict[str, str]
) -> dict[str, Any]:
    """Each player's shade ramp and minimap colour, both straight from the DAT.

    `names` orders the players, which the DAT confirms rather than states: its
    `player_colours[i].minimap_color` indexes the game palette, and those
    entries come out as pure blue, red, green, yellow, cyan, magenta, grey,
    orange in exactly this order.
    """
    source = palettes_dir / "original.pal"
    palette = read_jasc_pal(source)
    hashes[f"palettes/{source.name}"] = sha256(source)

    colors: dict[str, Any] = {}
    for index, name in enumerate(names):
        entry = dat.player_colours[index]
        base = entry.player_color_base
        colors[str(index + 1)] = {
            "name": name,
            "colorBase": base,
            "minimapColor": list(palette[entry.minimap_color]),
            # What the game draws a unit's contour in when a building hides it.
            "outlineColor": list(palette[entry.unit_outline_color]),
            "ramp": [list(shade) for shade in palette[base:base + PLAYER_SHADES]],
        }

    axis = colors[str(names.index(SHADE_AXIS) + 1)]["ramp"]
    previous = -1
    for red, green, blue in axis:
        if not red == green == blue:
            raise ValueError(f"the {SHADE_AXIS} player's block is not neutral: {(red, green, blue)}")
        if red <= previous:
            raise ValueError(f"the {SHADE_AXIS} player's block does not rise: {axis}")
        previous = red
    return {
        "palette": source.name,
        # What grey each shade stands for, so a sprite's own grey resolves to a
        # position in every player's ramp.
        "shadeLevels": [shade[0] for shade in axis],
        "players": colors,
    }


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


def resolve_graphic_id(unit: Any, animation: dict[str, Any], civ_units: Any, dat: Any = None) -> int:
    if "slot" in animation:
        slot = animation["slot"]
        if slot == "standing":
            return unit.standing_graphic[0]
        if slot == "base":
            # A wall is composed: the DAT's standing graphic is the animated
            # flag, drawn over a base graphic named in its first delta. The
            # base is what carries the connection shapes.
            deltas = dat.graphics[unit.standing_graphic[0]].deltas or []
            base = next((d.graphic_id for d in deltas if d.graphic_id >= 0), -1)
            if base < 0:
                raise ValueError(f"unit {unit.id}: standing graphic has no base delta")
            return base
        if slot == "dead":
            # What is left behind: the DAT models a corpse, a stump, or a pile
            # of rubble as its own unit, and its standing graphic is that art.
            if unit.dead_unit_id is None or unit.dead_unit_id < 0:
                raise ValueError(f"unit {unit.id} leaves nothing behind")
            return civ_units[unit.dead_unit_id].standing_graphic[0]
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
        # What a selection draws on the ground: obstruction type 5 is the round
        # unit outline, everything else marks its outline box (buildings and
        # resources, whose box can exceed the collision box — a barracks
        # collides at 1.5 half-tiles but outlines at 1.6).
        "selection": {
            "shape": "round" if unit.obstruction_type == 5 else "square",
            "outline": [rounded(unit.outline_size_x), rounded(unit.outline_size_y)],
        },
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

    if "trade" in spec:
        # A trade cart carries goods between markets rather than gathering from
        # a node: the DAT gives its rate and how much it can hold, and names
        # the building the route runs between.
        task = find_task(unit, spec["trade"]["task"])
        entity["trade"] = {
            "ratePerSecond": rounded(unit.bird.work_rate),
            "capacity": int(unit.resource_capacity),
            "buildingId": task.unit_id,
        }

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

    if category in ("resource", "animal"):
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

    entity["age"] = available_age(dat, unit.id)

    # The DAT names a unit's voices by Wwise id directly, so the audio import
    # resolves them without a name to hash.
    sounds = {
        name: getattr(unit, f"wwise_{field}_sound_id")
        for name, field in (("select", "selection"), ("train", "train"))
        if name in spec.get("sounds", []) and getattr(unit, f"wwise_{field}_sound_id")
    }
    if sounds:
        entity["sounds"] = sounds

    # An animation may name another unit to read its slot from: a gate's open
    # leaf is a unit of its own in the DAT, sharing everything but the art.
    entity["animations"] = {
        name: animation_entry(
            dat,
            graphics_dir,
            resolve_graphic_id(
                civ_units[animation["unitId"]] if "unitId" in animation else unit,
                animation,
                civ_units,
                dat,
            ),
            hashes,
        )
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


def effect_entry(
    dat: DatFile, graphics_dir: Path, spec: dict[str, Any], hashes: dict[str, str]
) -> dict[str, Any]:
    """Art the engine draws itself, with no unit behind it to resolve it from.

    The gather-point flag is one: nothing in the DAT's unit table points at it,
    so the graphic is found by its own name — and a name that matches more than
    one graphic, or none, is an error rather than a silent first hit.
    """
    matches = [index for index, graphic in enumerate(dat.graphics)
               if graphic is not None and graphic.name == spec["graphic"]]
    if len(matches) != 1:
        raise ValueError(f"graphic {spec['graphic']!r} matched {len(matches)} entries")
    return {
        "category": "effect",
        "animations": {"idle": animation_entry(dat, graphics_dir, matches[0], hashes)},
    }


# Effect command kinds this import understands, from the DAT's own tables.
EFFECT_ENABLE = 2          # a = unit, b = 1 makes it available
EFFECT_ATTRIBUTE_ADD = 4   # a = unit, b = class, c = attribute, d = amount
ATTRIBUTE_HIT_POINTS = 0
ATTRIBUTE_ARMOR = 8        # d packs the armour class in the high byte

# Age techs, in order. The DAT's own names are one age behind — tech 101 is
# called "Middle Age" and its effect is "Feudal Age" — so the effect name is
# what identifies an age, exactly as a graphic's file name identifies a unit.
AGE_TECHS = (104, 101, 102, 103)


def enabling_tech(dat: DatFile, unit_id: int) -> Any:
    """The "(make avail)" tech that turns a unit on, or None if it starts on."""
    for tech in dat.techs:
        if tech.effect_id is None or not 0 <= tech.effect_id < len(dat.effects):
            continue
        for command in dat.effects[tech.effect_id].effect_commands:
            if command.type == EFFECT_ENABLE and command.a == unit_id and command.b == 1:
                return tech
    return None


def available_age(dat: DatFile, unit_id: int) -> int:
    """Which age a unit becomes available in, read from what gates it."""
    tech = enabling_tech(dat, unit_id)
    if tech is None:
        return 0
    for required in tech.required_techs:
        if required in AGE_TECHS:
            return AGE_TECHS.index(required)
    return 0


def technology_entry(dat: DatFile, spec: dict[str, Any], hashes: dict[str, str]) -> dict[str, Any]:
    """One researchable technology: what it costs, where, and what it changes."""
    tech = dat.techs[spec["techId"]]
    effect = dat.effects[tech.effect_id]
    if effect.name != spec["effect"]:
        raise ValueError(f"tech {spec['techId']} effect is {effect.name!r}, not {spec['effect']!r}")
    location = next(l for l in tech.research_locations if l.location_id >= 0)
    entry: dict[str, Any] = {
        "techId": spec["techId"],
        "name": effect.name,
        "cost": {RESOURCE_NAMES[c.type]: int(c.amount) for c in tech.resource_costs
                 if c.flag and c.type in RESOURCE_NAMES},
        "researchSeconds": location.research_time,
        "researchedAt": location.location_id,
        "requiresAge": next(
            (AGE_TECHS.index(r) for r in tech.required_techs if r in AGE_TECHS), 0
        ),
    }
    if tech.icon_id is not None and tech.icon_id >= 0:
        entry["iconId"] = tech.icon_id
    if spec["techId"] in AGE_TECHS:
        entry["grantsAge"] = AGE_TECHS.index(spec["techId"])

    # Flat modifiers, read off the effect rather than transcribed. The spec
    # names which of our entities the class-wide change lands on.
    modifiers: dict[str, dict[str, Any]] = {}
    for command in dat.effects[tech.effect_id].effect_commands:
        if command.type != EFFECT_ATTRIBUTE_ADD:
            continue
        for key in spec.get("appliesTo", []):
            target = modifiers.setdefault(key, {"unit": key})
            if command.c == ATTRIBUTE_HIT_POINTS:
                target["hitPoints"] = int(command.d)
            elif command.c == ATTRIBUTE_ARMOR:
                packed = int(command.d)
                target.setdefault("armors", []).append(
                    {"class": packed >> 8, "amount": packed & 0xFF}
                )
    if modifiers:
        entry["effects"] = [modifiers[key] for key in spec.get("appliesTo", []) if key in modifiers]
    return entry


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


def extract(
    dat_path: Path,
    graphics_dir: Path,
    palettes_dir: Path,
    spec: dict[str, Any],
    source: dict[str, Any],
) -> dict[str, Any]:
    dat = DatFile.parse(dat_path)
    hashes: dict[str, str] = {"dat": sha256(dat_path)}
    entities: dict[str, Any] = {}
    for entity_spec in spec["entities"]:
        civ_index = spec["gaiaIndex"] if entity_spec.get("civ") == "gaia" else spec["civIndex"]
        entities[entity_spec["key"]] = extract_entity(
            dat, dat.civs[civ_index].units, entity_spec, graphics_dir, hashes
        )
    for effect_spec in spec.get("effects", []):
        entities[effect_spec["key"]] = effect_entry(dat, graphics_dir, effect_spec, hashes)
    technologies = {
        tech_spec["key"]: technology_entry(dat, tech_spec, hashes)
        for tech_spec in spec.get("technologies", [])
    }
    terrain = {
        key: terrain_entry(dat, slot["terrainId"])
        for key, slot in spec.get("terrain", {}).items()
    }
    return {
        "terrain": terrain,
        "audio": spec.get("audio", {}),
        "technologies": technologies,
        "playerColors": player_colors(dat, palettes_dir, spec["playerColors"], hashes),
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
    parser.add_argument("--palettes", type=Path, default=content / "resources/_common/palettes")
    parser.add_argument("--spec", type=Path, default=Path(__file__).with_name("import-spec.json"))
    parser.add_argument("--source", type=Path, default=Path(__file__).with_name("aoe2-source.json"))
    parser.add_argument("--out", type=Path, default=Path(".local/aoe2de/content.json"))
    args = parser.parse_args()

    result = extract(
        args.dat,
        args.graphics,
        args.palettes,
        json.loads(args.spec.read_text()),
        json.loads(args.source.read_text()),
    )
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
    print(args.out)


if __name__ == "__main__":
    main()
