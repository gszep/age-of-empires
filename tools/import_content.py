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
import re
from pathlib import Path
from typing import Any

from genieutils.datfile import DatFile

from depot import Graphics, depot_root

# The DAT's stockpiles. 17 is its fish storage -- what a fish holds and a
# fishing task takes in -- and it lands in the food stockpile like meat and
# berries do.
RESOURCE_NAMES = {0: "food", 1: "wood", 2: "stone", 3: "gold", 17: "food"}
# The bit of a projectile's `smart_mode` that makes it lead a moving target.
PROJECTILE_LEADS_TARGET = 1
POPULATION_TYPE = 4


# `creatable.hero_mode` bit: the unit asks before it is deleted.
HERO_CONFIRM_DELETE = 32

# The DAT names its strings by id into `key-value-strings-utf8.txt`. A unit's
# and a technology's `language_dll_name` and `language_dll_creation` index the
# file directly; `language_dll_help` is offset by this much (105121 on the
# villager is string 26121, the tooltip), which is the convention every
# community tool uses and the file itself bears out (issue #48).
HELP_STRING_OFFSET = 79000


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def rounded(value: float) -> float:
    return round(value, 6)


def read_strings(path: Path) -> dict[int, str]:
    """The reference's string table: `<id> "<text>"` per line, `\\n` kept as-is."""
    strings: dict[int, str] = {}
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        match = re.match(r'^(\d+)\s+"(.*)"\s*$', line)
        if match:
            strings[int(match.group(1))] = match.group(2)
    return strings


def text_of(strings: dict[int, str], name_id: int, creation_id: int, help_id: int) -> dict[str, str]:
    """What the reference calls a thing, and what its tooltip says."""
    text: dict[str, str] = {}
    if name_id in strings:
        text["name"] = strings[name_id]
    if creation_id in strings:
        text["create"] = strings[creation_id]
    if help_id - HELP_STRING_OFFSET in strings:
        text["help"] = strings[help_id - HELP_STRING_OFFSET]
    return text


def palx_alpha(path: Path) -> float:
    """The global alpha a `.palx` palette draws with, as a fraction: its
    `$ALPHA` header line, 0-255."""
    for line in path.read_text().splitlines():
        if line.startswith("$ALPHA"):
            return round(int(line.split()[1]) / 255, 4)
    raise ValueError(f"{path.name}: no $ALPHA header")


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


# The resource a corpse stores is its remaining lifetime, not a stockpile.
CORPSE_LIFETIME_RESOURCE = 12
# Constants.xs: cTaskTypeRepair.
TASK_REPAIR = 106
#: `cTaskTypeGatherRebuild`: a gather task, one per class of node.
TASK_GATHER = 5


def corpse_seconds(corpse: Any) -> float | None:
    """How long the DAT says this corpse or rubble lies there, in seconds."""
    rate = getattr(corpse, "resource_decay", 0) or 0
    if rate <= 0:
        return None
    for storage in corpse.resource_storages:
        if storage.type == CORPSE_LIFETIME_RESOURCE and storage.amount > 0:
            return rounded(storage.amount / rate)
    return None


def base_graphic(dat: Any, unit: Any, graphic_id: int) -> int:
    """A composed standing graphic's base: a wall's is the animated flag drawn
    over the base named in its first delta, which carries the connection
    shapes; a dock's is a file-less composite whose deltas are a reflection
    (file-less too, from the Feudal Age on), the building's own sheet and
    the birds over it. The base is the first delta that has a file. Each
    age's variant is composed the same way."""
    deltas = dat.graphics[graphic_id].deltas or []
    for delta in deltas:
        if delta.graphic_id < 0:
            continue
        graphic = dat.graphics[delta.graphic_id]
        if graphic is not None and graphic.file_name and graphic.file_name != "None":
            return delta.graphic_id
    raise ValueError(f"unit {unit.id}: standing graphic has no base delta")


def resolve_graphic_id(unit: Any, animation: dict[str, Any], civ_units: Any, dat: Any = None) -> int:
    if "slot" in animation:
        slot = animation["slot"]
        if slot == "standing":
            return unit.standing_graphic[0]
        if slot == "base":
            return base_graphic(dat, unit, unit.standing_graphic[0])
        if slot == "dead":
            # What is left behind: the DAT models a corpse, a stump, or a pile
            # of rubble as its own unit, and its standing graphic is that art.
            if unit.dead_unit_id is None or unit.dead_unit_id < 0:
                raise ValueError(f"unit {unit.id} leaves nothing behind")
            # ...but only for something that can die. A forage bush has zero
            # hit points and no dying graphic, so the engine never reaches the
            # `dead_unit_id` it nominally shares with the oak (both name STUMP,
            # 415) -- an exhausted bush is removed, it does not leave a tree
            # stump. Asking for the slot anyway is a spec error, not a silent
            # fallback (issue #12).
            if unit.dying_graphic is None or unit.dying_graphic < 0:
                raise ValueError(
                    f"unit {unit.id} has no dying graphic, so it never reaches "
                    f"its dead unit {unit.dead_unit_id}"
                )
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
    if "delta" in animation:
        # A named piece of a composed standing graphic: a fish is its leap
        # (the standing graphic, empty but for the frames it is in the air)
        # over a "(Underwater)" delta that is the school beneath the surface.
        wanted = animation["delta"]
        for delta in dat.graphics[unit.standing_graphic[0]].deltas or []:
            if delta.graphic_id < 0:
                continue
            graphic = dat.graphics[delta.graphic_id]
            if graphic is not None and wanted in (graphic.name or ""):
                return delta.graphic_id
        raise ValueError(f"unit {unit.id}: standing graphic has no {wanted!r} delta")
    task = find_task(unit, animation["task"])
    return getattr(task, f"{animation['graphic']}_graphic_id")


def animation_entry(
    dat: DatFile, graphics_dir: Path | Graphics, graphic_id: int, hashes: dict[str, str]
) -> dict[str, Any]:
    """One graphic's art: the DAT's counts and timing, and the file to decode.

    `source` is the file actually decoded and `scale` its pixels per screen
    unit: the DAT's `_x1` at 1, or the Enhanced Graphics Pack's `_x2` twin at
    2 when that depot is present (`depot.Graphics.source`).
    """
    graphic = dat.graphics[graphic_id]
    if graphic is None or not graphic.file_name or graphic.file_name == "None":
        raise ValueError(f"graphic {graphic_id} has no source file")
    sld, scale = Graphics.of(graphics_dir).source(graphic.file_name)
    if not sld.is_file():
        raise FileNotFoundError(sld)
    hashes[sld.name] = sha256(sld)
    return {
        "graphicId": graphic_id,
        "source": sld.name,
        "scale": scale,
        "frames": graphic.frame_count,
        "directions": graphic.angle_count,
        "frameSeconds": rounded(graphic.frame_duration),
        "mirroringMode": graphic.mirroring_mode,
    }


def dead_standing_graphic(civ_units: Any, unit: Any) -> int:
    """The art of what a unit leaves behind, or -1 when it leaves nothing."""
    if unit.dying_graphic is None or unit.dying_graphic < 0:
        return -1
    if unit.dead_unit_id is None or unit.dead_unit_id < 0:
        return -1
    dead = civ_units[unit.dead_unit_id]
    return dead.standing_graphic[0] if dead is not None else -1


def damage_stages(dat: DatFile, unit: Any) -> list[dict[str, Any]]:
    """The fires a building shows past each fraction of hit points lost.

    `damage_graphics` names, per `damage_percent`, a composite graphic with
    no file of its own whose deltas are the flame graphics -- FLM1A_NN and
    kin, HD-era sprites that DE draws instead as the particle effect each
    names (`particle_effect_name`, `fire_small_left` and so on) -- at an
    offset from the building's hotspot in sprite pixels, y down. Thresholds
    come out ascending, and the delta order is the file's.
    """
    stages: list[dict[str, Any]] = []
    for entry in unit.damage_graphics or []:
        if entry.graphic_id is None or entry.graphic_id < 0:
            continue
        composite = dat.graphics[entry.graphic_id]
        if composite is None:
            continue
        flames = []
        for delta in composite.deltas or []:
            if delta.graphic_id < 0:
                continue
            flame = dat.graphics[delta.graphic_id]
            if flame is None or not flame.particle_effect_name:
                continue
            flames.append({
                "effect": flame.particle_effect_name,
                "offset": [int(delta.offset_x), int(delta.offset_y)],
            })
        if flames:
            stages.append({"percent": int(entry.damage_percent), "flames": flames})
    stages.sort(key=lambda stage: stage["percent"])
    return stages


