from pathlib import Path
import json
import sys
import tempfile
import unittest

from PIL import Image

from import_militia import extract
from convert_sld import convert


ROOT = Path.home() / "Steam/steamapps/content/app_813780"
DAT = ROOT / "depot_813781/resources/_common/dat/empires2_x2_p1.dat"
GRAPHICS = ROOT / "depot_813784/resources/_common/drs/graphics"
SOURCE = Path(__file__).with_name("aoe2-source.json")
OPENAGE = Path(__file__).resolve().parents[1] / ".tools/openage-src"
sys.path.insert(0, str(OPENAGE))


@unittest.skipUnless(DAT.is_file(), "owned AoE2DE fixture is not installed")
class MilitiaImportIntegrationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.result = extract(DAT, GRAPHICS, json.loads(SOURCE.read_text()))

    def test_extracts_patch_matched_rules(self):
        unit = self.result["unit"]
        self.assertEqual(unit["id"], 74)
        self.assertEqual(unit["hitPoints"], 40)
        self.assertEqual(unit["cost"], {"food": 50, "gold": 20})
        self.assertEqual(unit["train"], {"buildingId": 12, "seconds": 21, "population": 1})
        self.assertEqual(unit["combat"]["attacks"], [{"class": 4, "amount": 4}])
        self.assertEqual(unit["combat"]["reloadSeconds"], 2.0)

    def test_resolves_every_runtime_animation_to_hashed_source(self):
        animations = self.result["unit"]["animations"]
        self.assertEqual(set(animations), {"idle", "walk", "attack", "death"})
        hashes = self.result["source"]["sha256"]
        for animation in animations.values():
            self.assertEqual(animation["directions"], 16)
            self.assertEqual(len(hashes[animation["source"]]), 64)

    @unittest.skipUnless((OPENAGE / "openage/convert/value_object/read/media/sld.pyx").is_file(), "openage is not bootstrapped")
    def test_converts_sld_to_playable_atlas(self):
        animation = self.result["unit"]["animations"]["idle"]
        expected = animation["frames"] * animation["directions"]
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "idle.png"
            atlas = convert(GRAPHICS / animation["source"], output, expected)
            self.assertEqual(len(atlas["frames"]), expected)
            with Image.open(output) as image:
                self.assertEqual(image.size, tuple(atlas["size"]))
                self.assertEqual(image.mode, "RGBA")


if __name__ == "__main__":
    unittest.main()
