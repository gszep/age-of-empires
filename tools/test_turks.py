import json
from pathlib import Path
import tempfile
import unittest

from test_import_aoe2 import extracted_content, _dat, AUDIO_PACK, SOURCES
from import_audio import consumed_cues, read_audio_packs, resolve_event_id, reviewed_unavailable_cue


class TurksImportTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.content = extracted_content()
        cls.profile = cls.content['civilizations']['turks']

    def test_complete_source_roster_identity_and_foreign_unique_exclusion(self):
        row = self.content['civilizationCatalog']['turks']
        self.assertEqual(row['missingRoster'], [])
        self.assertEqual((row['datIndex'], row['treeEffectId'], row['teamEffectId']), (10, 263, 410))
        self.assertTrue(row['enabled'])
        self.assertEqual(row['hudStyle'], 'CivOrie')
        p = self.profile
        self.assertEqual(p['audio']['switch'], 'Turks')
        self.assertEqual(p['civilization']['displayName'], 'Turks')
        self.assertIn(282, p['civilization']['unavailable']['units'])
        self.assertIn(6, p['civilization']['unavailable']['units'])  # Elite Skirmisher
        self.assertTrue(all('do not have it' in t['reason'] for t in p['skippedTechnologies']))

    def test_janissary_art_projectile_and_upgrade_are_owned_not_fallback(self):
        p = self.profile
        for uid, name in [(46, 'Janissary'), (557, 'Elite Janissary')]:
            e = p['entities'][f'dat-unit-{uid}']
            self.assertEqual(e['text']['name'], name)
            self.assertEqual(e['combat']['accuracyPercent'], _dat().civs[10].units[uid].type_50.accuracy_percent)
            for action in ['idle', 'walk', 'attack', 'death']:
                self.assertTrue(SOURCES.path(e['animations'][action]['source']).is_file())
        self.assertIn('dat-projectile-380', p['entities'])
        self.assertEqual(p['technologies']['elite-janissary']['upgrades'],
                         [{'from': 'dat-unit-46', 'to': 'dat-unit-557'}])

    def test_passives_decode_training_time_not_a_unit_cost_discount(self):
        nodes = self.profile['civilizationBonuses']['nodes']
        self.assertEqual(self.profile['entities']['villager-female-goldminer']['skinOf'], 'villager-goldminer')
        self.assertEqual([(c.a, c.c, c.d) for c in _dat().effects[295].effect_commands],
                         [(579, 13, 1.25), (581, 13, 1.25)])
        self.assertEqual(nodes['300']['effects'], [
            {'unit': 'villager-goldminer', 'attribute': 'workRate', 'operation': 'multiply', 'amount': 1.25}])
        for uid in [5, 36, 46, 557, 691]:
            self.assertIn({'unit': f'dat-unit-{uid}', 'attribute': 'hitPoints', 'operation': 'multiply', 'amount': 1.25}, nodes['301']['effects'])
            self.assertIn({'unit': f'dat-unit-{uid}', 'attribute': 'trainSeconds', 'operation': 'multiply', 'amount': .8}, nodes['-2']['effects'])
        self.assertTrue(all(e['attribute'] == 'trainSeconds' for e in nodes['-2']['effects']))
        self.assertIn({'unit': 'scout-cavalry', 'attribute': 'armor', 'operation': 'add', 'armorClass': 3, 'amount': 1}, nodes['452']['effects'])

    def test_free_research_keeps_count_gates_and_only_source_discounts(self):
        p = self.profile
        for key, tid in [('chemistry', 47), ('light-cavalry', 254), ('hussar', 428)]:
            t = p['technologies'][key]
            self.assertEqual(t['researchSeconds'], 0)
            self.assertFalse(any(t['cost'].values()))
            node = p['civilizationBonuses']['nodes'][str(tid)]
            self.assertTrue(node['automatic'])
            self.assertEqual(node['requiredTechCount'], _dat().techs[tid].required_tech_count)
        self.assertEqual(p['technologies']['hussar']['requiredTechs'], [103, 254])
        self.assertEqual(p['technologies']['bombard-tower']['cost'], {'food': 400, 'wood': 200})
        self.assertEqual(p['technologies']['elite-cannon-galleon']['cost'], {'wood': 262.5, 'gold': 250})
        self.assertEqual(p['technologies']['elite-janissary']['cost'], {'food': 850, 'gold': 750})

    def test_unique_technologies_cover_all_supported_targets(self):
        p = self.profile
        self.assertEqual(p['technologies']['sipahi']['techId'], 491)
        self.assertEqual(p['technologies']['sipahi']['cost'], {'food': 350, 'gold': 150})
        # Source effect 546 targets class 36 (cavalry archers), so every rostered
        # class-36 unit is covered, including captured Mangudai since Mongols (#190).
        self.assertEqual(p['technologies']['sipahi']['effects'], [
            {'unit': k, 'attribute': 'hitPoints', 'operation': 'add', 'amount': 20}
            for k in ['cavalry-archer', 'heavy-cavalry-archer', 'dat-unit-11', 'dat-unit-561']])
        t = p['technologies']['artillery']
        self.assertEqual(t['techId'], 10)
        self.assertEqual(t['cost'], {'food': 600, 'gold': 650})
        self.assertEqual(t['effects'], [
            {'unit': k, 'attribute': a, 'operation': 'add', 'amount': 2}
            for k in ['bombard-tower', 'dat-unit-36', 'cannon-galleon', 'dat-unit-691']
            for a in ['range', 'lineOfSight', 'searchRadius']])

    def test_every_turkish_audio_graph_resolves_or_is_an_exact_reviewed_source_gap(self):
        banks = read_audio_packs([AUDIO_PACK, AUDIO_PACK.with_name('Base.1.pck')])
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            ui, content = root / 'ui.json', root / 'content.json'
            ui.write_text('{"sounds":{}}')
            content.write_text(json.dumps({'civilizations': {'turks': self.profile}}))
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
            self.assertEqual(gaps, {
                'civilizations/turks/trade-cart-select': 3167914911,
                'civilizations/turks/trade-cart-train': 955679769,
                'civilizations/turks/events/2892846699': 2892846699})


if __name__ == '__main__':
    unittest.main()
