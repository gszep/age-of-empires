import unittest
import json
import tempfile
from pathlib import Path
from test_import_aoe2 import extracted_content, WIDGETUI, SPEC
from convert_sld import atlas_jobs
from import_audio import consumed_cues
from import_ui import load_material_index


class ProfileImportTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.content = extracted_content()

    def test_base_catalogue_and_explicit_enablement(self):
        rows = self.content['civilizationCatalog']
        self.assertEqual(len(rows), 53)
        self.assertTrue(all(row['era'] == 'base' for row in rows.values()))
        self.assertEqual({key for key, row in rows.items() if row['enabled']},
                         {'britons', *SPEC['enabledCivilizations']})
        self.assertTrue(rows['franks']['extracted'])
        for key, profile in [('britons', self.content), ('franks', self.content['civilizations']['franks'])]:
            self.assertNotIn(35, profile['civilization']['unavailable']['units'])
            self.assertNotIn(789, profile['civilization']['unavailable']['buildings'])
            self.assertNotIn(1258, rows[key]['missingRoster'])
            self.assertNotIn(792, rows[key]['missingRoster'])

    def test_franks_cannot_train_foreign_unique_and_has_own_art(self):
        root = self.content
        franks = root['civilizations']['franks']
        self.assertIn(8, franks['civilization']['unavailable']['units'])
        self.assertIn(530, franks['civilization']['unavailable']['units'])
        self.assertNotIn(281, franks['civilization']['unavailable']['units'])
        self.assertEqual(franks['entities']['dat-unit-281']['text']['name'], 'Throwing Axeman')
        self.assertNotEqual(root['entities']['castle']['animations']['idle']['source'],
                            franks['entities']['castle']['animations']['idle']['source'])
        self.assertNotEqual(root['entities']['rally-flag']['animations']['idle']['source'],
                            franks['entities']['rally-flag']['animations']['idle']['source'])
        self.assertTrue(any(j['key'] == 'civilizations/franks/castle' for j in atlas_jobs(root)))
        self.assertEqual(root['civilizationBonuses']['treeEffectId'], 254)
        self.assertEqual(franks['civilizationBonuses']['treeEffectId'], 258)
        self.assertNotIn({'from': 'war-hulk', 'to': 'dat-unit-2628'},
                         root['technologies']['heavy-warships'].get('upgrades', []),
                         'disabled Carrack child must not be folded into Briton Heavy Warships')

    def test_voice_aliases_preserve_profile_switches(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'ui.json').write_text('{}')
            (root / 'content.json').write_text(json.dumps(self.content))
            cues = {cue['alias']: cue for cue in consumed_cues(root / 'ui.json', root / 'content.json')}
        self.assertEqual(cues['villager-select']['switch'], 'Britons')
        self.assertEqual(cues['civilizations/franks/villager-select']['switch'], 'Franks')
        self.assertIn('civilizations/franks/dat-unit-281-select', cues)

    def test_first_milestone_hud_bindings_exist_in_owned_materials(self):
        materials, textures = load_material_index(WIDGETUI)
        for key in ('britons', 'franks'):
            entry = self.content['civilizationCatalog'][key]
            self.assertIn('CivEmblem' + entry['internalName'], materials)
            self.assertIn(entry['internalName'] + 'Icon', materials.keys() | textures.keys())
            self.assertIn(entry['hudStyle'] + 'ResourcePanel', materials)


if __name__ == '__main__':
    unittest.main()
