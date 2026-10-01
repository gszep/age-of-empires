import unittest
from test_import_aoe2 import extracted_content, _dat


class JapaneseImportTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.content = extracted_content()
        cls.profile = cls.content['civilizations']['japanese']

    def test_roster_bonuses_and_nonrandom_gate_match_source(self):
        p = self.profile
        self.assertEqual(self.content['civilizationCatalog']['japanese']['missingRoster'], [])
        self.assertEqual(p['entities']['dat-unit-291']['text']['name'], 'Samurai')
        self.assertEqual(p['entities']['dat-unit-560']['text']['name'], 'Elite Samurai')
        self.assertIn({'from': 'cannon-galleon', 'to': 'dat-unit-691'}, p['technologies']['elite-cannon-galleon']['upgrades'])
        nodes = p['civilizationBonuses']['nodes']
        self.assertEqual(nodes['341']['requiredTechs'], [101])
        self.assertEqual(nodes['339']['requiredTechCount'], 1)
        self.assertEqual(nodes['339']['requiredTechs'], [])
        for i in (306, 422, 423, 424):
            self.assertTrue(any(e.get('unit') == 'fishing-ship' and e.get('attribute') == 'workRate' for e in nodes[str(i)]['effects']))

    def test_negative_packed_attack_excludes_skirmishers(self):
        effects = self.profile['civilizationBonuses']['nodes']['190']['effects']
        attacks = [e for e in effects if e.get('unit') == 'cavalry-archer']
        self.assertIn(dict(unit='cavalry-archer', attribute='attack', operation='add', armorClass=15, amount=2), attacks)
        self.assertIn(dict(unit='cavalry-archer', attribute='attack', operation='add', armorClass=38, amount=-2), attacks)
        self.assertTrue(all(e.get('armorClass', 0) >= 0 for e in effects))

    def test_unique_research_preserves_both_arrows_and_packing_modifier(self):
        p = self.profile
        for kind in ('watch-tower', 'guard-tower', 'keep'):
            effects = [e for e in p['technologies']['yasama']['effects'] if e.get('unit') == kind]
            self.assertIn(dict(unit=kind, attribute='totalProjectiles', operation='add', amount=2), effects)
            self.assertIn(dict(unit=kind, attribute='garrisonMaxProjectiles', operation='add', amount=2), effects)
        self.assertIn(dict(unit='trebuchet-unpacked', attribute='workRate', operation='multiply', amount=4), p['technologies']['kataparuto']['effects'])
        self.assertEqual(p['entities']['trebuchet-unpacked']['workRate'], _dat().civs[5].units[42].bird.work_rate)

    def test_charge_movement_uses_the_task_not_a_civilisation_name(self):
        for uid, maximum in ((291, 6), (560, 7)):
            approach = self.profile['entities'][f'dat-unit-{uid}']['attackApproach']
            self.assertEqual((approach['minimumDistance'], approach['maximumDistance'], approach['speedMultiplier']), (2, maximum, 1.25))
            self.assertEqual((approach['source']['task'], approach['source']['flag'], approach['source']['event']), (133, 2001, 0))


if __name__ == '__main__':
    unittest.main()
