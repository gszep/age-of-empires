#!/usr/bin/env python3
"""Extract the minimal WEST widget-UI set from a locally owned AoE2DE install.

Panel geometry, material references, fonts, click sounds, and icon mappings are
read from the shipped ``widgetui`` JSON; referenced textures are converted
locally (DDS through Pillow, PNG copied byte-identically).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import struct
from pathlib import Path
from typing import Any

from PIL import Image
from import_feedback import extract_feedback

WIDGET_KEYS = (
    "Type",
    "Name",
    "ViewPort",
    # An Anchor widget carries its geometry here instead of in a ViewPort, and
    # it is the only thing that says where a group of children starts: the
    # command grid's five-by-three block of buttons hangs off one, and their
    # own ViewPorts are relative to it (issue #35).
    "Anchor",
    "ZPlane",
    "ZPlaneLocalOffset",
    "Text",
    "TextAnchor",
    "Help",
    "TabOrder",
    "ClickSound",
    "Hidden",
    "Clipped",
    "Box",
    "TextBox",
    "HotKey",
)
CIV_STYLE = re.compile(
    r"^Civ(Asia|West|East|Afri|Ande|Greek|Macedonian|Medi|Meso|Nomad|Orie|Persian|Puru|Seas|Slav|Thracian)"
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_material_index(widgetui: Path) -> tuple[dict[str, Any], dict[str, str]]:
    data = json.loads((widgetui / "materials.json").read_text())
    materials = {d["MaterialDef"]["Name"]: d["MaterialDef"] for d in data["Materials"]}
    textures: dict[str, str] = {}
    for atlas in data["AtlasTextures"]:
        for texture in atlas["AtlasDef"]["Textures"]:
            textures[texture["RefName"]] = texture["FileName"]
    for entry in data["GlobalTextures"]:
        definition = entry["TextureDef"]
        textures[definition["Name"]] = definition["FileName"]
    return materials, textures


def strip_widget(node: dict[str, Any], used_materials: set[str], used_sounds: set[str]) -> dict[str, Any]:
    widget = node["Widget"] if "Widget" in node else node
    result: dict[str, Any] = {}
    for key in WIDGET_KEYS:
        if key in widget:
            result[key] = widget[key]
    if "ClickSound" in widget:
        used_sounds.add(widget["ClickSound"].lstrip("?"))
    states = widget.get("StateMaterials")
    if states:
        kept: dict[str, Any] = {}
        for state, value in states.items():
            if not isinstance(value, dict):
                continue
            entry: dict[str, Any] = {}
            if "Material" in value:
                entry["Material"] = value["Material"]
                used_materials.add(value["Material"])
            if "Font" in value:
                entry["Font"] = value["Font"]
            if "Color" in value:
                entry["Color"] = value["Color"]
            if entry:
                kept[state] = entry
        if kept:
            result["StateMaterials"] = kept
    children = widget.get("ChildWidgets")
    if children:
        result["ChildWidgets"] = [strip_widget(child, used_materials, used_sounds) for child in children]
    return result


def resolve_texture(widgetui: Path, relative: str) -> Path:
    exact = widgetui / relative
    if exact.exists():
        return exact
    # materials.json references extensions case-insensitively (fine on the
    # shipped Windows/NTFS install); some depot files are actually .DDS.
    if exact.parent.is_dir():
        for candidate in exact.parent.iterdir():
            if candidate.name.lower() == exact.name.lower():
                return candidate
    return exact


def convert_texture(widgetui: Path, relative: str, out_root: Path) -> str:
    source = resolve_texture(widgetui, relative)
    target_relative = relative
    if source.suffix.lower() == ".dds":
        target_relative = str(Path(relative).with_suffix(".png"))
    target = out_root / target_relative
    target.parent.mkdir(parents=True, exist_ok=True)
    if source.suffix.lower() == ".dds":
        with Image.open(source) as image:
            image.convert("RGBA").save(target, optimize=True)
    else:
        shutil.copyfile(source, target)
    return target_relative


# The blend the icon materials declare, and what their alpha then means.
PLAYER_COLOR_BLEND = "AlphaPlayerColor"


def convert_player_color_texture(widgetui: Path, relative: str, out_root: Path) -> tuple[str, str]:
    """Split a player-coloured icon into its picture and its colour weight.

    An `AlphaPlayerColor` texture is opaque everywhere but the owner's cloth,
    where the alpha is how much of the icon's own colour stays and the RGB is
    the shading the owner's colour takes (issue #77). A browser cannot be
    trusted to hand that back: a canvas premultiplies, so an alpha-0 pixel
    loses its shading the moment it is drawn, and as a plain image the cloth
    is a hole. So the picture ships opaque, and the weight ships beside it as
    a grey mask -- white where the owner's colour is all of the pixel.
    """
    source = resolve_texture(widgetui, relative)
    stem = Path(relative).with_suffix("")
    picture_relative = f"{stem}.png"
    mask_relative = f"{stem}-playercolor.png"
    (out_root / picture_relative).parent.mkdir(parents=True, exist_ok=True)
    with Image.open(source) as image:
        rgba = image.convert("RGBA")
        alpha = rgba.getchannel("A")
        rgba.putalpha(255)
        rgba.save(out_root / picture_relative, optimize=True)
        alpha.point(lambda value: 255 - value).save(out_root / mask_relative, optimize=True)
    return picture_relative, mask_relative


def material_entry(
    name: str,
    materials: dict[str, Any],
    textures: dict[str, str],
    widgetui: Path,
    out_root: Path,
    hashes: dict[str, str],
) -> dict[str, Any]:
    definition = materials[name]
    entry: dict[str, Any] = {"type": definition["Type"], "blend": definition.get("Blend")}
    if "Color" in definition:
        entry["color"] = definition["Color"]
    reference = definition.get("TextureRef")
    if reference:
        relative = textures.get(reference)
        if relative is None:
            # The shipped materials.json contains a few dangling refs; keep the
            # material and record the gap instead of inventing a texture.
            entry["unresolvedTexture"] = reference
        else:
            hashes[relative] = sha256(resolve_texture(widgetui, relative))
            if definition.get("Blend") == PLAYER_COLOR_BLEND and relative.lower().endswith(".dds"):
                entry["texture"], entry["playerColorMask"] = convert_player_color_texture(
                    widgetui, relative, out_root
                )
            else:
                entry["texture"] = convert_texture(widgetui, relative, out_root)
    return entry


#: Which of the reference's four shipped layouts we take our keys from. The
#: others are the classic, high-definition and left-handed arrangements.
HOTKEY_LAYOUT = "definitive"


def extract_hotkeys(hotkeys_path: Path, wanted: dict[str, Any]) -> dict[str, Any]:
    """The keys the reference binds, for the actions this interface offers.

    `hotkeys.json` holds 457 bindings over 27 groups, each with the key and
    modifiers for four shipped layouts. Only the handful named in the spec are
    consumed; the rest are groups for units, buildings and campaigns this game
    does not have. Taking them from the file rather than typing the letters is
    what keeps "Ctrl+Shift+B selects your barracks" true of the reference
    rather than true of whoever typed it.
    """
    data = json.loads(hotkeys_path.read_text())
    by_name: dict[str, Any] = {}
    for group in data.get("hotkey_group_list", []):
        for binding in group.get("hotkey_list", []) or []:
            if "data_name" in binding and "defaults_list" in binding:
                by_name.setdefault(binding["data_name"], binding)

    def resolve(data_name: str) -> dict[str, Any]:
        binding = by_name.get(data_name)
        if binding is None:
            raise ValueError(f"no hotkey named {data_name} in the owned file")
        defaults = binding["defaults_list"]
        chosen = next(
            (d for d in defaults if d.get("name") == HOTKEY_LAYOUT), defaults[0])
        key = (chosen.get("key") or "").removeprefix("VK_")
        if not key:
            raise ValueError(f"{data_name} has no key in the {HOTKEY_LAYOUT} layout")
        entry: dict[str, Any] = {"key": key}
        for modifier in ("control", "shift", "alt"):
            if chosen.get(modifier):
                entry[modifier] = True
        return entry

    return {
        action: {name: resolve(data_name) for name, data_name in mapping.items()}
        for action, mapping in wanted.items()
    }


def extract_hotkey_profiles(path: Path, wanted: dict, content: dict) -> dict:
    """Preserve explicit unbound entries; do not borrow a different profile's key."""
    data = json.loads(path.read_text())
    groups = [*data.get('shared_hotkey_group_list', []), *data['hotkey_group_list']]
    bindings = [binding for group in groups for binding in group.get('hotkey_list', []) or []]
    layouts = list(dict.fromkeys(default['name'] for binding in bindings for default in binding.get('defaults_list', [])))
    profiles = {}
    for layout in layouts:
        names, strings, actions = {}, {}, {}
        for binding in bindings:
            if 'data_name' not in binding:
                continue
            chosen = next((d for d in binding.get('defaults_list', []) if d['name'] == layout), None)
            key = None
            if chosen and chosen.get('key'):
                key = {'key': chosen['key'].removeprefix('VK_')}
                for modifier in ('control', 'shift', 'alt'):
                    if chosen.get(modifier) or (modifier == 'alt' and chosen.get('alternate')):
                        key[modifier] = True
            names[binding['data_name']] = key
            for identifier in binding.get('string_index_list', []):
                strings[identifier] = key
            for identifier in binding.get('button_action_list', []):
                actions[str(identifier)] = key
        commands = {}
        for prefix, profile in [('', content), *((f'civilizations/{key}/', profile)
                for key, profile in sorted(content.get('civilizations', {}).items()))]:
            for key, entity in profile['entities'].items():
                identifier = entity.get('hotkeyTextId')
                if identifier in strings:
                    verb = 'build' if entity['category'] == 'building' else 'train'
                    commands[f'{prefix}{verb}-{key}'] = strings[identifier]
                for index, location in enumerate(entity.get('trainLocations', [])):
                    if index > 0 and location.get('hotkeyTextId') in strings:
                        commands[f'{prefix}train-{key}@{index}'] = strings[location['hotkeyTextId']]
            for key, technology in profile.get('technologies', {}).items():
                identifier = technology.get('hotkeyTextId')
                if identifier in strings:
                    commands[f'{prefix}research-{key}'] = strings[identifier]
        profiles[layout] = {**{action: {name: names.get(data_name) for name, data_name in mapping.items()}
                              for action, mapping in wanted.items()},
                            'commands': commands, 'names': names, 'actions': actions}
    return profiles


