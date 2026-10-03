"""The shore window must finish its fade before meeting an opaque water tile."""
from pathlib import Path
import unittest

import numpy as np
from PIL import Image

from depot import depot_root
from import_blends import de_masks

SOURCE = depot_root() / 'depot_813782/resources/_common/terrain/blends/watershore.png'


@unittest.skipUnless(SOURCE.is_file(), 'owned shoreline mask unavailable')
class ShoreWindowTest(unittest.TestCase):
    def test_water_facing_edges_do_not_expose_the_underlying_sand(self):
        for index, mask in enumerate(de_masks(SOURCE)[:16]):
            edge = [mask[-1, :], mask[:, 0], mask[:, -1], mask[0, :]][index // 4]
            self.assertLess(float(1 - edge.min() / 255), .025, index)

    def test_complete_fade_uses_untouched_source_samples(self):
        with Image.open(SOURCE) as image:
            source = np.asarray(image.convert('RGB'))[:, :, 0]
        masks = de_masks(SOURCE)
        self.assertTrue(np.array_equal(masks[0], source[0:96, 64:160]))
        self.assertTrue(np.array_equal(masks[8], source[96:192, 0:96]))
        # The old cut stops mid-fade: this is the baseline defect, not a
        # contrast adjustment to an otherwise unchanged source window.
        self.assertGreater(float(1 - source[63, 64:128].min() / 255), .15)
