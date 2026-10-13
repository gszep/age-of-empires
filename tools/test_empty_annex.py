import unittest
from types import SimpleNamespace as NS

from import_content import empty_annex_graphic


class EmptyAnnexTest(unittest.TestCase):
    def test_explicit_blank_matches_missing_graphic(self):
        graphic = dict(name='BLANK', file_name='None', slp=-1, deltas=[],
                       particle_effect_name='', sound_id=-1, wwise_sound_id=0,
                       angle_sounds_used=0, angle_sounds=[])
        dat = NS(graphics=[NS(**graphic)])
        self.assertTrue(empty_annex_graphic(dat, -1))
        self.assertTrue(empty_annex_graphic(dat, 0))
        for key, value in dict(name='Composite', file_name='real_x1', slp=1,
                               deltas=[NS(graphic_id=1)], particle_effect_name='fire',
                               sound_id=1, wwise_sound_id=1, angle_sounds_used=1,
                               angle_sounds=[NS()]).items():
            with self.subTest(field=key):
                self.assertFalse(empty_annex_graphic(NS(graphics=[NS(**{**graphic, key: value})]), 0))
        self.assertFalse(empty_annex_graphic(NS(graphics=[None]), 0))


if __name__ == '__main__':
    unittest.main()
