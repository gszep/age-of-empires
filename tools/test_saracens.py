import unittest
from test_import_aoe2 import extracted_content, DAT, _dat


class SaracensImportTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.content = extracted_content()
        cls.profile = cls.content['civilizations']['saracens']

    def test_complete_roster_and_current_unique_research(self):
        row = self.content['civilizationCatalog']['saracens']
        self.assertEqual(row['missingRoster'], [])
        self.assertEqual(row['hudStyle'], 'CivOrie')
        p = self.profile
        self.assertEqual(p['entities']['dat-unit-282']['text']['name'], 'Mameluke')
        self.assertEqual(p['entities']['dat-unit-556']['text']['name'], 'Elite Mameluke')
        self.assertEqual(p['technologies']['counterweights']['techId'], 454)
        self.assertNotIn('zealotry', p['technologies'])
        self.assertNotIn('madrasah', p['technologies'])
        skipped, = [t for t in p['skippedTechnologies'] if t['techId'] == 28]
        self.assertEqual(skipped['name'], 'Bimaristan')
        self.assertIn('deferred-civ exclusion #324', skipped['reason'])

    def test_185872_bimaristan_is_explicitly_excluded_not_approximated_with_old_targets(self):
        from scripted_effects import healing_aura, UnsupportedBimaristanMask
        self.assertNotIn('bimaristan', self.profile['technologies'])
        with self.assertRaisesRegex(UnsupportedBimaristanMask, 'complement class mask'):
            healing_aura(DAT.parent.parent, {})
        tech = _dat().techs[28]
        self.assertEqual(tech.effect_id, 28)
        self.assertEqual({c.type: c.amount for c in tech.resource_costs if c.flag}, {1: 300, 3: 200})
        self.assertEqual(tech.research_locations[0].research_time, 50)
        self.assertFalse(any(e.get('attribute') == 'healingAura' for node in
                             self.profile['civilizationBonuses']['nodes'].values() for e in node['effects']))
        # Positive48987 target/amount coverage lives in the synthetic XS fixture
        # test_scripted_effects.ScriptRewriteTest.test_legacy_bimaristan_expands_targets.


if __name__ == '__main__':
    unittest.main()
