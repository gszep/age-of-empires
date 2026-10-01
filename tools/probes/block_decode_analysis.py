"""Compare hardware readbacks with independent Pillow and rational BC decoding.

Run after the --synthetic fixture and BC_PROBE_MODE=decode BC_PROBE_READBACK=1
desktop probe. Outputs only diagnostics, never production art.
"""
import base64
from array import array
from collections import Counter
import json
from pathlib import Path
import struct
from PIL import Image


def contract(block: bytes, color: bool):
    """D3D11 sections19.5.2/3/6/9: reference values, per-channel allowed error.

    BC1 reference interpolation truncates promoted8-bit endpoints; other
    implementations may promote/round within the bound. BC4's reference uses
    normalized rational interpolation. Float readback avoids8-bit target error.
    """
    if color:
        a, b = struct.unpack_from('<HH', block)
        raw = [((v >> 11) / 31, ((v >> 5) & 63) / 63, (v & 31) / 31) for v in (a,b)]
        endpoints = lookup(block, True)[:2]
        promoted = [[v/255 for v in row[:3]] for row in endpoints]
        x, y = endpoints
        if a > b:
            values = [x,y,tuple((2*i+j)//3 for i,j in zip(x,y)),tuple((i+2*j)//3 for i,j in zip(x,y))]
        else:
            values = [x,y,tuple((i+j)//2 for i,j in zip(x,y)),(0,0,0,0)]
        tolerance = [1/255 + .03 * max(abs(raw[0][c]-raw[1][c]),abs(promoted[0][c]-promoted[1][c])) for c in range(3)] + [0]
        return [tuple(v/255 for v in row) for row in values], tolerance
    a, b = block[:2]
    if a > b:
        values = [a/255,b/255] + [((7-i)*a+i*b)/(7*255) for i in range(1,7)]
    else:
        values = [a/255,b/255] + [((5-i)*a+i*b)/(5*255) for i in range(1,5)] + [0,1]
    return [(v,v,v,1) for v in values], [1/65535 + .03*abs(a-b)/255]*3 + [0]


def lookup(block: bytes, color: bool) -> list[tuple[int, ...]]:
    if color:
        a, b = struct.unpack_from('<HH', block)
        def rgb(v):
            r, g, b = v >> 11, (v >> 5) & 63, v & 31
            return ((r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2), 255)
        x, y = rgb(a), rgb(b)
        if a > b:
            return [x, y, tuple((2*i+j+1)//3 for i,j in zip(x,y)), tuple((i+2*j+1)//3 for i,j in zip(x,y))]
        return [x, y, tuple((i+j+1)//2 for i,j in zip(x,y)), (0,0,0,0)]
    a, b = block[:2]
    if a > b:
        values = [a,b] + [((7-i)*a+i*b+3)//7 for i in range(1,7)]
    else:
        values = [a,b] + [((5-i)*a+i*b+2)//5 for i in range(1,5)] + [0,255]
    return [(v,v,v,255) for v in values]


def analyze(fixture: dict, row: dict) -> dict:
    width, height = fixture['width'], fixture['height']
    blocks = base64.b64decode(fixture['compressed'])
    gpu = base64.b64decode(row['readback'])
    floating = array('f', base64.b64decode(row['floatReadback']))
    color = fixture['format'].startswith('bc1')
    pillow = Image.frombytes('RGBA' if color else 'L', (width,height), blocks,
                             'bcn', (1 if color else 4, 'DXT1' if color else 'BC4')).convert('RGBA').tobytes()
    rational, independent = Counter(), Counter()
    worst = []
    violations = endpoints_checked = endpoint_violations = 0
    for block_index in range(len(blocks)//8):
        block = blocks[block_index*8:block_index*8+8]
        table = lookup(block, color)
        reference, tolerance = contract(block, color)
        indices = int.from_bytes(block[4:] if color else block[2:], 'little')
        for i in range(16):
            x, y = (block_index % (width//4))*4+i%4, (block_index//(width//4))*4+i//4
            at = (y*width+x)*4
            index = (indices >> ((2 if color else 3)*i)) & (3 if color else 7)
            floats = floating[at:at+4]
            for value, ref, bound in zip(floats, reference[index], tolerance):
                if ref in (0,1):
                    violations += value != ref
                else:
                    violations += abs(value-ref) >= bound
            if index < 2:
                endpoints_checked += 1
                # Compare with the correctly rounded f32 UNORM conversion,
                # not a fitted pixel-error threshold.
                endpoint_violations += any(v != struct.unpack('<f', struct.pack('<f', e/255))[0]
                                           for v,e in zip(floats,table[index]))
            expected = table[index]
            actual = tuple(gpu[at:at+4])
            if expected[3] == actual[3] == 0:
                continue
            err = max(abs(a-b) for a,b in zip(expected,actual))
            rational[err] += 1
            independent[max(abs(a-b) for a,b in zip(pillow[at:at+4],actual))] += 1
            if err > 1:
                example = dict(block=block.hex(), index=index, rational=expected, hardware=actual, error=err)
                if example not in worst:
                    worst.append(example)
                    worst.sort(key=lambda v: -v['error'])
                    worst = worst[:4]
    return dict(key=fixture['key'], layer=fixture['layer'], pixels=width*height,
                sourceEndpointsChecked=endpoints_checked, sourceEndpointViolations=endpoint_violations,
                d3dToleranceViolations=violations,
                rationalHistogram=dict(sorted(rational.items())), pillowHistogram=dict(sorted(independent.items())), worst=worst)


if __name__ == '__main__':
    fixtures = json.loads(Path('.local/probes/bc163-fixture.json').read_text())['cases']
    result = json.loads(Path('.local/probes/bc163-decode.json').read_text())
    rows = [analyze(f, next(r for r in result['comparisons'] if r['key'] == f['key'] and r['layer'] == f['layer']
                           and r['colourSpace'] == 'unorm data bytes')) for f in fixtures]
    print(json.dumps(rows, indent=2))
    if any(row['d3dToleranceViolations'] or row['sourceEndpointViolations'] for row in rows):
        raise SystemExit(1)
