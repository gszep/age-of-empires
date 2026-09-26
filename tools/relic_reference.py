"""Extract the tiny, two-player, standard-mode relic contract from owned RMS.

This is a deliberately narrow extractor, not an RMS interpreter. Branch anchors
fail closed when the source changes. Its JSON is numeric reference data consumed
by both open and owned modes; no script text or converted assets are published.
Run `uv run --locked python tools/relic_reference.py` to inspect the extraction.
The owned import suite compares it with src/sim/refdata/relic-placement.json.
"""
import json
import re
from pathlib import Path

from depot import depot_root


def between(text: str, start: str, end: str) -> str:
    return text.split(start, 1)[1].split(end, 1)[0]


def number(text: str, key: str) -> int:
    match = re.search(rf"\b{re.escape(key)}\s+(\d+)\b", text)
    if not match:
        raise ValueError(f"missing numeric RMS field {key}")
    return int(match[1])


def extract(root: Path | None = None) -> dict:
    root = (root or depot_root()) / 'depot_813784/resources/_common/drs/gamedata_x2'
    read = lambda name: (root / name).read_text(encoding='utf-8-sig')
    relics = read('includes/relics.inc')
    defaults = relics.split('if RELIC_TYPE_UNRESTRICTED', 1)[0]
    balanced = between(relics, 'elseif RELIC_TYPE_BALANCED', 'elseif RELIC_TYPE_PLAYER')
    central = between(balanced, 'create_object RELIC /* Central Relic */', 'create_object PLACEHOLDER_GENERIC')
    player = balanced.split('create_object RELIC /* Player Relic */', 1)[1]
    forest = read('Black_Forest.rms')
    forest_relic = forest.split('#define RELIC_TYPE_PLAYER', 1)[1]
    arabia = read('Arabia.rms')
    if '#define RELIC_TYPE_BALANCED' not in arabia:
        raise ValueError('Arabia no longer selects balanced relics')
    start = between(arabia, 'circle_radius rnd(', ')')
    radii = [int(n) for n in start.split(',')]
    islands = read('Islands.rms')
    tiny = between(islands, '/* BONUS RESOURCES */', '/* ======================= MEDIUM */')
    if 'GNR_RELICMODERN_PER2PL' not in islands:
        raise ValueError('Islands no longer selects two relics/player')
    objects = read('GeneratingObjects.inc')
    island_relic = between(objects, 'elseif GNR_RELICMODERN_PER2PL', '\n\telse')
    shared = objects.split(island_relic, 1)[1]
    neutral = between(read('includes/object_setup.inc'), '/* Neutral Zone, Small */', '/* Neutral Zone */')
    fraction = float(re.search(r'MAPSIZE_SIDE\s*\*\s*([\d.]+)', neutral)[1])
    if 'set_circular_placement' not in neutral or 'require_path' not in player:
        raise ValueError('placement flags changed')
    common = dict(count=number(defaults, 'RELIC_COUNT'), minStart=number(defaults, 'RELIC_DISTANCE'),
                  spacing=number(defaults, 'RELIC_SPACING'), forest=number(defaults, 'RELIC_FOREST_DISTANCE'),
                  cliff=number(defaults, 'RELIC_CLIFF_DISTANCE'), zoneDistance=number(defaults, 'RELIC_ZONE_DISTANCE'))
    player_rules = dict(common, edgeScaled=int(re.search(r'min_distance_to_map_edge\s*\((\d+)\s*\*', player)[1]),
                        circular='set_circular_placement' in player, requirePath='require_path' in player, closest='find_closest' in player)
    player_rules['count'] = number(between(player, 'if MAPSIZE_TINY', 'elseif MAPSIZE_SMALL'), 'number_of_objects')
    bf_rules = dict(common, minStart=number(forest_relic, 'RELIC_DISTANCE'), spacing=number(forest_relic, 'RELIC_SPACING'),
                    edge=number(forest_relic, 'RELIC_EDGE_DISTANCE'), circular=True, closest=True,
                    excludeNeutral=number(forest_relic, 'RELIC_CAA_A') == number(neutral, 'actor_area'))
    bf_land = between(forest, 'create_player_lands', '<ELEVATION_GENERATION>')
    islets = []
    for land_id, resource in [(20, 'GOLD'), (23, 'STONE')]:
        land = next(block for block in re.findall(r'create_land\s*\{([^}]+)\}', islands)
                    if re.search(rf'land_id\s+{land_id}\b', block))
        resource_block = next(block for block in re.findall(rf'create_object {resource}\s*\{{([^}}]+)\}}', tiny)
                              if re.search(rf'place_on_specific_land_id\s+{land_id}\b', block)
                              and (resource != 'STONE' or 'set_tight_grouping' in block))
        islets.append(dict(landId=land_id, zone=number(land, 'zone'), percent=number(land, 'land_percent'),
                           border=number(land, 'left_border'), fuzziness=number(land, 'border_fuzziness'),
                           clearance=number(land, 'other_zone_avoidance_distance'), resource=resource.lower(),
                           groups=number(resource_block, 'number_of_groups') if 'number_of_groups' in resource_block else 1,
                           count=number(resource_block, 'number_of_objects'), spread=number(resource_block, 'group_placement_radius')))
    extra = between(tiny, 'create_object RELIC', '}')
    return {
        'neutral': dict(landId=number(neutral, 'place_on_specific_land_id'), radiusFraction=fraction,
                        actorRadius=number(neutral, 'actor_area_radius')),
        'arabia': {
            'startRadius': dict(min=radii[0], max=radii[1], variance=int(re.search(r'circle_radius rnd\([^)]*\)\s+(\d+)', arabia)[1])),
            'central': dict(count=number(between(central, 'elseif MAPSIZE_TINY', 'elseif MAPSIZE_SMALL'), 'number_of_objects'),
                            minStart=number(balanced, 'RELIC_CENTRAL_DISTANCE'), spacing=number(balanced, 'RELIC_CENTRAL_SPACING'),
                            forest=number(balanced, 'RELIC_CENTRAL_FOREST_DISTANCE'), cliff=number(balanced, 'RELIC_CENTRAL_CLIFF_DISTANCE'),
                            edge=number(balanced, 'RELIC_CENTRAL_EDGE_DISTANCE'), zoneDistance=number(balanced, 'RELIC_CENTRAL_ZONE_DISTANCE'),
                            actorRadius=number(balanced, 'RELIC_CENTRAL_ACTOR_AREA_RADIUS'), spacerRadius=number(defaults, 'RELIC_CENTER_AVOIDANCE')),
            'player': player_rules,
        },
        'black-forest': {'player': bf_rules, 'land': dict(percent=number(bf_land, 'land_percent'), baseSize=number(bf_land, 'base_size'),
                                                         clumping=number(bf_land, 'clumping_factor'), clearance=number(bf_land, 'other_zone_avoidance_distance'))},
        'islands': {
            'player': dict(count=number(island_relic, 'number_of_objects'), minStart=number(island_relic, 'min_distance_to_players'),
                           maxStart=number(island_relic, 'max_distance_to_players'), spacing=number(island_relic, 'temp_min_distance_group_placement'),
                           forest=number(shared, 'avoid_forest_zone'), cliff=number(shared, 'avoid_cliff_zone'), circular=False, closest=False),
            'extra': dict(count=number(extra, 'number_of_objects'), landId=number(extra, 'place_on_specific_land_id')),
            'islets': islets,
        },
    }


if __name__ == '__main__':
    print(json.dumps(extract(), indent=2))
