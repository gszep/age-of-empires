import json
import tempfile
import unittest
from pathlib import Path

from atlas_cache import AtlasCache, LAYERS, fingerprints


class AtlasCacheTest(unittest.TestCase):
    def test_conversion_budget_uses_cpu_and_memory_without_changing_decoder_identity(self):
        from convert_sld import conversion_workers, decoder_fingerprint
        gib = 1024 ** 3
        identity = decoder_fingerprint()
        self.assertEqual(conversion_workers(32, 65 * gib), 16)
        self.assertEqual(conversion_workers(32, 12 * gib), 3)
        self.assertEqual(conversion_workers(4, 65 * gib), 2)
        self.assertEqual(conversion_workers(1, 0), 1)
        self.assertEqual(decoder_fingerprint(), identity)

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

    def test_particle_conversion_isolated_from_sprite_layer_fingerprints(self):
        import ast
        source = Path(__file__).with_name('convert_sld.py').read_text()
        original = fingerprints(source, 'conversion')
        for name, expected in [('convert_particles', set()), ('convert', set(LAYERS))]:
            with self.subTest(function=name):
                node = next(n for n in ast.parse(source).body if getattr(n, 'name', None) == name)
                lines = source.splitlines(keepends=True)
                lines.insert(node.body[0].lineno - 1, "    'dependency probe'\n")
                changed = fingerprints(''.join(lines), 'conversion')
                self.assertEqual({layer for layer in LAYERS if original[layer] != changed[layer]}, expected)

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

    def test_interrupted_conversion_checkpoints_completed_jobs_for_reuse(self):
        """Verify drain() checkpoints completed jobs and resumes from cache."""
        from convert_sld import convert, drain, write_cache
        from test_sld_integrity import container
        import hashlib

        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory)
            source = out / 'fixture.sld'
            source.write_bytes(container())
            digest = hashlib.sha256(source.read_bytes()).hexdigest()
            fps = dict.fromkeys(LAYERS, 'decoder')
            cache_path = out / 'atlas-cache.json'

            # Part 1: Simulate interrupted conversion with drain()
            cache = {}

            def publish(item):
                identifier, atlas, error = item
                if error is None and atlas is not None:
                    # Store with image path relative to out
                    image_path = 'a/main.png'
                    cache[identifier] = {
                        'source': digest, 'expected': 1, 'image': image_path,
                        'layer': 'main', 'decoder': 'decoder', 'atlas': atlas
                    }

            def results_with_interrupt():
                # First job completes and gets published
                path_a = out / 'a/main.png'
                atlas_a = convert(source, path_a, 1)
                yield ('a:idle', atlas_a, None)
                # Second job would complete, but we interrupt before it yields
                raise KeyboardInterrupt()

            # Run drain with interval=0 so every publish triggers a checkpoint
            with self.assertRaises(KeyboardInterrupt):
                drain(results_with_interrupt, publish,
                      lambda: write_cache(cache_path, 'decoder', cache), interval=0)

            # Part 2: Verify checkpoint persisted the first job
            self.assertTrue(cache_path.exists(), "Cache file should exist after checkpoint")
            saved = json.loads(cache_path.read_text())
            self.assertEqual(saved['schema'], 2)
            self.assertEqual(saved['decoder'], 'decoder')
            self.assertEqual(len(saved['atlases']), 1)
            self.assertIn('a:idle', saved['atlases'])
            self.assertFalse(cache_path.with_suffix(cache_path.suffix + '.tmp').exists(),
                           "Temp file should be cleaned up")

            # Part 3: Resume from checkpoint and verify reuse
            restored_cache = AtlasCache(saved, fps, 'decoder', out)
            reused = restored_cache.reuse(digest, 1, 'main', 'a/main.png')
            self.assertIsNotNone(reused, "Checkpointed job should be reusable")

            # Verify pages are byte-identical to fresh conversion in a different location
            clean_dir = Path(directory) / 'clean'
            clean_dir.mkdir()
            clean_path = clean_dir / 'fresh.png'
            clean_atlas = convert(source, clean_path, 1)
            self.assertEqual((out / 'a/main.png').read_bytes(), clean_path.read_bytes())

    def test_drain_checkpoint_interval_respects_clock(self):
        """Verify drain() checkpoints only at configured intervals."""
        from convert_sld import drain

        # Simulate publish events at these times
        times = [0, 10, 20, 31, 40, 62]
        clock_state = [0]  # Mutable holder for clock value

        def fake_clock():
            return clock_state[0]

        save_calls = []

        def publish(item):
            pass  # No-op

        def save():
            save_calls.append(clock_state[0])

        def results():
            # Yield 6 items, advancing time before each publish
            for i, t in enumerate(times):
                clock_state[0] = t
                yield (f'item{i}', None, None)

        # interval=30: one save before the first job, then whenever now >= due
        # Initial due = 0 + 30 = 30
        # Item 0 at t=0: now < due, no save
        # Item 1 at t=10: now < due, no save
        # Item 2 at t=20: now < due, no save
        # Item 3 at t=31: now >= due, save. due = 31 + 30 = 61
        # Item 4 at t=40: now < due, no save
        # Item 5 at t=62: now >= due, save. due = 62 + 30 = 92
        drain(results, publish, save, interval=30, clock=fake_clock)

        # The first save precedes any conversion, so a stale entry for a page
        # that is about to be rewritten never survives an interruption.
        self.assertEqual(save_calls, [0, 31, 62])
