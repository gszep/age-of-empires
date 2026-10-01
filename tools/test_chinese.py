import unittest
from test_import_aoe2 import extracted_content, _dat


class ChineseImportTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.content = extracted_content()
        cls.profile = cls.content['civilizations']['chinese']

    def test_complete_roster_and_regional_research_gates(self):
        p = self.profile
        self.assertEqual(self.content['civilizationCatalog']['chinese']['missingRoster'], [])
        for key, pair in [('elite-fire-lancer', ('dat-unit-1901', 'dat-unit-1903')),
                          ('heavy-rocket-cart', ('dat-unit-1904', 'dat-unit-1907')),
                          ('elite-chu-ko-nu', ('dat-unit-73', 'dat-unit-559')),
                          ('siege-ram', ('capped-ram', 'dat-unit-548'))]:
            self.assertIn(dict(zip(('from', 'to'), pair)), p['technologies'][key]['upgrades'])
        self.assertEqual(p['civilization']['hudStyle'], 'CivAsia')
        self.assertEqual(p['audio']['switch'], 'Chinese')
        self.assertEqual(p['entities']['dat-unit-548']['infantryCapacity'], 6)

    def test_starting_spawn_discounts_and_team_multiplier_are_gated_not_flattened(self):
        nodes = self.profile['civilizationBonuses']['nodes']
        self.assertEqual(nodes['302']['requiredTechs'], [639, 307])
        self.assertIn({'spawn': {'unit': 'villager', 'building': 'town-center', 'count': 3}, 'operation': 'set', 'amount': 3}, nodes['302']['effects'])
        self.assertEqual([e['amount'] for e in nodes['226']['effects']], [-200, -50])
        for tid, factor in [(304, 1), (350, .95), (351, .9), (352, .85)]:
            self.assertEqual(nodes[str(tid)]['effects'], [{'resource': 'researchCostMod', 'operation': 'set', 'amount': factor}])
        self.assertTrue(nodes['232']['automatic'])
        self.assertIn({'resource': 'farmFoodAmount', 'operation': 'multiply', 'amount': 1.1, 'reapplyMultiplier': True, 'reapplyMultiplierFrom': 'resource-69'}, nodes['232']['effects'])
        self.assertEqual(self.profile['playerAttributes']['resource-69'], 1)
        self.assertIn({'resource': 'resource-69', 'operation': 'multiply', 'amount': 1.1}, nodes['232']['effects'])
        self.assertFalse(nodes['396']['requiredTechCount'] <= len(nodes['396']['requiredTechs']))
        self.assertIn({'unit': 'town-center', 'attribute': 'populationSupport', 'operation': 'set', 'amount': 15}, nodes['425']['effects'])

    def test_primary_secondary_and_alternate_weapons_keep_source_identity(self):
        p = self.profile['entities']; units = _dat().civs[6].units
        for uid in [73, 559, 1904, 1907]:
            self.assertEqual(p[f'dat-unit-{uid}']['volley']['count'], units[uid].creatable.total_projectiles)
        self.assertEqual(p['dat-unit-73']['volley']['secondaryId'], 510)
        # Hero aura task templates are present, but the owned CKN has no
        # Combat Ability32 activation bit; do not grant those dormant auras.
        for uid in [73, 559]:
            self.assertTrue(any(t.action_type == 155 for t in units[uid].bird.tasks))
            self.assertEqual(units[uid].type_50.break_off_combat & 32, 0)
        for uid in [1901, 1903, 1948]:
            a, u = p[f'dat-unit-{uid}']['alternateAttack'], units[uid]
            self.assertEqual(a['projectileId'], u.creatable.charge_projectile_unit)
            self.assertEqual(a['count'], u.creatable.max_total_projectiles)
            self.assertEqual(a['rangeModifier'], u.creatable.charge_event)
            self.assertIn('attack-special', p[f'dat-unit-{uid}']['animations'])
        self.assertTrue(p['dat-unit-1901']['alternateAttack']['bulk'])
        self.assertEqual(p['dat-unit-1901']['populationCost'], 1)
        self.assertTrue(p['dat-unit-1948']['alternateAttack']['unitTargetsOnly'])
        self.assertEqual(p['dat-projectile-1925']['projectile']['vanishMode'], 0)
        self.assertEqual(p['dat-unit-1904']['combat']['abilityFlags'] & 9, 9)

    def test_rocketry_reaches_lou_chuan_projectile_replacement_and_ship_free_upgrade(self):
        p = self.profile
        self.assertIn({'projectileFrom': 'dat-projectile-1936', 'projectileTo': 'dat-projectile-1879', 'operation': 'set', 'amount': 1879}, p['technologies']['rocketry']['effects'])
        self.assertIn({'unit': 'dat-projectile-1879', 'attribute': 'attack', 'operation': 'add', 'armorClass': 3, 'amount': 2}, p['technologies']['rocketry']['effects'])
        self.assertTrue(p['civilizationBonuses']['nodes']['1010']['automatic'])
        self.assertEqual(p['technologies']['dragon-ship']['researchSeconds'], 0)
        self.assertEqual(p['entities']['dat-unit-1302']['fireCharge']['projectile']['id'], 2629)
        self.assertIn({'unit': 'dat-unit-1948', 'attribute': 'chargeRangeModifier', 'operation': 'add', 'amount': 1}, p['technologies']['fletching']['effects'])
        self.assertIn({'projectileFrom': 'dat-projectile-1936', 'projectileTo': 'dat-projectile-1937', 'operation': 'set', 'amount': 1937}, p['technologies']['chemistry']['effects'])


if __name__ == '__main__':
    unittest.main()
