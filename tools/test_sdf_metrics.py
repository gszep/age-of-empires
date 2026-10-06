import unittest
import json
import tempfile
from pathlib import Path
from unittest.mock import patch
import numpy as np
from PIL import Image
from sdf_metrics import LABELS, RING_RADIUS, main, measure, require_expected_labels


class StrokeMetricsTest(unittest.TestCase):
    def test_margin_rejects_a_clipped_ring_on_every_edge(self):
        for edge in ("left", "top", "right", "bottom"):
            with self.subTest(edge=edge):
                pixels = np.zeros((10, 10, 3), dtype="uint8")
                rows = slice(0, 3) if edge == "top" else slice(7, 10) if edge == "bottom" else slice(3, 7)
                cols = slice(0, 3) if edge == "left" else slice(7, 10) if edge == "right" else slice(3, 7)
                pixels[rows, cols] = 255
                with self.assertRaisesRegex(ValueError, "outline ring truncated"):
                    measure(Image.fromarray(pixels))

    def test_one_pixel_margin_includes_the_complete_dilated_ring(self):
        pixels = np.zeros((5, 5, 3), dtype="uint8")
        pixels[1:4, 1:4] = 255
        result = measure(Image.fromarray(pixels))
        self.assertEqual(result["margins"], (RING_RADIUS,)*4)
        self.assertEqual(result["ringLuma"], 0)

    def test_expanded_descender_crop_rejects_bright_beige_bottom_trim(self):
        pixels = np.zeros((14, 12, 3), dtype="uint8")
        pixels[2:11, 4:8] = 255
        pixels[11:14] = [243, 232, 216]  # bright panel trim, not white glyphs
        result = measure(Image.fromarray(pixels))
        self.assertEqual(result["box"], (4, 2, 8, 11))
        self.assertEqual(result["margins"], (4, 2, 4, 3))
        # The bottom ring is measured against the real trim, not omitted/padded.
        self.assertGreater(result["ringLuma"], 0)

    def test_requires_exactly_the_expected_six_labels(self):
        valid = [{"text": text} for text in LABELS]
        require_expected_labels(valid)
        for bad in ([], valid[:-1], valid+[valid[0]], valid[::-1],
                    [valid[0]]*6, [{"text": ""}]+valid[1:], [{}]+valid[1:], None):
            with self.subTest(labels=bad), self.assertRaises(ValueError):
                require_expected_labels(bad)

    def test_check_cli_rejects_partial_or_empty_labels_before_opening_images(self):
        valid = [{"text": text} for text in LABELS]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "labels.json"
            for bad in ([], valid[:-1], [{"text": ""}]+valid[1:]):
                path.write_text(json.dumps(bad))
                with self.subTest(labels=bad), patch("sys.argv", [
                    "sdf_metrics.py", "--check", "--labels", str(path), "--native", "absent.png"
                ]), self.assertRaisesRegex(ValueError, "expected"):
                    main()

    def test_neutral_strokes_not_beige_panel_art_and_normalized_coverage(self):
        pixels = np.full((10, 10, 3), [235, 215, 190], dtype="uint8")
        pixels[2:8, 3:5] = 240
        pixels[2:8, 6:8] = 240
        result = measure(Image.fromarray(pixels))
        self.assertEqual(result["box"], (3, 2, 8, 8))
        self.assertAlmostEqual(result["brightFraction"], .8, delta=.01)
        self.assertAlmostEqual(result["coreLuma"], 240)

    def test_dark_ring_and_unscaled_reported_core_luminance(self):
        pixels = np.zeros((10, 10, 3), dtype="uint8")
        pixels[2:8, 3:7] = [250, 230, 211]
        result = measure(Image.fromarray(pixels), (250, 230, 211))
        self.assertEqual(result["ringLuma"], 0)
        self.assertEqual(result["ringDarkFraction"], 1)
        self.assertAlmostEqual(result["coreLuma"], 232.8802)


if __name__ == "__main__":
    unittest.main()