def particle_effects(
    particles_dir: Path, names: set[str], hashes: dict[str, str]
) -> dict[str, Any]:
    """The reference's particle definitions, for the effects the content names.

    A fire is not a physics system: `particles/<name>.json` is a flipbook --
    `ImageCount` frames from `ImageFirst` in the TexturePacker atlas
    `AtlasFile` names, at `Scale`, looping over `Duration1`..`Duration2`
    seconds and fading in and out over `StartDuration`/`StopDuration`, with
    `FlipH` on the right-handed variants. The frames' rectangles are read
    here from the atlas's own table; the converter cuts them out.
    """
    effects: dict[str, Any] = {}
    tables: dict[str, dict[str, Any]] = {}
    for name in sorted(names):
        path = particles_dir / f"{name}.json"
        definition = json.loads(path.read_text())
        hashes[f"particles/{name}.json"] = sha256(path)
        atlas = Path(definition["AtlasFile"].replace("\\", "/"))
        table_path = particles_dir / atlas.with_suffix(".json")
        image_path = particles_dir / atlas.with_suffix(".png")
        if atlas.name not in tables:
            tables[atlas.name] = json.loads(table_path.read_text())
            hashes[f"particles/{atlas.with_suffix('.json').as_posix()}"] = sha256(table_path)
            hashes[f"particles/{atlas.with_suffix('.png').as_posix()}"] = sha256(image_path)
        table = tables[atlas.name]
        first, count = int(definition["ImageFirst"]), int(definition["ImageCount"])
        frames = table["frames"][first:first + count]
        if len(frames) != count:
            raise ValueError(f"particle {name}: {count} frames from {first} outrun the atlas table")
        effects[name] = {
            "atlas": str(image_path),
            "scale": rounded(definition.get("Scale", 1.0)),
            "flipHorizontal": bool(definition.get("FlipH", False)),
            "loop": definition.get("Type") == "Loop",
            "cycleSeconds": [rounded(definition["Duration1"]), rounded(definition["Duration2"])],
            "fadeInSeconds": rounded(definition.get("StartDuration", 0.0)),
            "fadeOutSeconds": rounded(definition.get("StopDuration", 0.0)),
            "frames": [
                {
                    "x": f["frame"]["x"], "y": f["frame"]["y"], "w": f["frame"]["w"], "h": f["frame"]["h"],
                    "rotated": bool(f["rotated"]),
                    "sourceX": f["spriteSourceSize"]["x"], "sourceY": f["spriteSourceSize"]["y"],
                    "sourceW": f["sourceSize"]["w"], "sourceH": f["sourceSize"]["h"],
                    "pivotX": f["pivot"]["x"], "pivotY": f["pivot"]["y"],
                }
                for f in frames
            ],
        }
    return effects


def costs_of(creatable: Any) -> tuple[dict[str, int], int]:
    paid: dict[str, int] = {}
    population = 0
    for cost in creatable.resource_costs:
        if cost.type == POPULATION_TYPE:
            population = int(cost.amount)
        elif cost.flag and cost.type in RESOURCE_NAMES:
            paid[RESOURCE_NAMES[cost.type]] = int(cost.amount)
    return paid, population


def selection_of(unit: Any) -> dict[str, Any]:
    """What a selection draws on the ground for this unit.

    Obstruction type 5 is the round unit outline; everything else marks its
    outline box (buildings and resources, whose box can exceed the collision
    box — a barracks collides at 1.5 half-tiles but outlines at 1.6).
    """
    return {
        "shape": "round" if unit.obstruction_type == 5 else "square",
        "outline": [rounded(unit.outline_size_x), rounded(unit.outline_size_y)],
    }


