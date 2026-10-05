import unittest
from test_import_aoe2 import extracted_content


class VikingsImportTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.content = extracted_content()
        cls.profile = cls.content['civilizations']['vikings']

    def test_complete_roster_and_unique_units(self):
        row = self.content['civilizationCatalog']['vikings']
        self.assertEqual(row['missingRoster'], [])
        self.assertEqual(row['hudStyle'], 'CivSlav')
        self.assertTrue(row['enabled'])
        for uid, name in [(250, 'Longboat'), (533, 'Elite Longboat'), (692, 'Berserk'), (694, 'Elite Berserk')]:
            e = self.profile['entities'][f'dat-unit-{uid}']
            self.assertEqual(e['text']['name'], name)
            self.assertTrue(e['animations']['idle'])
            self.assertTrue(e['animations']['death'])
            if uid in (250, 533):
                self.assertNotIn('decay', e['animations'])
                self.assertEqual(e['projectilesPerAttack'], 4)
            else:
                self.assertEqual(e['regenerationPerMinute'], 40)
        self.assertNotIn('dat-unit-583', self.profile['entities'])
        self.assertNotIn('dat-unit-683', self.profile['entities'])

    def test_team_bonus_exists(self):
        self.assertEqual(self.content['civilizationCatalog']['vikings']['teamEffectId'], 411)
        graphs = self.profile['civilizationBonuses']['nodes']
        self.assertIn({'unit': 'dock', 'attribute': 'cost', 'operation': 'multiply', 'amount': .85}, graphs['-2']['effects'])
        self.assertEqual(graphs['416']['requiredTechs'], [101])
        for tid, age, factor in [('395', 101, .9), ('501', 102, .94117), ('502', 103, .94117)]:
            self.assertEqual(graphs[tid]['requiredTechs'], [age])
            self.assertIn({'unit': 'galley', 'attribute': 'cost', 'operation': 'multiply', 'amount': factor}, graphs[tid]['effects'])

    def test_free_wheelbarrow_in_feudal(self):
        self.assert_free_research('wheelbarrow', '213', [101, 758], 1)

    def test_free_hand_cart_in_castle(self):
        self.assert_free_research('hand-cart', '249', [102, 213, 763], 2)

    def assert_free_research(self, key, tid, requirements, count):
        t = self.profile['technologies'][key]
        self.assertEqual(t['researchSeconds'], 0)
        self.assertTrue(all(v == 0 for v in t['cost'].values()))
        g = self.profile['civilizationBonuses']['nodes'][tid]
        self.assertTrue(g['automatic'])
        self.assertEqual(g['requiredTechs'], requirements)
        self.assertEqual(g['requiredTechCount'], count)

    def test_current_unique_research_uses_xs_loot_not_tooltip_numbers(self):
        p = self.profile
        self.assertEqual(p['technologies']['bogsveigar']['techId'], 49)
        self.assertNotIn('berserkergang', p['technologies'])
        t = p['technologies']['chieftains']
        self.assertEqual(t['techId'], 463)
        reward = next(e['killReward'] for e in t['effects'] if e.get('unit') == 'militia' and 'killReward' in e)
        self.assertEqual(reward['resource'], 'infantryKillReward')
        self.assertEqual(reward['targets'], [
            {'classId': 2, 'amount': 20}, {'classId': 43, 'amount': 20},
            {'classId': 18, 'amount': 20}, {'unitId': 1831, 'amount': 20},
            {'classId': 4, 'amount': 5}])
        self.assertFalse(any('effectFunctionNumber' in s for s in t.get('unmodelled', [])))

    def test_unknown_scripted_effect_stays_unsupported(self):
        from types import SimpleNamespace
        from import_content import effects_of
        dat = SimpleNamespace(techs=[SimpleNamespace(effect_id=0)], effects=[SimpleNamespace(
            effect_commands=[SimpleNamespace(type=1, a=33, b=0, c=-1, d=99)])])
        effects, _, unreached = effects_of(dat, 0, {}, {'effectFunctionNumber': 33})
        self.assertEqual(effects, [])
        self.assertTrue(any('effectFunctionNumber' in s for s in unreached))


if __name__ == '__main__':
    unittest.main()
