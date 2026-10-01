import tempfile
import unittest
from pathlib import Path

from atlas_cache import AtlasCache, LAYERS, fingerprints


class AtlasCacheTest(unittest.TestCase):
    def test_cached_conversion_matches_clean_decode_bytes_and_manifest_entries(self):
        from convert_sld import convert, convert_mask, published
        from test_sld_integrity import container
        import hashlib
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory)
            source = out / 'fixture.sld'
            source.write_bytes(container())
            digest = hashlib.sha256(source.read_bytes()).hexdigest()
            fps = dict.fromkeys(LAYERS, 'decoder')
            entries = {}
            for layer in LAYERS:
                old = out / f'old/{layer}.png'
                atlas = convert(source, old, 1) if layer == 'main' else convert_mask(source, old, 1, layer)
                entries[f'old:idle:{layer}'] = dict(source=digest, expected=1, image=f'old/{layer}.png',
                    layer=layer, decoder='decoder', atlas=atlas)
            cache = AtlasCache({'schema': 2, 'atlases': entries}, fps, 'legacy', out)
            for layer in LAYERS:
                reused = cache.reuse(digest, 1, layer, f'new/{layer}.png')
                fresh = out / f'fresh/{layer}.png'
                clean = convert(source, fresh, 1) if layer == 'main' else convert_mask(source, fresh, 1, layer)
                self.assertEqual(published(reused, f'new/{layer}.png', 2), published(clean, f'new/{layer}.png', 2))
                if clean:
                    self.assertEqual((out / f'new/{layer}.png').read_bytes(), fresh.read_bytes())

    def test_dependency_changes_invalidate_only_their_layers(self):
        source = Path(__file__).with_name('sld_layers.py').read_text()
        original = fingerprints(source, 'conversion')
        cases = {
            '_rgb565': {'main', 'playercolor'},
            '_bc4_lookup': {'shadow', 'damage', 'playercolor'},
            'decode_outline_layer': {'outline'},
            '_shelf_pack': set(LAYERS),
            '_decode_wanted': set(LAYERS),
        }
        for name, expected in cases.items():
            # Inject a statement at the actual dependency boundary, without
            # monkey-patching the fingerprint's dependency table.
            import ast
            node = next(n for n in ast.parse(source).body if getattr(n, 'name', None) == name)
            lines = source.splitlines(keepends=True)
            lines.insert(node.body[0].lineno - 1, "    'dependency probe'\n")
            changed = fingerprints(''.join(lines), 'conversion')
            self.assertEqual({layer for layer in LAYERS if original[layer] != changed[layer]}, expected)
        self.assertTrue(all(original[k] != fingerprints(source, 'changed conversion')[k] for k in LAYERS))

    def test_namespace_changes_reuse_all_pages_and_match_clean_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory)
            (out / 'old').mkdir()
            (out / 'old/body.png').write_bytes(b'first')
            (out / 'old/body-p1.png').write_bytes(b'second')
            fps = dict.fromkeys(LAYERS, 'valid')
            atlas = {'image': 'body.png', 'pages': [[4, 4], [4, 4]], 'frames': []}
            entry = dict(source='sha', expected=2, layer='main', decoder='valid', image='old/body.png', atlas=atlas)
            cache = AtlasCache({'schema': 2, 'atlases': {'old:idle': entry}}, fps, 'legacy', out)
            self.assertEqual(cache.reuse('sha', 2, 'main', 'new/idle.png'), {**atlas, 'image': 'idle.png'})
            self.assertEqual((out / 'new/idle.png').read_bytes(), b'first')
            self.assertEqual((out / 'new/idle-p1.png').read_bytes(), b'second')
            self.assertIsNone(cache.reuse('changed', 2, 'main', 'new/idle.png'))
            self.assertIsNone(cache.reuse('sha', 3, 'main', 'new/idle.png'))
            self.assertIsNone(cache.reuse('sha', 2, 'outline', 'new/idle.png'))
            (out / 'old/body-p1.png').unlink()
            self.assertIsNone(cache.reuse('sha', 2, 'main', 'new/idle.png'))

    def test_unknown_schema_or_changed_legacy_decoder_never_reuses(self):
        with tempfile.TemporaryDirectory() as directory:
            for stored in ({'schema': 3}, {'decoder': 'changed'}, {}):
                cache = AtlasCache(stored, dict.fromkeys(LAYERS, 'fp'), 'current', Path(directory))
                self.assertIsNone(cache.reuse('sha', 1, 'main', 'body.png'))

    def test_only_proven_unchanged_legacy_cache_migrates_and_layer_change_misses(self):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory)
            (out / 'body.png').write_bytes(b'png')
            atlas = {'frames': []}
            old = {'source': 'sha', 'expected': 1, 'image': 'body.png', 'atlas': atlas}
            fps = dict.fromkeys(LAYERS, 'fp')
            cache = AtlasCache({'decoder': 'current', 'atlases': {'unit:idle': old}}, fps, 'current', out)
            self.assertEqual(cache.reuse('sha', 1, 'main', 'body.png'), atlas)
            stored = {'schema': 2, 'atlases': {
                'unit:idle': {**old, 'layer': 'main', 'decoder': 'fp'},
                'unit:idle:shadow': {**old, 'layer': 'shadow', 'decoder': 'fp'},
            }}
            cache = AtlasCache(stored, {**fps, 'main': 'changed'}, 'ignored', out)
            self.assertIsNone(cache.reuse('sha', 1, 'main', 'body.png'))
            self.assertEqual(cache.reuse('sha', 1, 'shadow', 'body.png'), atlas)