def extract_entity(
    dat: DatFile,
    civ_units: Any,
    spec: dict[str, Any],
    graphics_dir: Path | Graphics,
    hashes: dict[str, str],
    strings: dict[int, str] | None = None,
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
        # The row of `terrain_restrictions` it obeys: which terrains it may
        # stand on. Land units are row 7, buildings row 4, walls row 10 --
        # and the table, not a rule, is what keeps a villager out of a pond.
        "terrainRestriction": unit.terrain_restriction,
        "minimapMode": unit.minimap_mode,
        "placementSideTerrain": [terrain for terrain in unit.placement_side_terrain if terrain >= 0],
        "collision": [rounded(unit.collision_size_x), rounded(unit.collision_size_y)],
        # Whether anything has to walk round it. A farm has a collision box
        # like any building but no height to it and no obstruction class, and
        # nothing walks round a farm in the reference. The town center reads
        # the same way and must not: its four annexes carry its obstruction,
        # which is why having none is part of the test (issue #40).
        "passable": (
            unit.collision_size_z == 0
            and unit.obstruction_class == 0
            and not [a for a in (unit.building.annexes or []) if a.unit_id and a.unit_id > 0]
        ) if unit.building is not None else False,
        "clearance": [rounded(value) for value in unit.clearance_size],
        # What a selection draws on the ground: obstruction type 5 is the round
        # unit outline, everything else marks its outline box (buildings and
        # resources, whose box can exceed the collision box — a barracks
        # collides at 1.5 half-tiles but outlines at 1.6).
        "selection": selection_of(unit),
        # The DAT's unit class. Technology effects are mostly addressed to a
        # class rather than a unit -- Loom is "+15 hit points to class 4", the
        # civilians -- so this is what lets those be resolved to our entities
        # instead of being listed by hand.
        "class": unit.class_,
        # Whether the thing keeps being drawn once its tile goes dark. Gaia's
        # resources and its huntables/herdables are 1; every player unit and
        # building is 0. This is the field that decides a unit does not linger
        # in the fog -- buildings are remembered by the engine's separate
        # last-seen memory, which no DAT field states.
        "fogVisibility": int(unit.fog_visibility),
        # What a siege shot may hurt. A target is caught in a blast when its
        # defense level is at least the shooter's `blast_attack_level`: every
        # unit is 3, every building 2, a tree 1, a bush or a mine 0 -- so a
        # mangonel (2) reaches soldiers and buildings, an onager (1) fells
        # trees as well, and nothing harvests a bush by shooting it (issue #46).
        "blastDefenseLevel": int(unit.blast_defense_level),
    }
    # What the reference calls it, verbatim from its own string table -- the
    # DAT's `language_dll_name` is "Man-at-Arms", not the slug's "Man At
    # Arms" -- with the create-button text and the tooltip beside it.
    # A skin is another DAT unit with the same rules and its own art and voice
    # -- the female villager (293) beside the male (83), and a counterpart for
    # every task unit. It is drawn instead of the unit it skins, at the odds
    # `objreplacement.json` states, and is nothing on the simulation's side.
    if "skinOf" in spec:
        entity["skinOf"] = spec["skinOf"]
        entity["skin"] = spec["skin"]
    # Flight art gets none: a projectile's string ids are leftovers (the
    # trebuchet's rock points at the Kipchak's tooltip), and a wrong name is
    # worse than no name.
    if strings and category != "projectile":
        text = text_of(strings, unit.language_dll_name, unit.language_dll_creation, unit.language_dll_help)
        if text:
            entity["text"] = text
    # What is left behind is its own unit in the DAT with its own obstruction:
    # a carcass stops being a body in the way and marks a flat box on the
    # ground instead of the live animal's ring.
    if "dead" in {a.get("slot") for a in spec["animations"].values()}:
        corpse = civ_units[unit.dead_unit_id] if unit.dead_unit_id and unit.dead_unit_id >= 0 else None
        if corpse is not None:
            entity["selection"]["dead"] = selection_of(corpse)
            # ...and its own lifetime. Only dead units carry a type-12 resource
            # storage, and it drains at the corpse's own `resource_decay`: 300
            # at 1.0 a second for every unit corpse in the file, 60 for every
            # building's rubble. Live units carry types 4, 11 and 19 instead,
            # which is what says this one is a clock rather than a stockpile.
            seconds = corpse_seconds(corpse)
            if seconds is not None:
                entity["corpseSeconds"] = seconds
    if unit.icon_id >= 0:
        entity["iconId"] = unit.icon_id
    if unit.speed and unit.speed > 0:
        entity["speedTilesPerSecond"] = rounded(unit.speed)

    if unit.creatable is not None:
        # `hero_mode` is a flag field: 1 full heal, 2 cannot be converted, 4
        # regenerates, 8 defensive stance, 16 protected formation, 32 asks
        # before Delete, 64 hero glow. Across this roster it reads 0, 32 or
        # 34: the town center, watch tower, monastery, castle and wonder ask,
        # and the rest go on the keypress -- which is the reference's own
        # division, not "buildings ask" (issue #47).
        if unit.creatable.hero_mode & HERO_CONFIRM_DELETE:
            entity["confirmDelete"] = True
        cost, population = costs_of(unit.creatable)
        if cost:
            entity["cost"] = cost
        if population:
            entity["populationCost"] = population
        train = unit.creatable.train_locations[0]
        if category == "building":
            entity["build"] = {"builderId": train.unit_id, "seconds": train.train_time}
            # Where it sits in the villager's build menu. The DAT states the
            # slot and not the page, but it states the page's *shape*: two
            # buildings may share a button id only if they are on different
            # pages, and every collision is one economic building against one
            # military one -- house against barracks, mill against archery
            # range, farm against outpost, blacksmith against palisade wall.
            # That is the reference for the layout (issue #25).
            if train.button_id > 0:
                entity["build"]["button"] = train.button_id
        elif train.unit_id >= 0:
            entity["train"] = {"buildingId": train.unit_id, "seconds": train.train_time}
            # Its cell in the building's command grid, 1-15 across then down.
            # A line shares one: the militia and everything it upgrades into
            # sit at the barracks' slot 1, which is why a button never moves
            # when a technology lands.
            if train.button_id > 0:
                entity["train"]["button"] = train.button_id

    combat = unit.type_50
    # Armour is imported even for something that never attacks. Damage is
    # scored class by class and a class the target has no entry for scores
    # nothing, so a building with no armours at all took exactly the minimum
    # damage from everything -- one point a hit, whatever hit it, and no
    # blacksmith upgrade could change it (issue #26). Every building in the
    # DAT has armours; only the four that shoot were being asked for them.
    if combat is not None and (any(attack.amount for attack in combat.attacks)
                               or combat.armours):
        entity["combat"] = {
            "reloadSeconds": rounded(combat.reload_time),
            "frameDelay": combat.frame_delay,
            "minimumRange": rounded(combat.min_range),
            "maximumRange": rounded(combat.max_range),
            "attacks": [{"class": a.class_, "amount": a.amount} for a in combat.attacks],
            "armors": [{"class": a.class_, "amount": a.amount} for a in combat.armours],
            # The chance a shot is aimed true. The DAT varies it widely -- an
            # archer 80, a cavalry archer 50, a longbowman 70, a tower 100 --
            # and Thumb Ring is an effect that sets it to 100 for the archer
            # classes, so it is a real attribute rather than a constant.
            "accuracyPercent": combat.accuracy_percent,
        }
        # ...and how far a shot that fails that roll lands from where it was
        # aimed, in tiles. Archers are 0.33, the trebuchet 0.2, everything
        # that cannot miss 0 (issue #45).
        if combat.accuracy_dispersion and combat.accuracy_dispersion > 0:
            entity["combat"]["accuracyDispersion"] = rounded(combat.accuracy_dispersion)
        # Ranged shooters name the projectile they launch; the arrow's own
        # entry carries its travel speed and art.
        if combat.projectile_unit_id is not None and combat.projectile_unit_id >= 0:
            entity["combat"]["projectileUnitId"] = combat.projectile_unit_id
            # The projectile unit's own `speed` is how fast the shot flies
            # (arrows 7, the mangonel's and trebuchet's stones 3.5, the town
            # center's volley 8). It was left to the hand-written fallback
            # until the review found the onager flying at 5 (issue #105).
            projectile = civ_units[combat.projectile_unit_id]
            if projectile is not None and projectile.speed:
                entity["combat"]["projectileSpeed"] = rounded(projectile.speed)
        # Where the shot leaves the shooter. The z component is what puts a
        # tower's arrows at its top, so a close shot points down rather than up.
        if combat.graphic_displacement:
            entity["combat"]["launchOffset"] = [rounded(v) for v in combat.graphic_displacement]
        # A mangonel's stone hurts what it lands beside, not only what it hit.
        if combat.blast_width and combat.blast_width > 0:
            entity["combat"]["blastRadius"] = rounded(combat.blast_width)
            entity["combat"]["blastAttackLevel"] = int(combat.blast_attack_level)

    # Garrison (issue #75). A building says how many it holds
    # (`garrison_capacity`), who may enter (`building.garrison_type`, a flag
    # field over the editor's categories: 1 villagers, 2 infantry and foot
    # archers, 4 cavalry, 8 monks, 16 livestock, 32 siege -- 11 for a town
    # center and a tower, 15 for a castle, 0 for a production building) and
    # how fast those inside mend (`garrison_heal_rate`). What it shoots when
    # they are in is `creatable.total_projectiles` to `max_total_projectiles`
    # -- the town center's own projectile is -1, so it fires only the
    # garrison's arrows, which are `secondary_projectile_unit` (54) and deal
    # that unit's own damage.
    if category == "building" and unit.garrison_capacity > 0 and unit.building is not None:
        entity["garrison"] = {
            "capacity": int(unit.garrison_capacity),
            "types": int(unit.building.garrison_type),
            "healRate": rounded(unit.building.garrison_heal_rate),
        }
        if unit.creatable is not None and unit.creatable.max_total_projectiles > 0:
            volley = {
                "base": rounded(unit.creatable.total_projectiles),
                "max": int(unit.creatable.max_total_projectiles),
            }
            secondary = unit.creatable.secondary_projectile_unit
            if secondary is not None and secondary >= 0 and civ_units[secondary] is not None:
                arrow = civ_units[secondary]
                volley["arrowUnitId"] = int(secondary)
                volley["arrowSpeed"] = rounded(arrow.speed)
                volley["arrowAttacks"] = [
                    {"class": a.class_, "amount": a.amount} for a in arrow.type_50.attacks
                ] if arrow.type_50 is not None else []
            entity["garrison"]["volley"] = volley
    # What a unit adds to the volley of the building it sits in: the
    # archers' 1.0 is the reference's arrow apiece. The villagers' -2.5 (and
    # the fishing ships' -1.0, two heroes' -7.5 and -4.5) is an encoding the
    # owned files do not explain; it is carried as the number it is.
    if category in ("unit", "unit-variant") and unit.type_50 is not None:
        entity["garrisonFirepower"] = rounded(unit.type_50.garrison_firepower)

    if category == "projectile" and unit.projectile is not None:
        # `projectile_arc` is a fraction of the shot's distance. Its sign varies
        # between units in ways this import does not interpret; the renderer
        # uses the magnitude for the visual arc height.
        entity["projectile"] = {
            "hitMode": unit.projectile.hit_mode,
            "vanishMode": unit.projectile.vanish_mode,
            "arc": rounded(unit.projectile.projectile_arc),
            # Whether the shot leads a moving target. `smart_mode` is a flag
            # field and this is its low bit: Ballistics sets every projectile
            # to 1, or to 3 for the fourteen that already carry a second flag,
            # and that single `set attribute` is the whole of that technology.
            "leadsTarget": bool(unit.projectile.smart_mode & PROJECTILE_LEADS_TARGET),
        }

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

    if "repairer" in spec:
        # Repair is its own task unit in the DAT -- VMREP (156) beside the
        # builder -- whose work rate is hit points a second, and whose repair
        # tasks (action 106) say by class what takes it slower: the default
        # row at 1.0 is a building, and siege and ships are named at 0.25.
        # The classes it names are also the only units it will mend at all;
        # everything else is a monk's work (issue #74).
        repairer = civ_units[spec["repairer"]]
        tasks = [t for t in repairer.bird.tasks if t.action_type == TASK_REPAIR]
        entity["repair"] = {
            "hitPointsPerSecond": rounded(repairer.bird.work_rate),
            "classFactors": {
                str(t.class_id): rounded(t.work_value_1) for t in tasks if t.class_id >= 0
            },
        }

    if "heal" in spec:
        # A monk mends what it stands beside. The rate is the unit's work rate;
        # the task's own range is how close it has to come.
        task = find_task(unit, spec["heal"]["task"])
        entity["heal"] = {
            "hitPointsPerSecond": rounded(unit.bird.work_rate),
            "range": rounded(task.work_range),
        }

    if "convert" in spec:
        # Conversion is a wait, not a blow: the DAT gives the earliest second it
        # can succeed and the second by which it must. The range is the unit's
        # own maximum, which is what a monk reaches with.
        task = find_task(unit, spec["convert"]["task"])
        entity["convert"] = {
            "minSeconds": rounded(task.work_value_1),
            "maxSeconds": rounded(task.work_value_2),
            "range": rounded(unit.type_50.max_range),
        }

    if category == "unit-variant" or (category == "unit" and "task" in spec):
        task = find_task(unit, spec["task"])
        resource_type = task.resource_out if task.resource_out >= 0 else task.resource_in
        if resource_type in RESOURCE_NAMES:
            entity["gather"] = {
                "resource": RESOURCE_NAMES[resource_type],
                "ratePerSecond": rounded(unit.bird.work_rate),
                "capacity": int(unit.resource_capacity),
                "task": spec["task"],
                # What the work rate is multiplied by per class of node it
                # gathers from (`work_value_1` on each gather task): the
                # fishing ship works a deep-sea fish (class 5) at 1.75 and a
                # shore fish (class 33) at 1.0.
                "classFactors": {
                    str(t.class_id): rounded(t.work_value_1)
                    for t in unit.bird.tasks
                    if t.action_type == TASK_GATHER and t.class_id >= 0
                },
            }
        else:
            entity["work"] = {"task": spec["task"]}
    if category in ("unit", "unit-variant") and unit.bird is not None:
        drop_sites = [site for site in unit.bird.drop_sites if site >= 0]
        if drop_sites:
            entity["dropSites"] = drop_sites

    if category == "animal" and unit.bird is not None:
        # How close something has to come before the animal reacts. The deer's
        # 1.0 is exactly the one tile the reference startles it at; the sheep's
        # 4.0 is the reach of a different behaviour, so which animals flee is a
        # rule (see `docs/ledger.md`), not this number.
        entity["searchRadius"] = rounded(unit.bird.search_radius)

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

    # Ageing up replaces the building with the next age's unit, so the art for
    # each age is that unit's standing graphic (issue #13) -- and its own
    # collapse and rubble, because the variant carries its own `dying_graphic`
    # and names its own rubble unit (`House Age2 (Rubble)`), so a razed Feudal
    # house falls as a Feudal house (issue #61). A collapse is a hundred-frame
    # sheet, so an age whose art is the previous age's (the Imperial house is
    # the Castle one) is left to the renderer's age chain rather than decoded
    # twice. The hit points the variants also carry are a simulation change
    # and are not read here; see docs/backlog.md.
    if category == "building":
        # What it burns with as it loses hit points (issue #73): the DAT's
        # `damage_graphics` are one composite per threshold whose deltas are
        # the reference's fire particles at their places on this picture, so
        # each age's picture has its own, keyed by the idle art it belongs to.
        stages = damage_stages(dat, unit)
        if stages:
            entity["damageStages"] = {"idle": stages}
        last_death = unit.dying_graphic
        last_decay = dead_standing_graphic(civ_units, unit)
        composed = spec["animations"].get("idle", {}).get("slot") == "base"
        for age, variant_id in age_variants(dat, unit.id).items():
            variant = civ_units[variant_id]
            if variant is None or variant.standing_graphic[0] < 0:
                continue
            standing = variant.standing_graphic[0]
            entity["animations"][f"idle-{age}"] = animation_entry(
                dat, graphics_dir, base_graphic(dat, variant, standing) if composed else standing, hashes
            )
            variant_stages = damage_stages(dat, variant)
            if variant_stages and variant_stages != stages:
                entity.setdefault("damageStages", {})[f"idle-{age}"] = variant_stages
                stages = variant_stages
            if "death" in spec["animations"] and variant.dying_graphic >= 0 \
                    and variant.dying_graphic != last_death:
                entity["animations"][f"death-{age}"] = animation_entry(
                    dat, graphics_dir, variant.dying_graphic, hashes
                )
                last_death = variant.dying_graphic
            decay = dead_standing_graphic(civ_units, variant)
            if "decay" in spec["animations"] and decay >= 0 and decay != last_decay:
                entity["animations"][f"decay-{age}"] = animation_entry(
                    dat, graphics_dir, decay, hashes
                )
                last_decay = decay

    # How long the death graphic runs, so the simulation can keep the corpse
    # until it has played out. A building's collapse is 8.3 seconds where a
    # villager's is 1.5, and a flat window shorter than either makes the
    # building vanish mid-fall and never reach its rubble.
    death = entity["animations"].get("death")
    if death and death.get("frames") and death.get("frameSeconds"):
        entity["deathSeconds"] = rounded(death["frames"] * death["frameSeconds"])

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
                        ),
                        # The annex ids on a town center are the same in every
                        # age; it is the annex units themselves the age
                        # technology upgrades, so each is followed separately.
                        **{
                            f"idle-{age}": animation_entry(
                                dat, graphics_dir,
                                civ_units[variant_id].standing_graphic[0], hashes,
                            )
                            for age, variant_id in age_variants(dat, annex.unit_id).items()
                            if civ_units[variant_id] is not None
                            and civ_units[variant_id].standing_graphic[0] >= 0
                        },
                    },
                }
            )
        entity["annexes"] = annexes

    return entity


