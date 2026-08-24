from functools import lru_cache
from pathlib import Path
import json
import os
import sys
import tempfile
import unittest

from PIL import Image

from import_content import extract
from import_ui import extract_ui
from convert_sld import convert


ROOT = Path(os.environ.get(
    "AOE2DE_DEPOT_ROOT",
    Path.home() / "Steam/steamapps/content/app_813780",
)).expanduser()
DAT = ROOT / "depot_813781/resources/_common/dat/empires2_x2_p1.dat"
SOUNDS = ROOT / "depot_813781/resources/_common/dat/sounds.json"
GRAPHICS = ROOT / "depot_813784/resources/_common/drs/graphics"
WIDGETUI = ROOT / "depot_813782/widgetui"
SPEC = json.loads(Path(__file__).with_name("import-spec.json").read_text())
SOURCE = Path(__file__).with_name("aoe2-source.json")
OPENAGE = Path(__file__).resolve().parents[1] / ".tools/openage-src"
sys.path.insert(0, str(OPENAGE))


@lru_cache(maxsize=1)
def extracted_content():
    return extract(DAT, GRAPHICS, SPEC, json.loads(SOURCE.read_text()))


@unittest.skipUnless(DAT.is_file(), "owned AoE2DE fixture is not installed")
class ContentImportIntegrationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.result = extracted_content()

    def test_militia_fixture_keeps_patch_matched_rules(self):
        unit = self.result["entities"]["militia"]
        self.assertEqual(unit["id"], 74)
        self.assertEqual(unit["hitPoints"], 40)
        self.assertEqual(unit["cost"], {"food": 50, "gold": 20})
        self.assertEqual(unit["populationCost"], 1)
        self.assertEqual(unit["train"], {"buildingId": 12, "seconds": 21})
        self.assertIn({"class": 4, "amount": 4}, unit["combat"]["attacks"])
        self.assertIn({"class": 3, "amount": 1}, unit["combat"]["armors"])
        self.assertEqual(unit["combat"]["reloadSeconds"], 2.0)

    def test_economy_entities_carry_dat_backed_rules(self):
        entities = self.result["entities"]
        self.assertEqual(entities["villager"]["train"], {"buildingId": 109, "seconds": 25})
        self.assertEqual(entities["villager-forager"]["gather"]["resource"], "food")
        self.assertEqual(entities["villager-forager"]["gather"]["ratePerSecond"], 0.31)
        self.assertEqual(entities["villager-lumberjack"]["gather"]["resource"], "wood")
        self.assertEqual(entities["villager-goldminer"]["gather"]["resource"], "gold")
        for variant in ("villager-forager", "villager-lumberjack", "villager-goldminer"):
            self.assertEqual(entities[variant]["gather"]["capacity"], 10)
        self.assertEqual(entities["house"]["cost"], {"wood": 25})
        self.assertEqual(entities["house"]["popSupport"], 5)
        self.assertEqual(entities["house"]["build"]["seconds"], 25)
        self.assertEqual(entities["barracks"]["build"]["seconds"], 50)
        self.assertEqual(entities["berries"]["storage"], {"food": 125})
        self.assertEqual(entities["gold"]["storage"], {"gold": 800})
        self.assertEqual(entities["tree-oak"]["storage"], {"wood": 100})
        self.assertEqual(entities["town-center"]["collision"], [2.0, 2.0])
        self.assertTrue(entities["town-center"]["annexes"])

    def test_every_animation_resolves_to_hashed_source(self):
        hashes = self.result["source"]["sha256"]
        for key, entity in self.result["entities"].items():
            groups = [entity["animations"]] + [
                annex["animations"] for annex in entity.get("annexes", [])
            ]
            for animations in groups:
                for state, animation in animations.items():
                    self.assertGreater(animation["frames"], 0, f"{key}/{state}")
                    self.assertEqual(len(hashes[animation["source"]]), 64, f"{key}/{state}")

    def test_regeneration_is_deterministic(self):
        again = extract(DAT, GRAPHICS, SPEC, json.loads(SOURCE.read_text()))
        self.assertEqual(
            json.dumps(self.result, sort_keys=True), json.dumps(again, sort_keys=True)
        )

    @unittest.skipUnless((OPENAGE / "openage/convert/value_object/read/media/sld.pyx").is_file(), "openage is not bootstrapped")
    def test_converts_sld_to_playable_byte_identical_atlas(self):
        animation = self.result["entities"]["berries"]["animations"]["idle"]
        expected = animation["frames"] * animation["directions"]
        with tempfile.TemporaryDirectory() as directory:
            first = Path(directory) / "a.png"
            second = Path(directory) / "b.png"
            atlas = convert(GRAPHICS / animation["source"], first, expected)
            convert(GRAPHICS / animation["source"], second, expected)
            self.assertEqual(first.read_bytes(), second.read_bytes())
            self.assertEqual(len(atlas["frames"]), expected)
            with Image.open(first) as image:
                self.assertEqual(image.size, tuple(atlas["size"]))
                self.assertEqual(image.mode, "RGBA")


@unittest.skipUnless(WIDGETUI.is_dir() and DAT.is_file(), "owned AoE2DE fixture is not installed")
class UiImportIntegrationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory()
        cls.result = extract_ui(
            WIDGETUI, SOUNDS, SPEC, extracted_content(), Path(cls.directory.name)
        )

    @classmethod
    def tearDownClass(cls):
        cls.directory.cleanup()

    def test_panels_keep_source_geometry_and_materials(self):
        layouts = self.result["layouts"]
        self.assertEqual(
            set(layouts),
            {"blanktoppanel", "resourcepanel", "commandpanel", "mappanel", "blankbottompanel", "menupanel"},
        )
        resource = layouts["resourcepanel"]
        self.assertEqual(resource["viewPort"]["width"], 1935)
        dumped = json.dumps(resource)
        self.assertIn('"ResourceWood"', dumped)
        self.assertIn('"ResourceFood"', dumped)
        self.assertIn('"ResourceGold"', dumped)

    def test_every_material_texture_was_converted(self):
        out = Path(self.directory.name)
        textured = 0
        for name, material in self.result["materials"].items():
            if "texture" in material:
                textured += 1
                self.assertTrue((out / material["texture"]).is_file(), name)
        self.assertGreater(textured, 200)

    def test_entity_icons_and_action_icons_resolve(self):
        icons = self.result["icons"]
        self.assertIn("002", icons["Buildings"])  # barracks
        self.assertIn("028", icons["Buildings"])  # town center
        self.assertIn("008", icons["Units"])  # militia
        self.assertIn("015", icons["Units"])  # villager
        for material in list(icons["Buildings"].values()) + list(icons["Units"].values()):
            self.assertIn("texture", self.result["materials"][material])
        self.assertTrue(
            any(name.startswith("IconAction") for name in self.result["materials"])
        )

    def test_west_style_variants_and_sounds_are_included(self):
        self.assertIn("CivWestResourcePanel", self.result["materials"])
        self.assertEqual(self.result["sounds"].get("button_ui"), "Play_Button_UI")


if __name__ == "__main__":
    unittest.main()
