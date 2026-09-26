import json
import unittest
from pathlib import Path

from test_import_aoe2 import ROOT, extracted_content, sld, _dat


class RegicideSourceTest(unittest.TestCase):
    def test_king_flags_stats_art_and_voice_survive_both_profiles_and_publication(self):
        content = extracted_content()
        published = json.loads(Path('public/imported/aoe2/manifest.json').read_text())
        audio_root = Path('public/imported/aoe2/audio')
        audio = json.loads((audio_root / 'manifest.json').read_text())['audio']
        for key in ['king-select', 'civilizations/franks/king-select']:
            self.assertTrue(audio[key]['files'], key)
            for clip in audio[key]['files']:
                self.assertTrue((audio_root / clip['file']).is_file())
        for source, ready in [(content, published), (content['civilizations']['franks'], published['civilizations']['franks'])]:
            king = source['entities']['king']
            self.assertEqual((king['id'], king['hitPoints'], king['lineOfSight'], king['class'], king['iconId']), (434, 75, 6, 59, 48))
            self.assertEqual(king['speedTilesPerSecond'], 1.32)
            self.assertTrue(king['conversionImmune'])
            self.assertTrue(king['confirmDelete'])
            self.assertFalse(king['combat']['attacks'])
            self.assertNotIn('train', king)
            self.assertEqual(king['text'], {'name': 'King'})
            self.assertIn('select', king['sounds'])
            self.assertEqual(king['animations']['idle']['source'], sld('u_king_west_idleA'))
            self.assertEqual(king['animations']['walk']['source'], sld('u_king_west_walkA'))
            self.assertEqual(king['animations']['death']['source'], sld('u_king_west_deathA'))
            self.assertTrue(ready['entities']['king']['conversionImmune'])
            for animation in ['idle', 'walk', 'death', 'decay']:
                self.assertIn(animation, ready['entities']['king']['atlases'])
                self.assertIn(animation + '-playercolor', ready['entities']['king']['atlases'])
                self.assertIn(animation + '-outline', ready['entities']['king']['atlases'])

    def test_mode_rules_are_distinct_from_permanent_spies_and_match_owned_rms_branches(self):
        from regicide_reference import extract
        self.assertEqual(extract(ROOT), json.loads(Path('src/sim/refdata/regicide.json').read_text()))
        dat = _dat()
        self.assertEqual(dat.civs[1].units[434].creatable.hero_mode, 34)
        self.assertEqual(dat.civs[1].units[434].creatable.garrison_graphic, -1)
        self.assertEqual(dat.civs[1].units[434].creatable.train_locations[0].unit_id, -1)
        self.assertEqual(dat.civs[1].resources[84], 3)
        # Engine game-mode gating is outside DAT prerequisites:117 is explicitly
        # named Regicide-only, while ordinary408 requires Imperial Age103.
        self.assertIn('Regicide only', dat.techs[117].name)
        self.assertEqual(dat.effects[dat.techs[117].effect_id].effect_commands[0].d, 408)
        self.assertEqual(dat.techs[408].required_techs[0], 103)
        text = extracted_content()['strings']['treasonHelp']
        self.assertIn('Gold,400', text)
        self.assertIn('few seconds', text)
        self.assertIn('flashing X', text)
        scripts = ROOT / 'depot_813784/resources/_common/drs/gamedata_x2'
        modern = (scripts / 'includes/regicide.inc').read_text()
        for line in ['#const REGICIDE_BUILDING 82', '#const REGICIDE_DISTANCE 12', '#const REGICIDE_ZONE_DISTANCE 4',
                     '#const REGICIDE_FOREST_DISTANCE 3', '#const REGICIDE_EDGE_DISTANCE 4', 'find_closest_to_map_center']:
            self.assertIn(line, modern)
        villagers = (scripts / 'includes/villagers.inc').read_text()
        self.assertRegex(villagers, r'if REGICIDE\s+number_of_objects 10')
        classic = (scripts / 'GeneratingObjects.inc').read_text().split('/* Regicide buildings', 1)[1].split('/* Empire Wars Lumbercamps', 1)[0]
        self.assertRegex(classic, r'create_object KING\s*\{\s*set_place_for_every_player\s*min_distance_to_players 6\s*max_distance_to_players 8')
        self.assertRegex(classic, r'create_object VILLAGER\s*\{\s*set_place_for_every_player\s*number_of_objects 7')
        self.assertRegex(classic, r'else\s*min_distance_to_players 10\s*max_distance_to_players 10')
