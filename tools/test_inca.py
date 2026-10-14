"""Pinned Inca contracts; the full-profile check must not bypass art failures."""
import copy
from pathlib import Path
import tempfile
import unittest

from civilization_profiles import shared_combat_specs
from import_content import (age_variants, civilization_bonuses, civilization_entry,
                            extract_entity, import_drop_sites, player_attribute_ids,
                            read_strings, technologies_from_tree)
from test_import_aoe2 import DAT, SPEC, SOURCES, STRINGS, _dat, extracted_content


@unittest.skipUnless(DAT.exists(), 'owned DAT unavailable')
class IncaImportTest(unittest.TestCase):
    def test_mixed_tc_delta_keeps_its_main_pixels_and_the_existing_cast_shadow(self):
        from convert_sld import atlas_jobs, _convert_one
        from import_content import town_center_shadow
        from sld_layers import decode_colors, decode_masks, LAYER_DAMAGE
        from types import SimpleNamespace
        from PIL import Image
        profile = extracted_content()['civilizations']['incas']
        tc = profile['entities']['town-center']
        # Inca's fourth slot is the DAT's deliberately empty annex890, not
        # another Western TC piece. Preserve every drawable source annex.
        self.assertEqual([a['unitId'] for a in tc['annexes']], [618, 619, 620])
        self.assertEqual(_dat().civs[21].units[109].building.annexes[3].unit_id, 890)
        #185872 replaces the absent graphic with explicit, cue-free BLANK1751.
        self.assertEqual(_dat().civs[21].units[890].standing_graphic[0], 1751)
        from import_content import empty_annex_graphic
        self.assertTrue(empty_annex_graphic(_dat(), 1751))
        self.assertEqual(age_variants(_dat(), 890), {})
        self.assertEqual(set(tc['animationLayers']), {'idle-feudal', 'idle-castle', 'idle-imperial'})
        jobs = atlas_jobs({'entities': {'town-center': tc}})
        with tempfile.TemporaryDirectory() as directory:
            for age, gid in [('feudal', 13682), ('castle', 13698), ('imperial', 13714)]:
                name = f'idle-{age}'
                layers = tc['animationLayers'][name]
                self.assertEqual(layers, [{'animation': name, 'x': 0, 'y': 0},
                    {'animation': f'{name}-cast-body', 'x': 0, 'y': 0, 'belowBody': True, 'shadow': False}])
                body = tc['animations'][layers[1]['animation']]
                self.assertEqual(body['graphicId'], gid)
                self.assertEqual(tc['animations'][name]['shadow'], body)
                self.assertLess(_dat().graphics[gid].layer, _dat().graphics[tc['animations'][name]['graphicId']].layer)
                job, = [j for j in jobs if j['name'] == layers[1]['animation']]
                self.assertEqual(job['source'], body['source'])
                source = SOURCES.path(job['source'])
                pixels = decode_colors(source.read_bytes())[0]
                self.assertFalse(pixels.empty)
                soot = decode_masks(source.read_bytes(), LAYER_DAMAGE)[0]
                self.assertFalse(soot.empty)
                self.assertIn('damage', job['layers'])
                out = Path(directory) / f'{age}.png'
                _, atlas, error = _convert_one((age, str(source), str(out), job['expected'], None))
                self.assertIsNone(error)
                repeat = Path(directory) / f'{age}-repeat.png'
                _, repeated_atlas, repeated_error = _convert_one((age, str(source), str(repeat), job['expected'], None))
                self.assertIsNone(repeated_error)
                self.assertEqual(out.read_bytes(), repeat.read_bytes())
                self.assertEqual(atlas['frames'], repeated_atlas['frames'])
                frame = atlas['frames'][0]
                self.assertEqual((frame['w'], frame['h'], frame['cx'], frame['cy']),
                                 (pixels.width, pixels.height, pixels.hotspot_x, pixels.hotspot_y))
                with Image.open(out) as image:
                    crop = image.crop((frame['x'], frame['y'], frame['x']+frame['w'], frame['y']+frame['h']))
                    self.assertEqual(crop.tobytes(), bytes(pixels.rgba))
                soot_out = Path(directory) / f'{age}-damage.png'
                _, mask_atlas, error = _convert_one((age, str(source), str(soot_out), job['expected'], 'damage'))
                self.assertIsNone(error)
                repeated_soot = Path(directory) / f'{age}-damage-repeat.png'
                _, repeated_mask, repeated_error = _convert_one((age, str(source), str(repeated_soot), job['expected'], 'damage'))
                self.assertIsNone(repeated_error)
                self.assertEqual(soot_out.read_bytes(), repeated_soot.read_bytes())
                self.assertEqual(mask_atlas['frames'], repeated_mask['frames'])
                f = mask_atlas['frames'][0]
                self.assertEqual((f['w'], f['h'], f['cx'], f['cy']),
                                 (soot.width, soot.height, soot.hotspot_x, soot.hotspot_y))
                with Image.open(soot_out) as image:
                    crop = image.crop((f['x'], f['y'], f['x']+f['w'], f['y']+f['h']))
                    self.assertEqual(crop.getchannel('A').tobytes(), bytes(soot.alpha))
        # Opting into a colour consumer must not bypass the layer-order guard.
        mixed = _dat().graphics[13682]
        parent = SimpleNamespace(layer=mixed.layer,
            deltas=[SimpleNamespace(graphic_id=1, offset_x=0, offset_y=0)])
        with self.assertRaisesRegex(ValueError, 'unreviewed body layer order'):
            town_center_shadow(SimpleNamespace(graphics=[parent, mixed]), SOURCES,
                {'graphicId': 0, 'frames': 1, 'directions': 1}, {}, body_layer={})

    def test_fire_projectile_3822_is_a_reviewed_particle_carrier_not_a_missing_sld(self):
        from naval import specs
        dat = _dat()
        self.assertEqual(dat.graphics[3822].file_name, 'None')
        profile = extracted_content()['civilizations']['incas']
        for key, uid in [('naval-fire', 676), ('fire-charge', 2629)]:
            entity = profile['entities'][key]
            unit = dat.civs[21].units[uid]
            self.assertEqual(unit.standing_graphic[0], 3822)
            self.assertEqual(unit.dead_fish.tracking_unit, 677)
            self.assertEqual(dat.civs[21].units[677].standing_graphic[0], 3823)
            self.assertEqual(entity['animations'], {})
            self.assertEqual(entity['particleEffect'], dat.graphics[3823].particle_effect_name)
            self.assertEqual(entity['particleEffect'], 'flamethrower_flame')
            self.assertIn(entity['particleEffect'], profile['particles'])
            self.assertEqual(entity['sourceAbsence'], {'graphicId': 3822,
                'reason': 'DAT file-less particle carrier', 'particleGraphicId': 3823})
        expanded = {**SPEC, 'entities': [*SPEC['entities'], *specs()]}
        self.assertFalse(any(s['unitId'] == 2629 for s in shared_combat_specs(dat, expanded)))
        self.assertNotIn('dat-projectile-2629', profile['entities'])

    def test_other_civilizations_ready_rows_do_not_auto_complete_paid_upgrades(self):
        profiles = extracted_content()['civilizations']
        for civ, ready, paid in [('goths', {886}, set()),
                ('chinese', {979, 980, 981, 982, 1034}, {980, 982}),
                ('byzantines', {235, 236, 886, 1453, 1454}, {236, 1454}), ('saracens', {235, 236}, {236}),
                ('turks', {235, 236}, {236}), ('mongols', {235, 236, 714, 715}, {236, 715})]:
            nodes = profiles[civ]['civilizationBonuses']['nodes']
            self.assertEqual({int(t) for t, n in nodes.items() if n.get('initialState') == 'ready'}, ready)
            for tid in ready:
                node = nodes[str(tid)]
                self.assertEqual(node['automatic'], tid not in paid)
                self.assertFalse(node.get('disabled', False))
            for tid in paid:
                if tid == 1454:
                    #185872 Elite Varangian Guard is new, outside this roster.
                    source = _dat().techs[tid]
                    self.assertTrue(any(l.research_time > 0 for l in source.research_locations))
                    self.assertTrue(any(c.flag and c.amount > 0 for c in source.resource_costs))
                    skipped, = [t for t in profiles[civ]['skippedTechnologies'] if t['techId'] == tid]
                    self.assertEqual(skipped['reason'], 'upgrades to a unit that is not imported (unit 2704)')
                    self.assertFalse(any(t['techId'] == tid for t in profiles[civ]['technologies'].values()))
                    continue
                tech, = [t for t in profiles[civ]['technologies'].values() if t['techId'] == tid]
                self.assertGreater(tech['researchSeconds'], 0)
                self.assertTrue(any(tech['cost'].values()))

    def test_full_enabled_profile_extracts_without_omitting_owned_art(self):
        content = extracted_content()
        profile = content['civilizations']['incas']
        self.assertTrue(profile['civilization']['enabled'])
        self.assertEqual(content['civilizationCatalog']['incas']['missingRoster'], [])
        self.assertEqual(profile['civilization']['startingScout'], 'dat-unit-2550')
        self.assertEqual(profile['entities']['settlement']['accepts'], ['food', 'wood', 'gold', 'stone'])


