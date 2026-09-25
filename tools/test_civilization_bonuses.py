"""Focused owned-DAT bonus extraction: no atlas work or published manifest."""
import copy
import json
import os
from pathlib import Path
import unittest

from datq import load_dat, DAT_RELATIVE
from depot import depot_root
from import_content import civilization_bonuses, technologies_from_tree, player_attribute_ids


class CivilizationBonusImportTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        root = depot_root()
        path = root / DAT_RELATIVE
        if not path.is_file():
            raise unittest.SkipTest("owned DAT unavailable")
        cls.dat = load_dat()
        spec = json.loads(Path(__file__).with_name("import-spec.json").read_text())
        ids = player_attribute_ids((path.parent.parent / "xs/Constants.xs").read_text())
        cls.profiles = {}
        for ci, key, tree in [(1, "britons", "BRITONS.json"), (2, "franks", "FRANKS.json")]:
            own = {**spec, "civIndex": ci, "civilization": {"key": key, "treeFile": tree}}
            entities = {}
            for entry in spec["entities"]:
                if "unitId" not in entry:
                    continue
                unit = cls.dat.civs[ci].units[entry["unitId"]]
                if unit is None:
                    continue
                entities[entry["key"]] = {"id": unit.id, "class": unit.class_, "category": entry["category"]}
                if "skinOf" in entry:
                    entities[entry["key"]]["skinOf"] = entry["skinOf"]
            techs, _ = technologies_from_tree(cls.dat, path, own, entities, {"name": key}, {}, ids)
            before = copy.deepcopy(techs)
            bonuses = civilization_bonuses(cls.dat, ci, entities, techs, ids)
            cls.profiles[key] = {"civilizationBonuses": bonuses, "technologies": techs, "entities": entities}
            again = civilization_bonuses(cls.dat, ci, copy.deepcopy(entities), before, ids)
            assert bonuses == again
        if target := os.environ.get("CIV_BONUS_EXTRACT"):
            Path(target).write_text(json.dumps(cls.profiles, sort_keys=True))

    def test_briton_effects_are_source_addressed_with_skirmisher_reversals(self):
        nodes = self.profiles["britons"]["civilizationBonuses"]["nodes"]
        self.assertEqual(nodes["381"]["requiredTechs"], [102])
        self.assertEqual(nodes["383"]["requiredTechCount"], 0)
        self.assertIn({"unit": "villager-shepherd", "attribute": "workRate", "operation": "multiply", "amount": 1.25}, nodes["383"]["effects"])
        self.assertIn({"unit": "town-center", "attribute": "woodCost", "operation": "multiply", "amount": 0.5}, nodes["381"]["effects"])
        for tid in ("382", "403"):
            ranges = [e["amount"] for e in nodes[tid]["effects"] if e.get("unit") == "skirmisher" and e.get("attribute") == "range"]
            self.assertEqual(sum(ranges), 0)
        self.assertIn({"unit": "archery-range", "attribute": "workRate", "operation": "multiply", "amount": 1.1}, nodes["-2"]["effects"])
        yeomen = next(t for t in self.profiles["britons"]["technologies"].values() if t["techId"] == 3)
        self.assertEqual(yeomen["cost"], {"wood": 750, "gold": 450})
        self.assertEqual(yeomen["researchSeconds"], 60)

    def test_free_farms_keep_all_gates_and_foreign_alternatives_disabled(self):
        profile = self.profiles["franks"]
        nodes = profile["civilizationBonuses"]["nodes"]
        for tid in (12, 13, 14):
            tech = next(t for t in profile["technologies"].values() if t["techId"] == tid)
            self.assertEqual(sum(tech["cost"].values()), 0)
            self.assertEqual(tech["researchSeconds"], 0)
            self.assertTrue(nodes[str(tid)]["automatic"])
            self.assertEqual(nodes[str(tid)]["researchedAt"], "mill")
        self.assertEqual(nodes["13"]["requiredTechs"], [102, 14, 761])
        self.assertEqual(nodes["13"]["requiredTechCount"], 2)
        self.assertTrue(nodes["761"]["disabled"])
        self.assertEqual(nodes["110"]["triggeredByBuildings"], ["mill"])
        self.assertEqual(nodes["290"]["requiredTechs"], [101])
        self.assertIn({"unit": "knight", "attribute": "hitPoints", "operation": "multiply", "amount": 1.2}, nodes["290"]["effects"])
        self.assertIn({"unit": "castle", "attribute": "cost", "operation": "multiply", "amount": 0.85}, nodes["325"]["effects"])


if __name__ == "__main__":
    unittest.main()
