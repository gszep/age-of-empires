"""Small authored XS fixtures: accept syntax changes, reject semantic changes."""
import tempfile
import unittest
from pathlib import Path

from scripted_effects import free_llama
from scripted_effects import (stronghold_aura, infantry_loot, healing_aura,
                              UnsupportedBimaristanMask, deferred_script_exclusion)
from types import SimpleNamespace as NS
from unittest.mock import patch


LITERAL = '''void EffectFunction1(int playerId = -1)
{
    int llamaId = 305;
    int randomNumber = xsGetRandomNumberLH(0, 2);
    if (randomNumber == 1)
    {
        llamaId = 1963;
    }
    xsEffectAmount(cSpawnUnit, llamaId, 619, 1, playerId);
}
'''
NAMED = ('const int Llama1ID = 305;\nconst int Llama2ID = 1963;\n'
         + LITERAL.replace('llamaId', 'targetLlama').replace('= 305;', '= Llama1ID;')
         .replace('= 1963;', '= Llama2ID;'))


def bimaristan_command(**changes):
    return NS(**{'type': 1, 'a': 33, 'b': 0, 'c': -1, 'd': 7.0, **changes})


class FreeLlamaTest(unittest.TestCase):
    def extract(self, text, constant=7):
        with tempfile.TemporaryDirectory() as directory:
            common = Path(directory)
            (common / 'xs').mkdir()
            (common / 'xs/Effects.xs').write_text(text)
            (common / 'xs/Constants.xs').write_text(f'extern const int cSpawnUnit = {constant};\n')
            hashes = {}
            result = free_llama(common, hashes)
            self.assertEqual(set(hashes), {'xs/Effects.xs', 'xs/Constants.xs'})
            return result

    def test_literal_and_named_forms(self):
        for text in (LITERAL, NAMED):
            with self.subTest(text=text):
                self.assertEqual(self.extract(text), {'unitIds': [305, 1963], 'buildingId': 619, 'count': 1})

    def test_semantic_mutations_fail(self):
        mutations = [('= 305;', '= 306;'), ('= 1963;', '= 305;'),
                     ('LH(0, 2)', 'LH(0, 3)'), ('randomNumber == 1', 'randomNumber == 0'),
                     ('619, 1, playerId', '620, 1, playerId'),
                     ('619, 1, playerId', '619, 2, playerId'),
                     ('targetLlama, 619', 'Llama1ID, 619'),
                     ('targetLlama', 'randomNumber'),
                     ('targetLlama', 'playerId'),
                     ('    if (', '    xsResetTaskAmount();\n    if (')]
        for before, after in mutations:
            with self.subTest(mutation=before):
                self.assertIn(before, NAMED)
                with self.assertRaises(ValueError):
                    self.extract(NAMED.replace(before, after))
        with self.assertRaises(ValueError):
            self.extract(NAMED, constant=8)

    def test_unresolved_or_duplicate_constants_fail(self):
        for text in (NAMED.replace('const int Llama1ID = 305;\n', ''),
                     'const int Llama1ID = 306;\n' + NAMED,
                     NAMED.replace('const int Llama1ID = 305;', 'const int Llama1ID = 300 + 5;')):
            with self.subTest(text=text), self.assertRaises(ValueError):
                self.extract(text)

    def test_local_names_cannot_shadow_referenced_globals(self):
        for name in ('Llama1ID', 'Llama2ID', 'cSpawnUnit'):
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, 'local binding shadows'):
                self.extract(NAMED.replace('targetLlama', name))
        text = ('const int randomNumber = 1963;\n'
                + NAMED.replace('targetLlama = Llama2ID;', 'targetLlama = randomNumber;'))
        with self.assertRaisesRegex(ValueError, 'local binding shadows'):
            self.extract(text)


