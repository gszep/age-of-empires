import hashlib
import json
import struct
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from sld_integrity import source_names, validate_container, validate_sld
from sld_layers import FILE_HEADER, FRAME_HEADER


def container(first=16):
    header = FILE_HEADER.pack(b'SLDX', 4, 1, 0, first, 0)[:first]
    frame = FRAME_HEADER.pack(4, 4, 2, 2, 1, 0, 0)
    layer = struct.pack('<I4H2BH2B', 26, 0, 0, 4, 4, 0, 0, 1, 0, 1) + bytes(8)
    return header + frame + layer + bytes(2)


class SldIntegrityTest(unittest.TestCase):
    def test_exact_walk_accepts_both_documented_frame_starts_without_writing(self):
        for first in (14, 16):
            data = container(first)
            self.assertEqual(validate_container(data), 1)
            with tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / 'fixture.sld'
                path.write_bytes(data)
                before = hashlib.sha256(data).hexdigest()
                self.assertEqual(validate_sld(path), 1)
                self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), before)

    def test_present_layer_cannot_have_zero_length_or_escape_the_file(self):
        for length in (0, 3, 10000):
            data = bytearray(container())
            struct.pack_into('<I', data, 28, length)
            with self.assertRaisesRegex(ValueError, 'invalid length'):
                validate_container(data)

    def test_zero_filled_declared_tail_and_extra_bytes_cannot_pass_as_empty_frames(self):
        data = bytearray(container() + bytes(112))
        struct.pack_into('<H', data, 6, 3)
        with self.assertRaisesRegex(ValueError, 'not EOF'):
            validate_container(data)
        with self.assertRaisesRegex(ValueError, 'not EOF'):
            validate_container(container() + b'extra')
        with self.assertRaisesRegex(ValueError, 'invalid length|padding'):
            validate_container(container()[:-3])

    def test_source_inventory_includes_nested_profiles_and_annexes_only_once(self):
        content = {'entities': {'a': {'animations': {'idle': {'source': 'a.sld'}},
                    'annexes': [{'animations': {'idle': {'source': 'b.sld'}}}]}},
                   'civilizations': {'other': {'entities': {'a': {'animations': {'idle': {'source': 'a.sld'}}}}}},
                   'source': {'sha256': {'a.sld': 'digest'}}}
        self.assertEqual(source_names(content), {'a.sld', 'b.sld'})

    def test_import_rejects_bad_source_before_cache_reuse_and_keeps_last_good_manifest(self):
        from convert_sld import decoder_fingerprint, main
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            data = bytearray(container()); struct.pack_into('<I', data, 28, 0)
            (root / 'broken.sld').write_bytes(data)
            digest = hashlib.sha256(data).hexdigest()
            content = root / 'content.json'
            content.write_text(json.dumps({'source': {'sha256': {'broken.sld': digest}}, 'entities': {
                'unit': {'category': 'unit', 'animations': {'idle': {'source': 'broken.sld', 'frames': 1, 'directions': 1}}}}}))
            out = root / 'out'; out.mkdir()
            manifest = out / 'manifest.json'; manifest.write_text('last good manifest\n')
            cache = root / 'cache.json'
            cache.write_text(json.dumps({'decoder': decoder_fingerprint(), 'atlases': {
                'unit:idle': {'source': digest, 'expected': 1, 'atlas': {'frames': []}}}}))
            with patch('sys.argv', ['convert_sld.py', '--content', str(content), '--graphics', str(root),
                                    '--out', str(out), '--cache', str(cache)]):
                with self.assertRaisesRegex(ValueError, 'Incomplete or unsupported SLD source.*invalid length 0'):
                    main()
            self.assertEqual(manifest.read_text(), 'last good manifest\n')
            self.assertEqual(list(out.iterdir()), [manifest])

    @unittest.skipUnless(Path('.local/aoe2de/content.json').is_file(), 'owned import unavailable')
    def test_every_selected_owned_source_has_an_exact_container_walk(self):
        from depot import Graphics, depot_root, uhd_graphics_dir
        root = depot_root()
        graphics = Graphics(root / 'depot_813784/resources/_common/drs/graphics', uhd_graphics_dir(root))
        names = source_names(json.loads(Path('.local/aoe2de/content.json').read_text()))
        self.assertGreater(len(names), 0)
        for name in sorted(names):
            with self.subTest(source=name):
                self.assertGreater(validate_sld(graphics.path(name)), 0)


if __name__ == '__main__':
    unittest.main()
