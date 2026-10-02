import unittest
from test_import_aoe2 import extracted_content, _dat, sld
from naval import graphic_layers
from import_content import graphic_sound_events


class AttackGraphicsImportTest(unittest.TestCase):
    def test_every_selected_second_attack_retains_source_layers_clocks_and_audio(self):
        content = extracted_content(); dat = _dat(); checked = 0
        for profile in [content, *content['civilizations'].values()]:
            civ = profile['civilization']['datIndex']
            for key, entity in profile['entities'].items():
                if 'attack' not in entity.get('animations', {}):
                    continue
                unit = dat.civs[civ].units[entity['id']] or dat.civs[0].units[entity['id']]
                if not unit or not unit.type_50 or unit.type_50.attack_graphic_2 < 0:
                    continue
                second = dat.graphics[unit.type_50.attack_graphic_2]
                self.assertIn('attack-2', entity['animations'], (civ, key))
                self.assertAlmostEqual(entity['combat']['secondAttackReleaseSeconds'],
                                       unit.type_50.frame_delay * second.frame_duration, places=5)
                if 'attack-2' in entity.get('animationLayers', {}):
                    actual = {entity['animations'][row['animation']]['graphicId'] for row in entity['animationLayers']['attack-2']}
                    self.assertEqual(actual, {gid for gid, x, y in graphic_layers(dat, second.id)})
                    for index, row in enumerate(entity['animationLayers']['attack-2']):
                        animation = entity['animations'][row['animation']]
                        expected = graphic_sound_events(second) if index == 0 and graphic_sound_events(second) else graphic_sound_events(dat.graphics[animation['graphicId']])
                        self.assertEqual(animation['soundEvents'], expected)
                else:
                    self.assertEqual(entity['animations']['attack-2']['graphicId'], second.id)
                    self.assertEqual(entity['animations']['attack-2']['soundEvents'], graphic_sound_events(second))
                checked += 1
        self.assertGreater(checked, 50)
        self.assertEqual(content['entities']['dat-unit-329']['animations']['attack-2']['source'], sld('u_cam_camel_attackB'))
        self.assertEqual(content['entities']['dat-unit-25']['animations']['attack-2']['source'], sld('u_inf_teutonic_knight_attackB'))


if __name__ == '__main__':
    unittest.main()
