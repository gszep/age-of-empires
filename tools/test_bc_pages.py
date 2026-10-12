"""Source-block pages: real authored SLD streams, no owned content or GPU needed."""
import json
import struct
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

from convert_sld import convert, convert_mask, published, shared_atlas_jobs
from sld_layers import (FILE_HEADER, FRAME_HEADER, FLAG_DELTA, LAYER_MAIN,
                        LAYER_SHADOW, LAYER_DAMAGE, LAYER_PLAYERCOLOR, LAYER_OUTLINE,
                        ColorFrame, MaskFrame, decode_colors, decode_masks,
                        _decode_bc1_block, _decode_block, _ceil4,
                        pack_color_atlas, pack_mask_atlas)

TRANSPARENT = bytes.fromhex('00000000ffffffff')
RED = struct.pack('<HHI', 0xf800, 0, 0)
GREEN = struct.pack('<HHI', 0x07e0, 0, 0)
BLUE = struct.pack('<HHI', 0x001f, 0, 0)
WHITE = struct.pack('<HHI', 0xffff, 0, 0)
COVERAGE = bytes((200, 100)) + int('7654321076543210', 8).to_bytes(6, 'little')


def record(box=(0, 0, 4, 4), commands=((0, 1),), blocks=(RED,), delta=False):
    return box, commands, blocks, delta