def extract_techtrees(techs_dir: Path, content: dict[str, Any], strings: dict | None = None,
                      hashes: dict | None = None, aliases: dict | None = None) -> dict[str, dict[str, Any]]:
    """Keep the native typed IDs: Building ID is the column, NOT the unit ID.

    ResearchedCompleted is static roster metadata, not a player's history.
    Include the root profile as well as enabled imported profiles; fail loudly
    on a broken owned source rather than publishing an incomplete tree.
    """
    from import_content import HELP_STRING_OFFSET
    strings = strings or {}
    result = {}
    profiles = [content, *content.get("civilizations", {}).values()]
    for profile in sorted(profiles, key=lambda p: p.get("civilization", {}).get("key", "")):
        civ = profile.get("civilization", {})
        if not civ.get("treeFile") or civ.get("enabled") is False:
            continue
        path = techs_dir / civ["treeFile"]
        data = json.loads(path.read_text())
        if hashes is not None:
            hashes[f"CivTechTrees/{path.name}"] = sha256(path)
        nodes = []
        for node in data["civ_techs_buildings"] + data["civ_techs_units"]:
            entry = {key: node[source] for key, source in {
                "nodeId": "Node ID", "buildingId": "Building ID", "ageId": "Age ID",
                "nodeStatus": "Node Status", "useType": "Use Type",
                "iconId": "Picture Index", "nameStringId": "Name String ID",
                "helpStringId": "Help String ID",
            }.items()}
            # Some shipped Elite Cannon Galleon rows omit Node Type. Preserve
            # the omission; Use Type still identifies the numeric namespace.
            for key, source in {"nodeType": "Node Type", "linkId": "Link ID", "linkType": "Link Node Type",
                                "newColumn": "Building in new column", "upgradedFromId": "Building upgraded from ID",
                                "triggerTechId": "Trigger Tech ID"}.items():
                if source in node:
                    entry[key] = node[source]
            entry["prerequisites"] = [
                {"id": pid, "type": kind}
                for pid, kind in zip(node.get("Prerequisite IDs", []), node.get("Prerequisite Types", []))
                if kind != "None"
            ]
            entry["name"] = strings.get(node["Name String ID"], node["Name"])
            entry["help"] = strings.get(node["Help String ID"] - HELP_STRING_OFFSET, "")
            # Reviewed roster aliases and reciprocal construction heads are
            # identities already used by the content importer, not name matches.
            if node["Use Type"] == "Unit" and node["Node ID"] in (aliases or {}):
                entry["simId"] = aliases[node["Node ID"]]
            if node["Use Type"] == "Building":
                entity = next((e for e in profile.get("entities", {}).values()
                               if e.get("build", {}).get("sourceId") == node["Node ID"]), None)
                if entity:
                    entry["simId"] = entity["id"]
            nodes.append(entry)
        result[civ["key"]] = {"civId": data["civ_id"], "nodes": nodes}
    return result


