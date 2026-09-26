"""Owned metadata tests; optional extract export never publishes atlases."""
import copy
import json
import os
from pathlib import Path
import unittest
from test_import_aoe2 import DAT, PALETTES, SPEC, SOURCE, STRINGS, UHD, GRAPHICS, _dat
from import_content import age_variants, extract


class BuildingRosterTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dat = _dat()
        cls.profiles = {}
        for index, key, tree in ((1, "britons", "BRITONS.json"), (2, "franks", "FRANKS.json")):
            spec = copy.deepcopy(SPEC)
            spec.update(civIndex=index, civilization={"key": key, "treeFile": tree})
            spec.pop("profileCivilizations", None)
            spec.pop("enabledCivilizations", None)
            spec["effects"] = []
            cls.profiles[key] = extract(DAT, GRAPHICS, PALETTES, spec,
                json.loads(SOURCE.read_text()), STRINGS, uhd_dir=UHD, _dat=cls.dat)
        if path := os.environ.get("CIV_BUILDING_CONTENT"):
            Path(path).write_text(json.dumps(cls.profiles))

    def test_every_age_stat_and_art_comes_from_the_same_replacement(self):
        for index, key in ((1, "britons"), (2, "franks")):
            for entity in self.profiles[key]["entities"].values():
                if entity.get("category") != "building":
                    continue
                for age, uid in age_variants(self.dat, entity["id"]).items():
                    unit = self.dat.civs[index].units[uid]
                    stats = entity["ageStats"][age]
                    self.assertEqual(stats["id"], uid)
                    self.assertEqual(stats["hp"], unit.hit_points)
                    self.assertEqual(stats["armors"], [{"class": a.class_, "amount": a.amount} for a in unit.type_50.armours])
                    self.assertIn(f"idle-{age}", entity["animations"])
            self.assertEqual(self.profiles[key]["entities"]["house"]["ageStats"]["feudal"]["hp"], 750)

    def test_paid_upgrades_include_gates_and_do_not_turn_age_changes_into_buttons(self):
        for key, profile in self.profiles.items():
            techs = profile["technologies"]
            self.assertEqual(techs["guard-tower"]["upgrades"], [{"from": "watch-tower", "to": "guard-tower"}])
            if key == "britons":
                self.assertIn({"from": "guard-tower", "to": "keep"}, techs["keep"]["upgrades"])
            else:
                self.assertNotIn("keep", techs)
                self.assertIn(235, profile["civilization"]["unavailable"]["buildings"])
            self.assertEqual(techs["fortified-wall"]["upgrades"], [
                {"from": "stone-wall", "to": "fortified-wall"},
                {"from": "stone-gate", "to": "fortified-gate"}])
            self.assertNotIn("upgrades", techs["feudal-age"])
            self.assertEqual(techs["guard-tower"]["cost"], {"food": 100, "wood": 250})

    def test_gate_import_has_doorway_posts_flags_and_both_orientations(self):
        for profile in self.profiles.values():
            for key, uid, source in (("stone-gate", 64, 487), ("fortified-gate", 63, 488)):
                gate = profile["entities"][key]
                self.assertEqual(gate["id"], uid)
                self.assertEqual(gate["build"]["sourceId"], source)
                self.assertEqual(gate["availabilityId"], 487)
                self.assertEqual(gate["build"]["button"], 11)
                self.assertEqual(gate["collision"], [2, .5])
                self.assertEqual(profile["entities"][key + "-y"]["collision"], [.5, 2])
                self.assertEqual(gate["animations"]["construction"]["graphicId"],
                                 self.dat.civs[1].units[source].building.construction_graphic_id)
                for state in ("death", "decay"):
                    self.assertEqual(len(gate["animationLayers"][state]), 3)
                for state in ("idle", "open"):
                    layers = gate["animationLayers"][state]
                    self.assertEqual(len(layers), 5)
                    files = [gate["animations"][l["animation"]]["source"] for l in layers]
                    self.assertTrue(any(("closed" if state == "idle" else "open") in f for f in files))

    def test_sole_age_auto_stats_and_secondary_projectiles_keep_their_provenance(self):
        for profile in self.profiles.values():
            wall = profile["entities"]["stone-wall"]["ageStats"]["castle"]
            self.assertEqual(wall["includedTechs"], [71])
            self.assertAlmostEqual(wall["hp"], 1800, places=3)
            palisade = profile["entities"]["palisade-wall"]["ageStats"]["feudal"]
            self.assertEqual(palisade["includedTechs"], [72])
            self.assertAlmostEqual(palisade["hp"], 250, places=2)
            self.assertIn({"unit": "dat-projectile-505", "attribute": "attack", "operation": "add",
                           "armorClass": 3, "amount": 2}, profile["technologies"]["guard-tower"]["effects"])

    def test_arrowslits_descendants_preserve_thresholds_and_foreign_alternative(self):
        for key, profile in self.profiles.items():
            nodes = profile['civilizationBonuses']['nodes']
            for tid, paid in ((610, 140), (611, 63)):
                node = nodes[str(tid)]
                self.assertEqual(node['requiredTechs'], [608, paid, 775])
                self.assertEqual(node['requiredTechCount'], 2)
                self.assertIn({'unit': 'dat-projectile-505', 'attribute': 'attack',
                               'operation': 'add', 'armorClass': 3, 'amount': 1}, node['effects'])
            self.assertTrue(nodes['775']['disabled'])
            self.assertEqual(nodes['63'].get('disabled', False), key == 'franks')


if __name__ == '__main__':
    unittest.main()
