#!/usr/bin/env python3
"""#163 diagnostic source blocks + current PNG decode; never publish an import.

Uses the existing SLD command walker to sample literal blocks. This deliberately
does not repack production atlases or modify the decoder/cache fingerprint.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import struct
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from depot import Graphics, GRAPHICS, depot_root, uhd_graphics_dir
from sld_layers import (ColorFrame, MaskFrame, LAYER_MAIN, LAYER_SHADOW,
                        _decode_wanted, _decode_bc1_block, _decode_block)
from PIL import Image


def sample(data: bytes, layer: int, limit: int = 256) -> list[bytes]:
    blocks: list[bytes] = []

    class Enough(Exception):
        pass

    decoder = _decode_bc1_block if layer == LAYER_MAIN else _decode_block

    def capture(raw: bytes, offset: int) -> list[int]:
        blocks.append(raw[offset:offset + 8])
        if len(blocks) == limit:
            raise Enough
        return decoder(raw, offset)

    try:
        _decode_wanted(data, layer, ColorFrame if layer == LAYER_MAIN else MaskFrame,
                       4 if layer == LAYER_MAIN else 1, capture)
    except Enough:
        pass
    return blocks


def fixture(blocks: list[bytes], color: bool) -> dict:
    # A diagnostic grid of literal source blocks, not an animation atlas.
    width = 1024 if len(blocks) > 4096 else 64
    columns = width // 4
    height = ((len(blocks) + columns - 1) // columns) * 4
    image = Image.new('RGBA', (width, height))
    empty = bytes.fromhex('00000000ffffffff') if color else bytes(8)
    padded = blocks + [empty] * (width * height // 16 - len(blocks))
    for index, block in enumerate(padded):
        if color:
            pixels = bytes(_decode_bc1_block(block, 0))
        else:
            # Compare the mask's data channel directly, avoiding premultiplied
            # canvas alpha loss. Production masks use this coverage as alpha.
            pixels = bytes(v for a in _decode_block(block, 0) for v in (a, a, a, 255))
        image.paste(Image.frombytes('RGBA', (4, 4), pixels), ((index % columns) * 4, (index // columns) * 4))
    png = io.BytesIO()
    image.save(png, format='PNG')
    return dict(width=width, height=height, blocks=len(blocks),
                format='bc1-rgba-unorm' if color else 'bc4-r-unorm',
                compressed=base64.b64encode(b''.join(padded)).decode(),
                rgba=base64.b64encode(image.tobytes()).decode(),
                png=base64.b64encode(png.getvalue()).decode())


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--content', type=Path, default=Path('.local/aoe2de/content.json'))
    parser.add_argument('--output', type=Path, default=Path('.local/probes/bc163-fixture.json'))
    parser.add_argument('--synthetic', action='store_true', help='also sweep authored endpoint/index blocks')
    args = parser.parse_args()
    content = json.loads(args.content.read_text())
    root = depot_root()
    sources = Graphics(root / GRAPHICS, uhd_graphics_dir(root))
    cases = []
    for key in ('villager', 'militia', 'galley'):
        entry = content['entities'][key]['animations']['idle']
        path = sources.path(entry['source'])
        data = path.read_bytes()
        for name, layer in (('main', LAYER_MAIN), ('shadow', LAYER_SHADOW)):
            blocks = sample(data, layer)
            if not blocks:
                raise ValueError(f'{path.name}: no {name} blocks')
            cases.append(dict(key=key, layer=name, source=path.name,
                              sha256=hashlib.sha256(data).hexdigest(),
                              **fixture(blocks, layer == LAYER_MAIN)))
    if args.synthetic:
        bc1 = [struct.pack('<HHI', a, (a * 12345) & 0xffff, 0xe4e4e4e4) for a in range(65536)]
        bc4 = [bytes((a, b)) + sum((i % 8) << (3 * i) for i in range(16)).to_bytes(6, 'little')
               for a in range(256) for b in range(256)]
        for name, blocks, color in [('bc1-endpoints', bc1, True), ('bc4-endpoints', bc4, False)]:
            cases.append(dict(key=name, layer='main' if color else 'shadow', source='authored synthetic blocks',
                              sha256=hashlib.sha256(b''.join(blocks)).hexdigest(), **fixture(blocks, color)))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(dict(version=1, cases=cases), sort_keys=True))
    print(f'{len(cases)} source-block fixtures: {args.output}')


if __name__ == '__main__':
    main()
