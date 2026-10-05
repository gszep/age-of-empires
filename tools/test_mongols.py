import json
from pathlib import Path
import tempfile
import unittest

from test_import_aoe2 import extracted_content, _dat, AUDIO_PACK, SOURCES
from import_audio import consumed_cues, read_audio_packs, resolve_event_id, reviewed_unavailable_cue


class MongolsImportTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.content = extracted_content()
        cls.profile = cls.content['civilizations']['mongols']

    def test_complete_source_roster_identity_and_foreign_unique_exclusion(self):
        row = self.content['civilizationCatalog']['mongols']
        self.assertEqual(row['missingRoster'], [])
        self.assertEqual((row['datIndex'], row['treeEffectId'], row['teamEffectId']), (12, 277, 407))
        self.assertTrue(row['enabled'])
        self.assertEqual(row['hudStyle'], 'CivNomad')
        p = self.profile
        self.assertEqual(p['audio']['switch'], 'Mongols')
        self.assertEqual(p['civilization']['displayName'], 'Mongols')
        # Mongol unique units must be available (in entities)
        self.assertIn('dat-unit-11', p['entities'])
        self.assertIn('dat-unit-561', p['entities'])
        self.assertIn('dat-unit-1370', p['entities'])  # Steppe Lancer
        self.assertIn('dat-unit-1372', p['entities'])  # Elite Steppe Lancer
        self.assertEqual(p['entities']['dat-unit-11']['text']['name'], 'Mangudai')
        self.assertEqual(p['entities']['dat-unit-561']['text']['name'], 'Elite Mangudai')
        # Foreign uniques must be unavailable
        self.assertIn(46, p['civilization']['unavailable']['units'])  # Turks Janissary
        self.assertIn(692, p['civilization']['unavailable']['units'])  # Vikings Berserk
        self.assertTrue(all(t['name'] == 'Nomads' or 'do not have it' in t['reason'] for t in p['skippedTechnologies']))

    def test_mangudai_and_steppe_lancer_art_is_owned_not_fallback(self):
        p = self.profile
        # Verify Mangudai line
        for uid, name in [(11, 'Mangudai'), (561, 'Elite Mangudai')]:
            e = p['entities'][f'dat-unit-{uid}']
            self.assertEqual(e['text']['name'], name)
            self.assertEqual(e['combat']['accuracyPercent'], _dat().civs[12].units[uid].type_50.accuracy_percent)
            self.assertEqual(e['combat']['accuracyPercent'], 95)
            self.assertEqual(e['combat']['projectileUnitId'], 477)
            self.assertEqual(e['train']['buildingId'], 82)
            for action in ['idle', 'walk', 'attack', 'death', 'decay']:
                self.assertTrue(SOURCES.path(e['animations'][action]['source']).is_file())
        # Verify Steppe Lancer line
        for uid, name in [(1370, 'Steppe Lancer'), (1372, 'Elite Steppe Lancer')]:
            e = p['entities'][f'dat-unit-{uid}']
            self.assertEqual(e['text']['name'], name)
            self.assertEqual(e['train']['buildingId'], 101)
            for action in ['idle', 'walk', 'attack', 'death']:
                self.assertTrue(SOURCES.path(e['animations'][action]['source']).is_file())
        self.assertIn('elite-mangudai', p['technologies'])
        self.assertEqual(p['technologies']['elite-mangudai']['upgrades'],
                         [{'from': 'dat-unit-11', 'to': 'dat-unit-561'}])
        self.assertEqual(p['technologies']['elite-steppe-lancer']['upgrades'],
                         [{'from': 'dat-unit-1370', 'to': 'dat-unit-1372'}])

    def test_drill_unique_tech_affects_siege_units(self):
        p = self.profile
        t = p['technologies']['drill']
        self.assertEqual(t['techId'], 6)
        self.assertEqual(t['researchedAt'], 82)
        self.assertEqual(t['cost'], {'wood': 500, 'gold': 450})
        targets = [e['unit'] for e in t['effects']]
        for key in ['siege-tower', 'battering-ram', 'capped-ram', 'mangonel', 'onager', 'dat-unit-548', 'dat-unit-588', 'scorpion', 'heavy-scorpion']:
            self.assertIn(key, targets)
        self.assertNotIn('trebuchet', targets)
        self.assertTrue(all(e == {'unit': e['unit'], 'attribute': 'speed', 'operation': 'multiply', 'amount': 1.5} for e in t['effects']))

    def test_light_cavalry_bonus_is_multiplicative_not_unit_cost_discount(self):
        profiles = {self.content['civilization']['key']: self.content, **self.content['civilizations']}
        inventory = {(key, tid): node['disabledByTechs']
                     for key, profile in profiles.items()
                     for tid, node in profile['civilizationBonuses']['nodes'].items()
                     if 'disabledByTechs' in node}
        self.assertEqual(inventory, {
            ('mongols', '286'): [288], ('mongols', '288'): [286],
            ('mongols', '287'): [388], ('mongols', '388'): [287]})
        nodes = self.profile['civilizationBonuses']['nodes']
        self.assertEqual({int(tid) for tid, n in nodes.items() if n.get('disabledByTechs')}, {286, 287, 288, 388})
        for tid, requires, counterpart in [(286, [102, 435], 288), (288, [102], 286),
                                           (287, [103, 435], 388), (388, [103], 287)]:
            node = nodes[str(tid)]
            self.assertEqual(node['requiredTechs'], requires)
            self.assertEqual(node['requiredTechCount'], len(requires))
            self.assertEqual(node['disabledByTechs'], [counterpart])
            self.assertTrue(all(e['attribute'] == 'hitPoints' for e in node['effects']))
            self.assertEqual([e['unit'] for e in node['effects'] if e['operation'] == 'multiply' and e['amount'] < 2],
                ['scout-cavalry', 'light-cavalry', 'dat-unit-441', 'dat-unit-1370', 'dat-unit-1372'] * (2 if tid in (286, 287) else 1))
        self.assertEqual(nodes['288']['effects'][0]['amount'], 1.2)
        self.assertEqual(nodes['388']['effects'][0]['amount'], 1.084)
        self.assertEqual([(e['operation'], e['amount']) for e in nodes['287']['effects'] if e['unit'] == 'light-cavalry'],
                         [('multiply', 100), ('add', -2000), ('multiply', 1.08333), ('add', 2000), ('multiply', .01)])

    def test_hunter_work_rate_bonus(self):
        nodes = self.profile['civilizationBonuses']['nodes']
        self.assertEqual([(c.a, c.c, round(c.d, 5)) for c in _dat().effects[388].effect_commands],
                         [(216, 13, 1.4), (122, 13, 1.4)])
        self.assertEqual(nodes['389']['effects'], [
            {'unit': 'villager-hunter', 'attribute': 'workRate', 'operation': 'multiply', 'amount': 1.4}])

    def test_fire_rate_and_team_sight_are_not_armour(self):
        nodes = self.profile['civilizationBonuses']['nodes']
        self.assertEqual(nodes['394']['effects'], [
            {'unit': k, 'attribute': 'reloadSeconds', 'operation': 'multiply', 'amount': .8}
            for k in ['cavalry-archer', 'heavy-cavalry-archer', 'dat-unit-11', 'dat-unit-561']])
        self.assertEqual(nodes['-2']['effects'], [
            {'unit': k, 'attribute': a, 'operation': 'add', 'amount': 2}
            for a in ['lineOfSight', 'searchRadius'] for k in ['scout-cavalry', 'light-cavalry', 'dat-unit-441']])

    def test_nomads_is_explicitly_deferred_house_storage_not_cavalry_archers(self):
        d = _dat()
        for uid in [70, 463, 464, 465, 191, 192]:
            self.assertEqual(d.civs[12].units[uid].class_, 3)
            storage = d.civs[12].units[uid].resource_storages[0]
            self.assertEqual((storage.type, storage.amount, storage.flag), (4, 5, 8 if uid in [191, 192] else 4))
        self.assertEqual([(c.type, c.a, c.b, c.d) for c in d.effects[542].effect_commands],
                         [(3, 70, 191, 5), (3, 463, 191, 5), (3, 464, 191, 5)])
        self.assertEqual(self.profile['civilizationBonuses']['nodes']['641']['requiredTechs'], [487, 103])
        self.assertNotIn('nomads', self.profile['technologies'])
        nomads = [t for t in self.profile['skippedTechnologies'] if t['name'] == 'Nomads']
        self.assertEqual(len(nomads), 1)
        self.assertIn('none of its effects reach anything imported', nomads[0]['reason'])

    def test_every_mongol_audio_graph_resolves_or_is_an_exact_reviewed_source_gap(self):
        banks = read_audio_packs([AUDIO_PACK, AUDIO_PACK.with_name('Base.1.pck')])
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            ui, content = root / 'ui.json', root / 'content.json'
            ui.write_text('{"sounds":{}}')
            content.write_text(json.dumps({'civilizations': {'mongols': self.profile}}))
            gaps = {}
            for cue in consumed_cues(ui, content):
                event_id = cue['id'] & 0xffffffff
                candidates = [b for b in banks if event_id in b.objects]
                if candidates:
                    self.assertTrue(resolve_event_id(candidates[0], event_id, cue['switch']), cue)
                else:
                    gap = reviewed_unavailable_cue(cue, banks)
                    self.assertIsNotNone(gap, cue)
                    self.assertEqual(gap['issue'], 271)
                    gaps[cue['alias']] = event_id
            self.assertEqual(gaps, {})


if __name__ == '__main__':
    unittest.main()
