import unittest
from test_import_aoe2 import extracted_content


class TeutonImportTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.content = extracted_content()
        cls.teutons = cls.content['civilizations']['teutons']

    def test_conversion_task_permissions_ranges_and_messages_are_source_backed(self):
        p = self.teutons
        tasks = p['entities']['monk']['convert']['tasks']
        monk = next(t for t in tasks if t['classId'] == 18)
        building = next(t for t in tasks if t['classId'] == 3)
        ram = next(t for t in tasks if t['unitId'] == 35)
        self.assertEqual(monk['requiredResource'], 27)
        self.assertIn('Atonement', monk['failureMessage'])
        self.assertEqual((building['requiredResource'], building['minSeconds'], building['maxSeconds'], building['range']), (28,15,25,.5))
        self.assertEqual((ram['requiredResource'],ram['range']), (29,.5))
        self.assertIn('Redemption', ram['failureMessage'])
        self.assertEqual(p['playerAttributeIds']['resource-29'],29)
        self.assertEqual(p['playerAttributes']['resource-29'],0)
        self.assertEqual({e['resource'] for e in p['technologies']['redemption']['effects']}, {'convertBuilding','resource-29'})
        self.assertEqual({e['resource'] for e in p['technologies']['atonement']['effects']}, {'convertPriest'})

    def test_capacity_maximum_and_free_research_are_preserved_separately(self):
        nodes = self.teutons['civilizationBonuses']['nodes']
        tc = [e for e in nodes['336']['effects'] if e.get('unit') == 'town-center']
        self.assertIn({'unit':'town-center','attribute':'garrisonCapacity','operation':'add','amount':10},tc)
        self.assertIn({'unit':'town-center','attribute':'garrisonMaxProjectiles','operation':'add','amount':5},tc)
        self.assertTrue(nodes['322']['automatic'])
        self.assertEqual(self.teutons['technologies']['murder-holes']['cost']['food'],200)
        self.assertEqual(self.teutons['technologies']['murder-holes']['researchSeconds'],0)
        self.assertEqual(nodes['347']['effects'], [{'resource':'healRange','operation':'set','amount':8}])

    def test_bombard_tower_keeps_its_research_gate_and_fractional_arrow_effect(self):
        p = self.teutons
        self.assertIn('bombard-tower', p['entities']['bombard-tower']['requires'])
        self.assertEqual(p['entities']['bombard-tower']['combat']['projectileUnitId'],506)
        self.assertEqual(p['entities']['bombard-tower-shot']['id'],506)
        effect = next(e for e in p['technologies']['bombard-tower']['effects'] if e.get('unit') == 'dat-projectile-54')
        self.assertEqual((effect['armorClass'],effect['amount']),(3,.5))
        self.assertEqual(self.content['civilizationCatalog']['teutons']['missingRoster'],[])


if __name__ == '__main__':
    unittest.main()
