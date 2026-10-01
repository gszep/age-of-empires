"""#256: prove regenerated PNG atlas crops use the corrected source decoder.

Run only after the full import finishes. Checks main RGB, white/alpha shadow,
derived player shading, source-sized boxes and hotspots, including late frames.
"""
from collections import defaultdict
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from depot import depot_root, Graphics, GRAPHICS, uhd_graphics_dir
from atlas_metadata import expand_atlas_frames
from sld_layers import decode_colors, decode_masks, LAYER_SHADOW, LAYER_PLAYERCOLOR, luminance
from PIL import Image


def audit() -> dict:
    root = depot_root()
    sources = Graphics(root / GRAPHICS, uhd_graphics_dir(root))
    content = json.loads(Path('.local/aoe2de/content.json').read_text())
    base = Path('public/imported/aoe2')
    manifest = expand_atlas_frames(json.loads((base / 'manifest.json').read_text()))
    checked = []
    for key in ('villager', 'militia', 'galley'):
        source = sources.path(content['entities'][key]['animations']['idle']['source'])
        data = source.read_bytes()
        colors = decode_colors(data)
        for suffix in ('', '-shadow', '-playercolor'):
            atlas = manifest['entities'][key]['atlases'].get('idle' + suffix)
            frames = colors if not suffix else decode_masks(data, LAYER_SHADOW if suffix == '-shadow' else LAYER_PLAYERCOLOR)
            if atlas is None:
                animation = content['entities'][key]['animations']['idle']
                limit = animation['frames'] * animation['directions']
                assert suffix and not any(f is not None and not f.empty for f in frames[:limit]), (key,suffix,'missing populated layer')
                continue
            count = len(atlas['frames'])
            groups = defaultdict(list)
            for index in sorted({0, count // 2, count - 1}):
                box, frame = atlas['frames'][index], frames[index]
                if not box['w']:
                    assert frame is None or frame.empty
                    continue
                assert (box['w'], box['h'], box['cx'], box['cy']) == (frame.width,frame.height,frame.hotspot_x,frame.hotspot_y)
                page = atlas.get('pages', [atlas])[box.get('page', 0)]
                groups[page['image']].append((index, box, frame))
            assert groups, (key, suffix, 'no samples')
            for page, samples in groups.items():
                with Image.open(base / page) as image:
                    for index, box, frame in samples:
                        if not suffix:
                            expected = bytes(frame.rgba)
                        elif suffix == '-shadow':
                            expected = bytes(v for alpha in frame.alpha for v in (255,255,255,alpha))
                        else:
                            color = colors[index]
                            expected = bytearray()
                            for i, alpha in enumerate(frame.alpha):
                                value = luminance(*color.rgba[i*4:i*4+3])
                                expected.extend((value,value,value,alpha))
                        crop = image.crop((box['x'],box['y'],box['x']+box['w'],box['y']+box['h'])).convert('RGBA')
                        assert crop.tobytes() == expected, (key,suffix,index,page,'stale or incorrect decoded pixels')
                        checked.append(dict(key=key, layer=suffix or 'main', frame=index, page=page, pixels=box['w']*box['h']))
    return dict(checked=checked, totalPixels=sum(row['pixels'] for row in checked))


if __name__ == '__main__':
    print(json.dumps(audit(), indent=2))
