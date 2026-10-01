"""Original synthetic blocks guard the diagnostic reference, not DE artwork."""
import base64
import io
import struct
import unittest
from PIL import Image
from probes.block_compression_fixture import fixture


class BlockCompressionProbeTest(unittest.TestCase):
    def test_bc1_keeps_literal_blocks_current_endpoint_bytes_and_transparent_padding(self):
        block = struct.pack('<HHI', 0xffff, 0, 0)
        result = fixture([block], True)
        self.assertEqual((result['width'], result['height']), (64, 4))
        payload = base64.b64decode(result['compressed'])
        self.assertEqual(payload[:8], block)  # no lossy re-encoding
        self.assertEqual(len(payload), 128)
        pixels = Image.open(io.BytesIO(base64.b64decode(result['png']))).convert('RGBA')
        self.assertEqual(pixels.getpixel((0, 0)), (255, 255, 255, 255))
        self.assertEqual(pixels.getpixel((4, 0)), (0, 0, 0, 0))
        self.assertEqual(pixels.tobytes(), base64.b64decode(result['rgba']))
        self.assertEqual(result, fixture([block], True))

    def test_bc4_reference_is_opaque_data_and_preserves_source_interpolation(self):
        # Endpoint255,0, every index2: current CPU decoder floors 6*255/7.
        indices = sum(2 << (3 * i) for i in range(16))
        block = bytes((255, 0)) + indices.to_bytes(6, 'little')
        result = fixture([block], False)
        self.assertEqual(base64.b64decode(result['compressed'])[:8], block)
        pixels = Image.open(io.BytesIO(base64.b64decode(result['png']))).convert('RGBA')
        self.assertEqual(pixels.getpixel((0, 0)), (218, 218, 218, 255))
        self.assertEqual(pixels.getpixel((4, 0)), (0, 0, 0, 255))
        self.assertEqual(pixels.tobytes(), base64.b64decode(result['rgba']))


if __name__ == '__main__':
    unittest.main()
