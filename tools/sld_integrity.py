#!/usr/bin/env python3
"""Read-only SLD container validation, before atlas cache reuse or publication.

This does not decode pixels or relax mask invariants. A present layer's length
includes its own four-byte length field; every frame/layer must stay in bounds
and the declared frame walk must end exactly at EOF (including alignment).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import mmap
from pathlib import Path

from sld_layers import FILE_HEADER, FRAME_HEADER, LAYER_LENGTH


def validate_container(data: bytes | mmap.mmap) -> int:
    size = len(data)
    if size < FILE_HEADER.size:
        raise ValueError('truncated SLD file header')
    signature, _version, count, _unknown, first, _last = FILE_HEADER.unpack_from(data)
    if signature != b'SLDX' or first < 14 or first > size:
        raise ValueError('invalid SLD signature/frame start')
    # The base stable starts at14, overlapping the unused final header word.
    cursor = first
    for frame in range(count):
        if cursor + FRAME_HEADER.size > size:
            raise ValueError(f'frame {frame}: truncated header at byte {cursor}')
        flags = FRAME_HEADER.unpack_from(data, cursor)[4]
        cursor += FRAME_HEADER.size
        if flags & ~0x1f:
            raise ValueError(f'frame {frame}: unsupported layer flags {flags:#x}')
        for layer in (1, 2, 4, 8, 16):
            if not flags & layer:
                continue
            if cursor + LAYER_LENGTH.size > size:
                raise ValueError(f'frame {frame}, layer {layer}: truncated length at byte {cursor}')
            length = LAYER_LENGTH.unpack_from(data, cursor)[0]
            if length < LAYER_LENGTH.size or cursor + length > size:
                raise ValueError(f'frame {frame}, layer {layer}: invalid length {length} at byte {cursor} of {size}')
            cursor += length
            cursor += (4 - (cursor - first)) % 4
            if cursor > size:
                raise ValueError(f'frame {frame}, layer {layer}: truncated alignment padding')
    if cursor != size:
        raise ValueError(f'SLD frame walk ended at byte {cursor}, not EOF {size}')
    return count


def validate_sld(path: Path) -> int:
    try:
        with path.open('rb') as handle:
            if path.stat().st_size == 0:
                raise ValueError('empty file')
            with mmap.mmap(handle.fileno(), 0, access=mmap.ACCESS_READ) as data:
                return validate_container(data)
    except ValueError as error:
        raise ValueError(f'Incomplete or unsupported SLD source {path}: {error}. Revalidate the owned depot; no atlas was published.') from error


def source_names(value) -> set[str]:
    if isinstance(value, dict):
        names = {value['source']} if isinstance(value.get('source'), str) and value['source'].endswith('.sld') else set()
        return names.union(*(source_names(child) for child in value.values()))
    if isinstance(value, list):
        return set().union(*(source_names(child) for child in value))
    return set()


def main() -> None:
    from depot import Graphics, depot_root, uhd_graphics_dir
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('files', type=Path, nargs='*')
    parser.add_argument('--content', type=Path, default=Path('.local/aoe2de/content.json'))
    parser.add_argument('--base', action='store_true', help='audit x1 counterparts of the consumed content')
    args = parser.parse_args()
    if args.files:
        paths = args.files
    else:
        root = depot_root()
        graphics = Graphics(root / 'depot_813784/resources/_common/drs/graphics',
                            None if args.base else uhd_graphics_dir(root))
        names = source_names(json.loads(args.content.read_text()))
        paths = [graphics.path(name.replace('_x2.sld', '_x1.sld') if args.base else name) for name in sorted(names)]
    errors = []
    for path in paths:
        try:
            validate_sld(path)
        except (ValueError, OSError) as error:
            data = path.read_bytes() if path.is_file() else None
            errors.append({'file': str(path), 'error': str(error),
                           'sha256': hashlib.sha256(data).hexdigest() if data is not None else None,
                           'bytes': len(data) if data is not None else None,
                           'zeroTailStart': len(data.rstrip(b'\0')) if data is not None else None})
    print(json.dumps({'checked': len(paths), 'valid': len(paths) - len(errors), 'errors': errors}, indent=2))
    raise SystemExit(1 if errors else 0)


if __name__ == '__main__':
    main()
