"""Source-hash reuse must not merge graphics or outlive an extraction."""
import hashlib
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import patch

from depot import Graphics
from import_content import _SourceHashes, animation_entry, sha256


def graphic(frames, seconds, event):
    return SimpleNamespace(file_name='shared_x1', frame_count=frames,
                           angle_count=8, frame_duration=seconds, mirroring_mode=1,
                           wwise_sound_id=event, angle_sounds_used=False)


class ContentHashTest(unittest.TestCase):
    def test_shared_source_is_read_once_without_sharing_animation_metadata(self):
        dat = SimpleNamespace(graphics=[graphic(4, .1, 17), graphic(7, .2, 23)])
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'shared_x1.sld'
            source.write_bytes(b'original source')
            hashes = _SourceHashes()
            with patch('import_content.sha256', wraps=sha256) as digest:
                first = animation_entry(dat, root, 0, hashes)
                second = animation_entry(dat, root, 1, hashes)
            digest.assert_called_once_with(source)
            self.assertEqual(hashes, {source.name: hashlib.sha256(b'original source').hexdigest()})
            self.assertEqual(first['source'], second['source'])
            self.assertEqual((first['graphicId'], second['graphicId']), (0, 1))
            self.assertEqual((first['frames'], second['frames']), (4, 7))
            self.assertEqual((first['frameSeconds'], second['frameSeconds']), (.1, .2))
            self.assertEqual(first['soundEvents'], [{'frame': 0, 'event': 17}])
            self.assertEqual(second['soundEvents'], [{'frame': 0, 'event': 23}])

    def test_new_extraction_rehashes_changed_source_and_missing_files_still_fail(self):
        dat = SimpleNamespace(graphics=[graphic(4, .1, 17)])
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'shared_x1.sld'
            source.write_bytes(b'before')
            before = _SourceHashes()
            animation_entry(dat, root, 0, before)
            source.write_bytes(b'after!')  # Same length: not a size-based cache.
            after = _SourceHashes()
            animation_entry(dat, root, 0, after)
            self.assertNotEqual(before, after)
            self.assertEqual(after[source.name], hashlib.sha256(b'after!').hexdigest())
            source.unlink()
            with self.assertRaises(FileNotFoundError):
                animation_entry(dat, root, 0, after)

    def test_base_and_enhanced_sources_keep_separate_hashes_and_scale(self):
        dat = SimpleNamespace(graphics=[graphic(4, .1, 17)])
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            base, enhanced = root / 'base', root / 'enhanced'
            base.mkdir()
            enhanced.mkdir()
            (base / 'shared_x1.sld').write_bytes(b'base')
            (enhanced / 'shared_x2.sld').write_bytes(b'enhanced')
            hashes = _SourceHashes()
            first = animation_entry(dat, Graphics(base), 0, hashes)
            second = animation_entry(dat, Graphics(base, enhanced), 0, hashes)
            self.assertEqual((first['scale'], second['scale']), (1, 2))
            self.assertEqual(hashes, {
                'shared_x1.sld': hashlib.sha256(b'base').hexdigest(),
                'shared_x2.sld': hashlib.sha256(b'enhanced').hexdigest(),
            })

    def test_profiles_share_reads_but_not_their_provenance_tables(self):
        dat = SimpleNamespace(graphics=[graphic(4, .1, 17)])
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'shared_x1.sld').write_bytes(b'shared')
            first = _SourceHashes()
            second = _SourceHashes(first.sld_hashes)
            first['first-profile-only'] = 'separate metadata'
            with patch('import_content.sha256', wraps=sha256) as digest:
                animation_entry(dat, root, 0, first)
                animation_entry(dat, root, 0, second)
            digest.assert_called_once_with(root / 'shared_x1.sld')
            self.assertEqual(second, {'shared_x1.sld': first['shared_x1.sld']})

    def test_same_basename_in_different_roots_never_reuses_the_wrong_hash(self):
        dat = SimpleNamespace(graphics=[graphic(4, .1, 17)])
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            first, second = root / 'first', root / 'second'
            first.mkdir()
            second.mkdir()
            (first / 'shared_x1.sld').write_bytes(b'first')
            (second / 'shared_x1.sld').write_bytes(b'other')
            hashes = _SourceHashes()
            animation_entry(dat, first, 0, hashes)
            animation_entry(dat, second, 0, hashes)
            self.assertEqual(hashes['shared_x1.sld'], hashlib.sha256(b'other').hexdigest())
