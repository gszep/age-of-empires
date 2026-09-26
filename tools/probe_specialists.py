"""Read-only specialist evidence probe; no owned output is committed."""
from dataclasses import asdict
import json
from datq import load_dat
from depot import depot_root

dat = load_dat()
root = depot_root() / 'depot_813781/resources'
for civ in (1, 2):
    for uid in (440, 1105, 1258, 35, 422, 548):
        unit = dat.civs[civ].units[uid]
        print('UNIT', civ, uid, json.dumps(asdict(unit), default=str, indent=2))
        for gid in [*unit.standing_graphic, unit.dying_graphic, unit.type_50.attack_graphic,
                    unit.dead_fish.walking_graphic, unit.creatable.garrison_graphic]:
            if gid >= 0:
                print('GRAPHIC', gid, json.dumps(asdict(dat.graphics[gid]), default=str))
for name in ('BRITONS', 'FRANKS'):
    tree = json.loads((root / '_common/dat/CivTechTrees' / (name + '.json')).read_text())
    print('TREE', name, [n for n in tree['civ_techs_units'] if n['Node ID'] in (35,440,1105,1258)])
print('EXPLOSION', json.dumps(asdict(dat.graphics[12217]), indent=2))
for civ in (1, 2):
    original, variant = (asdict(dat.civs[civ].units[uid]) for uid in (35, 1258))
    print('RAM VARIANT DIFFERENCES', civ, json.dumps({k: [v, variant[k]] for k, v in original.items() if v != variant[k]}, indent=2))
for line in (root / 'en/strings/key-value/key-value-strings-utf8.txt').read_text().splitlines():
    if any(s in line.lower() for s in ('petard', 'siege tower', 'garrisoned infantry')):
        print('STRING', line)