@unittest.skipUnless(DAT.exists(), 'owned DAT unavailable')
class IncaSourceContractTest(unittest.TestCase):
    """Component tests independent of the separately tested TC composition.

    Extract real Inca units/buildings/workers, then call the same rule consumers
    as extract(). This does not claim a complete renderable profile exists.
    """
    @classmethod
    def setUpClass(cls):
        cls.dat = _dat()
        cls.spec = copy.deepcopy(SPEC)
        cls.spec.update(civIndex=21, civilization={'key': 'incas', 'treeFile': 'INCAS.json'})
        cls.spec['entities'].extend(shared_combat_specs(cls.dat, cls.spec))
        cls.strings = read_strings(STRINGS)
        cls.hashes = {}
        cls.attributes = player_attribute_ids((DAT.parent.parent / 'xs/Constants.xs').read_text())
        cls.entities = {}
        for row in cls.spec['entities']:
            if row['key'] not in {'settlement', 'house', 'barracks', 'castle', 'archery-range', 'mill',
                                  'lumber-camp', 'mining-camp', 'skirmisher', 'elite-skirmisher'} \
                    and not row['key'].startswith('villager') \
                    and row['unitId'] not in (2550, 2588, 2552, 2554, 879, 881, 185, 1570, 2633, 187, 1932) \
                    and row.get('category') not in ('resource', 'animal'):
                continue
            civ = 0 if row.get('civ') == 'gaia' else 21
            cls.entities[row['key']] = extract_entity(cls.dat, cls.dat.civs[civ].units, row,
                                                      SOURCES, cls.hashes, cls.strings)
        import_drop_sites(DAT, cls.dat.civs[21].units, cls.entities, cls.hashes)
        cls.civilization = civilization_entry(cls.dat, DAT, cls.spec, cls.hashes, cls.strings)
        cls.technologies, cls.skipped = technologies_from_tree(
            cls.dat, DAT, cls.spec, cls.entities, cls.civilization, cls.hashes, cls.attributes, cls.strings)
        # Pure bonus-graph fixture: annex ownership comes from the actual DAT,
        # independently of TC artwork (covered by the full extraction above).
        tc = cls.dat.civs[21].units[109]
        cls.entities['town-center'] = {'id': 109, 'category': 'building', 'class': tc.class_}
        cls.nodes = civilization_bonuses(cls.dat, 21, cls.entities, cls.technologies, cls.attributes)['nodes']

    def test_identity_starting_scout_and_generic_disables(self):
        self.assertEqual(self.civilization['displayName'], 'Inca')
        self.assertEqual(self.civilization['startingScout'], 'dat-unit-2550')
        self.assertEqual(self.dat.civs[21].resources[263], 2550)
        unavailable = self.civilization['unavailable']
        self.assertIn(74, unavailable['units'])
        for uid in (68, 562, 584):
            self.assertIn(uid, unavailable['buildings'])
        # A shared spec must not make the ordinary Briton opening unavailable.
        britons = civilization_entry(self.dat, DAT, SPEC, {}, self.strings)
        self.assertNotIn('startingScout', britons)
        self.assertNotIn(74, britons['unavailable']['units'])
        for uid in (68, 562, 584):
            self.assertNotIn(uid, britons['unavailable']['buildings'])

    def test_roster_art_and_producers_are_owned(self):
        for uid, name, venue in [(2550, 'Champi Scout', 12), (2588, 'Champi Runner', 12),
                                 (2552, 'Champi Warrior', 12), (2554, 'Elite Champi Warrior', 12),
                                 (879, 'Kamayuk', 82), (881, 'Elite Kamayuk', 82), (185, 'Slinger', 87)]:
            entity = self.entities[f'dat-unit-{uid}']
            self.assertEqual(entity['category'], 'unit')
            self.assertEqual(entity['text']['name'], name)
            self.assertEqual(entity['train']['buildingId'], venue)
            for action in ('idle', 'walk', 'attack', 'death'):
                self.assertTrue(SOURCES.path(entity['animations'][action]['source']).is_file())

    def test_settlement_uses_building_drop_site_housing_and_age_machinery(self):
        entity = self.entities['settlement']
        self.assertEqual((entity['id'], entity['category'], entity['kind']), (2556, 'building', 'settlement'))
        self.assertEqual(entity['collision'], [1.5, 1.5])
        self.assertEqual(entity['clearance'], [1.5, 1.5])
        self.assertEqual(entity['popSupport'], 5)
        self.assertEqual(entity['cost'], {'wood': 125})
        self.assertEqual(entity['build'], {'builderId': 118, 'seconds': 40, 'button': 2})
        self.assertEqual(entity['accepts'], ['food', 'wood', 'gold', 'stone'])
        self.assertEqual(age_variants(self.dat, 2556), {'feudal': 2558, 'castle': 2560})
        for age, uid in [('feudal', 2558), ('castle', 2560)]:
            self.assertEqual(entity['ageStats'][age]['id'], uid)
            self.assertEqual(entity['ageStats'][age]['hp'], self.dat.civs[21].units[uid].hit_points)
            self.assertTrue(SOURCES.path(entity['animations'][f'idle-{age}']['source']).is_file())
        for key in ('villager-forager', 'villager-lumberjack', 'villager-goldminer', 'villager-stonemason'):
            self.assertIn(2556, self.entities[key]['gather']['dropSites'])

    def test_ready_enables_bookkeeping_without_completing_paid_upgrades(self):
        ready = {1353, 1350, 1402, 1351, 1352, 528, 378, 913, 730}
        self.assertEqual({int(tid) for tid, node in self.nodes.items() if node.get('initialState') == 'ready'}, ready)
        for tid in ready:
            node, source = self.nodes[str(tid)], self.dat.techs[tid]
            self.assertFalse(node.get('disabled', False))
            self.assertEqual(node['requiredTechs'], [r for r in source.required_techs if r >= 0])
            self.assertEqual(node['requiredTechCount'], source.required_tech_count)
            self.assertEqual(node['automatic'], tid not in (1402, 1351, 1352))
        for key, tid, price, seconds in [('champi-runner', 1402, {'food': 90, 'gold': 60}, 40),
                                       ('champi-warrior', 1351, {'food': 150, 'gold': 175}, 50),
                                       ('elite-champi-warrior', 1352, {'food': 650, 'gold': 450}, 50),
                                       ('elite-kamayuk', 509, {'food': 900, 'gold': 500}, 45)]:
            tech = self.technologies[key]
            self.assertEqual(tech['cost'], price)
            self.assertEqual(tech['researchSeconds'], seconds)
            self.assertFalse(self.nodes[str(tid)]['automatic'])
            expected = [{'from': f'dat-unit-{c.a}', 'to': f'dat-unit-{c.b}'}
                        for c in self.dat.effects[self.dat.techs[tid].effect_id].effect_commands if c.type == 3]
            self.assertEqual(tech['upgrades'], expected)
        self.assertNotIn('champi-scout', self.technologies)
        self.assertFalse(any('effect type 8' in s or 'effect type 18' in s or 'effect type 2' in s
                             for s in self.nodes['-1']['unmodelled']))

    def test_unique_techs_keep_source_targets_and_values(self):
        sling = self.technologies['andean-sling']
        self.assertEqual(sling['techId'], 516)
        for key in ('skirmisher', 'elite-skirmisher', 'dat-unit-185'):
            self.assertIn({'unit': key, 'attribute': 'minRange', 'operation': 'set', 'amount': 0}, sling['effects'])
        self.assertIn({'unit': 'dat-unit-185', 'attribute': 'attack', 'operation': 'add', 'armorClass': 3, 'amount': 1}, sling['effects'])
        shields = self.technologies['fabric-shields']
        self.assertEqual(shields['techId'], 517)
        for uid in (2550, 2588, 2552, 2554, 879, 881, 185, 1570):
            for armor in (3, 4):
                self.assertIn({'unit': f'dat-unit-{uid}', 'attribute': 'armor', 'operation': 'add',
                               'armorClass': armor, 'amount': 1}, shields['effects'])

    def test_settlement_economy_uses_secondary_dat_venues_and_buttons(self):
        for key, tid, button in [('horse-collar', 14, 11), ('heavy-plow', 13, 11),
                                 ('double-bit-axe', 202, 12), ('bow-saw', 203, 12),
                                 ('gold-mining', 55, 13), ('gold-shaft-mining', 182, 13)]:
            tech = self.technologies[key]
            location = next(l for l in self.dat.techs[tid].research_locations if l.location_id == 2556)
            self.assertEqual(tech['researchedAt'], 2556)
            self.assertEqual(tech['button'], button)
            self.assertEqual(tech['researchSeconds'], location.research_time)
            self.assertEqual(tech['hotkeyTextId'], location.hot_key_id)

    def test_food_discount_preserves_ordered_reciprocal_commands(self):
        #185872 DAT153/155 change the reciprocal factors; retain exact order.
        for tid, age, factors in [(152, 104, [.85]), (153, 101, [1.174, .8]),
                                  (154, 102, [1.25, .75]), (155, 103, [1.328, .7])]:
            node = self.nodes[str(tid)]
            self.assertEqual(node['requiredTechs'], [age])
            effects = [e for e in node['effects'] if e.get('unit') == 'dat-unit-2550']
            self.assertEqual(effects, [{'unit': 'dat-unit-2550', 'attribute': 'foodCost',
                                       'operation': 'multiply', 'amount': n} for n in factors])

    def test_villager_blacksmith_count_gates_and_stone_annex_trigger(self):
        for tid in range(474, 480):
            node, source = self.nodes[str(tid)], self.dat.techs[tid]
            self.assertEqual(node['requiredTechs'], [r for r in source.required_techs if r >= 0])
            self.assertEqual(node['requiredTechCount'], 2)
            self.assertTrue(node['automatic'])
            effects = [e for e in node['effects'] if e.get('unit') == 'villager']
            expected = [{'unit': 'villager', 'attribute': 'attack' if c.c == 9 else 'armor',
                         'operation': 'add', 'armorClass': int(c.d) >> 8, 'amount': int(c.d) & 255}
                        for c in self.dat.effects[source.effect_id].effect_commands]
            self.assertEqual(effects, expected)
        self.assertEqual(self.nodes['158']['requiredTechs'], [307])
        self.assertEqual(self.nodes['307']['triggeredByBuildings'], ['town-center'])
        self.assertEqual(self.nodes['307']['requiredTechCount'], 1)
        self.assertEqual([e['amount'] for e in self.nodes['519']['effects'] if e.get('unit') == 'town-center'], [.85, 1.17647])
        self.assertEqual(self.nodes['158']['effects'], [
            {'unit': 'town-center', 'attribute': 'stoneCost', 'operation': 'multiply', 'amount': .85}])
        for key in ('house', 'settlement'):
            self.assertEqual([e for e in self.nodes['495']['effects'] if e.get('unit') == key], [
                {'unit': key, 'attribute': 'populationSupport', 'operation': 'add', 'amount': 5}])