class ScriptRewriteTest(unittest.TestCase):
    def extract(self, adapter, body, constants=''):
        with tempfile.TemporaryDirectory() as directory:
            common = Path(directory)
            (common / 'xs').mkdir()
            (common / 'xs/Effects.xs').write_text(body)
            (common / 'xs/Constants.xs').write_text(constants)
            return adapter(common, {})

    def test_legacy_bimaristan_expands_targets(self):
        # Authored48987-shaped explicit targets, not185872's unsupported mask.
        targets = [0, 4, 6, 12, 18, 19, 23, 35, 36, 43, 44, 47, 49, 59]
        constants = 'extern const int cMonkClass = 918;\nextern const int cMonkWithRelicClass = 943;\n'
        constants += ''.join(f'extern const int cTarget{t}Class = {900+t};\n' for t in targets)
        body = ['int WarriorPriestWithRelicID = 1831;']
        body += [f'xsTaskAmount(cTaskAttr{name}, {value});' for name, value in [
            ('WorkValue1', 75), ('WorkValue2', 1), ('WorkRange', 5),
            ('GatheringSoundInt32', 13404), ('OwnerType', 4), ('CombatLevelFlag', 2),
            ('SearchWaitTime', 109), ('GatherType', 21)]]
        for source in ('cMonkClass', 'cMonkWithRelicClass'):
            body.append(f'xsEffectAmount(cAddAttribute, {source}, cCombatAbility, 32, playerId);')
            body += [f'xsTask({source}, cTaskTypeAura, cTarget{t}Class, playerId);' for t in targets]
        body += [f'xsRemoveTask(WarriorPriestWithRelicID, cTaskTypeAura, cTarget{t}Class, playerId);' for t in targets]
        result = self.extract(healing_aura, 'void EffectFunction7(int playerId = -1)\n{\n' + '\n'.join(body) + '\n}\n', constants)
        self.assertEqual(result, {'sourceClasses': [18, 43], 'targetClasses': targets,
                                 'excludedSourceIds': [1831], 'range': 5,
                                 'hitPointsPerSecond': 1.25, 'helpStringId': 13404})
        from import_content import effects_of
        dat = NS(techs=[NS(effect_id=0)], effects=[NS(effect_commands=[
            NS(type=1, a=33, b=0, c=-1, d=7)])])
        entities = {'monk': {'id': 125, 'class': 18}, 'monk-relic': {'id': 286, 'class': 43},
                    'excluded': {'id': 1831, 'class': 43}, 'infantry': {'id': 74, 'class': 6}}
        effects, unmodelled, unreached = effects_of(dat, 0, entities, {'effectFunctionNumber': 33},
                                                   scripted_effects={7: result})
        self.assertEqual({e['unit'] for e in effects}, {'monk', 'monk-relic'})
        for effect in effects:
            self.assertEqual(effect['attribute'], 'healingAura')
            self.assertEqual(effect['healingAura'], result)
            self.assertNotIn('resource', effect)
        self.assertEqual((unmodelled, unreached), ([], []))

    def test_stronghold_local_and_global_ids(self):
        program = ['xsResetTaskAmount();',
                   'xsEffectAmount(cAddAttribute, CastleID, cCombatAbility, 32, playerId);']
        program += [f'xsTaskAmount(cTaskAttr{k}, {v});' for k, v in [
            ('WorkValue1', 30), ('WorkValue2', 1), ('WorkRange', 7),
            ('GatheringSoundInt32', 13405), ('DepositSoundInt32', 13405),
            ('OwnerType', 4), ('CombatLevelFlag', 4), ('SearchWaitTime', 109), ('GatherType', 21)]]
        program += ['xsTask(CastleID, cTaskTypeAura, cInfantryClass, playerId);',
                    'xsTask(CastleID, cTaskTypeAura, WarriorPriestWithRelicID, playerId);',
                    'xsResetTaskAmount();']
        ids = 'int WarriorPriestWithRelicID = 1831;\nint CastleID = 82;\n'
        function = 'void EffectFunction8(int playerId = -1)\n{\n'
        old = function + ids + '\n'.join(program) + '\n}\n'
        new = ids.replace('int ', 'const int ') + function + '\n'.join(program) + '\n}\n'
        constants = 'extern const int cInfantryClass = 906;\n'
        result = self.extract(stronghold_aura, old, constants)
        self.assertEqual(result, self.extract(stronghold_aura, new, constants))
        self.assertEqual((result['sourceUnitIds'], result['targetUnitIds'], result['hitPointsPerSecond']),
                         ([82], [1831], .5))
        for body in (new.replace('const int CastleID = 82;\n', ''),
                     new.replace('xsTask(CastleID', 'xsResetTaskAmount();\nxsTask(CastleID', 1)):
            with self.assertRaises(ValueError):
                self.extract(stronghold_aura, body, constants)

    def test_loot_local_and_global_ids_and_source_amounts(self):
        program = '''xsResetTaskAmount();
xsTaskAmount(cTaskAttrWorkValue1, 20);
xsTaskAmount(cTaskAttrProductivityResource, cAttributeInfantryKillReward);
xsTaskAmount(cTaskAttrResourceOut, cAttributeGold);
xsTask(cInfantryClass, cTaskTypeLoot, WarriorPriestWithRelicID, playerId);
xsTaskAmount(cTaskAttrWorkValue1, 5);
xsTask(cInfantryClass, cTaskTypeLoot, cVillagerClass, playerId);
xsResetTaskAmount();'''
        function = 'void EffectFunction5(int playerId = -1)\n{\n'
        old = function + 'int WarriorPriestWithRelicID = 1831;\n' + program + '\n}\n'
        new = 'const int WarriorPriestWithRelicID = 1831;\n' + function + program + '\n}\n'
        constants = 'extern const int cInfantryClass = 906;\nextern const int cVillagerClass = 904;\n'
        result = self.extract(infantry_loot, old, constants)
        self.assertEqual(result, self.extract(infantry_loot, new, constants))
        self.assertEqual(result['targets'], [{'unitId': 1831, 'amount': 20}, {'classId': 4, 'amount': 5}])
        from import_content import effects_of
        dat = NS(techs=[NS(effect_id=0)], effects=[NS(effect_commands=[
            NS(type=1, a=33, b=0, c=-1, d=5)])])
        effects, unmodelled, unreached = effects_of(dat, 0,
            {'militia': {'id': 74, 'class': 6}, 'knight': {'id': 38, 'class': 12}},
            {'effectFunctionNumber': 33}, scripted_effects={5: result})
        self.assertEqual(effects, [{'unit': 'militia', 'attribute': 'killReward', 'operation': 'set',
                                   'amount': 1, 'killReward': result}])
        self.assertEqual((unmodelled, unreached), ([], []))
        self.assertEqual(self.extract(infantry_loot, new.replace('WorkValue1, 20', 'WorkValue1, 25'),
                                      constants)['targets'][0]['amount'], 25)

    def test_bimaristan_mask_is_not_approximated(self):
        with self.assertRaises(UnsupportedBimaristanMask) as caught:
            self.extract(healing_aura, BIMARISTAN_MASK, BIMARISTAN_CONSTANTS)
        reason = deferred_script_exclusion('saracens', 9, 28, 9, 28, caught.exception,
                                           commands=[bimaristan_command()])
        self.assertIn('deferred-civ exclusion #324', reason)
        for identity in [('britons', 1, 28, 9, 28), ('incas', 21, 28, 9, 28),
                         ('saracens', 9, 29, 9, 28), ('saracens', 9, 28, 9, 29)]:
            with self.subTest(identity=identity), self.assertRaises(UnsupportedBimaristanMask):
                deferred_script_exclusion(*identity, caught.exception, commands=[bimaristan_command()])
        with self.assertRaisesRegex(ValueError, 'unrelated'):
            deferred_script_exclusion('saracens', 9, 28, 9, 28, ValueError('unrelated'),
                                      commands=[bimaristan_command()])
        for before, after in [('WorkRange, 5', 'WorkRange, 6'),
                              ('cFlagClassShip', 'cFlagClassInfantry'),
                              ('cMonkClass, playerId, 0', 'cMonkClass, playerId, 1')]:
            with self.subTest(before=before), self.assertRaises(ValueError) as changed:
                self.extract(healing_aura, BIMARISTAN_MASK.replace(before, after), BIMARISTAN_CONSTANTS)
            self.assertNotIsInstance(changed.exception, UnsupportedBimaristanMask)

    def test_bimaristan_changed_constants_are_not_excludable(self):
        # Same statement text, different source or mask semantics must never
        # reach the deliberately caught UnsupportedBimaristanMask exception.
        import re
        for name, value in re.findall(r'const int (\w+) = (-?\d+);', BIMARISTAN_CONSTANTS + BIMARISTAN_MASK):
            before, after = f'{name} = {value};', f'{name} = {int(value) + 1};'
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, f'constant {name} changed') as changed:
                self.extract(healing_aura, BIMARISTAN_MASK.replace(before, after),
                             BIMARISTAN_CONSTANTS.replace(before, after))
            self.assertNotIsInstance(changed.exception, UnsupportedBimaristanMask)
        for body, constants in [
            (BIMARISTAN_MASK, BIMARISTAN_CONSTANTS.replace('extern const int cMonkClass = 918;\n', '')),
            ('const int cMonkClass = 918;\n' + BIMARISTAN_MASK, BIMARISTAN_CONSTANTS),
            (BIMARISTAN_MASK, BIMARISTAN_CONSTANTS.replace('cFlagClassShip = 64;', 'cFlagClassShip = 32 + 32;')),
        ]:
            with self.subTest(body=body, constants=constants), self.assertRaises(ValueError) as changed:
                self.extract(healing_aura, body, constants)
            self.assertNotIsInstance(changed.exception, UnsupportedBimaristanMask)

    def test_excluded_technology_is_logged_and_not_offered(self):
        from import_content import technologies_from_tree
        dat = NS(civs={9: NS(tech_tree_id=1)}, effects={1: NS(effect_commands=[]),
                 28: NS(effect_commands=[bimaristan_command()])},
                 techs={28: NS(civ=9, effect_id=28)})
        node = {'Node ID': 28, 'Node Type': 'UniqueTech', 'Name': 'Bimaristan',
                'Node Status': 'Available', 'Building ID': 82}
        with patch('import_content.tree_nodes', return_value=[node]), \
                patch('scripted_effects.healing_aura', side_effect=UnsupportedBimaristanMask('mask')), \
                patch('import_content.technology_entry') as entry, patch('sys.stderr') as stderr:
            keep, skipped = technologies_from_tree(dat, Path('dat/source'), {'civIndex': 9}, {},
                                                   {'key': 'saracens'}, {}, {})
        self.assertEqual(keep, {})
        self.assertEqual(skipped[0]['techId'], 28)
        self.assertIn('deferred-civ exclusion #324', skipped[0]['reason'])
        entry.assert_not_called()
        self.assertTrue(stderr.write.called)

    def test_exclusion_rejects_changed_or_additional_dat_commands(self):
        from import_content import technologies_from_tree
        dat = NS(civs={9: NS(tech_tree_id=1)}, effects={1: NS(effect_commands=[]),
                 28: NS(effect_commands=[])}, techs={28: NS(civ=9, effect_id=28)})
        node = {'Node ID': 28, 'Node Type': 'UniqueTech', 'Name': 'Bimaristan',
                'Node Status': 'Available', 'Building ID': 82}
        cases = [[], [bimaristan_command(), bimaristan_command(type=4, a=125, c=0, d=10)],
                 [bimaristan_command(), bimaristan_command()]]
        cases += [[bimaristan_command(**{key: value})] for key, value in
                  [('type', 6), ('a', 34), ('b', 1), ('c', 0), ('d', 8)]]
        for commands in cases:
            dat.effects[28].effect_commands = commands
            with self.subTest(commands=commands), \
                    patch('import_content.tree_nodes', return_value=[node]), \
                    patch('scripted_effects.healing_aura', side_effect=UnsupportedBimaristanMask('mask')), \
                    patch('import_content.technology_entry') as entry, patch('sys.stderr') as stderr:
                with self.assertRaisesRegex(ValueError, 'effect28 commands changed') as changed:
                    technologies_from_tree(dat, Path('dat/source'), {'civIndex': 9}, {},
                                           {'key': 'saracens'}, {}, {})
                self.assertNotIsInstance(changed.exception, UnsupportedBimaristanMask)
                entry.assert_not_called()
                stderr.write.assert_not_called()

    def test_unique_tech_tree_nodes_preserve_research(self):
        from import_content import technologies_from_tree
        tech = NS(civ=0, effect_id=0, research_locations=[NS(location_id=82, research_time=50)],
                  required_techs=[], required_tech_count=0)
        dat = NS(civs=[NS(tech_tree_id=0)], effects=[NS(effect_commands=[NS(type=4)])], techs=[tech])
        node = {'Node ID': 0, 'Node Type': 'Research', 'Name': 'Fixture Technology',
                'Node Status': 'Available', 'Building ID': 82}
        entry = {'techId': 0, 'effects': [{'unit': 'fixture', 'amount': 2}]}
        results = []
        for kind in ('Research', 'UniqueTech', 'RegionalTech'):
            with patch('import_content.tree_nodes', return_value=[{**node, 'Node Type': kind}]), \
                    patch('import_content.technology_entry', return_value=dict(entry)):
                results.append(technologies_from_tree(dat, Path('dat/source'), {'civIndex': 0},
                    {'castle': {'id': 82, 'category': 'building'}}, {'key': 'fixture'}, {}, {}))
        self.assertEqual(results[0], results[1])
        self.assertEqual(results[0], results[2])
        self.assertEqual(results[1][0]['fixture-technology']['effects'], entry['effects'])
        self.assertEqual(results[1][1], [])

    def test_focused_activation_change_is_a_blocker_not_an_exclusion(self):
        from import_content import focused_import_blockers
        bonuses = {'treeEffectId': 3, 'nodes': {'-1': {'unmodelled': [
            'effect type 18: a=730, b=12, c=-1, d=1.0']}}}
        for civ in ('britons', 'incas'):
            reason, = focused_import_blockers(civ, bonuses)
            self.assertIn('effect type 18: a=730', reason)
            self.assertIn('implementation decision required', reason)
        self.assertEqual(focused_import_blockers('saracens', bonuses), [])
        self.assertEqual(focused_import_blockers('incas', {'treeEffectId': 3, 'nodes': {}}), [])

    def test_focused_roster_defers_only_owner_approved_ids(self):
        from import_content import focused_roster_blockers, deferred_roster_exclusions
        catalogue = {'britons': {'missingRoster': [2700],
                                'roster': [{'Node ID': 2700, 'Name': 'Mounted Crossbowman'}]}}
        with patch('sys.stderr') as stderr:
            exclusions = deferred_roster_exclusions(catalogue)
        self.assertEqual(exclusions[0]['issue'], 331)
        self.assertTrue(stderr.write.called)
        self.assertEqual(focused_roster_blockers(catalogue), [])
        catalogue['britons']['missingRoster'].append(9999)
        self.assertIn('9999', focused_roster_blockers(catalogue)[0])
        self.assertEqual(focused_roster_blockers({'britons': {'missingRoster': []}}), [])
        self.assertEqual(focused_roster_blockers({'saracens': {'missingRoster': [2700]}}), [])

    def test_team_ready_respects_generic_initial_disable_and_recipient(self):
        from import_content import initial_team_research_gates
        command = lambda kind, a=-1, b=-1, c=-1, d=0: NS(type=kind, a=a, b=b, c=c, d=d)
        startup = NS(civ=-1, full_tech_mode=0, required_tech_count=0, effect_id=2,
                     required_techs=[-1]*6, research_locations=[NS(location_id=-1, research_time=0)],
                     resource_costs=[])
        dat = NS(civs=[NS(tech_tree_id=0), NS(tech_tree_id=1)], techs=[startup], effects=[
            NS(effect_commands=[]), NS(effect_commands=[command(18, a=42, b=12, d=1)]),
            NS(effect_commands=[command(102, d=42)])])
        self.assertEqual(initial_team_research_gates(dat, 0), ({42}, set()))
        self.assertEqual(initial_team_research_gates(dat, 1), ({42}, {42}))
        for key, value in [('full_tech_mode', -1), ('required_tech_count', 1), ('civ', 1)]:
            with self.subTest(key=key), patch.object(startup, key, value), self.assertRaises(ValueError):
                initial_team_research_gates(dat, 1)
        dat.effects[1].effect_commands[0].type = 8
        self.assertEqual(initial_team_research_gates(dat, 1), (set(), set()))


