import unittest
from test_import_aoe2 import extracted_content, _dat, sld


class ByzantineImportTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.content = extracted_content()
        cls.profile = cls.content['civilizations']['byzantines']

    def test_complete_roster_and_owned_unique_research(self):
        p = self.profile
        self.assertEqual(self.content['civilizationCatalog']['byzantines']['missingRoster'], [])
        self.assertEqual(p['civilization']['hudStyle'], 'CivMedi')
        self.assertEqual(p['audio']['switch'], 'Byzantines')
        for key, uid in [('dat-unit-40', 40), ('dat-unit-553', 553), ('dat-unit-329', 329), ('dat-unit-330', 330)]:
            self.assertEqual(p['entities'][key]['id'], uid)
        self.assertIn({'from': 'dat-unit-40', 'to': 'dat-unit-553'}, p['technologies']['elite-cataphract']['upgrades'])
        self.assertIn({'from': 'dat-unit-329', 'to': 'dat-unit-330'}, p['technologies']['heavy-camel-rider']['upgrades'])
        self.assertAlmostEqual(p['technologies']['imperial-age']['cost']['food'], 670, places=4)
        self.assertAlmostEqual(p['technologies']['imperial-age']['cost']['gold'], 536, places=4)
        for key in ['town-watch', 'town-patrol']:
            self.assertEqual(p['technologies'][key]['researchSeconds'], 0)
            self.assertFalse(any(p['technologies'][key]['cost'].values()))
        self.assertTrue(all('do not have it' in row['reason'] for row in p['skippedTechnologies']))

    def test_healing_task_product_and_team_effect_are_both_preserved(self):
        p = self.profile; monk = _dat().civs[7].units[125]
        task = next(t for t in monk.bird.tasks if t.action_type == 105)
        self.assertEqual(p['entities']['monk']['heal']['hitPointsPerSecond'], monk.bird.work_rate * task.work_value_1)
        self.assertEqual(p['entities']['monk']['heal']['hitPointsPerSecond'], 2.5)
        self.assertEqual(p['playerAttributes']['healRateModifer'], 0)
        self.assertIn({'resource': 'healRateModifer', 'operation': 'set', 'amount': 2}, p['civilizationBonuses']['nodes']['-2']['effects'])

    def test_fixed_trample_and_greek_fire_projectile_identity(self):
        p = self.profile
        for uid in [40, 553]:
            key = f'dat-unit-{uid}'
            self.assertEqual(p['entities'][key]['combat']['blastDamage'], _dat().civs[7].units[uid].type_50.blast_damage)
            self.assertEqual(p['entities'][key]['combat']['blastDamage'], -5)
            self.assertIn({'unit': key, 'attribute': 'blastRadius', 'operation': 'add', 'amount': .5}, p['technologies']['logistica']['effects'])
        effects = p['technologies']['greek-fire']['effects']
        for source, target in [('bombard-tower-shot', 'dat-projectile-537'), ('dat-projectile-508', 'dat-projectile-1798')]:
            self.assertTrue(any(e.get('projectileFrom') == source and e.get('projectileTo') == target for e in effects))
        self.assertIn({'unit': 'bombard-tower', 'attribute': 'blastRadius', 'operation': 'add', 'amount': .5}, effects)

    def test_mediterranean_flags_traverse_legacy_parents_with_owned_offsets(self):
        p = self.profile['entities']['town-center']
        for age, y in [('feudal', -159), ('castle', -165), ('imperial', -180)]:
            flags = p['garrisonFlags'][f'idle-{age}']
            self.assertEqual(flags, [{'animation': 'garrison-11380', 'x': 0, 'y': y}])
        self.assertEqual(p['animations']['garrison-11380']['source'], sld('b_medi_garrison_flag'))


if __name__ == '__main__':
    unittest.main()
