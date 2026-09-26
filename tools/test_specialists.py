"""Owned specialist contracts; extraction only, no asset publication."""
from dataclasses import asdict
import unittest
from test_import_aoe2 import extracted_content, _dat, sld


class SpecialistImportTest(unittest.TestCase):
    def test_identity_and_tree_alias_are_source_identical_for_both_profiles(self):
        dat = _dat()
        for civ in (1, 2):
            original, variant = (asdict(dat.civs[civ].units[uid]) for uid in (35, 1258))
            changed = {key for key in original if original[key] != variant[key]}
            self.assertEqual(changed, {"id", "base_id", "copy_id", "hide_in_editor"})
            tower = dat.civs[civ].units[1105]
            self.assertFalse(tower.type_50.attacks)
            self.assertEqual([(task.action_type, task.class_id) for task in tower.bird.tasks
                              if task.action_type == 14], [(14, 27)])
            self.assertEqual(tower.garrison_capacity, 10)
            self.assertEqual(dat.civs[civ].units[440].type_50.blast_width, 0.5)

    def test_metadata_retains_real_attack_wall_task_flags_and_explosion_chain(self):
        root = extracted_content()
        for content in [root, *root['civilizations'].values()]:
            petard = content['entities']['petard']
            tower = content['entities']['siege-tower']
            ram = content['entities']['battering-ram']
            self.assertEqual(petard['id'], 440)
            self.assertTrue(petard['selfDestruct'])
            self.assertIn({'class': 11, 'amount': 500}, petard['combat']['attacks'])
            self.assertEqual(petard['combat']['blastRadius'], 0.5)
            self.assertEqual(petard['animations']['walk']['source'], sld('u_sie_petard_walkA'))
            self.assertEqual(petard['deathEffect'], 'impact_petard')
            effect = content['particles'][petard['deathEffect']]
            self.assertEqual(len(effect['frames']), 85)
            self.assertEqual(effect['cycleSeconds'], [1.5, 1.5])
            self.assertGreaterEqual(petard['deathSeconds'], 1.5)
            self.assertEqual(tower['unloadOverWall'], {'targetClass': 27})
            self.assertEqual(tower['infantryCapacity'], 10)
            self.assertFalse(tower['combat']['attacks'])
            self.assertTrue(tower['garrisonFlags']['idle'])
            self.assertEqual(tower['animations']['attack']['source'], sld('u_sie_siege_tower_attackA'))
            self.assertEqual(ram['treeUnitId'], 1258)
            self.assertEqual(ram['id'], 35)


if __name__ == '__main__':
    unittest.main()
