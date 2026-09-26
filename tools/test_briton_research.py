"""Source-to-consumer contracts for the Briton research closure."""
import unittest
from test_import_aoe2 import extracted_content, _dat


class BritonResearchTest(unittest.TestCase):
    def test_final_five_research_nodes_keep_source_consumers_and_charge_chain(self):
        content = extracted_content()
        by_id = {t['techId']: t for t in content['technologies'].values()}
        for tid, resource, amount in [(15, 'tradeVigRate', .15), (17, 'tributeInefficency', 0),
                                      (23, 'tributeInefficency', .2), (408, 'spies', 1)]:
            self.assertIn(dict(resource=resource, operation='set', amount=amount), by_id[tid]['effects'])
        self.assertEqual(by_id[408]['cost']['gold'], 200)
        entities = content['entities']
        for key in ['fire-galley', 'fire-ship', 'fast-fire-ship']:
            charge = entities[key]['fireCharge']
            source = _dat().civs[1].units[entities[key]['id']].creatable
            self.assertEqual(charge['maximum'], source.max_charge)
            self.assertEqual(charge['rechargePerSecond'], round(source.recharge_rate, 6))
            self.assertEqual((charge['event'], charge['target']), (0, 64))
            self.assertEqual(charge['projectile']['id'], source.charge_projectile_unit)
            self.assertEqual(charge['projectile']['impactEffect'], 'impact_grenade')
            self.assertEqual(charge['projectile']['impactSeconds'], 1.5)
            self.assertIn(dict(unit=key, attribute='maxCharge', operation='set', amount=1), by_id[909]['effects'])
            self.assertIn(dict(unit=key, attribute='chargeType', operation='set', amount=6), by_id[909]['effects'])
        self.assertEqual(entities['fire-charge']['id'], 2629)
        self.assertEqual(entities['fire-charge']['particleEffect'], 'flamethrower_flame')
        self.assertEqual(content['particles']['impact_grenade']['scale'], .2)
        self.assertEqual(len(content['particles']['impact_grenade']['frames']), 85)
        for key in ['buyWood', 'sellFood', 'payTribute', 'tributeStoneHelp']:
            self.assertTrue(content['strings'][key])

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
