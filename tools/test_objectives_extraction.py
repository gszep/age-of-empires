"""Objectives vocabulary/layout tests and a read-only browser source fixture.

--fixture emits JSON to stdout, without running an import or copying assets.
The smoke serves only the fixture's explicit PNG allow-list on its private port.
"""
import json
from pathlib import Path
import sys
import tempfile
import unittest

from depot import depot_root
from import_content import read_strings
from import_ui import extract_objectives_strings, load_material_index, resolve_texture, sha256, strip_widget

WIDGETUI = depot_root() / "depot_813782/widgetui"
STRINGS = depot_root() / "depot_813781/resources/en/strings/key-value/key-value-strings-utf8.txt"


def source_fixture():
    """Real menu + Objectives source data, open simulation/art elsewhere."""
    hashes, layouts, used = {}, {}, set()
    strings = extract_objectives_strings(WIDGETUI, STRINGS, hashes)
    for name in ("menupanel", "objectivespanel", "dialogobjectives"):
        path = WIDGETUI / f"{name}.json"
        collection = json.loads(path.read_text())["Collection"]
        hashes[path.name] = sha256(path)
        layouts[name] = {"viewPort": collection["ViewPort"], "widgets": [
            strip_widget(w, used, set()) for w in collection["Widgets"]]}
    materials, textures = load_material_index(WIDGETUI)
    icons = {"MenuIcons": json.loads((WIDGETUI / "icons.json").read_text())["MenuIcons"]}
    used.update(icons["MenuIcons"].values())
    resolved, files = {}, {}
    for name in sorted(used):
        material = materials.get(name, {})
        relative = textures.get(material.get("TextureRef"))
        # Unrelated DDS/placeholder materials are outside this focused fixture.
        if relative and Path(relative).suffix.lower() == ".png":
            path = resolve_texture(WIDGETUI, relative)
            files[relative] = str(path)
            hashes[relative] = sha256(path)
            resolved[name] = {"type": material["Type"], "texture": relative}
    return {"manifest": {"layouts": layouts, "materials": resolved, "icons": icons,
                         "objectivesStrings": strings, "source": {"sha256": hashes}}, "files": files}


class ObjectivesFixtureTest(unittest.TestCase):
    def test_localized_vocabulary_is_exact_and_deterministic(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "stringreference.json").write_text(json.dumps({"IDS_OBJECTIVES_MAIN": 10910, "IDS_TEXT_CLOSE": 9249}))
            labels = {10910: "Titre", 9249: "Fermer", 9823: "Conquete", 11436: "Construire", 11301: "Merveille: %d"}
            strings_path = root / "strings.txt"
            strings_path.write_text('\n'.join(f'{key} "{value}"' for key, value in labels.items()))
            hashes = {}
            expected = {str(k): v for k, v in labels.items()}
            self.assertEqual(extract_objectives_strings(root, strings_path, hashes), expected)
            self.assertEqual(extract_objectives_strings(root, strings_path, {}), expected)
            self.assertEqual(hashes["objectivesStrings"], sha256(strings_path))
            strings_path.write_text('10910 "Only title"')
            with self.assertRaises(KeyError):
                extract_objectives_strings(root, strings_path, {})

    def test_pipeline_spec_publishes_both_owned_layouts(self):
        spec = json.loads(Path(__file__).with_name("import-spec.json").read_text())
        self.assertTrue({"objectivespanel", "dialogobjectives"}.issubset(spec["ui"]["panels"]))


@unittest.skipUnless(WIDGETUI.is_dir() and STRINGS.is_file(), "owned UI/localization unavailable")
class OwnedObjectivesTest(unittest.TestCase):
    def test_source_fixture_preserves_labels_geometry_and_materials(self):
        fixture = source_fixture()
        ui = fixture["manifest"]
        original = read_strings(STRINGS)
        for key, value in ui["objectivesStrings"].items():
            self.assertEqual(value, original[int(key)])
        self.assertNotIn("13094", ui["objectivesStrings"])
        layout = ui["layouts"]["dialogobjectives"]
        self.assertEqual((layout["viewPort"]["width"], layout["viewPort"]["height"]), (1358, 1512))
        children = layout["widgets"][0]["ChildWidgets"]
        close = next(w for w in children if w["Name"] == "ButtonCancel")
        self.assertEqual(close["HotKey"]["Key"], 27)
        self.assertEqual(close["ViewPort"]["width"], 416)
        background = next(w for w in children if w["Name"] == "BackgroundObjectives")
        box = next(w for w in background["ChildWidgets"] if w["Name"] == "ObjectivesBox")
        self.assertEqual(box["ViewPort"]["height"], 950)
        self.assertEqual(box["StateMaterials"]["StateTextNormal"]["Font"]["PointSize"], 42)
        for name in ("Objectives-MenuObjectivesHintsBg", "ButtonRedNormal", "ButtonRedHover", "ButtonRedClicked", "MenuObjectivesNormal"):
            self.assertTrue(Path(fixture["files"][ui["materials"][name]["texture"]]).is_file())
        self.assertEqual(fixture, source_fixture())


if __name__ == "__main__":
    if sys.argv[1:] == ["--fixture"]:
        print(json.dumps(source_fixture()))
    else:
        unittest.main()
