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
            entry["texture"] = convert_texture(widgetui, relative, out_root)
    return entry


def extract_ui(
    widgetui: Path,
    sounds_path: Path,
    spec: dict[str, Any],
    content: dict[str, Any],
    out_root: Path,
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
    used_sounds: set[str] = set()
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
        "Units": sorted(
            {
                e["iconId"]
                for e in content["entities"].values()
                if e["category"] in ("unit", "unit-variant") and "iconId" in e
            }
        ),
    }
    for category, mode in ui_spec["iconCategories"].items():
        table = icons[category]
        wanted = (
            [f"{index:03d}" for index in entity_icons[category]] if mode == "entities" else sorted(table)
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

    return {
        "schemaVersion": spec["schemaVersion"],
        "style": style,
        "rawTextures": raw_textures,
        "layouts": layouts,
        "materials": resolved_materials,
        "missingMaterials": missing,
        "icons": icon_entries,
        "sounds": {alias: sounds[alias] for alias in sorted(used_sounds) if alias in sounds},
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
    )
    args.out.mkdir(parents=True, exist_ok=True)
    manifest_path = args.out / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, separators=(",", ":"), sort_keys=True) + "\n")
    print(manifest_path)


if __name__ == "__main__":
    main()
