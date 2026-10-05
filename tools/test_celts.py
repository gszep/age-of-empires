import json
import re
from pathlib import Path
import tempfile
import unittest

from test_import_aoe2 import extracted_content, _dat, AUDIO_PACK, SOURCES, DAT
from scripted_effects import stronghold_aura
from import_audio import consumed_cues, read_audio_packs, resolve_event_id, reviewed_unavailable_cue


class CeltsImportTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.content = extracted_content()
        cls.profile = cls.content['civilizations']['celts']

    def test_complete_source_roster_identity_and_foreign_unique_exclusion(self):
        row = self.content['civilizationCatalog']['celts']
        self.assertEqual(row['missingRoster'], [])
        self.assertEqual((row['datIndex'], row['treeEffectId'], row['teamEffectId']), (13, 275, 401))
        self.assertEqual(row['hudStyle'], 'CivWest')
        self.assertTrue(row['enabled'])
        p = self.profile
        self.assertEqual(p['audio']['switch'], 'Celts')
        self.assertEqual(p['civilization']['displayName'], 'Celts')
        self.assertTrue(all('do not have it' in t['reason'] for t in p['skippedTechnologies']))
        for uid in [46, 557, 692, 694, 250, 533]:
            self.assertIn(uid, p['civilization']['unavailable']['units'])

    def test_woad_raider_art_and_upgrade_are_owned_not_fallback(self):
        p = self.profile
        for uid, name in [(232, 'Woad Raider'), (534, 'Elite Woad Raider')]:
            e = p['entities'][f'dat-unit-{uid}']
            self.assertEqual(e['text']['name'], name)
            self.assertEqual(e['combat']['accuracyPercent'], _dat().civs[13].units[uid].type_50.accuracy_percent)
            for action in ['idle', 'walk', 'attack', 'death']:
                self.assertTrue(SOURCES.path(e['animations'][action]['source']).is_file())
            self.assertEqual(e['id'], uid)
            self.assertEqual(e['hitPoints'], 70 if uid == 232 else 85)
            self.assertEqual(e['speedTilesPerSecond'], 1.17)
            self.assertEqual(e['train']['buildingId'], 82)
        self.assertEqual(p['technologies']['elite-woad-raider']['upgrades'],
                         [{'from': 'dat-unit-232', 'to': 'dat-unit-534'}])
        self.assertEqual(p['technologies']['elite-woad-raider']['cost'], {'food': 1000, 'gold': 800})

    def test_passives_decode_lumberjack_and_infantry_bonuses(self):
        nodes = self.profile['civilizationBonuses']['nodes']
        self.assertEqual(nodes['385']['requiredTechs'], [])
        self.assertEqual(nodes['385']['effects'], [
            {'unit': 'villager-lumberjack', 'attribute': 'workRate', 'operation': 'multiply', 'amount': 1.15}])
        for tid, age, multiplier in [(393, 104, 1.05), (898, 101, 1.04762),
                                     (899, 102, 1.04545), (900, 103, 1.04348)]:
            self.assertEqual(nodes[str(tid)]['requiredTechs'], [age])
            self.assertEqual(nodes[str(tid)]['requiredTechCount'], 1)
            for key in ['militia', 'dat-unit-232', 'dat-unit-534']:
                self.assertIn({'unit': key, 'attribute': 'speed', 'operation': 'multiply', 'amount': multiplier}, nodes[str(tid)]['effects'])
        self.assertEqual(nodes['386']['requiredTechs'], [])
        for key in ['battering-ram', 'mangonel', 'scorpion', 'trebuchet-unpacked']:
            self.assertIn({'unit': key, 'attribute': 'reloadSeconds', 'operation': 'multiply', 'amount': .8}, nodes['386']['effects'])
        self.assertIn({'unit': 'siege-workshop', 'attribute': 'workRate', 'operation': 'multiply', 'amount': 1.2}, nodes['-2']['effects'])
        # Deferred rather than a silently enabled ineffective consumer.
        self.assertEqual(nodes['405']['effects'], [])
        self.assertIn('resource 97 (dominantSheepControl) at the player level: not modelled', nodes['405']['unmodelled'])

    def test_unique_technologies_stronghold_and_furor_celtica(self):
        p = self.profile
        strong = p['technologies']['stronghold']
        self.assertEqual(strong['techId'], 482)
        self.assertEqual(strong['cost'], {'food': 250, 'gold': 200})
        self.assertEqual(strong.get('unmodelled', []), [])
        for key in ['castle', 'watch-tower', 'guard-tower', 'keep', 'bombard-tower']:
            self.assertIn({'unit': key, 'attribute': 'reloadSeconds', 'operation': 'multiply', 'amount': .75}, strong['effects'])
        aura = [e for e in strong['effects'] if e['attribute'] == 'healingAura']
        self.assertEqual(len(aura), 1)
        self.assertEqual(aura[0]['unit'], 'castle')
        self.assertEqual(aura[0]['healingAura'], {
            'sourceUnitIds': [82], 'sourceClasses': [], 'excludedSourceIds': [],
            'targetClasses': [6], 'targetUnitIds': [1831], 'range': 7,
            'hitPointsPerSecond': .5, 'helpStringId': 13405})
        furor = p['technologies']['furor-celtica']
        self.assertEqual(furor['techId'], 5)
        self.assertEqual(furor['cost'], {'food': 750, 'gold': 450})
        for key in ['battering-ram', 'mangonel', 'scorpion', 'trebuchet', 'trebuchet-unpacked']:
            self.assertIn({'unit': key, 'attribute': 'hitPoints', 'operation': 'multiply', 'amount': 1.4}, furor['effects'])

    def test_every_celtic_audio_graph_resolves_or_is_an_exact_reviewed_source_gap(self):
        banks = read_audio_packs([AUDIO_PACK, AUDIO_PACK.with_name('Base.1.pck')])
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            ui, content = root / 'ui.json', root / 'content.json'
            ui.write_text('{"sounds":{}}')
            content.write_text(json.dumps({'civilizations': {'celts': self.profile}}))
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

    def test_stronghold_script_rejects_reordered_and_inserted_statements(self):
        common = DAT.parent.parent
        text = (common / 'xs/Effects.xs').read_text(encoding='utf-8-sig')
        body = re.search(r'void EffectFunction8\(int playerId = -1\)\s*\{(.*?)\n\}', text, re.S)[1]
        lines = [line.strip() for line in body.splitlines() if line.strip()]
        reordered = lines.copy()
        reordered[4], reordered[5] = reordered[5], reordered[4]
        task_index = lines.index('xsTask(CastleID, cTaskTypeAura, WarriorPriestWithRelicID, playerId);')
        mutations = {'reordered': reordered}
        for name, inserted in {
            'reset': ['xsResetTaskAmount();'],
            'duplicate': ['xsTaskAmount(cTaskAttrWorkValue1, 30);'],
            'differing_assignment': ['xsTaskAmount(cTaskAttrWorkValue1, 60);',
                                     'xsTaskAmount(cTaskAttrWorkValue1, 30);'],
        }.items():
            mutations[name] = lines[:task_index] + inserted + lines[task_index:]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'xs').mkdir()
            (root / 'xs/Constants.xs').write_bytes((common / 'xs/Constants.xs').read_bytes())
            effects = root / 'xs/Effects.xs'
            effects.write_text(text)
            self.assertEqual(stronghold_aura(root, {}), stronghold_aura(common, {}))
            for name, changed in mutations.items():
                with self.subTest(name=name):
                    effects.write_text(text.replace(body, '\n' + '\n'.join(changed)))
                    with self.assertRaisesRegex(ValueError, 'statement order/count changed'):
                        stronghold_aura(root, {})


if __name__ == '__main__':
    unittest.main()
