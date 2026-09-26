"""Compressed, original fixture plus the actual owned prose boundary (#60)."""

from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from pypdf import PdfWriter
from pypdf.generic import DictionaryObject, NameObject, DecodedStreamObject

from depot import depot_root
from pdf_text import extract


class PdfTextTests(unittest.TestCase):
    def test_compressed_text_and_blank_page_keep_physical_page_numbers(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / "fixture.pdf"
            writer = PdfWriter()
            page = writer.add_blank_page(200, 200)
            font = DictionaryObject({NameObject("/Type"): NameObject("/Font"),
                                     NameObject("/Subtype"): NameObject("/Type1"),
                                     NameObject("/BaseFont"): NameObject("/Helvetica")})
            page[NameObject("/Resources")] = DictionaryObject({
                NameObject("/Font"): DictionaryObject({NameObject("/F1"): font})})
            stream = DecodedStreamObject()
            stream.set_data(b"BT /F1 12 Tf 10 100 Td (Original audit fixture) Tj ET")
            page[NameObject("/Contents")] = stream.flate_encode()
            writer.add_blank_page(200, 200)
            writer.write(path)
            result = extract(path)
            self.assertEqual(result, extract(path))
            self.assertEqual(len(result["sha256"]), 64)
            self.assertEqual(result["pages"], [
                {"page": 1, "text": "Original audit fixture"}, {"page": 2, "text": ""}])

    def test_owned_manual_market_and_conversion_prose_is_readable(self):
        path = depot_root() / "depot_813781/Docs/en/AoK Manual.pdf"
        if not path.exists():
            self.skipTest("owned English manual unavailable")
        pages = extract(path)["pages"]
        # Printed pages 33, 46–47 and 13 are physical PDF pages 36, 49–50 and 16.
        # These are evidence anchors, not assertions of modern DE engine parity.
        text = lambda number: " ".join(pages[number - 1]["text"].split())
        self.assertIn("retain the attributes they had at the time they were converted", text(36))
        self.assertIn("all players in the game are buying and selling", text(49))
        self.assertIn("updated following each transaction", text(50))
        self.assertIn("location is revealed temporarily", text(16))
