import unittest

from test_import_aoe2 import extracted_content, sld


class BritonMonasteryImportTest(unittest.TestCase):
    def test_owned_briton_research_and_relic_art(self):
        content = extracted_content()
        self.assertEqual(content['civilization']['key'], 'britons')
        entities = content['entities']
        self.assertEqual(entities['relic']['id'], 285)
        self.assertEqual(entities['relic']['animations']['idle']['source'], sld('u_misc_relic'))
        self.assertEqual(entities['monk-relic']['animations']['idle']['source'], sld('u_monk_west_carryidleA'))
        self.assertEqual(content['playerAttributes']['relicRate'], 30)
        for key in ['devotion', 'faith', 'theocracy', 'herbal-medicine', 'block-printing', 'illumination']:
            self.assertIn(key, content['technologies'])
            self.assertTrue(content['technologies'][key].get('effects'), key)
        self.assertEqual(entities['monk']['combat']['reloadSeconds'], 1.6)
        for key in ['devotion', 'faith']:
            effects = content['technologies'][key]['effects']
            self.assertEqual({e.get('resource') for e in effects}, {'convertResistMinAdj', 'convertResistMaxAdj'})
