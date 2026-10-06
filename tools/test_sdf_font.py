"""Public parser/coverage fixtures plus skip-guarded lossless owned atlas checks."""
import json
import tempfile
import unittest
from pathlib import Path

from PIL import Image
from depot import depot_root
from sdf_font import extract_sdf_font, hud_characters, parse_glyphs

FONTS = depot_root() / "depot_813781/resources/_common/fonts"


class SdfFontTest(unittest.TestCase):
    def test_display_strings_across_profiles_and_widgets_determine_coverage(self):
        content = {"strings": {"greeting": "é"}, "ages": [{"name": "Äge"}],
                   "civilizations": {"other": {"entities": {"unit": {"name": "ñ", "source": "NO☃"}}}}}
        chars = hud_characters(content, {"panel": {"Text": "©"}}, {"42": "ß"})
        self.assertTrue(set("éÄñ©ß0123456789/:-") <= chars)
        self.assertNotIn("☃", chars)

    def test_parser_keeps_offsets_and_rejects_malformed_glyphs(self):
        header = "Source Font Pixel Size : 64\n"
        line = "Glyph - 'A'    W(4), H(5), UV(0.1, 0.2), ST(0.3, 0.4), Atlas(2), XO(-1.2345), YO(-2), HAdvance(3.4567)"
        size, glyphs = parse_glyphs(header + line)
        self.assertEqual(size, 64)
        self.assertEqual(glyphs[65], [4, 5, .1, .2, .3, .4, 2, -1.2345, -2, 3.4567])
        with self.assertRaises(ValueError):
            parse_glyphs(header + "Glyph - 'A'    bad")


@unittest.skipUnless((FONTS / "combined.txt").is_file(), "owned font not installed")
class OwnedSdfFontTest(unittest.TestCase):
    def test_packed_pixels_metrics_hashes_and_determinism(self):
        size, original = parse_glyphs((FONTS / "combined.txt").read_text())
        self.assertEqual((size, len(original)), (64, 7697))
        # Runtime surface strings, including a non-ASCII localization character.
        chars = hud_characters({"ages": [{"name": "Imperial Age"}], "strings": {"test": "é"}}, {}, {})
        with tempfile.TemporaryDirectory() as directory:
            out, hashes = Path(directory), {}
            result = extract_sdf_font(FONTS, chars, out, hashes)
            packed = Image.open(out / result["pages"][0]).convert("RGB")
            for code, g in result["glyphs"].items():
                old = original[int(code)]
                self.assertEqual(g[7:], old[7:])
                with Image.open(FONTS / f"combined_{old[6]:04}.png") as page:
                    x, y = round(old[2] * page.width), round(old[3] * page.height)
                    expected = page.convert("RGB").crop((x-2, y-2, x+g[0]+2, y+g[1]+2))
                x, y = round(g[2] * packed.width), round(g[3] * packed.height)
                actual = packed.crop((x-2, y-2, x+g[0]+2, y+g[1]+2))
                self.assertEqual(actual.tobytes(), expected.tobytes(), code)
            before = (out / result["pages"][0]).read_bytes()
            self.assertEqual(result, extract_sdf_font(FONTS, chars, out, {}))
            self.assertEqual(before, (out / result["pages"][0]).read_bytes())
            self.assertLess(len(before), 200_000)
            self.assertIn("fonts/combined.txt", hashes)
            self.assertEqual(set(map(int, result["glyphs"])), set(map(ord, chars)))

    def test_absent_glyph_is_an_explicit_import_error(self):
        with tempfile.TemporaryDirectory() as directory, self.assertRaisesRegex(ValueError, "absent"):
            extract_sdf_font(FONTS, {"\U0010ffff"}, Path(directory), {})


if __name__ == "__main__":
    unittest.main()
