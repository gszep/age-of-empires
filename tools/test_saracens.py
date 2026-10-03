import unittest
from test_import_aoe2 import extracted_content


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
        self.assertFalse(any(t['name'] == 'Bimaristan' for t in p['skippedTechnologies']))

    def test_bimaristan_expands_owned_xs_instead_of_granting_resource33(self):
        t = self.profile['technologies']['bimaristan']
        self.assertEqual(t['cost'], {'wood': 300, 'gold': 200})
        self.assertEqual(t['researchSeconds'], 50)
        self.assertEqual({e['unit'] for e in t['effects']}, {'monk', 'monk-relic'})
        for e in t['effects']:
            self.assertEqual(e['attribute'], 'healingAura')
            self.assertEqual(e['healingAura']['range'], 5)
            self.assertEqual(e['healingAura']['hitPointsPerSecond'], 1.25)
            self.assertEqual(e['healingAura']['targetClasses'], [0, 4, 6, 12, 18, 19, 23, 35, 36, 43, 44, 47, 49, 59])
            self.assertNotIn('resource', e)


if __name__ == '__main__':
    unittest.main()
