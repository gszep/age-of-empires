"""Test particle import with synthetic fixtures: PNG atlas, AtlasImagesRaw, extra fields."""

import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace as Row

from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from import_content import particle_effects, feedback_effect_links
from convert_sld import convert_particles


class ParticleImportTest(unittest.TestCase):
    """Synthetic fixture tests for generalized particle importer."""

    def setUp(self):
        """Create a temporary particles directory with fixtures."""
        self.temp_dir = tempfile.TemporaryDirectory()
        self.particles_dir = Path(self.temp_dir.name)
        self.hashes = {}
        self.composed = self.particles_dir / 'output'

    def effects(self, names):
        return particle_effects(self.particles_dir, names, self.hashes, self.composed)

    def test_feedback_links_follow_foundation_deltas_not_the_parent(self):
        dat = Row(graphics=[
            Row(particle_effect_name='spawn'), Row(particle_effect_name='glow'),
            Row(particle_effect_name='complete'), Row(particle_effect_name='', deltas=[Row(graphic_id=4)]),
            Row(particle_effect_name='dust'),
        ])
        unit = Row(creatable=Row(spawning_graphic=0), building=Row(
            researching_graphic=1, research_completed_graphic=2, construction_graphic_id=3))
        self.assertEqual(feedback_effect_links(dat, unit), {
            'spawnEffect': 'spawn', 'researchingEffect': 'glow',
            'researchCompleteEffect': 'complete', 'constructionEffect': 'dust',
        })
        self.assertEqual(feedback_effect_links(dat, Row(creatable=None, building=None)), {})

    def tearDown(self):
        self.temp_dir.cleanup()

    def _make_png_atlas(self, name: str, image_size: tuple[int, int], frame_count: int):
        """Create a TexturePacker JSON atlas with a synthetic PNG."""
        width, height = image_size
        frames_per_row = 5
        atlas_width = frames_per_row * width
        atlas_height = ((frame_count - 1) // frames_per_row + 1) * height

        # Create PNG
        png_path = self.particles_dir / f"{name}.png"
        img = Image.new("RGBA", (atlas_width, atlas_height), (100, 150, 200, 255))
        img.save(png_path)

        # Create TexturePacker JSON with frame boxes
        frames = []
        for i in range(frame_count):
            row = i // frames_per_row
            col = i % frames_per_row
            frames.append({
                "filename": f"frame_{i:04d}.png",
                "frame": {"x": col * width, "y": row * height, "w": width, "h": height},
                "rotated": False,
                "trimmed": False,
                "spriteSourceSize": {"x": 0, "y": 0, "w": width, "h": height},
                "sourceSize": {"w": width, "h": height},
                "pivot": {"x": 0.5, "y": 0.5},
            })

        table = {"frames": frames, "meta": {"image": f"{name}.png", "size": {"w": atlas_width, "h": atlas_height}}}
        json_path = self.particles_dir / f"{name}.json"
        json_path.write_text(json.dumps(table))

    def _make_raw_frames(self, dirname: str, pattern: str, frame_count: int, frame_size: tuple[int, int]):
        """Create numbered frame files for AtlasImagesRaw."""
        dir_path = self.particles_dir / dirname
        dir_path.mkdir(parents=True, exist_ok=True)

        width, height = frame_size
        for i in range(frame_count):
            frame_path = dir_path / pattern.replace("%04d", f"{i:04d}")
            img = Image.new("RGBA", (width, height), (50 + i, 100, 150 + i, 255))
            img.save(frame_path)

    def test_png_atlas_with_extra_fields(self):
        """PNG atlas (like construction_medium_ground) with timing/visibility fields."""
        self._make_png_atlas("smoke_medium", (64, 64), 60)

        definition = {
            "AtlasFile": "smoke_medium.png",
            "ImageFirst": 0,
            "ImageCount": 60,
            "Type": "Once",
            "Layer": "Terrain",
            "Duration": 6,
            "Scale": 1,
            "Alpha": 0.5,
            "StartDelay": 0.25,
            "StopMode": "Fade",
            "StopDuration": 0.5,
            "StartDuration": 1.0,
            "AlphaStart": 3,
            "AlphaEnd": 0,
            "Timer": "Real",
            "SortBias": 100,
            "DisplayLevel": "High"
        }
        (self.particles_dir / "construction_medium_ground.json").write_text(json.dumps(definition))

        effects = self.effects({"construction_medium_ground"})

        effect = effects["construction_medium_ground"]
        self.assertEqual(effect["loop"], False)
        self.assertEqual(effect["scale"], 1.0)
        self.assertEqual(effect["alpha"], 0.5)
        self.assertEqual(effect["layer"], "Terrain")
        self.assertEqual(effect["startDelay"], [0.25, 0.25])
        self.assertEqual(effect["stopMode"], "Fade")
        self.assertEqual(effect["startDuration"], 1.0)
        self.assertEqual(effect["sortBias"], 100)
        self.assertEqual(effect["displayLevel"], "High")
        self.assertEqual(len(effect["frames"]), 60)
        self.assertIn("smoke_medium.png", str(effect["atlas"]))
        converted = convert_particles(effects, self.composed)["construction_medium_ground"]
        for key in ('alpha', 'layer', 'startDelay', 'stopMode', 'stopDuration', 'startDuration',
                    'alphaStart', 'alphaEnd', 'timer', 'sortBias', 'displayLevel'):
            self.assertEqual(converted[key], effect[key], f'{key} must reach the published manifest')

    def test_identical_particle_pages_share_one_file_but_different_pages_do_not(self):
        self._make_png_atlas('shared', (8, 8), 2)
        source = self.particles_dir / 'shared.png'
        with Image.open(source) as image:
            image.paste((255, 0, 0, 255), (8, 0, 16, 8))
            image.save(source)
        for different in [False, True]:
            with self.subTest(different=different):
                for name, first, kind, seconds in [('a', 0, 'Loop', 3), ('b', int(different), 'Once', 2.5)]:
                    (self.particles_dir / f'{name}.json').write_text(json.dumps({
                        'AtlasFile': 'shared.png', 'ImageFirst': first, 'ImageCount': 1,
                        'Type': kind, 'Duration': seconds, 'Scale': 1,
                    }))
                effects = self.effects({'a', 'b'})
                effects['b']['frames'][0]['pivotX'] = .25 # Pixels may alias; geometry must remain per effect.
                output = self.composed / str(different)
                result = convert_particles(dict(reversed(list(effects.items()))), output)
                self.assertEqual(sorted(p.name for p in (output / 'particles').glob('*.png')),
                                 ['a.png', 'b.png'] if different else ['a.png'])
                a, b = result['a']['atlas'], result['b']['atlas']
                self.assertEqual(a['image'], 'particles/a.png')
                self.assertEqual(a['image'] == b['image'], not different)
                self.assertNotEqual(a['frames'][0]['cx'], b['frames'][0]['cx'])
                self.assertTrue(result['a']['loop'])
                self.assertFalse(result['b']['loop'])
                self.assertEqual(result['b']['cycleSeconds'], [2.5, 2.5])
                if not different:
                    # An incremental full import also retires old duplicate URLs.
                    (output / 'particles/b.png').write_bytes(b'obsolete duplicate')
                    self.assertEqual(convert_particles(effects, output), result)
                    self.assertFalse((output / 'particles/b.png').exists())

    def test_atlas_images_raw_composed_into_atlas(self):
        """AtlasImagesRaw frames composed deterministically into near-square grid."""
        self._make_raw_frames("test_move", "p_all_move_%04d.png", 15, (32, 32))

        definition = {
            "AtlasImagesRaw": {
                "Format": "test_move\\p_all_move_%04d.png",
                "First": 0,
                "Last": 14
            },
            "Type": "Once",
            "Duration": 0.5,
            "Scale": 0.5,
            "DisplayInFog": True,
            "DisplayInHidden": True,
            "DimInFog": False,
            "Timer": "Real"
        }
        (self.particles_dir / "move.json").write_text(json.dumps(definition))

        # Translucent source coverage must not be multiplied by itself on paste.
        source = self.particles_dir / 'test_move/p_all_move_0000.png'
        Image.new('RGBA', (32, 32), (50, 100, 150, 128)).save(source)
        effects = self.effects({"move"})

        effect = effects["move"]
        self.assertEqual(effect["scale"], 0.5)
        self.assertEqual(effect["loop"], False)
        self.assertEqual(effect["cycleSeconds"], [0.5, 0.5])
        self.assertEqual(effect["displayInFog"], True)
        self.assertEqual(effect["displayInHidden"], True)
        self.assertEqual(effect["dimInFog"], False)
        self.assertEqual(effect["timer"], "Real")

        # Check frames: 15 frames in near-square grid (4 cols, 4 rows)
        self.assertEqual(len(effect["frames"]), 15)
        frames = effect["frames"]

        # Verify grid layout: cols = ceil(sqrt(15)) = 4, rows = ceil(15/4) = 4
        # Each frame is 32×32, so grid is 128×128
        for i, frame in enumerate(frames):
            row = i // 4
            col = i % 4
            self.assertEqual(frame["x"], col * 32, f"Frame {i} x position")
            self.assertEqual(frame["y"], row * 32, f"Frame {i} y position")
            self.assertEqual(frame["w"], 32)
            self.assertEqual(frame["h"], 32)

        # Check composed atlas
        atlas_path = Path(effect["atlas"])
        self.assertEqual(atlas_path.parent, self.composed)
        self.assertFalse((self.particles_dir / '.composed').exists())
        self.assertIn('particles/test_move/p_all_move_0000.png', self.hashes)
        self.assertTrue(atlas_path.exists(), f"Composed atlas missing: {atlas_path}")
        with Image.open(atlas_path) as img:
            self.assertEqual(img.getpixel((0, 0)), (50, 100, 150, 128))
            self.assertEqual(img.size, (128, 128), "Composed atlas grid 4×4 at 32×32 each")
            # Verify atlas is ≤ 8192 in both dimensions
            self.assertLessEqual(img.size[0], 8192)
            self.assertLessEqual(img.size[1], 8192)

    def test_identical_continuation_pages_publish_shared_image_urls(self):
        from unittest.mock import patch
        self._make_png_atlas('shared', (8, 8), 2)
        for name in ['a', 'b']:
            (self.particles_dir / f'{name}.json').write_text(json.dumps({
                'AtlasFile': 'shared.png', 'ImageFirst': 0, 'ImageCount': 2,
                'Type': 'Once', 'Duration': 1, 'Scale': 1,
            }))
        with patch('sld_layers.MAX_SHEET', 8):
            result = convert_particles(self.effects({'a', 'b'}), self.composed)
        self.assertEqual(sorted(p.name for p in (self.composed / 'particles').glob('*.png')), ['a.png'])
        for effect in result.values():
            atlas = effect['atlas']
            self.assertEqual(atlas['pages'], [{'image': 'particles/a.png', 'size': [8, 8]}] * 2)
            self.assertEqual([frame.get('page', 0) for frame in atlas['frames']], [0, 1])

    def test_absent_optional_fields_omitted(self):
        """Optional fields not in definition are not added to output."""
        self._make_png_atlas("simple", (32, 32), 1)

        definition = {
            "AtlasFile": "simple.png",
            "ImageFirst": 0,
            "ImageCount": 1,
            "Type": "Loop",
            "Duration": 2,
            "Scale": 1,
        }
        (self.particles_dir / "idlepointer.json").write_text(json.dumps(definition))

        effects = self.effects({"idlepointer"})

        effect = effects["idlepointer"]
        # Required fields
        self.assertIn("loop", effect)
        self.assertIn("cycleSeconds", effect)
        # Optional fields should be absent
        self.assertNotIn("layer", effect)
        self.assertNotIn("startMode", effect)
        self.assertNotIn("displayInFog", effect)
        self.assertNotIn("alpha", effect)

    def test_unknown_format_raises(self):
        """Particle with neither AtlasFile nor AtlasImagesRaw raises ValueError."""
        definition = {
            "Type": "Loop",
            "Duration": 1,
            "Scale": 1,
        }
        (self.particles_dir / "broken.json").write_text(json.dumps(definition))

        with self.assertRaises(ValueError) as ctx:
            self.effects({"broken"})
        self.assertIn("no AtlasFile or AtlasImagesRaw", str(ctx.exception))

    def test_missing_atlas_raw_frame_raises(self):
        """AtlasImagesRaw with missing frame file raises ValueError."""
        # Don't create the actual frame files
        definition = {
            "AtlasImagesRaw": {
                "Format": "missing\\frame_%04d.png",
                "First": 0,
                "Last": 4
            },
            "Type": "Once",
            "Duration": 1,
        }
        (self.particles_dir / "broken_raw.json").write_text(json.dumps(definition))

        with self.assertRaises(ValueError) as ctx:
            self.effects({"broken_raw"})
        self.assertIn("frame file missing", str(ctx.exception))

    def test_atlas_images_raw_oversized_raises(self):
        """AtlasImagesRaw that would exceed 8192 px limit raises ValueError."""
        # Create 256 frames of 100×100: grid 16×16 = 1600×1600 (safe)
        # Create 300 frames of 100×100: grid 18×17 = 1800×1700 (safe)
        # Create many large frames to exceed 8192
        # ceil(sqrt(100)) = 10, 100/10 = 10 rows = 10×10 grid of 900×900 each = 9000×9000 (exceeds)
        self._make_raw_frames("too_large", "frame_%04d.png", 100, (900, 900))

        definition = {
            "AtlasImagesRaw": {
                "Format": "too_large\\frame_%04d.png",
                "First": 0,
                "Last": 99
            },
            "Type": "Once",
            "Duration": 1,
        }
        (self.particles_dir / "oversized.json").write_text(json.dumps(definition))

        with self.assertRaises(ValueError) as ctx:
            self.effects({"oversized"})
        self.assertIn("exceeds 8192 px limit", str(ctx.exception))

    def test_dds_atlas_unchanged_behavior(self):
        """Existing DDS atlas path still works (no PNG atlas created, reference files)."""
        # Create a minimal DDS "atlas" (just text, not real DDS - the code only checks existence)
        dds_path = self.particles_dir / "atlases" / "fire.dds"
        dds_path.parent.mkdir(parents=True, exist_ok=True)
        dds_path.write_text("fake dds")

        # Create PNG reference for the atlas table (still needed for texture)
        png_path = dds_path.with_suffix(".png")
        img = Image.new("RGBA", (200, 240), (200, 100, 50, 255))
        img.save(png_path)

        # Create TexturePacker JSON
        frames = []
        for i in range(2):
            frames.append({
                "filename": f"frame_{i}.png",
                "frame": {"x": i * 100, "y": 0, "w": 100, "h": 120},
                "rotated": False,
                "trimmed": False,
                "spriteSourceSize": {"x": 0, "y": 0, "w": 100, "h": 120},
                "sourceSize": {"w": 100, "h": 120},
                "pivot": {"x": 0.5, "y": 0.5},
            })
        table_path = dds_path.with_suffix(".json")
        table_path.write_text(json.dumps({"frames": frames}))

        definition = {
            "AtlasFile": "atlases\\fire.dds",
            "ImageFirst": 0,
            "ImageCount": 2,
            "Type": "Loop",
            "Duration": 3,
            "Scale": 0.5,
        }
        (self.particles_dir / "fire_small.json").write_text(json.dumps(definition))

        effects = self.effects({"fire_small"})

        effect = effects["fire_small"]
        self.assertEqual(effect["loop"], True)
        self.assertEqual(effect["scale"], 0.5)
        self.assertEqual(len(effect["frames"]), 2)
        self.assertIn("fire.png", str(effect["atlas"]))

        # Also exercise DDS-only decoding, not merely a DDS-named PNG fixture.
        img.save(dds_path)
        png_path.unlink()
        effects = self.effects({'fire_small'})
        self.assertEqual(Path(effects['fire_small']['atlas']), dds_path)
        converted = convert_particles(effects, self.composed)
        self.assertEqual(converted['fire_small']['atlas']['framesInFile'], 2)


if __name__ == "__main__":
    unittest.main()
