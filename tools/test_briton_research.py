"""Source-to-consumer contracts for the Briton research closure."""
import unittest
from test_import_aoe2 import extracted_content, _dat


class BritonResearchTest(unittest.TestCase):
    def test_warwolf_and_shipwright_keep_their_source_target_and_zero_baseline(self):
        content = extracted_content()
        dat = _dat()
        deployed = content['entities']['trebuchet-unpacked']['combat']
        self.assertEqual(deployed['blastRadius'], dat.civs[1].units[42].type_50.blast_width)
        self.assertEqual(deployed['blastRadius'], 0)
        self.assertEqual(deployed['blastAttackLevel'], 1)
        effects = content['technologies']['warwolf']['effects']
        self.assertIn(dict(unit='trebuchet-unpacked', attribute='blastRadius', operation='add', amount=.5), effects)
        self.assertIn(dict(unit='trebuchet-unpacked', attribute='accuracyPercent', operation='set', amount=100), effects)
        shipwright = content['technologies']['shipwright']['effects']
        for kind in ('fishing-ship', 'galley', 'trade-cog', 'transport-ship'):
            self.assertIn(dict(unit=kind, attribute='trainSeconds', operation='multiply', amount=.65), shipwright)
        caravan = content['technologies']['caravan']['effects']
        self.assertIn(dict(unit='trade-cart', attribute='workRate', operation='multiply', amount=1.2), caravan)


if __name__ == '__main__':
    unittest.main()
