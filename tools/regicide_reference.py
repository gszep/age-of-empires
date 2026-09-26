"""Narrow standard Regicide RMS/localization extraction; no engine timing claims."""
import json
import re
from pathlib import Path
from depot import depot_root
from relic_reference import between, number


def extract(root: Path | None = None) -> dict:
    root = root or depot_root()
    scripts = root / 'depot_813784/resources/_common/drs/gamedata_x2'
    modern = (scripts / 'includes/regicide.inc').read_text()
    defaults = between(modern, 'else', '#const REGICIDE_ZONE_DISTANCE')
    king = between(modern, 'second_object KING', 'if REGICIDE_SAFE')
    villagers = (scripts / 'includes/villagers.inc').read_text()
    count = int(re.search(r'^\s*if REGICIDE\s+number_of_objects (\d+)', villagers, re.M)[1])
    distance = number(villagers.split('if NOMAD_SCATTERED', 1)[0].rsplit('else', 1)[1], 'VILLAGER_DISTANCE')
    villager_rules = villagers[list(re.finditer(r'min_distance_group_placement\s+0', villagers))[-1].end():]
    classic = (scripts / 'GeneratingObjects.inc').read_text().split('/* Regicide buildings', 1)[1].split('/* Empire Wars Lumbercamps', 1)[0]
    island_king = between(classic, 'create_object KING', '}')
    island_villager = between(classic, 'create_object VILLAGER', '}')
    island_castle = classic.split('elseif GNR_REGICIDECLASSIC', 1)[1].split('else', 1)[1]
    if '#define GNR_REGICIDECLASSIC' not in (scripts / 'Islands.rms').read_text():
        raise ValueError('Islands Regicide branch changed')
    if '(REGICIDE_DISTANCE + 1)' not in modern or 'find_closest_to_map_center' not in modern:
        raise ValueError('modern Regicide placement changed')
    strings = (root / 'depot_813781/resources/en/strings/key-value/key-value-strings-utf8.txt').read_text(encoding='utf-8-sig')
    help_text = re.search(r'^41112\s+"(.*)"', strings, re.M)[1]
    return {
        'modern': {
            'villagers': count, 'villagerDistance': distance,
            'villager': {'forest': number(villager_rules, 'avoid_forest_zone'), 'zone': number(villager_rules, 'max_distance_to_other_zones'),
                         'cliff': number(villager_rules, 'avoid_cliff_zone'),
                         'edge': number(villager_rules, 'min_distance_to_map_edge')},
            'king': {'forest': number(king, 'avoid_forest_zone'), 'zone': number(king, 'max_distance_to_other_zones'),
                     'cliff': number(king, 'avoid_cliff_zone'),
                     'edge': number(king, 'min_distance_to_map_edge')},
            'castle': {'unitId': number(defaults, 'REGICIDE_BUILDING'), 'maximumDistance': number(defaults, 'REGICIDE_DISTANCE') + 1,
                       'forest': number(modern, 'REGICIDE_FOREST_DISTANCE'), 'zone': number(modern, 'REGICIDE_ZONE_DISTANCE'),
                       'cliff': number(modern, 'REGICIDE_CLIFF_DISTANCE'), 'edge': number(modern, 'REGICIDE_EDGE_DISTANCE')},
        },
        'blackForestBackward': '#define REGICIDE_BACKWARD' in (scripts / 'Black_Forest.rms').read_text(),
        'islands': {'extraVillagers': number(island_villager, 'number_of_objects'), 'villagerDistance': number(island_villager, 'min_distance_to_players'),
                    'kingMinimum': number(island_king, 'min_distance_to_players'), 'kingMaximum': number(island_king, 'max_distance_to_players'),
                    'castleDistance': number(island_castle, 'max_distance_to_players')},
        'treasonGold': int(re.search(r'static_cost=Gold,(\d+)', help_text)[1]),
    }


if __name__ == '__main__':
    print(json.dumps(extract(), indent=2))
