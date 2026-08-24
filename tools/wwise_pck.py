#!/usr/bin/env python3
"""Read Wwise "AKPK" archives to locate the packed audio streams inside.

AoE2DE ships its audio as Wwise packs rather than loose files. The archive
format is a header, four sized tables (languages, banks, streams, externals),
then the packed payloads; each table entry addresses its payload by block index
times block size.

This reads the container only. Decoding a WEM payload to something a browser
can play is a separate step; see tools/import_audio.py.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from struct import Struct
from typing import BinaryIO

HEADER = Struct("< 4s I")
SIZES = Struct("< 5I")  # version, language map, banks, streams, externals
COUNT = Struct("< I")
ENTRY = Struct("< 5I")  # id, block size, payload size, first block, language


@dataclass(frozen=True)
class PackedFile:
    id: int
    offset: int
    size: int
    language: int


def _table(data: bytes, base: int) -> list[PackedFile]:
    count, = COUNT.unpack_from(data, base)
    files = []
    for index in range(count):
        file_id, block, size, first_block, language = ENTRY.unpack_from(data, base + COUNT.size + index * ENTRY.size)
        files.append(PackedFile(file_id, first_block * block, size, language))
    return files


def read_index(handle: BinaryIO) -> dict[str, list[PackedFile]]:
    """Bank and stream entries, keyed 'banks' and 'streams'."""
    handle.seek(0)
    magic, header_size = HEADER.unpack(handle.read(HEADER.size))
    if magic != b"AKPK":
        raise ValueError(f"not a Wwise pack: {magic!r}")
    data = magic + header_size.to_bytes(4, "little") + handle.read(header_size)
    _version, language_size, bank_size, _stream_size, _external_size = SIZES.unpack_from(data, HEADER.size)
    languages = HEADER.size + SIZES.size
    banks = languages + language_size
    streams = banks + bank_size
    return {"banks": _table(data, banks), "streams": _table(data, streams)}


def extract(handle: BinaryIO, entry: PackedFile) -> bytes:
    handle.seek(entry.offset)
    return handle.read(entry.size)


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("pack", type=Path)
    parser.add_argument("--out", type=Path)
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    with args.pack.open("rb") as handle:
        index = read_index(handle)
        print(f"banks={len(index['banks'])} streams={len(index['streams'])}")
        if not args.out:
            for entry in index["streams"][:10]:
                print(f"  stream {entry.id} size={entry.size} offset={entry.offset}")
            return
        args.out.mkdir(parents=True, exist_ok=True)
        entries = index["streams"] + index["banks"]
        if args.limit:
            entries = entries[:args.limit]
        for entry in entries:
            payload = extract(handle, entry)
            suffix = "wem" if payload[:4] == b"RIFF" else "bnk"
            (args.out / f"{entry.id}.{suffix}").write_bytes(payload)
        print(f"wrote {len(entries)} files to {args.out}")


if __name__ == "__main__":
    main()
