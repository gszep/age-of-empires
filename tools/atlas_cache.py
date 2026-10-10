"""Layer-dependent invalidation and namespace-independent reuse; no decoding here."""
from __future__ import annotations

import ast
import hashlib
import shutil
from pathlib import Path

LAYERS = ("main", "playercolor", "shadow", "outline", "damage")
# Unclassified code is deliberately common: adding a helper cannot silently
# escape invalidation. Container/geometry/packing constants remain common.
SPECIALIZED = {
    "convert_particles": set(),  # Particle conversion does not affect sprite atlas layers.
    "_rgb565": {"main", "playercolor"},
    "_bc1_lookup": {"main", "playercolor"},
    "_decode_bc1_block": {"main", "playercolor"},
    "decode_colors": {"main", "playercolor"},
    "ColorFrame": {"main", "playercolor"},
    "pack_color_atlas": {"main"},
    "luminance": {"playercolor"},
    "pack_playercolor_atlas": {"playercolor"},
    "_bc4_lookup": {"shadow", "damage", "playercolor"},
    "_decode_block": {"shadow", "damage", "playercolor", "outline"},
    "decode_masks": {"shadow", "damage", "playercolor"},
    "decode_outline_layer": {"outline"},
    "decode_outlines": {"outline"},
    "pack_mask_atlas": {"shadow", "damage", "outline"},
}


def fingerprints(source: str, conversion: str) -> dict[str, str]:
    parts = {layer: [conversion] for layer in LAYERS}
    for node in ast.parse(source).body:
        text = ast.get_source_segment(source, node) or ast.dump(node)
        for layer in SPECIALIZED.get(getattr(node, "name", None), set(LAYERS)):
            parts[layer].append(text)
    return {layer: hashlib.sha256("\n".join(text).encode()).hexdigest() for layer, text in parts.items()}


def layer_of(identifier: str) -> str:
    suffix = identifier.rsplit(":", 1)[-1]
    return suffix if suffix in LAYERS[1:] else "main"


class AtlasCache:
    def __init__(self, stored: dict, fingerprints: dict[str, str], legacy: str, out: Path):
        self.out = out
        self.fingerprints = fingerprints
        self.entries: dict[tuple, list[dict]] = {}
        # A known legacy hash proves the complete old decoder is unchanged.
        # Unknown/changed legacy hashes and unknown schemas never reuse output.
        legacy_ok = "schema" not in stored and stored.get("decoder") == legacy
        if stored.get("schema") != 2 and not legacy_ok:
            return
        for identifier, original in stored.get("atlases", {}).items():
            layer = layer_of(identifier) if legacy_ok else original.get("layer")
            decoder = fingerprints.get(layer) if legacy_ok else original.get("decoder")
            if not decoder or decoder != fingerprints.get(layer) or not original.get("source"):
                continue
            entry = dict(original)
            # Legacy caches before canonical URLs had no reliable location.
            if not entry.get("image"):
                continue
            key = (entry["source"], entry["expected"], layer)
            self.entries.setdefault(key, []).append(entry)

    def reuse(self, source: str, expected: int, layer: str, image: str):
        from convert_sld import page_path
        for entry in self.entries.get((source, expected, layer), []):
            atlas = entry["atlas"]
            count = len(atlas.get("pages", [0])) if atlas else 0
            old = self.out / entry["image"]
            if not all(page_path(old, page).is_file() for page in range(count)):
                continue
            if entry["image"] != image:
                for page in range(count):
                    target = page_path(self.out / image, page)
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(page_path(old, page), target)
            result = dict(atlas)
            if "image" in result:
                result["image"] = Path(image).name
            return result
        return None
