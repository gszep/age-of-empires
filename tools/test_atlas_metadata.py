import copy
import json
from pathlib import Path
import unittest
from atlas_metadata import expand_atlas_frames, intern_atlas_frames


class AtlasMetadataTest(unittest.TestCase):
    @unittest.skipUnless(Path('public/imported/aoe2/manifest.json').is_file(), 'no owned manifest')
    def test_published_wire_fits_the_javascript_string_limit(self):
        path = Path('public/imported/aoe2/manifest.json')
        self.assertLess(path.stat().st_size, 0x1fffffe8,
                        'the browser/Node cannot parse this ASCII JSON string')

    def test_lossless_deterministic_interning_covers_annexes_pages_and_scales(self):
        frames = [{'x': 1, 'y': 2, 'w': 3, 'h': 4, 'cx': -1, 'cy': 8, 'page': 1}]
        a = {'image': 'a.png', 'size': [16, 16], 'framesInFile': 1, 'frames': frames, 'scale': 1}
        b = {**a, 'scale': 2, 'pages': [{'image': 'a.png', 'size': [16, 16]}, {'image': 'b.png', 'size': [8, 8]}]}
        original = {'entities': {'root': {'atlases': {'idle': a}}},
                    'civilizations': {'other': {'entities': {'unit': {'atlases': {'idle': b}, 'annexes': [{'atlases': {'idle': a}}]}}}}}
        packed = intern_atlas_frames(copy.deepcopy(original))
        self.assertEqual(len(packed['atlasFrames']), 1)
        self.assertNotIn('frames', packed['entities']['root']['atlases']['idle'])
        wire = json.dumps(packed, sort_keys=True)
        restored = expand_atlas_frames(json.loads(wire))
        self.assertEqual(restored, original)
        self.assertIs(restored['entities']['root']['atlases']['idle']['frames'],
                      restored['civilizations']['other']['entities']['unit']['atlases']['idle']['frames'])
        self.assertEqual(json.dumps(intern_atlas_frames(restored), sort_keys=True), wire)

    def test_distinct_geometry_is_never_aliased_and_bad_refs_fail(self):
        value = {'entities': {'root': {'atlases': {str(i): {'frames': [{'x': i}]} for i in range(2)}}}}
        self.assertEqual(len(intern_atlas_frames(value)['atlasFrames']), 2)
        with self.assertRaisesRegex(ValueError, 'missing atlas frame set'):
            expand_atlas_frames({'entities': {'root': {'atlases': {'idle': {'framesRef': 'absent'}}}}})


if __name__ == '__main__':
    unittest.main()
