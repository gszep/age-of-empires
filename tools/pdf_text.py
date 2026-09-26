#!/usr/bin/env python3
"""Extract owned PDF prose with physical page numbers; redirect only to ignored storage."""

from __future__ import annotations

import argparse
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path

from pypdf import PdfReader


def extract(path: Path) -> dict:
    data = path.read_bytes()
    reader = PdfReader(BytesIO(data))
    return {
        "source": str(path),
        "sha256": sha256(data).hexdigest(),
        "pages": [
            {"page": index, "text": page.extract_text() or ""}
            for index, page in enumerate(reader.pages, 1)
        ],
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf", type=Path)
    args = parser.parse_args()
    print(json.dumps(extract(args.pdf), ensure_ascii=False, indent=2))
