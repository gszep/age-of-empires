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
from pathlib import Path
from typing import Any

from PIL import Image

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


def extract_ui(
    widgetui: Path,
    sounds_path: Path,
    spec: dict[str, Any],
    content: dict[str, Any],
    out_root: Path,
    hotkeys_path: Path | None = None,
    fonts_dir: Path | None = None,
) -> dict[str, Any]:
    ui_spec = spec["ui"]
    style = ui_spec["style"]
    materials, textures = load_material_index(widgetui)
    icons = json.loads((widgetui / "icons.json").read_text())
    sounds = {
        entry["key"]: entry["name"]
        for entry in json.loads(sounds_path.read_text())["sound_list"]
    }
    hashes = {
        "materials.json": sha256(widgetui / "materials.json"),
        "icons.json": sha256(widgetui / "icons.json"),
        "sounds.json": sha256(sounds_path),
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
    # the HUD's choice among them is recorded in `docs/status.md`.
    fonts: dict[str, str] = {}
    if fonts_dir is not None:
        for name in ui_spec.get("fonts", []):
            source = fonts_dir / name
            if not source.is_file():
                continue
            hashes[f"fonts/{name}"] = sha256(source)
            target = out_root / "fonts" / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(source.read_bytes())
            fonts[name] = f"fonts/{name}"

    # The reference's own UI colours: per player colour, the tint its text
    # and health bars use (`UIColors.json`), which is lighter than the
    # palette block the sprites wear.
    colors: dict[str, Any] = {}
    colors_path = widgetui / "UIColors.json"
    if colors_path.is_file():
        hashes["UIColors.json"] = sha256(colors_path)
        colors = json.loads(colors_path.read_text())

    return {
        "schemaVersion": spec["schemaVersion"],
        "style": style,
        "fonts": fonts,
        "colors": colors,
        "rawTextures": raw_textures,
        "layouts": layouts,
        "materials": resolved_materials,
        "missingMaterials": missing,
        "icons": icon_entries,
        "sounds": {alias: sounds[alias] for alias in sorted(used_sounds) if alias in sounds},
        "missingCues": sorted(alias for alias in spec.get("ui", {}).get("cues", []) if alias not in sounds),
        "hotkeys": extract_hotkeys(hotkeys_path, ui_spec["hotkeys"])
        if hotkeys_path and ui_spec.get("hotkeys") else {},
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
    )
    args.out.mkdir(parents=True, exist_ok=True)
    manifest_path = args.out / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, separators=(",", ":"), sort_keys=True) + "\n")
    print(manifest_path)


if __name__ == "__main__":
    main()