BIMARISTAN_CONSTANTS = '''extern const int cAddAttribute = 4;
extern const int cCombatAbility = 63;
extern const int cMonkClass = 918;
extern const int cMonkWithRelicClass = 943;
extern const int cFlagClassRemoval = -1;
extern const int cFlagClassOffset = 1000;
extern const int cFlagClassBuilding = 256;
extern const int cFlagClassSiege = 128;
extern const int cFlagClassShip = 64;
extern const int cTaskAttrWorkValue1 = 0;
extern const int cTaskAttrWorkValue2 = 1;
extern const int cTaskAttrWorkRange = 2;
extern const int cTaskAttrGatheringSoundInt32 = 18;
extern const int cTaskAttrDepositSoundInt32 = 21;
extern const int cTaskAttrOwnerType = 6;
extern const int cTaskAttrCombatLevelFlag = 5;
extern const int cTaskAttrSearchWaitTime = 4;
extern const int cTaskAttrGatherType = 25;
extern const int cTaskAttrObjectClass = 30;
extern const int cTaskAttrTaskType = 28;
extern const int cTaskTypeAura = 155;
'''
BIMARISTAN_MASK = '''const int WarriorPriestWithRelicID = 1831;
void EffectFunction7(int playerId = -1)
{
int TargetClass = 0;
xsResetTaskAmount();
xsEffectAmount(cAddAttribute, cMonkClass, cCombatAbility, 32, playerId);
xsEffectAmount(cAddAttribute, cMonkWithRelicClass, cCombatAbility, 32, playerId);
xsEffectAmount(cAddAttribute, WarriorPriestWithRelicID, cCombatAbility, -32, playerId);
xsTaskAmount(cTaskAttrWorkValue1, 75);
xsTaskAmount(cTaskAttrWorkValue2, 1);
xsTaskAmount(cTaskAttrWorkRange, 5);
xsTaskAmount(cTaskAttrGatheringSoundInt32, 13404);
xsTaskAmount(cTaskAttrDepositSoundInt32, 13404);
xsTaskAmount(cTaskAttrOwnerType, 4);
xsTaskAmount(cTaskAttrCombatLevelFlag, 2);
xsTaskAmount(cTaskAttrSearchWaitTime, 109);
xsTaskAmount(cTaskAttrGatherType, 21);
TargetClass = cFlagClassRemoval * (cFlagClassOffset + cFlagClassBuilding + cFlagClassSiege + cFlagClassShip);
xsTaskAmount(cTaskAttrObjectClass, TargetClass);
xsTaskAmount(cTaskAttrTaskType, cTaskTypeAura);
xsModifyObjectTasks(cMonkClass, playerId, 0);
xsModifyObjectTasks(cMonkWithRelicClass, playerId, 0);
xsModifyObjectTasks(WarriorPriestWithRelicID, playerId, -1);
xsResetTaskAmount();
}
'''


if __name__ == '__main__':
    unittest.main()
