import unittest
from test_import_aoe2 import extracted_content, _dat
from naval import graphic_layers


class GothImportTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.content = extracted_content()
        cls.goths = cls.content['civilizations']['goths']

    def test_anarchy_preserves_disabled_slot_and_source_training_clocks(self):
        for uid in (41, 555):
            slots = self.goths['entities'][f'dat-unit-{uid}']['trainLocations']
            self.assertEqual(slots, [
                {'buildingId': 82, 'seconds': 13, 'button': 1, 'hotkeyTextId': 16104},
                {'buildingId': -1, 'seconds': 16, 'button': 4, 'hotkeyTextId': 16748},
            ])
            self.assertIn({'unit': f'dat-unit-{uid}', 'attribute': 'trainLocation', 'operation': 'set',
                'amount': 12, 'trainingIndex': 1, 'trainingBuilding': 'barracks'},
                self.goths['technologies']['anarchy']['effects'])
        self.assertEqual(self.content['civilizationCatalog']['goths']['missingRoster'], [])

    def test_aliases_are_the_source_tree_secondary_producers_not_duplicate_trainable_units(self):
        dat = _dat()
        for base, alias in [(41,759),(555,761)]:
            original, secondary = dat.civs[3].units[base], dat.civs[3].units[alias]
            self.assertEqual(original.standing_graphic, secondary.standing_graphic)
            self.assertEqual(original.hit_points, secondary.hit_points)
            self.assertEqual([a for a in original.type_50.attacks if a.amount],
                             [a for a in secondary.type_50.attacks if a.amount])
            self.assertEqual(original.type_50.armours, secondary.type_50.armours)
            self.assertEqual(original.creatable.resource_costs, secondary.creatable.resource_costs)
            self.assertEqual(secondary.creatable.train_locations[1].unit_id, 12)
            self.assertNotIn(f'dat-unit-{alias}', self.goths['entities'])

    def test_loom_annex_trigger_hunting_yield_and_population_are_consumed(self):
        nodes = self.goths['civilizationBonuses']['nodes']
        self.assertIn('town-center', nodes['307']['triggeredByBuildings'])
        self.assertEqual(nodes['343']['requiredTechs'], [307])
        self.assertEqual(nodes['343']['effects'], [{'technologyId': 22, 'attribute': 'researchSeconds', 'operation': 'set', 'amount': 1}])
        self.assertIn({'resource': 'huntingProductivity', 'operation': 'multiply', 'amount': 1.23}, nodes['402']['effects'])
        self.assertEqual(nodes['406']['effects'], [{'resource': 'unitLimit', 'operation': 'add', 'amount': 10}])
        self.assertEqual(self.goths['entities']['dat-unit-1795']['projectilesPerAttack'], 5)

    def test_e_placeholder_is_not_a_sprite_but_its_child_layers_survive(self):
        dat = _dat()
        layers = graphic_layers(dat, 2536)
        self.assertTrue(layers)
        self.assertTrue(all(dat.graphics[i].file_name != 'E' for i, _, _ in layers))
        self.assertEqual(graphic_layers(dat, 2416), [])

    def test_incendiaries_uses_the_dead_units_own_damage_and_feedback(self):
        tech = self.goths['technologies']['incendiaries']
        self.assertEqual(tech['techId'], 910)
        self.assertEqual(tech['cost'], {'food': 200, 'gold': 325})
        self.assertEqual(tech['researchSeconds'], 50)
        for effect in tech['effects']:
            blast = effect['deathExplosion']
            self.assertEqual(blast['art'], 'fire-ship-explosion')
            self.assertEqual(blast['radius'], 3)
            self.assertEqual(blast['level'], 2)
            self.assertEqual(blast['attacks'], [{'class': 4, 'amount': 10}, {'class': 60, 'amount': 5}])
            self.assertGreater(blast['seconds'], 0)
        self.assertEqual({e['unit'] for e in tech['effects']}, {'fire-galley', 'fire-ship', 'fast-fire-ship'})
        self.assertEqual(self.goths['entities']['fire-ship-explosion']['deathEffect'], 'explosion_demo_ships')
        self.assertFalse([t for t in self.goths['skippedTechnologies'] if 'do not have' not in t['reason']])


if __name__ == '__main__':
    unittest.main()