def sld(records, layer=LAYER_MAIN):
    """Encode a real SLD command stream; masks include a main geometry layer."""
    data = bytearray(FILE_HEADER.pack(b'SLDX', 4, len(records), 0, 16, 0))
    for index, (box, commands, blocks, delta) in enumerate(records):
        kind = layer if layer in (LAYER_MAIN, LAYER_SHADOW) else LAYER_MAIN | layer
        data.extend(FRAME_HEADER.pack(64, 64, 13, 17, kind, 0, index))
        for current in (LAYER_MAIN, LAYER_SHADOW, LAYER_OUTLINE, LAYER_DAMAGE, LAYER_PLAYERCOLOR):
            if not kind & current:
                continue
            flags = FLAG_DELTA if delta else 0
            header = (struct.pack('<4H2B', *box, flags, 0) if current in (LAYER_MAIN, LAYER_SHADOW)
                      else bytes((flags, 0)))
            if current == LAYER_OUTLINE:
                # The exclusion fixture is one 4x4 block with alternating bits.
                payload = header + struct.pack('<H', 0) + b'\x81\x55\xaa'
            elif current == LAYER_MAIN and layer != LAYER_MAIN:
                count = ((box[2] - box[0] + 3) // 4) * ((box[3] - box[1] + 3) // 4)
                payload = header + struct.pack('<H2B', 1, 0, count) + RED * count
            else:
                payload = header + struct.pack('<H', len(commands))
                payload += b''.join(bytes(command) for command in commands) + b''.join(blocks)
            data.extend(struct.pack('<I', len(payload) + 4) + payload)
            data.extend(bytes((-len(data)) % 4))
    return bytes(data)


def decoded_page(payload, size, fmt):
    """Decode the generated row-major page with the portable #256 decoder."""
    width, height = size
    channels = 4 if fmt == 'bc1' else 1
    decode = _decode_bc1_block if channels == 4 else _decode_block
    pixels = bytearray(width * height * channels)
    for index in range(width * height // 16):
        block = bytes(decode(payload, index * 8))
        x, y = (index % (width // 4)) * 4, (index // (width // 4)) * 4
        for row in range(4):
            start = ((y + row) * width + x) * channels
            pixels[start:start + 4 * channels] = block[row * 4 * channels:(row + 1) * 4 * channels]
    return bytes(pixels)


def fringe_block(fmt, zero=True):
    # Only the 3x3 frame is covered. The last row/column are deliberate fringe.
    if fmt == 'bc1':
        selectors = sum((3 if zero and (i % 4 == 3 or i // 4 == 3) else 1) << (2 * i)
                        for i in range(16))
        return struct.pack('<HHI', 0, 0xffff, selectors)
    selectors = sum((1 if zero and (i % 4 == 3 or i // 4 == 3) else 0) << (3 * i)
                    for i in range(16))
    return bytes((255, 0)) + selectors.to_bytes(6, 'little')


class BcPagesTest(unittest.TestCase):
    def assert_page(self, image, payload, fmt):
        self.assertIsNotNone(payload)
        self.assertEqual(len(payload), image.width * image.height // 2)
        self.assertEqual(image.width % 4, 0)
        self.assertEqual(image.height % 4, 0)
        expected = image.tobytes() if fmt == 'bc1' else image.getchannel('A').tobytes()
        self.assertEqual(decoded_page(payload, image.size, fmt), expected)

    def test_actual_pages_match_every_png_pixel_and_coverage_with_empty_padding(self):
        interpolated = struct.pack('<HHI', 0xf841, 0x07e1, 0xe4e4e4e4)
        for layer, fmt, block in ((LAYER_MAIN, 'bc1', interpolated), (LAYER_SHADOW, 'bc4', COVERAGE),
                                  (LAYER_DAMAGE, 'bc4', COVERAGE)):
            with self.subTest(layer=layer):
                # Width=8 atlas; final row's second block is unused. First frame
                # includes an explicit skip, second a missing keyframe inheritance.
                data = sld([record((0, 0, 8, 4), ((1, 1),), (block,), True),
                            record(blocks=(block,)), record(blocks=(block,)),
                            record(blocks=(block,))], layer)
                frames = decode_colors(data) if fmt == 'bc1' else decode_masks(data, layer)
                pack = pack_color_atlas if fmt == 'bc1' else pack_mask_atlas
                images, atlas, pages = pack(frames, len(frames))
                self.assertEqual(len(images), 1)
                self.assertEqual(pages[0][:8], TRANSPARENT if fmt == 'bc1' else bytes(8))
                self.assertEqual(pages[0][-8:], TRANSPARENT if fmt == 'bc1' else bytes(8))
                self.assert_page(images[0], pages[0], fmt)
                self.assertEqual(pack(frames, len(frames))[2], pages)
                self.assert_geometry(atlas)

    def assert_geometry(self, atlas):
        frames = [f for f in atlas['frames'] if f['w'] and f['h']]
        for i, frame in enumerate(frames):
            self.assertEqual((frame['x'] % 4, frame['y'] % 4), (0, 0))
            for other in frames[i + 1:]:
                if frame.get('page', 0) == other.get('page', 0):
                    self.assertTrue(frame['x'] + _ceil4(frame['w']) <= other['x'] or
                                    other['x'] + _ceil4(other['w']) <= frame['x'] or
                                    frame['y'] + _ceil4(frame['h']) <= other['y'] or
                                    other['y'] + _ceil4(other['h']) <= frame['y'])

    def test_skips_missing_keyframes_and_unspecified_tail_are_transparent(self):
        for delta in (False, True):
            frames = decode_colors(sld([record((0, 0, 12, 4), ((1, 1),), (RED,), delta)]))
            self.assertEqual(frames[0].blocks, [TRANSPARENT, RED, TRANSPARENT])
            images, _, pages = pack_color_atlas(frames, 1)
            self.assert_page(images[0], pages[0], 'bc1')

    def test_all_empty_pages_are_valid_transparent_blocks(self):
        images, atlas, pages = pack_color_atlas(decode_colors(sld([record(commands=((1, 0),), blocks=())])), 1)
        self.assertEqual(atlas['frames'][0]['w'], 0)
        self.assertEqual(pages, [TRANSPARENT])
        self.assert_page(images[0], pages[0], 'bc1')

    def test_delta_uses_keyframe_stride_origin_and_not_previous_delta(self):
        for layer, fmt, blocks in ((LAYER_MAIN, 'bc1', (RED, GREEN, BLUE, WHITE)),
                                  (LAYER_SHADOW, 'bc4', tuple(bytes((v, 0)) + bytes(6)
                                                            for v in (50, 100, 150, 200)))):
            # Keyframe is 8x8 at (4,4), delta is narrower and shifted by +4 x.
            data = sld([record((4, 4, 12, 12), ((0, 4),), blocks),
                        record((8, 4, 12, 12), ((0, 1), (1, 0)), (blocks[0],), True),
                        record((8, 4, 12, 12), ((2, 0),), (), True),
                        record((0, 4, 8, 12), ((4, 0),), (), True),
                        record((12, 4, 16, 12), ((2, 0),), (), True),
                        record((4, 8, 12, 12), ((2, 0),), (), True)], layer)
            frames = decode_colors(data) if fmt == 'bc1' else decode_masks(data, layer)
            empty = TRANSPARENT if fmt == 'bc1' else bytes(8)
            self.assertEqual(frames[1].blocks, [blocks[0], blocks[3]])
            self.assertEqual(frames[2].blocks, [blocks[1], blocks[3]])
            self.assertEqual(frames[3].blocks, [empty, blocks[0], empty, blocks[2]])
            self.assertEqual(frames[4].blocks, [empty, empty])  # no row wrap
            self.assertEqual(frames[5].blocks, [blocks[2], blocks[3]])
            pack = pack_color_atlas if fmt == 'bc1' else pack_mask_atlas
            images, atlas, pages = pack(frames, len(frames))
            self.assertEqual((atlas['frames'][2]['w'], atlas['frames'][2]['h'],
                              atlas['frames'][2]['cx'], atlas['frames'][2]['cy']), (4, 8, 5, 13))
            for image, payload in zip(images, pages):
                self.assert_page(image, payload, fmt)

    def test_non_aligned_inheritance_declines_bc_not_png(self):
        for layer, fmt, block in ((LAYER_MAIN, 'bc1', RED), (LAYER_SHADOW, 'bc4', COVERAGE)):
            data = sld([record(blocks=(block,)), record((1, 0, 5, 4), ((1, 0),), (), True)], layer)
            frames = decode_colors(data) if fmt == 'bc1' else decode_masks(data, layer)
            self.assertIsNone(frames[1].blocks)
            self.assertFalse(frames[1].empty)
            pack = pack_color_atlas if fmt == 'bc1' else pack_mask_atlas
            images, _, pages = pack(frames, 2)
            self.assertEqual(pages, [None])
            self.assertTrue(any(images[0].getchannel('A').tobytes()))

    def test_partial_keyframe_boundary_must_also_have_zero_fringe(self):
        for zero in (True, False):
            block = fringe_block('bc1', zero)
            frames = decode_colors(sld([record((0, 0, 3, 3), blocks=(block,)),
                                        record(commands=((1, 0),), blocks=(), delta=True)]))
            self.assertEqual(frames[1].blocks, [block] if zero else None)
            images, _, pages = pack_color_atlas(frames, 2)
            if zero:
                self.assert_page(images[0], pages[0], 'bc1')
            else:
                self.assertEqual(pages, [None])

    def test_non_multiple_frames_zero_fringe_only_and_missing_blocks_decline(self):
        for fmt, frame_type, pack, decode in (('bc1', ColorFrame, pack_color_atlas, _decode_bc1_block),
                                             ('bc4', MaskFrame, pack_mask_atlas, _decode_block)):
            for zero in (False, True):
                block = fringe_block(fmt, zero)
                full = bytes(decode(block, 0))
                channels = 4 if fmt == 'bc1' else 1
                cropped = b''.join(full[y * 4 * channels:(y * 4 + 3) * channels] for y in range(3))
                frame = frame_type(3, 3, 1, 2, bytearray(cropped), [block])
                images, atlas, pages = pack([frame], 1)
                self.assertEqual(atlas['frames'][0], dict(x=0, y=0, w=3, h=3, cx=1, cy=2))
                if zero:
                    self.assert_page(images[0], pages[0], fmt)
                else:
                    self.assertEqual(pages, [None])
                frame.blocks = None
                self.assertEqual(pack([frame], 1)[2], [None])

    def test_real_multipage_conversion_publication_and_canonical_aliases(self):
        from sld_integrity import validate_container
        for layer, fmt, block in ((LAYER_MAIN, 'bc1', RED), (LAYER_SHADOW, 'bc4', COVERAGE),
                                  (LAYER_DAMAGE, 'bc4', COVERAGE)):
            with tempfile.TemporaryDirectory() as directory, patch('sld_layers.MAX_SHEET', 8):
                root = Path(directory)
                source = root / 'fixture.sld'
                source.write_bytes(sld([record((0, 0, 8, 4), ((0, 2),), (block, block))] * 5, layer))
                self.assertEqual(validate_container(source.read_bytes()), 5)
                jobs = [dict(key=key, name='idle', source=source.name, expected=5, scale=scale, layers=())
                        for key, scale in [('z/alias', 1), ('a/canonical', 2)]]
                group = shared_atlas_jobs(jobs, {source.name: 'hash'})[0]
                canonical = group[0][2]
                atlas = (convert(source, root / canonical, 5) if layer == LAYER_MAIN else
                         convert_mask(source, root / canonical, 5, 'shadow' if layer == LAYER_SHADOW else 'damage'))
                self.assertEqual(len(atlas['pages']), 3)
                aliases = [published(atlas, canonical, job['scale']) for _, job, _, _ in group]
                self.assertEqual(aliases[0]['pages'], aliases[1]['pages'])
                self.assertEqual(aliases[0]['bc'], aliases[0]['pages'][0]['bc'])
                self.assertNotIn('bcPages', aliases[0])
                self.assertEqual(aliases[0]['frames'], atlas['frames'])
                self.assert_geometry(atlas)
                for page in aliases[0]['pages']:
                    self.assertEqual(page['bc']['image'], str(Path(page['image']).with_suffix('.' + fmt)))
                    with Image.open(root / page['image']) as png:
                        self.assert_page(png, (root / page['bc']['image']).read_bytes(), fmt)
                self.assertFalse((root / 'z/alias').exists())

    def test_page_local_eligibility_and_stale_sidecar_removal(self):
        for layer, fmt in ((LAYER_MAIN, 'bc1'), (LAYER_SHADOW, 'bc4')):
            with tempfile.TemporaryDirectory() as directory, patch('sld_layers.MAX_SHEET', 4):
                root = Path(directory)
                source, output = root / 'fixture.sld', root / 'unit/idle.png'

                def generate(zero):
                    source.write_bytes(sld([record((0, 0, 3, 3), blocks=(fringe_block(fmt, zero),)),
                                            record(blocks=(fringe_block(fmt, False),))], layer))
                    return (convert(source, output, 2) if layer == LAYER_MAIN else
                            convert_mask(source, output, 2, 'shadow'))

                generate(True)
                self.assertTrue(output.with_suffix('.' + fmt).is_file())
                entry = published(generate(False), 'unit/idle.png', 1)
                self.assertNotIn('bc', entry)
                self.assertNotIn('bc', entry['pages'][0])
                self.assertIn('bc', entry['pages'][1])
                self.assertFalse(output.with_suffix('.' + fmt).exists())
                self.assertTrue((root / entry['pages'][1]['bc']['image']).is_file())

    def test_outline_and_playercolor_files_and_metadata_remain_png_only(self):
        for layer, name in ((LAYER_OUTLINE, 'outline'), (LAYER_PLAYERCOLOR, 'playercolor')):
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                source = root / 'fixture.sld'
                source.write_bytes(sld([record(blocks=(COVERAGE,))], layer))
                output = root / f'idle-{name}.png'
                atlas = convert_mask(source, output, 1, name)
                self.assertTrue(atlas)
                self.assertTrue(output.is_file())
                self.assertNotIn('bc', json.dumps(published(atlas, output.name, 1)))
                self.assertEqual(list(root.glob('*.bc*')), [])


if __name__ == '__main__':
    unittest.main()
