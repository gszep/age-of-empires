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


def _table(data: bytes, base: int, size: int) -> list[PackedFile]:
    if size < COUNT.size:
        raise ValueError('truncated AKPK table count')
    count, = COUNT.unpack_from(data, base)
    if size != COUNT.size + count * ENTRY.size:
        raise ValueError('AKPK table count/size mismatch')
    files = []
    for index in range(count):
        file_id, block, size, first_block, language = ENTRY.unpack_from(data, base + COUNT.size + index * ENTRY.size)
        if block == 0:
            raise ValueError('AKPK zero block size')
        files.append(PackedFile(file_id, first_block * block, size, language))
    return files


def read_index(handle: BinaryIO) -> dict[str, list[PackedFile]]:
    """Bank and stream entries, keyed 'banks' and 'streams'."""
    handle.seek(0)
    raw = handle.read(HEADER.size)
    if len(raw) != HEADER.size:
        raise ValueError('truncated AKPK header')
    magic, header_size = HEADER.unpack(raw)
    if magic != b"AKPK":
        raise ValueError(f"not a Wwise pack: {magic!r}")
    data = magic + header_size.to_bytes(4, "little") + handle.read(header_size)
    if len(data) != header_size + 8 or header_size < SIZES.size:
        raise ValueError('truncated AKPK index')
    version, language_size, bank_size, stream_size, external_size = SIZES.unpack_from(data, HEADER.size)
    if version != 1:
        raise ValueError(f'unsupported AKPK version {version}')
    if header_size != SIZES.size + language_size + bank_size + stream_size + external_size:
        raise ValueError('AKPK section sizes do not fill header')
    languages = HEADER.size + SIZES.size
    if language_size < 4:
        raise ValueError('truncated AKPK language map')
    count, = COUNT.unpack_from(data, languages)
    if 4 + count * 8 > language_size:
        raise ValueError('truncated AKPK language entries')
    # Each language row is (relative string offset, language id), followed by
    # UTF-16LE NUL-terminated strings. Common packs name sfx; English names en.
    for i in range(count):
        offset, _ = Struct('<II').unpack_from(data, languages + 4 + i * 8)
        if offset < 4 + count * 8 or offset % 2 or offset >= language_size:
            raise ValueError('invalid AKPK language string offset')
        end = offset
        while end + 2 <= language_size and data[languages + end:languages + end + 2] != b'\0\0':
            end += 2
        if end + 2 > language_size:
            raise ValueError('unterminated AKPK language string')
        data[languages + offset:languages + end].decode('utf-16le')
    banks = languages + language_size
    streams = banks + bank_size
    externals = streams + stream_size
    if external_size != 4 or COUNT.unpack_from(data, externals)[0] != 0:
        raise ValueError('unsupported nonempty AKPK external-source table')
    result = {"banks": _table(data, banks, bank_size), "streams": _table(data, streams, stream_size)}
    handle.seek(0, 2)
    length = handle.tell()
    for table in result.values():
        if len({entry.id for entry in table}) != len(table):
            raise ValueError('duplicate AKPK file ID within table')
        for entry in table:
            if entry.offset < len(data) or entry.offset + entry.size > length:
                raise ValueError(f'AKPK payload outside file: {entry.id}')
    return result


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