@unittest.skipUnless(DAT.exists(), 'owned DAT unavailable')
class IncaLlamaSourceContractTest(unittest.TestCase):
    """Inca team bonus llama: XS parsing and validation."""

    def test_free_llama_parses_effect_function_1_and_validates_structure(self):
        from scripted_effects import free_llama
        hashes = {}
        spec = free_llama(DAT.parent.parent, hashes)
        self.assertEqual(spec, {'unitIds': [305, 1963], 'buildingId': 619, 'count': 1})
        self.assertEqual(set(hashes), {'xs/Effects.xs', 'xs/Constants.xs'})

    def test_hidden_team_graph_and_shared_animal_art_are_extracted(self):
        content = extracted_content()
        profile = content['civilizations']['incas']
        nodes = profile['civilizationBonuses']['nodes']
        self.assertEqual(nodes['730']['requiredTechs'], [639, 307])
        self.assertEqual(nodes['730']['requiredTechCount'], 2)
        self.assertTrue(nodes['730']['automatic'])
        self.assertEqual(nodes['639']['requiredTechCount'], 0)
        self.assertEqual(nodes['307']['triggeredByBuildings'], ['town-center'])
        self.assertEqual(nodes['730']['effects'], [
            {'resource': 'spawnCap', 'operation': 'set', 'amount': 1},
            {'spawn': {'units': ['dat-unit-305', 'dat-unit-1963'], 'building': 'town-center', 'count': 1},
             'operation': 'set', 'amount': 1}])
        self.assertFalse(nodes['730'].get('unmodelled'))
        self.assertNotIn('730', content['civilizationBonuses']['nodes'])
        for p in (content, profile):
            for uid in (305, 1963):
                animal = p['entities'][f'dat-unit-{uid}']
                self.assertEqual((animal['category'], animal['class'], animal['storage']['food']), ('animal', 58, 100))
                self.assertEqual(animal['foodDecayPerSecond'], .25)
                for action in ('idle', 'walk', 'death', 'decay'):
                    self.assertTrue(SOURCES.path(animal['animations'][action]['source']).is_file())

    def test_dispatch_uses_effect_function_not_technology_number(self):
        from import_content import effects_of
        from scripted_effects import free_llama
        profile = extracted_content()['civilizations']['incas']
        # Supply tech0 with effect678: a hardcoded tech730 branch cannot pass.
        effects, unmodelled, unreached = effects_of(_dat(), 0, profile['entities'],
            profile['playerAttributeIds'], effect_id=678,
            scripted_effects={1: free_llama(DAT.parent.parent, {})})
        self.assertEqual(effects, profile['civilizationBonuses']['nodes']['730']['effects'])
        self.assertEqual((unmodelled, unreached), ([], []))
        missing = dict(profile['entities'])
        del missing['dat-unit-1963']
        effects, _, unreached = effects_of(_dat(), 0, missing, profile['playerAttributeIds'], effect_id=678,
            scripted_effects={1: free_llama(DAT.parent.parent, {})})
        self.assertFalse(any('spawn' in e for e in effects))
        self.assertTrue(any('EffectFunction1' in reason for reason in unreached))

    def test_free_llama_raises_on_mutated_xs_body(self):
        from scripted_effects import free_llama
        common_path = DAT.parent.parent
        xs_path = common_path / 'xs/Effects.xs'
        original_text = xs_path.read_text(encoding='utf-8-sig')
        constants = (common_path / 'xs/Constants.xs').read_text()
        mutations = [('const int Llama1ID = 305;', 'const int Llama1ID = 306;'),
                     ('const int Llama2ID = 1963;', 'const int Llama2ID = 305;'),
                     ('xsGetRandomNumberLH(0, 2)', 'xsGetRandomNumberLH(0, 3)'),
                     ('if (randomNumber == 1)', 'if (randomNumber == 0)'),
                     ('targetLlama, 619, 1, playerId', 'targetLlama, 109, 1, playerId'),
                     ('targetLlama, 619, 1, playerId', 'targetLlama, 619, 2, playerId'),
                     ('targetLlama, 619, 1, playerId', 'targetLlama, 619, 1, 0'),
                     ('int targetLlama = Llama1ID;', 'int targetLlama = Llama1ID;\n    targetLlama = Llama2ID;'),
                     ('void EffectFunction1(', 'void MissingEffectFunction1(')]
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_path = Path(tmpdir)
            (tmp_path / 'xs').mkdir()
            (tmp_path / 'xs/Constants.xs').write_text(constants)
            for before, after in mutations:
                with self.subTest(mutation=after):
                    self.assertEqual(original_text.count(before), 1, before)
                    mutated = original_text.replace(before, after, 1)
                    self.assertTrue(mutated != original_text, f'mutation did not apply: {before}')
                    (tmp_path / 'xs/Effects.xs').write_text(mutated, encoding='utf-8-sig')
                    with self.assertRaisesRegex(ValueError, 'EffectFunction1'):
                        free_llama(tmp_path, {})
            (tmp_path / 'xs/Effects.xs').write_text(original_text, encoding='utf-8-sig')
            (tmp_path / 'xs/Constants.xs').write_text(constants.replace('cSpawnUnit = 7;', 'cSpawnUnit = 8;'))
            with self.assertRaisesRegex(ValueError, 'cSpawnUnit'):
                free_llama(tmp_path, {})


if __name__ == '__main__':
    unittest.main()