def compact_techtrees(trees: dict) -> dict:
    """Publish localization once across civs, retaining native string IDs."""
    strings, result = {}, {}
    for civ, tree in trees.items():
        nodes = []
        for source in tree["nodes"]:
            node = dict(source)
            for field in ("name", "help"):
                identifier, text = str(node[field + "StringId"]), node.pop(field)
                if identifier in strings and strings[identifier] != text:
                    raise ValueError(f"conflicting tech tree localization for {identifier}")
                strings[identifier] = text
            nodes.append(node)
        result[civ] = {**tree, "nodes": nodes}
    return {"techTrees": result, "techTreeStrings": strings}


def import_cursors(directory: Path, names: list[str], out_root: Path, hashes: dict[str, str]) -> dict[str, Any]:
    """Copy native CUR bytes and read their actual dimensions/hotspot.

    The owned flag32x32.cur is 48x48, so filenames are not size metadata.
    These consumed files have one CUR directory entry (ICONDIR + ICONDIRENTRY).
    """
    result = {}
    for name in sorted(names):
        source = directory / f"{name}32x32.cur"
        data = source.read_bytes()
        if len(data) < 22 or struct.unpack_from("<HHH", data) != (0, 2, 1):
            raise ValueError(f"{source.name}: expected a single-image CUR")
        width, height, _, _, x, y, size, offset = struct.unpack_from("<BBBBHHII", data, 6)
        width, height = width or 256, height or 256
        if not (x < width and y < height and offset >= 22 and offset + size <= len(data)):
            raise ValueError(f"{source.name}: invalid CUR directory bounds/hotspot")
        relative = f"cursors/{source.name}"
        target = out_root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        hashes[relative] = sha256(source)
        result[name] = {"image": relative, "size": [width, height], "hotspot": [x, y]}
    return result


