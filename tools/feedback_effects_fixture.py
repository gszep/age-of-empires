"""Read-only source probe: small feedback fragment, NOT a published import.

Writes only private .local/ scratch. The browser probe overlays this on an
existing publication; it never changes that publication or the owned depot.
"""
import json
from pathlib import Path

from genieutils.datfile import DatFile
from depot import depot_root
from import_content import feedback_effect_links, particle_effects, sha256
from convert_sld import convert_particles


def main():
    root = Path(__file__).resolve().parent.parent
    out = root / '.local/feedback-source'
    out.mkdir(parents=True, exist_ok=True)
    common = depot_root() / 'depot_813781/resources/_common'
    dat_path = common / 'dat/empires2_x2_p1.dat'
    dat = DatFile.parse(dat_path)
    spec = json.loads((root / 'tools/import-spec.json').read_text())
    units = dat.civs[spec['civIndex']].units
    entities = {key: feedback_effect_links(dat, units[uid])
                for key, uid in [('villager', 83), ('town-center', 109), ('house', 70)]}
    assert entities['villager']['spawnEffect'] == 'spawn'
    assert entities['house']['constructionEffect'] == 'construction_small_ground'
    assert entities['town-center']['researchingEffect']
    assert entities['town-center']['researchCompleteEffect']
    names = {'move', 'idlepointer'} | {name for links in entities.values() for name in links.values()}
    hashes = {'dat': sha256(dat_path)}
    extracted = particle_effects(common / 'particles', names, hashes, out / 'raw-atlases')
    converted = convert_particles(extracted, out)
    result = {'entities': entities, 'particles': converted, 'sha256': hashes}
    fragment = out / 'fragment.json'
    fragment.write_text(json.dumps(result))
    print(fragment)


if __name__ == '__main__':
    main()
