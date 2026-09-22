#!/usr/bin/env python3
"""Record/compare every sprite atlas's pixels and layout across URL sharing.

The baseline is local evidence, not a redistributable game asset. PNG SHA-256
identity is stronger than a screenshot: every frame and transparent pixel is
covered. Only page URLs may change; the rest of the manifest stays identical.
"""
import argparse
import copy
import hashlib
import json
from pathlib import Path


def audit(manifest_path):
    manifest = json.loads(manifest_path.read_text())
    normalized = copy.deepcopy(manifest)
    hashes = {}
    sizes = {}

    def atlas(value):
        pages = value.get("pages", [value])
        for page in pages:
            image = page["image"]
            if image not in hashes:
                with (manifest_path.parent / image).open("rb") as source:
                    hashes[image] = hashlib.file_digest(source, "sha256").hexdigest()
                sizes[image] = page["size"][0] * page["size"][1] * 4
            page["image"] = hashes[image]
        if "pages" in value:
            value["image"] = value["pages"][0]["image"]

    for entity in normalized["entities"].values():
        for owner in [entity, *entity.get("annexes", [])]:
            for value in owner["atlases"].values():
                atlas(value)
    for effect in normalized.get("particles", {}).values():
        atlas(effect["atlas"])
    return {"normalized": normalized, "pages": len(hashes), "rgbaBytes": sum(sizes.values()),
            "pngBytes": sum((manifest_path.parent / image).stat().st_size for image in hashes)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["record", "compare"])
    parser.add_argument("baseline", type=Path)
    parser.add_argument("--manifest", type=Path, default=Path("public/imported/aoe2/manifest.json"))
    args = parser.parse_args()
    current = audit(args.manifest)
    if args.mode == "record":
        args.baseline.write_text(json.dumps(current, sort_keys=True) + "\n")
        print(json.dumps({k: v for k, v in current.items() if k != "normalized"}))
    else:
        before = json.loads(args.baseline.read_text())
        assert before["normalized"] == current["normalized"], "pixels, atlas layout or manifest semantics changed"
        print(json.dumps({key: {"before": before[key], "after": current[key], "saved": before[key] - current[key]}
                          for key in ("pages", "rgbaBytes", "pngBytes")}, indent=2))
        print("ATLAS SHARING GREEN: every sprite PNG and all non-URL manifest fields are identical")