def extract_ui(
    widgetui: Path,
    sounds_path: Path,
    spec: dict[str, Any],
    content: dict[str, Any],
    out_root: Path,
    hotkeys_path: Path | None = None,
    fonts_dir: Path | None = None,
    cursors_dir: Path | None = None,
    techs_dir: Path | None = None,
) -> dict[str, Any]:
    ui_spec = spec["ui"]
    # Derive from the pipeline's resolved DAT directory, not a second hardcoded depot.
    techs_dir = techs_dir or sounds_path.parent / "CivTechTrees"
    declared_trees = any(p.get("civilization", {}).get("treeFile")
                         and p["civilization"].get("enabled") is not False
                         for p in [content, *content.get("civilizations", {}).values()])
    if declared_trees and not techs_dir.is_dir():
        raise FileNotFoundError(f"shipped civilizations require CivTechTrees directory: {techs_dir}")
    tech_trees, tree_layout = {}, None
    tree_hashes = {}
    if techs_dir.is_dir():
        from import_content import read_strings
        strings_path = sounds_path.parents[2] / "en/strings/key-value/key-value-strings-utf8.txt"
        strings = read_strings(strings_path)
        references_path = widgetui / "stringreference.json"
        references = json.loads(references_path.read_text())
        tree_hashes[references_path.name] = sha256(references_path)
        tree_hashes["techTreeStrings"] = sha256(strings_path)
        aliases = {alias: e["unitId"] for e in spec["entities"] + spec.get("combatRoster", [])
                   for alias in e.get("rosterAliases", [])}
        tech_trees = extract_techtrees(techs_dir, content, strings, tree_hashes, aliases)
        screen_path = widgetui / "screentechtree.json"
        screen = json.loads(screen_path.read_text())["Collection"]
        def widgets(rows):
            for row in rows:
                w = row["Widget"]
                yield w
                yield from widgets(w.get("ChildWidgets", []))
        boxes = {w["Name"]: w for w in widgets(screen["Widgets"])}
        eras_path = techs_dir.parent / "eras.json"
        ages = next(e["Ages"] for e in json.loads(eras_path.read_text()) if e["Name"] == "base")
        tree_layout = {"width": screen["ViewPort"]["width"], "height": screen["ViewPort"]["height"],
                       "ageWidth": boxes["Age1Icon"]["ViewPort"]["width"],
                       "ages": [{"name": strings[a["NameId"]],
                                 "height": boxes[f"Age{i+1}Icon"]["ViewPort"]["height"]}
                                for i, a in enumerate(ages[:4])],
                       "title": strings[references["IDS_MPS_TECHTREE_INFO"]],
                       "close": strings[references["IDS_BACK"]]}
        tree_hashes[screen_path.name] = sha256(screen_path)
        tree_hashes[eras_path.name] = sha256(eras_path)
    from civilization_profiles import art_entities
    profiles = [content, *content.get("civilizations", {}).values()]
    hotkey_profiles = extract_hotkey_profiles(hotkeys_path, ui_spec.get('hotkeys', {}), content) if hotkeys_path else {}
    content = {**content, "entities": art_entities(content), "technologies": {
        f"{index}/{key}": tech for index, profile in enumerate(profiles)
        for key, tech in profile.get("technologies", {}).items()
    }}
    style = ui_spec["style"]
    materials, textures = load_material_index(widgetui)
    icons = json.loads((widgetui / "icons.json").read_text())
    sounds = {
        entry["key"]: entry["name"]
        for entry in json.loads(sounds_path.read_text())["sound_list"]
    }
    hashes = {
        **tree_hashes,
        "materials.json": sha256(widgetui / "materials.json"),
        "icons.json": sha256(widgetui / "icons.json"),
        "sounds.json": sha256(sounds_path),
    }
    buttons_path = sounds_path.with_name('buttons.json')
    hashes['buttons.json'] = sha256(buttons_path)
    command_buttons = {
        str(entry['button_action_id']): {
            'name': entry['name'], 'slot': entry['sequence_id'] + 1,
            'iconId': entry['icon_id'], 'helpId': entry.get('help_string_id'),
            'moreHelpId': entry.get('more_help_string_id'),
        } for entry in json.loads(buttons_path.read_text())['command_button_list']
    }

    used_materials: set[str] = set()
    # Cues the game plays for itself rather than for a widget click: alerts and
    # feedback the view raises from what it observes. `sounds.json` names them,
    # so the spec only has to list which ones the slice consumes.
    used_sounds: set[str] = set(spec.get("ui", {}).get("cues", []))
    layouts: dict[str, Any] = {}
    for panel in ui_spec["panels"]:
        panel_path = widgetui / f"{panel}.json"
        hashes[panel_path.name] = sha256(panel_path)
        document = json.loads(panel_path.read_text())
        collection = document["Collection"]
        layouts[panel] = {
            "name": collection.get("Name"),
            "viewPort": collection.get("ViewPort"),
            "widgets": [
                strip_widget(widget, used_materials, used_sounds)
                for widget in collection.get("Widgets", [])
            ],
        }

    # Referenced civ-styled materials also pull the configured style variant.
    for name in sorted(used_materials):
        match = CIV_STYLE.match(name)
        if match and match.group(1) != style:
            variant = f"Civ{style}{name[match.end():]}"
            if variant in materials:
                used_materials.add(variant)

    icon_entries: dict[str, dict[str, str]] = {}
    entity_icons = {
        "Buildings": sorted(
            {e["iconId"] for e in content["entities"].values() if e["category"] == "building" and "iconId" in e}
        ),
        # Animals are units the player selects — a sheep walked home, a carcass
        # clicked to read the food left on it — so their portraits belong in the
        # same sheet as everything else the selection panel shows.
        "Units": sorted(
            {
                e["iconId"]
                for e in content["entities"].values()
                if e["category"] in ("unit", "unit-variant", "animal") and "iconId" in e
            }
        ),
        # Research buttons were the only ones without art. Each technology
        # carries its own `icon_id`, and the widgetui sheet is `Techs`.
        "Techs": sorted(
            {t["iconId"] for t in content["technologies"].values() if "iconId" in t}
        ),
    }
    for category, mode in ui_spec["iconCategories"].items():
        table = icons[category]
        wanted = (
            [f"{index:03d}" for index in entity_icons[category]]
            if mode in ("entities", "technologies") else sorted(table)
        )
        selected: dict[str, str] = {}
        for index in wanted:
            material = table[index]
            if material and material != "None":
                selected[index] = material
                used_materials.add(material)
        icon_entries[category] = selected
    for prefix in ui_spec.get("materialPrefixes", []):
        for name in materials:
            if name.startswith(prefix):
                used_materials.add(name)
    # Materials the widget files reach only through the executable: the
    # `CivEmblem` widget names a material the engine substitutes per
    # civilisation (`CivEmblemBritons`), and the shield beside the menu is an
    # `InGameCivEmblem` icon. Named in the spec, for the civilisation imported.
    for name in ui_spec.get("materials", []):
        used_materials.add(name)
    for entry in content.get("civilizationCatalog", {}).values():
        for name in (f"CivEmblem{entry['internalName']}", f"{entry['internalName']}Icon"):
            used_materials.add(name)
    for profile in profiles:
        family = profile.get("civilization", {}).get("hudStyle")
        if family:
            for name in list(used_materials):
                match = CIV_STYLE.match(name)
                if match:
                    variant = family + name[match.end():]
                    if variant in materials:
                        used_materials.add(variant)

    resolved_materials: dict[str, Any] = {}
    missing: list[str] = []
    for name in sorted(used_materials):
        if name == "None":
            continue
        if name in materials:
            resolved_materials[name] = material_entry(name, materials, textures, widgetui, out_root, hashes)
        elif name in textures:
            # icons.json may name a texture directly instead of a material
            relative = textures[name]
            hashes[relative] = sha256(resolve_texture(widgetui, relative))
            resolved_materials[name] = {
                "type": "Texture",
                "blend": None,
                "texture": convert_texture(widgetui, relative, out_root),
            }
        else:
            missing.append(name)

    # Whole texture directories whose name mapping lives only in the
    # executable (for example stat icons); import the files as-is.
    raw_textures: dict[str, list[str]] = {}
    for directory in ui_spec.get("textureDirectories", []):
        entries = []
        for path in sorted((widgetui / directory).iterdir()):
            if path.is_file():
                relative = str(Path(directory) / path.name)
                hashes[relative] = sha256(path)
                entries.append(convert_texture(widgetui, relative, out_root))
        raw_textures[directory] = entries

    # The faces the HUD's labels are set in, copied as they ship (issue #69).
    # The widget files index a font (0 on nearly every label, 2 and 3 on a
    # handful) and ship the faces in `fonts/`; nothing in the files names
    # which index is which face, so the spec names the faces to carry and
    # the HUD's choice among them is recorded in `docs/ledger.md`. A name
    # with a path reaches beside `fonts/`: the in-game glyph atlas
    # (`combined.txt`) has Georgia's letters and lining digits Georgia has
    # not, and the shipped face whose digits measure as the atlas's is the
    # menus' Palatino Linotype under `wpfg/fonts`.
    fonts: dict[str, str] = {}
    if fonts_dir is not None:
        for name in ui_spec.get("fonts", []):
            source = (fonts_dir / name).resolve()
            if not source.is_file():
                continue
            hashes[f"fonts/{source.name}"] = sha256(source)
            target = out_root / "fonts" / source.name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(source.read_bytes())
            fonts[source.name] = f"fonts/{source.name}"

    # The reference's own UI colours: per player colour, the tint its text
    # and health bars use (`UIColors.json`), which is lighter than the
    # palette block the sprites wear.
    colors: dict[str, Any] = {}
    colors_path = widgetui / "UIColors.json"
    if colors_path.is_file():
        hashes["UIColors.json"] = sha256(colors_path)
        colors = json.loads(colors_path.read_text())

    color_palettes = {}
    for name in ("deuteranopia", "protanopia", "tritanopia"):
        path = widgetui / f"uicolors_{name}.json"
        hashes[path.name] = sha256(path)
        color_palettes[name] = json.loads(path.read_text())
    tags_path = sounds_path.parent / "UiColors.txt"
    hashes["UiColors.txt"] = sha256(tags_path)
    color_tags = {}
    for line in tags_path.read_text().splitlines():
        fields = line.split("//", 1)[0].split()
        if fields:
            name, *rgba = fields
            color_tags[name] = [int(value) for value in rgba]

    return {
        "schemaVersion": spec["schemaVersion"],
        "commandButtons": command_buttons,
        "hotkeyProfiles": hotkey_profiles,
        "style": style,
        "fonts": fonts,
        "colors": colors,
        "colorPalettes": color_palettes,
        "colorTags": color_tags,
        "nativeFeedback": extract_feedback(sounds_path.parent.parent / "wpfg", out_root, hashes),
        "cursors": import_cursors(cursors_dir or sounds_path.parent.parent / "cursors",
                                  ui_spec.get("cursors", []), out_root, hashes),
        "rawTextures": raw_textures,
        "layouts": layouts,
        "materials": resolved_materials,
        "missingMaterials": missing,
        "icons": icon_entries,
        "sounds": {alias: sounds[alias] for alias in sorted(used_sounds) if alias in sounds},
        "missingCues": sorted(alias for alias in spec.get("ui", {}).get("cues", []) if alias not in sounds),
        "hotkeys": extract_hotkeys(hotkeys_path, ui_spec["hotkeys"])
        if hotkeys_path and ui_spec.get("hotkeys") else {},
        **compact_techtrees(tech_trees),
        "techTreeLayout": tree_layout,
        "source": {"sha256": hashes},
    }