def effect_entry(
    dat: DatFile, graphics_dir: Path | Graphics, spec: dict[str, Any], hashes: dict[str, str]
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
EFFECT_UPGRADE_UNIT = 3    # a = unit, b = what it becomes
EFFECT_ATTRIBUTE_ADD = 4   # a = unit, b = class, c = attribute, d = amount

# The age each of these technologies grants, by the name this project uses for
# it. Ageing up in AoE2 replaces a building with the next age's unit, which is
# where the taller mill and the stone barracks come from; the DAT states every
# swap as an `upgrade unit` command on the age technology itself.
AGE_UPGRADE_TECHS = {"feudal": 101, "castle": 102, "imperial": 103}
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


def age_variants(dat: DatFile, unit_id: int) -> dict[str, int]:
    """What this unit becomes in each later age, as the age technology says.

    A building is not restyled in AoE2, it is replaced: the Feudal Age
    technology carries `upgrade unit` commands turning the barracks (12) into
    "Barracks Age2" (498), the house into HOUS2, and the town center and each
    of its four annex pieces into their Feudal selves. Reading those commands
    is how the age art is found; nothing here lists a unit id by hand.
    """
    found: dict[str, int] = {}
    for age, tech_id in AGE_UPGRADE_TECHS.items():
        tech = dat.techs[tech_id]
        if tech.effect_id is None or not 0 <= tech.effect_id < len(dat.effects):
            continue
        for command in dat.effects[tech.effect_id].effect_commands:
            if command.type == EFFECT_UPGRADE_UNIT and int(command.a) == unit_id:
                found[age] = int(command.b)
                break
    return found


def available_age(dat: DatFile, unit_id: int) -> int:
    """Which age a unit becomes available in, read from what gates it."""
    tech = enabling_tech(dat, unit_id)
    if tech is None:
        return 0
    for required in tech.required_techs:
        if required in AGE_TECHS:
            return AGE_TECHS.index(required)
    return 0


# Which DAT attribute each effect command changes, under the name the rules
# use for it. Anything not here is not modelled; the importer records it rather
# than dropping it silently (see `unmodelled` in the technology entry).
ATTRIBUTE_NAMES = {
    0: "hitPoints",
    1: "lineOfSight",
    5: "speed",
    8: "armor",
    9: "attack",
    10: "reloadSeconds",
    11: "accuracyPercent",
    12: "range",
    13: "workRate",
    14: "carryCapacity",
    # How close is too close. A watch tower and a castle each have a tile of
    # it, and Murder Holes is one `set` of this to zero.
    20: "minRange",
    # On a projectile, whether the shot leads a moving target. Ballistics is
    # one `set` of this and nothing else.
    19: "leadsTarget",
}
# 8 and 9 pack an armour class into the high byte. The low byte is the amount
# for `set` and `add`, and a percentage for `multiply` -- Heated Shot arrives
# as 4321, which is class 16 and x2.25, and Siege Engineers as 2936, class 11
# and x1.2. Both are exactly what those technologies do in AoE2.
PACKED_ATTRIBUTES = {"armor", "attack"}
OPERATION_NAMES = {0: "set", 4: "add", 5: "multiply"}

# Effect command type 1 changes a *player* attribute rather than a unit's, and
# addresses it by resource id. The civ's own `resources` table holds the
# starting value, which is how a number nobody could find turns out to be
# stated: a farm's food is resource 36 and civ 1 starts it at 175, exactly the
# figure the open fallback had hand-written. Horse Collar adds 75 to it and
# Heavy Plow 125, which is the whole of what those technologies do here.
RESOURCE_ATTRIBUTES = {
    36: "farmFoodAmount",
    # Constants.xs: cAttributeUnitRepairCost 270, cAttributeBuildingRepairCost
    # 271 -- the fraction of the price a full repair costs (issue #74).
    270: "unitRepairCost",
    271: "buildingRepairCost",
}
# `b` on a type 1 command: 0 writes the value, 1 adds to it.
RESOURCE_OPERATIONS = {0: "set", 1: "add"}


def slug(name: str) -> str:
    """A stable key from a technology's own name: `Bodkin Arrow` -> bodkin-arrow."""
    cleaned = "".join(c.lower() if c.isalnum() else "-" for c in name)
    while "--" in cleaned:
        cleaned = cleaned.replace("--", "-")
    return cleaned.strip("-")


def effects_of(
    dat: DatFile, tech_id: int, entities: dict[str, Any]
) -> tuple[list[dict[str, Any]], list[str]]:
    """Decode one technology's effect commands against the entities we have.

    A command is addressed either to a unit (`a`) or to a whole unit class
    (`a` is -1 and `b` is the class), which is why every entity carries its
    DAT class: Loom is not "+15 hit points to the villager", it is "+15 to
    class 4", and the villager task variants are all class 4.

    Returns the effects that landed, the names of the attributes that did not,
    and -- for a technology where *nothing* landed -- what each of its commands
    was actually asking for, so "none of its effects reach anything imported"
    can say which effects and what they wanted.
    """
    tech = dat.techs[tech_id]
    by_id: dict[int, list[str]] = {}
    by_class: dict[int, list[str]] = {}
    for key, entity in entities.items():
        # A skin has no rules of its own to change: what lands on the unit it
        # skins lands on it.
        if "skinOf" in entity:
            continue
        if "id" in entity:
            by_id.setdefault(entity["id"], []).append(key)
        if "class" in entity:
            by_class.setdefault(entity["class"], []).append(key)

    effects: list[dict[str, Any]] = []
    unmodelled: set[str] = set()
    unreached: set[str] = set()
    for command in dat.effects[tech.effect_id].effect_commands:
        if command.type == 1:
            # A player attribute: `a` names the resource, `b` chooses write or
            # add, `d` is the amount. `c` is a bookkeeping slot this does not
            # read.
            resource = RESOURCE_ATTRIBUTES.get(int(command.a))
            resource_operation = RESOURCE_OPERATIONS.get(int(command.b))
            if resource is None or resource_operation is None:
                unreached.add(f"resource {int(command.a)} at the player level")
                continue
            effects.append({
                "resource": resource,
                "operation": resource_operation,
                "amount": rounded(float(command.d)),
            })
            continue
        operation = OPERATION_NAMES.get(command.type)
        if operation is None:
            continue  # enable, upgrade-unit and the rest are not attribute changes
        target = int(command.a)
        targets = by_id.get(target, []) if target >= 0 else by_class.get(int(command.b), [])
        attribute_id = int(command.c)
        if not targets:
            # Something this slice of the game does not have. Say which
            # attribute it wanted to change and on what, by the DAT's own
            # numbers -- naming them would be guessing at attributes this
            # importer does not model.
            where = f"unit {target}" if target >= 0 else f"unit class {int(command.b)}"
            unreached.add(f"attribute {attribute_id} on {where}")
            continue
        attribute = ATTRIBUTE_NAMES.get(attribute_id)
        if attribute is None:
            unmodelled.add(f"attribute {attribute_id}")
            unreached.add(f"attribute {attribute_id} on {targets[0]}, which is not modelled")
            continue
        amount = float(command.d)
        for key in targets:
            effect: dict[str, Any] = {
                "unit": key, "attribute": attribute, "operation": operation,
            }
            if attribute in PACKED_ATTRIBUTES:
                packed = int(amount)
                effect["armorClass"] = packed >> 8
                low = packed & 0xFF
                effect["amount"] = rounded(low / 100) if operation == "multiply" else low
            else:
                effect["amount"] = rounded(amount)
            effects.append(effect)
    return effects, sorted(unmodelled), sorted(unreached)


def technology_entry(
    dat: DatFile, spec: dict[str, Any], hashes: dict[str, str], strings: dict[int, str] | None = None,
) -> dict[str, Any]:
    """One researchable technology: what it costs, where, and what it changes."""
    tech = dat.techs[spec["techId"]]
    effect = dat.effects[tech.effect_id]
    if "effect" in spec and effect.name != spec["effect"]:
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
    # Its cell in the grid, as for a unit: Forging, Iron Casting and Blast
    # Furnace all sit at the blacksmith's slot 1, the three ages at 11.
    if location.button_id > 0:
        entry["button"] = location.button_id
    if strings:
        text = text_of(strings, tech.language_dll_name, tech.language_dll_description, tech.language_dll_help)
        if "create" in text:
            # A technology's second string is its description, the button
            # text: "Research Loom (Villagers +15 HP and +1 melee/+2 pierce armor)".
            text["description"] = text.pop("create")
        if text:
            entry["text"] = text
    if spec["techId"] in AGE_TECHS:
        entry["grantsAge"] = AGE_TECHS.index(spec["techId"])

    # What it changes, decoded from the effect commands against the entities
    # this game actually has, rather than transcribed into the spec.
    effects, unmodelled, unreached = effects_of(dat, spec["techId"], spec["entities"])
    if effects:
        entry["effects"] = effects
    if unmodelled or (effects and unreached):
        # Kept so a half-applied technology is visible rather than a surprise.
        # A technology that lands *something* still says what it did not: Heavy
        # Plow's farm food arrives and its +1 carry for the farmer villagers
        # (DAT units 214 and 259) does not, because this game has no farmer
        # variant to put it on.
        entry["unmodelled"] = sorted(set(unmodelled) | (set(unreached) if effects else set()))
    # Only of interest when nothing landed; the caller strips it otherwise.
    entry["_unreached"] = unreached
    return entry


def civilization_entry(
    dat: DatFile, dat_path: Path, spec: dict[str, Any], hashes: dict[str, str],
    strings: dict[int, str] | None = None,
) -> dict[str, Any]:
    """The civilisation this content is imported for, and what its tree lacks.

    The depot ships a tech tree per civilisation next to the DAT, and each node
    in it carries a `Node Status`. `NotAvailable` is the game's own record that
    a civilisation does not get something: the Britons have no Thumb Ring, no
    Paladin, no Hussar and no Bloodlines, which is exactly their real tree.
    Those are recorded by DAT id, so the rules can refuse them by the same
    number the technology and unit entries already carry.
    """
    civ_spec = spec["civilization"]
    tree_path = dat_path.parent / "CivTechTrees" / civ_spec["treeFile"]
    if not tree_path.is_file():
        raise ValueError(f"no tech tree at {tree_path}")
    hashes[tree_path.name] = sha256(tree_path)
    tree = json.loads(tree_path.read_text())
    nodes = tree["civ_techs_buildings"] + tree["civ_techs_units"]

    # `Use Type` says which table a node's id belongs to, so a technology and a
    # unit that share a number are not confused for one another.
    buckets = {"Tech": "technologies", "Unit": "units", "Building": "buildings"}
    unavailable: dict[str, list[int]] = {name: [] for name in buckets.values()}
    for node in nodes:
        if node["Node Status"] != "NotAvailable":
            continue
        bucket = buckets.get(node["Use Type"])
        if bucket is None:
            continue
        node_id = int(node["Node ID"])
        if node_id not in unavailable[bucket]:
            unavailable[bucket].append(node_id)
    for name in unavailable:
        unavailable[name].sort()
    entry: dict[str, Any] = {
        "key": civ_spec["key"],
        "datIndex": spec["civIndex"],
        # The DAT's own name for the civilisation, which is not always the
        # modern one: civ 1 is "British" where everything else says Britons.
        "name": dat.civs[spec["civIndex"]].name,
        "treeFile": civ_spec["treeFile"],
        "unavailable": unavailable,
    }
    # What the reference calls it, and what it calls a computer player of it.
    # `civilizations.json` beside the DAT names the civilisation's string
    # (10271 "Britons") and the offset of its computer-name table: the string
    # at the offset is the count, and the names follow (4401 "Henry V" ...).
    civ_list = dat_path.parent / "civilizations.json"
    if strings and civ_list.is_file():
        hashes["civilizations.json"] = sha256(civ_list)
        for civ in json.loads(civ_list.read_text())["civilization_list"]:
            if civ.get("tech_tree_name") != civ_spec["treeFile"].removesuffix(".json"):
                continue
            if civ.get("name_string_id") in strings:
                entry["displayName"] = strings[civ["name_string_id"]]
            offset = civ.get("computer_name_string_table_offset")
            if offset is not None and offset in strings and strings[offset].isdigit():
                count = int(strings[offset])
                entry["computerNames"] = [strings[offset + i] for i in range(1, count + 1) if offset + i in strings]
            break
    return entry


def tree_nodes(dat_path: Path, spec: dict[str, Any]) -> list[dict[str, Any]]:
    """Every node of the configured civilisation's own tech tree."""
    tree_path = dat_path.parent / "CivTechTrees" / spec["civilization"]["treeFile"]
    tree = json.loads(tree_path.read_text())
    return tree["civ_techs_buildings"] + tree["civ_techs_units"]


def technologies_from_tree(
    dat: DatFile,
    dat_path: Path,
    spec: dict[str, Any],
    entities: dict[str, Any],
    civilization: dict[str, Any],
    hashes: dict[str, str],
    strings: dict[int, str] | None = None,
) -> tuple[dict[str, Any], list[dict[str, str]]]:
    """Every technology the civilisation's tree offers that this game can hold.

    The tree is the list, not a hand-written one: a `Research` node names the
    technology, the building it happens at and the age it appears in. A node is
    taken when the civilisation has it, when its building is a building we
    import, and when at least one of its effect commands lands on an entity we
    have. Anything left out is returned with the reason.
    """
    buildings = {
        entity["id"]: key
        for key, entity in entities.items()
        if entity.get("category") == "building" and "id" in entity
    }
    units = {
        entity["id"]: key
        for key, entity in entities.items()
        if entity.get("category") in ("unit", "animal") and "id" in entity and "skinOf" not in entity
    }
    keep: dict[str, Any] = {}
    skipped: list[dict[str, str]] = []
    for node in tree_nodes(dat_path, spec):
        # A `UnitUpgrade` node is a technology too -- it just replaces one unit
        # with another rather than adding to it, and the tree names the
        # technology that does it separately from the unit it produces. A
        # civilisation's unique unit takes the same shape: the Elite Longbowman
        # is a `UniqueUnit` node carrying a `Trigger Tech ID`, where the plain
        # Longbowman is a `UniqueUnit` with none because it simply exists.
        upgrade = node["Node Type"] in ("UnitUpgrade", "UniqueUnit") and node.get("Trigger Tech ID")
        if node["Node Type"] != "Research" and not upgrade:
            continue
        name = node["Name"]
        tech_id = int(node["Trigger Tech ID"]) if upgrade else int(node["Node ID"])
        if node["Node Status"] == "NotAvailable":
            skipped.append({"name": name, "techId": tech_id,
                            "reason": f"the {civilization['name']} do not have it"})
            continue
        building = buildings.get(int(node["Building ID"]))
        if building is None:
            skipped.append({"name": name, "techId": tech_id,
                            "reason": f"researched at DAT unit {node['Building ID']}, not imported"})
            continue
        # A tree node the DAT gives nowhere to research (the Fast Fire Ship's
        # locations are all -1) or nothing to do (the Galleon's effect is -1)
        # is listed but not offered.
        tech = dat.techs[tech_id]
        if not any(l.location_id >= 0 for l in tech.research_locations) or tech.effect_id < 0:
            skipped.append({"name": name, "techId": tech_id,
                            "reason": "the DAT gives it no research location or no effect"})
            continue
        entry = technology_entry(
            dat, {"techId": tech_id, "entities": entities}, hashes, strings
        )
        if upgrade:
            # What it turns into, from the DAT's own `upgrade unit` command --
            # the same command the age technologies use on buildings.
            becomes = [
                {"from": units[int(c.a)], "to": units[int(c.b)]}
                for c in dat.effects[dat.techs[tech_id].effect_id].effect_commands
                if c.type == EFFECT_UPGRADE_UNIT
                and int(c.a) in units and int(c.b) in units
            ]
            if not becomes:
                missing = units.get(int(node.get("Link ID", -1)), f"unit {node['Node ID']}")
                skipped.append({"name": name, "techId": tech_id,
                                "reason": f"upgrades to a unit that is not imported ({missing})"})
                continue
            entry["upgrades"] = becomes
        elif not entry.get("effects") and "grantsAge" not in entry:
            # Say what it was actually asking for. "None of its effects reach
            # anything imported" is true of twenty technologies and tells the
            # next reader nothing about which twenty or why.
            wanted = entry.get("_unreached") or []
            detail = "; ".join(wanted[:4]) if wanted else "it changes no attribute at all"
            if len(wanted) > 4:
                detail += f"; and {len(wanted) - 4} more"
            skipped.append({"name": name, "techId": tech_id,
                            "reason": f"none of its effects reach anything imported ({detail})"})
            continue
        entry.pop("_unreached", None)
        # The tree's own name keys the technology; the reference's display
        # name, where the strings file has one, is what the panel shows.
        entry["name"] = entry.get("text", {}).get("name", name)
        keep[slug(name)] = entry

    # A second pass for prerequisites, now that the set is known. The DAT lists
    # each technology's requirements as technology ids -- Iron Casting needs
    # Forging, Hand Cart needs Wheelbarrow -- alongside the age technology and
    # some bookkeeping nodes that are not researchable at all ("Shadow Node+
    # for Age Four"). Only the ones this game offers become requirements; the
    # age is already a field of its own.
    by_tech_id = {entry["techId"]: key for key, entry in keep.items()}
    for key, entry in keep.items():
        required = [
            by_tech_id[int(other)]
            for other in dat.techs[entry["techId"]].required_techs
            if int(other) >= 0 and int(other) in by_tech_id
            and by_tech_id[int(other)] != key
            and int(other) not in AGE_TECHS
        ]
        if required:
            entry["requires"] = sorted(required)
    skipped.sort(key=lambda row: row["name"])
    return keep, skipped


#: `water_def.json`'s per-class rows, by the DAT's `is_water` flag.
WATER_CLASSES = {4: "shallow", 1: "normal", 2: "deep", 8: "walkable"}


def terrain_entry(
    dat: DatFile, terrain_id: int, palette: list[tuple[int, int, int]] | None = None,
) -> dict[str, Any]:
    """Texture name, tile span, and minimap color for one DAT terrain slot."""
    terrain = dat.terrain_block.terrains[terrain_id]
    if not terrain.name_2:
        raise ValueError(f"terrain {terrain_id} has no texture name")
    width, height = terrain.terrain_dimensions
    # `colors` is three *indices* into the game palette, not an RGB triple:
    # the minimap's shade for a tile sloping up, lying flat, and sloping
    # down. Read raw, grass came out (55, 236, 54), which is green by luck,
    # and water (19, 19, 19), which is black by the same luck the other way.
    # Read as the first entry, grass was the up-slope highlight (0, 169, 0),
    # which issue #80 reported as too bright: DE's own minimap draws flat
    # grass at (51, 149, 39), the middle entry to within the screenshot's
    # rounding, and open sea at the middle entry of `Water, Medium` the same
    # way. Flat ground is what a board here mostly is.
    shades = [list(palette[index]) for index in terrain.colors] if palette else None
    minimap = shades[1] if shades else list(terrain.colors)
    return {
        "terrainId": terrain_id,
        "name": terrain.name,
        "texture": terrain.name_2,
        # Tiles covered by one repeat of the texture, so the view can lay it out
        # at the authored scale instead of guessing a tiling rate.
        "dimensions": [width, height],
        # Which terrain wins where two meet, and which family of blend masks
        # the edge is drawn with: the higher priority is painted over its
        # neighbour. Both are the DAT's own fields.
        "blendPriority": terrain.blend_priority,
        "blendType": terrain.blend_type,
        "minimapColor": minimap,
        # Up-slope, flat, down-slope, for a minimap that shades relief.
        "minimapShades": shades,
        # Which of a water preset's classes the surface takes over it: the
        # DAT's `is_water` is 4 for shallow water, 1 for medium, 2 for deep,
        # 8 for walkable shallows, 16 for beach and 32 for land. Nothing
        # carries the presets' `ocean` class: `Deep Ocean` is 2 like `Deep`.
        "waterClass": WATER_CLASSES.get(terrain.is_water),
        # The irregular mask `TerrainBlend_ps` gates this terrain by where it
        # is drawn over a neighbour (`g_MaskTexture`, sampled at the tile's
        # own uv): a file in `terrain/masks`, or nothing for a terrain that
        # names none.
        "overlayMask": terrain.overlay_mask_name or None,
    }



#: The water presets a board can roll, by `water_def.json` index: 0 is the
#: engine's default (Islands names none), 3 "Calm" and 6 "Dimmed" are what
#: Arabia's `WATER_POND` rolls between (includes/water_preset.inc, 65/35).
WATER_PRESETS = (0, 3, 6)


def shadow_profile(dat_path: Path, hashes: dict[str, str]) -> dict[str, Any]:
    """Default shadow settings read by CombineTerrainSpriteSMP. Per-biome
    colour grading is not yet rendered; preserve the Default profile here."""
    tail = Path("resources/_common/terrain/colorcorrection_json/colorcorrection.json")
    candidates = [depot_root() / "depot_813782" / tail] + [
        parent / "depot_813782" / tail for parent in dat_path.parents
    ]
    for path in candidates:
        if path.is_file():
            hashes["terrain/colorcorrection.json"] = sha256(path)
            profile = next(p for p in json.loads(path.read_text())["correction_types"] if p["name"] == "Default")
            return {"profile": profile["name"], "strength": profile["shadow_strength"], "color": profile["shadow_color"]}
    return {}


def water_presets(dat_path: Path, hashes: dict[str, str]) -> dict[str, Any]:
    """DE renders water through a shader, not a tile: `water_def.json`
    beside the terrain names, per preset, a normal map and its drift, a sky
    dome to reflect, a sea-floor texture and its intensity, the sun and the
    colours. The three presets the shipped maps roll are carried whole;
    the textures are converted by the atlas step."""
    # The DAT depot and the terrain depot are different depots; the water
    # definition lives beside the terrain textures, in 813782.
    tail = Path("resources/_common/terrain/water_json/water_def.json")
    candidates = [depot_root() / "depot_813782" / tail] + [
        parent / "depot_813782" / tail for parent in dat_path.parents
    ]
    for candidate in candidates:
        if candidate.is_file():
            path = candidate
            break
    else:
        return {}
    hashes["terrain/water_def.json"] = sha256(path)
    types = json.loads(path.read_text())["water_types"]
    presets: dict[str, Any] = {}
    for index in WATER_PRESETS:
        entry = types[index]
        normal = entry["water_normals_def"][0]
        presets[str(index)] = {
            "name": entry["water_type_name"],
            # Texture paths as the file spells them, resolved by the atlas step.
            "normal": normal["normalFileName"].replace("\\", "/"),
            "normalVelocity": [normal["velocity_min"], normal["velocity_max"]],
            "normalDirection": [normal["direction_min"], normal["direction_max"]],
            "normalAzimuth": normal["azimuth"],
            "normalScale": normal["scale"],
            "sky": entry["water_sky_texture"].replace("\\", "/"),
            "seaFloor": entry["sea_floor_texture"].replace("\\", "/"),
            "sunDirection": entry["sun_direction"],
            "sunColor": entry["sun_color"],
            "skyColor": entry["sky_color"],
            "waterColor": entry["water_color"],
            "seaFloorIntensity": entry["sea_floor_intensity"],
            "skyIntensity": entry["sky_intensity"],
            "skyRotation": entry["sky_rotation"],
            "skyScale": entry["sky_scale"],
            "specularIntensity": entry["specular_intensity"],
            "specularPower": entry["specular_power"],
            "mapScale": entry["map_scale"],
            "seaFloorScale": entry["sea_floor_scale"],
            "waveAnimationSpeed": entry["wave_animation_speed"],
            "waveRepeatLength": entry["wave_repeat_length"],
            "waveAmplitude": entry["wave_amplitude"],
            # Per water class: how much sky it reflects and how opaque it is
            # over the floor, 0..255.
            "types": {
                kind["name"]: {"reflectivity": kind["reflectivity"], "opacity": kind["opacity"]}
                for kind in entry["water_types_def"]
            },
        }
    return presets


def terrain_restrictions(
    dat: DatFile, rows: set[int], terrain_ids: list[int]
) -> dict[str, list[int]]:
    """For each row of `terrain_restrictions` something imported obeys, the
    shipped terrain ids it may stand on -- the DAT's own passability table,
    cut down to the terrains the board can hold. A nonzero multiplier is
    passable; the multiplier itself (a damage factor) is not modelled."""
    return {
        str(row): [
            terrain_id for terrain_id in terrain_ids
            if dat.terrain_restrictions[row].passable_buildable_dmg_multiplier[terrain_id] != 0
        ]
        for row in sorted(rows)
    }


def ages_of(dat_path: Path, strings: dict[int, str] | None) -> list[dict[str, Any]]:
    """The base era's ages: name (from the string table) and shield material.

    `eras.json` lists each age's `NameId` (4201 "Dark Age" ...) and
    `ShieldMaterialName` (`ShieldDarkAge` ...); the panel's `AgeUp` button
    draws the material `ButtonsShieldDark-AgeNormal`, which is that name
    spelled the way the material table spells it.
    """
    path = dat_path.parent / "eras.json"
    if not path.is_file():
        return []
    base = next((era for era in json.loads(path.read_text()) if era.get("Name") == "base"), None)
    ages: list[dict[str, Any]] = []
    for age in (base or {}).get("Ages", []):
        if "ShieldMaterialName" not in age:
            continue
        entry: dict[str, Any] = {"shield": age["ShieldMaterialName"]}
        if strings and age.get("NameId") in strings:
            entry["name"] = strings[age["NameId"]]
        ages.append(entry)
    return ages


def skin_chances(dat_path: Path, entities: dict[str, Any], hashes: dict[str, str]) -> None:
    """How often a skin is drawn instead of the unit it skins.

    `objreplacement.json` sits beside the DAT and states it per unit: the
    villager (83) is replaced by the female villager (293) with `chance` 50,
    and she by him with the same. Only the base unit has a row -- a trained
    villager is unit 83 -- so the chance lands on the skin of the base unit,
    and the task variants of the same `skin` family follow it in the view.
    """
    path = dat_path.parent / "objreplacement.json"
    if not path.is_file():
        return
    hashes["objreplacement.json"] = sha256(path)
    replaced_by: dict[int, int] = {}
    for row in json.loads(path.read_text()).get("objects", []):
        override = row.get("object_override", {})
        # Only a chance-driven row is a skin; the rest of the file swaps a
        # building for another under a technology or a civilisation attribute.
        if "replacement_object" in override and "chance" in override:
            replaced_by[override["replacement_object"]] = override["chance"]
    for entity in entities.values():
        if "skinOf" in entity and entity["id"] in replaced_by:
            entity["chance"] = replaced_by[entity["id"]]


def extract(
    dat_path: Path,
    graphics_dir: Path,
    palettes_dir: Path,
    spec: dict[str, Any],
    source: dict[str, Any],
    strings_path: Path | None = None,
    uhd_dir: Path | None = None,
) -> dict[str, Any]:
    """Everything the game reads off the owned data, as `content.json`.

    `uhd_dir` is the Enhanced Graphics Pack's graphics directory when that
    depot is downloaded: every animation whose `_x2` twin it holds is then
    sourced from the pack at scale 2 (issue #151).
    """
    dat = DatFile.parse(dat_path)
    graphics = Graphics.of(graphics_dir, uhd_dir)
    hashes: dict[str, str] = {"dat": sha256(dat_path)}
    strings: dict[int, str] | None = None
    if strings_path is not None and strings_path.is_file():
        strings = read_strings(strings_path)
        hashes["strings"] = sha256(strings_path)
    entities: dict[str, Any] = {}
    for entity_spec in spec["entities"]:
        civ_index = spec["gaiaIndex"] if entity_spec.get("civ") == "gaia" else spec["civIndex"]
        entities[entity_spec["key"]] = extract_entity(
            dat, dat.civs[civ_index].units, entity_spec, graphics, hashes, strings
        )
    for effect_spec in spec.get("effects", []):
        entities[effect_spec["key"]] = effect_entry(dat, graphics, effect_spec, hashes)
    # The particle definitions the buildings' fires name, from the directory
    # beside the DAT's.
    flame_names = {
        flame["effect"]
        for entity in entities.values()
        for stages in entity.get("damageStages", {}).values()
        for stage in stages
        for flame in stage["flames"]
    }
    particles = particle_effects(dat_path.parent.parent / "particles", flame_names, hashes)
    skin_chances(dat_path, entities, hashes)
    civilization = civilization_entry(dat, dat_path, spec, hashes, strings)
    technologies, skipped_technologies = technologies_from_tree(
        dat, dat_path, spec, entities, civilization, hashes, strings
    )
    palette_path = palettes_dir / "original.pal"
    palette = read_jasc_pal(palette_path) if palette_path.is_file() else None
    # An animation drawn through one of the engine's alpha palettes: the
    # underwater school of a fish takes `n_alpha_underwater.palx`, whose
    # `$ALPHA` header (86 of 255) is how far under the surface it reads.
    # Which graphics take it is the engine's convention for its "(Underwater)"
    # deltas, so the spec names the palette on the animation.
    for entity_spec in spec["entities"]:
        for name, animation in entity_spec["animations"].items():
            if "alphaPalette" not in animation:
                continue
            palx = palettes_dir / animation["alphaPalette"]
            hashes[f"palettes/{palx.name}"] = sha256(palx)
            entities[entity_spec["key"]]["animations"][name]["alpha"] = palx_alpha(palx)
    # A gaia object's own minimap dot, where the DAT gives one: gold (255,
    # 199, 0), stone (145, 145, 145), the huntables, herdables, fish and
    # bushes (165, 196, 108), the relic white -- each a palette index, and
    # what DE's own minimap draws them in. Trees are 0, black, and DE draws
    # them anyway, so the minimap keeps its own wood.
    if palette:
        for entity_spec in spec["entities"]:
            civ_index = spec["gaiaIndex"] if entity_spec.get("civ") == "gaia" else spec["civIndex"]
            unit = dat.civs[civ_index].units[entity_spec["unitId"]]
            if unit is not None and unit.minimap_color:
                entities[entity_spec["key"]]["minimapColor"] = list(palette[unit.minimap_color % 256])
    terrain = {
        key: terrain_entry(dat, slot["terrainId"], palette)
        for key, slot in spec.get("terrain", {}).items()
    }
    return {
        "terrain": terrain,
        "water": water_presets(dat_path, hashes),
        "shadows": shadow_profile(dat_path, hashes),
        # The shore foam's frames (`WaveAnim_ps`): four sequences of 128
        # frames, each over two 8x8 atlases of 256 px in `terrain/water`;
        # `diag` for a shore along a tile edge, `ortho` for one stepped
        # across the screen's axes, each with a mirrored variant (#89).
        "foam": {
            "diag": [f"water/atlas_v1_diag_{i}.png" for i in (1, 2, 3, 4)],
            "ortho": [f"water/atlas_v1_ortho_{i}.png" for i in (1, 2, 3, 4)],
            "frameSize": 256, "framesPerRow": 8,
        },
        "terrainRestrictions": terrain_restrictions(
            dat,
            {entity["terrainRestriction"] for entity in entities.values() if "terrainRestriction" in entity},
            [slot["terrainId"] for slot in spec.get("terrain", {}).values()],
        ),
        # The ages, from `eras.json` beside the DAT: each names its string and
        # the shield the resource panel's `AgeUp` button shows for it.
        "ages": ages_of(dat_path, strings),
        "audio": spec.get("audio", {}),
        "civilization": civilization,
        # Where a player-level attribute starts, from the civ's own resource
        # table. A farm's food has always been 175 here and was hand-written;
        # it is resource 36, and the DAT has been stating it all along.
        "playerAttributes": {
            name: rounded(dat.civs[spec["civIndex"]].resources[resource_id])
            for resource_id, name in sorted(RESOURCE_ATTRIBUTES.items())
        },
        "technologies": technologies,
        "particles": particles,
        # The reference's own words for a refused order (issue #70): the
        # strings file's 3001-3005, shown when a button is pressed that the
        # bank or the housing cannot meet -- the reference lets the click
        # through and says why rather than greying the button.
        "strings": {
            name: strings[string_id]
            for name, string_id in (
                ("notEnoughFood", 3001), ("notEnoughWood", 3002), ("notEnoughStone", 3003),
                ("notEnoughGold", 3004), ("needMoreHouses", 3005),
                ("creating", 4310), ("stopCreating", 42105),
                # Map setup labels and the three shipped random-map names (#144).
                ("mapType", 9691), ("mapSeed", 10658), ("startGame", 9472),
                ("gameSettings", 9682), ("randomSeed", 10107),
                ("mapArabia", 10875), ("mapBlackForest", 10878), ("mapIslands", 10885),
            )
            if strings is not None and string_id in strings
        },
        # What the civilisation's tree offers that this game cannot represent,
        # and why. Recorded rather than dropped, so the gap is visible.
        "skippedTechnologies": skipped_technologies,
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
    parser.add_argument("--uhd-graphics", type=Path, default=None,
                        help="the Enhanced Graphics Pack's graphics directory, preferred when given")
    parser.add_argument("--palettes", type=Path, default=content / "resources/_common/palettes")
    parser.add_argument("--strings", type=Path,
                        default=content / "resources/en/strings/key-value/key-value-strings-utf8.txt")
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
        args.strings,
        uhd_dir=args.uhd_graphics,
    )
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
    print(args.out)


if __name__ == "__main__":
    main()
