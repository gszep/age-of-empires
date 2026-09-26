"""Private Briton smoke fixture: existing assets are served in place, never copied.

RELIC_BASE_MANIFEST points at a fully imported manifest. Decode only the three
newly needed sheets into .local, not public/. This is not the import pipeline.
"""
import json
import os
from pathlib import Path

from test_import_aoe2 import extracted_content, SOURCES
from convert_sld import convert, convert_mask, published


def main():
    root = Path(__file__).resolve().parent.parent
    out = root / '.local/monastery-fixture'
    out.mkdir(parents=True, exist_ok=True)
    content = extracted_content()
    manifest = json.loads(Path(os.environ['RELIC_BASE_MANIFEST']).read_text())
    for key in ['technologies', 'playerAttributes', 'civilizationBonuses']:
        manifest[key] = content[key]
    for key in ['relic', 'monk-relic']:
        entity = {**content['entities'][key], 'atlases': {}}
        for name, animation in entity['animations'].items():
            if name == 'death':
                continue
            source = SOURCES.path(animation['source'])
            frames = animation['frames'] * animation['directions']
            for layer in [None, 'shadow', 'playercolor']:
                suffix = f'-{layer}' if layer else ''
                image = f'{key}/{name}{suffix}.png'
                atlas = (convert_mask(source, out / image, frames, layer) if layer
                         else convert(source, out / image, frames))
                entity['atlases'][name + suffix] = published(atlas, f'monastery-fixture/{image}', animation.get('scale', 1))
        manifest['entities'][key] = entity
    (out / 'manifest.json').write_text(json.dumps(manifest))
    print(out)


if __name__ == '__main__':
    main()