def main() -> None:
    home = Path.home()
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--widgetui",
        type=Path,
        default=home / "Steam/steamapps/content/app_813780/depot_813782/widgetui",
    )
    parser.add_argument(
        "--sounds",
        type=Path,
        default=home / "Steam/steamapps/content/app_813780/depot_813781/resources/_common/dat/sounds.json",
    )
    parser.add_argument(
        "--hotkeys",
        type=Path,
        default=home / "Steam/steamapps/content/app_813780/depot_813781/resources/_common/dat/hotkeys.json",
    )
    parser.add_argument(
        "--fonts",
        type=Path,
        default=home / "Steam/steamapps/content/app_813780/depot_813781/resources/_common/fonts",
    )
    parser.add_argument("--spec", type=Path, default=Path(__file__).with_name("import-spec.json"))
    parser.add_argument("--cursors", type=Path, help="owned native CUR directory (defaults beside dat)")
    parser.add_argument("--techs", type=Path, help="owned CivTechTrees directory (defaults beside sounds)")
    parser.add_argument("--content", type=Path, default=root / ".local/aoe2de/content.json")
    parser.add_argument("--out", type=Path, default=root / "public/imported/aoe2/ui")
    args = parser.parse_args()

    manifest = extract_ui(
        args.widgetui,
        args.sounds,
        json.loads(args.spec.read_text()),
        json.loads(args.content.read_text()),
        args.out,
        args.hotkeys if args.hotkeys.is_file() else None,
        args.fonts if args.fonts.is_dir() else None,
        args.cursors,
        args.techs,
    )
    args.out.mkdir(parents=True, exist_ok=True)
    manifest_path = args.out / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, separators=(",", ":"), sort_keys=True) + "\n")
    print(manifest_path)


if __name__ == "__main__":
    main()
