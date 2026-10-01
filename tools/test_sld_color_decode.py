"""Authored source blocks verify the BC1 endpoint correction independently."""
import struct
import unittest
from sld_layers import ColorFrame, MaskFrame, _decode_bc1_block, pack_color_atlas, pack_playercolor_atlas


class SldColorDecodeTest(unittest.TestCase):
    def test_full_range_primaries_and_interpolated_colors_reach_the_atlas(self):
        # Selector row0,1,2,3, repeated. RGB565 red/green and their two blends.
        data = struct.pack('<HHI', 0xf800, 0x07e0, 0xe4e4e4e4)
        frame = ColorFrame(4, 4, 2, 3, bytearray(_decode_bc1_block(data, 0)))
        pages, atlas = pack_color_atlas([frame], 1)
        self.assertEqual(list(pages[0].get_flattened_data()),
                         [(255,0,0,255), (0,255,0,255), (170,85,0,255), (85,170,0,255)] * 4)
        self.assertEqual(atlas['frames'][0], dict(x=0,y=0,w=4,h=4,cx=2,cy=3))

    def test_low_endpoint_bits_survive_promotion_and_equal_endpoints_keep_transparency(self):
        data = struct.pack('<HHI', 0x8410, 0x8410, 0xe4e4e4e4)
        rgba = _decode_bc1_block(data, 0)
        self.assertEqual(rgba[:16], [132,130,132,255] * 3 + [0,0,0,0])
        black = _decode_bc1_block(struct.pack('<HHI', 0, 0, 0), 0)
        self.assertEqual(black, [0,0,0,255] * 16)

    def test_player_shading_uses_corrected_main_color_without_changing_coverage(self):
        data = struct.pack('<HHI', 0xffff, 0, 0)
        color = ColorFrame(4, 4, 2, 3, bytearray(_decode_bc1_block(data, 0)))
        mask = MaskFrame(4, 4, 2, 3, bytearray([0,64,128,255] * 4))
        pages, atlas = pack_playercolor_atlas([mask], [color], 1)
        self.assertEqual(list(pages[0].get_flattened_data()), [(255,255,255,a) for a in [0,64,128,255] * 4])
        self.assertEqual((atlas['frames'][0]['cx'], atlas['frames'][0]['cy']), (2,3))
        self.assertEqual(list(mask.alpha), [0,64,128,255] * 4)


if __name__ == '__main__':
    unittest.main()
