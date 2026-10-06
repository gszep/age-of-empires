"""Typed tree IDs, localization and shipped-profile completeness (no DAT reload)."""
import json
from pathlib import Path
import tempfile
import unittest

from depot import depot_root
from import_content import read_strings, HELP_STRING_OFFSET
from import_ui import extract_techtrees, extract_ui, compact_techtrees

DAT_DIR = depot_root() / "depot_813781/resources/_common/dat"
TREES = DAT_DIR / "CivTechTrees"
STRINGS = DAT_DIR.parents[1] / "en/strings/key-value/key-value-strings-utf8.txt"
SPEC = json.loads(Path(__file__).with_name("import-spec.json").read_text())


class TechTreeFixtureTest(unittest.TestCase):
    def test_extract_ui_rejects_absent_declared_tree_directory_before_publishing(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            profile = {"civilization": {"key": "test", "treeFile": "TEST.json"}}
            for content in (profile, {"civilizations": {"test": profile}}):
                for explicit in (None, path / "explicit-missing"):
                    with self.subTest(content=content, explicit=explicit):
                        with self.assertRaisesRegex(FileNotFoundError, "require CivTechTrees directory"):
                            extract_ui(path / "widgets", path / "dat/sounds.json", {"ui": {}},
                                       content, path / "out", techs_dir=explicit)
                        self.assertFalse((path / "out").exists())

    def test_missing_and_corrupt_shipped_sources_are_not_silently_omitted(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            content = {"civilization": {"key": "test", "treeFile": "TEST.json"}}
            with self.assertRaises(FileNotFoundError):
                extract_techtrees(path, content)
            (path / "TEST.json").write_text("not JSON")
            with self.assertRaises(json.JSONDecodeError):
                extract_techtrees(path, content)

    def test_empty_or_disabled_profiles_do_not_require_owned_files(self):
        self.assertEqual(extract_techtrees(Path("absent"), {}), {})
        self.assertEqual(extract_techtrees(Path("absent"), {
            "civilization": {"key": "test", "treeFile": "TEST.json", "enabled": False}}), {})


@unittest.skipUnless(TREES.is_dir() and STRINGS.is_file(), "owned CivTechTrees/localization unavailable")
class OwnedTechTreeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.content = {"civilization": SPEC["civilization"], "civilizations": {
            key: {"civilization": {"key": key, "treeFile": key.upper() + ".json"}}
            for key in SPEC["enabledCivilizations"]}}
        cls.strings = read_strings(STRINGS)
        cls.hashes = {}
        cls.trees = extract_techtrees(TREES, cls.content, cls.strings, cls.hashes)

    def test_all_and_only_shipped_profiles_including_root_are_deterministic(self):
        self.assertEqual(set(self.trees), {SPEC["civilization"]["key"], *SPEC["enabledCivilizations"]})
        self.assertEqual(self.trees, extract_techtrees(TREES, self.content, self.strings))
        self.assertEqual(len(self.hashes), len(self.trees))

    def test_shared_localization_round_trips_every_node_without_changing_source(self):
        before = json.dumps(self.trees, sort_keys=True)
        compact = compact_techtrees(self.trees)
        self.assertEqual(compact, compact_techtrees(self.trees))
        self.assertEqual(before, json.dumps(self.trees, sort_keys=True))
        for civ, tree in compact['techTrees'].items():
            for node, original in zip(tree['nodes'], self.trees[civ]['nodes']):
                self.assertNotIn('name', node)
                self.assertNotIn('help', node)
                for field in ('name', 'help'):
                    self.assertEqual(compact['techTreeStrings'][str(node[field + 'StringId'])], original[field])

    def test_every_node_preserves_typed_ids_status_age_and_localization(self):
        for key, tree in self.trees.items():
            source = json.loads((TREES / f"{tree['civId']}.json").read_text())
            rows = source["civ_techs_buildings"] + source["civ_techs_units"]
            self.assertEqual(len(tree["nodes"]), len(rows), key)
            for actual, native in zip(tree["nodes"], rows):
                self.assertEqual(actual["nodeId"], native["Node ID"])
                self.assertEqual(actual["buildingId"], native["Building ID"])
                self.assertEqual(actual["useType"], native["Use Type"])
                self.assertEqual(actual["nodeStatus"], native["Node Status"])
                self.assertEqual(actual.get("nodeType"), native.get("Node Type"))
                self.assertEqual(actual.get("newColumn"), native.get("Building in new column"))
                self.assertEqual(actual.get("upgradedFromId"), native.get("Building upgraded from ID"))
                self.assertIn(actual["ageId"], range(1, 5))
                self.assertEqual(actual["name"], self.strings[native["Name String ID"]])
                self.assertEqual(actual["help"], self.strings[native["Help String ID"] - HELP_STRING_OFFSET])
                if "Trigger Tech ID" in native:
                    self.assertEqual(actual["triggerTechId"], native["Trigger Tech ID"])

    def test_core_nodes_map_to_sim_spec_not_their_production_building(self):
        nodes = {(n["useType"], n["nodeId"]): n for n in self.trees["britons"]["nodes"]}
        entities = {e["key"]: e for e in SPEC["entities"]}
        techs = {t["key"]: t for t in SPEC["technologies"]}
        for key in ["barracks", "archery-range", "stable"]:
            self.assertIn(("Building", entities[key]["unitId"]), nodes)
        archer = nodes["Unit", entities["archer"]["unitId"]]
        self.assertEqual(archer["buildingId"], entities["archery-range"]["unitId"])
        self.assertNotEqual(archer["nodeId"], archer["buildingId"])
        self.assertEqual(nodes["Tech", techs["loom"]["techId"]]["name"], "Loom")
        self.assertEqual(nodes["Unit", 24]["triggerTechId"], 100)
        self.assertEqual(nodes["Building", 12]["ageId"], 1)
        self.assertEqual(nodes["Building", 12]["nodeStatus"], "ResearchedCompleted")

    def test_typed_prerequisites_drop_padding_but_not_unavailable_nodes(self):
        nodes = {(n["useType"], n["nodeId"]): n for n in self.trees["britons"]["nodes"]}
        self.assertEqual(nodes["Building", 234]["prerequisites"], [{"id": 140, "type": "Tech"}])
        self.assertEqual(nodes["Unit", 569]["nodeStatus"], "NotAvailable")


if __name__ == "__main__":
    unittest.main()
