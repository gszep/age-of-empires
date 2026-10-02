"""Narrow source contract for the currently represented Islands seasons.

Like relic_reference.py, this is not an RMS interpreter. Owned tests compare
the extraction with the numeric reference consumed by the map generator.
"""
import json
import re
from pathlib import Path

from depot import depot_root
from relic_reference import number


def extract(root: Path | None = None) -> dict:
    root = (root or depot_root()) / 'depot_813784/resources/_common/drs/gamedata_x2'
    islands = (root / 'Islands.rms').read_text()
    if '#define GNR_STANDARDFISH' not in islands:
        raise ValueError('Islands no longer selects standard fish')
    objects = (root / 'GeneratingObjects.inc').read_text()
    standard = objects.split('elseif GNR_STANDARDFISH', 1)[1].split('elseif GNR_SMALLFISHONLY', 1)[0]
    shore = re.search(r'create_object MELKARYBA\s*\{([^}]+)\}', standard)[1]
    normal_shore = shore.split('else', 1)[1].split('endif', 1)[0]
    deep = []
    for symbol in ('FISH_A', 'FISH_B'):
        candidates = [b for b in re.findall(rf'create_object {symbol}\s*\{{([^}}]+)\}}', standard)
                      if 'set_scaling_to_map_size' in b]
        if len(candidates) != 1 or 'set_gaia_object_only' not in candidates[0] or 'set_place_for_every_player' in candidates[0]:
            raise ValueError(f'{symbol} global default branch changed')
        block = candidates[0]
        deep.append(dict(tiles=number(block, 'number_of_objects'), spacing=number(block, 'min_distance_group_placement'),
                         nearLand=number(block, 'max_distance_to_other_zones')))
    seasons = (root / 'F_seasons.inc').read_text()
    pairs = {}
    for season in ('PH_SPRING', 'PH_MEDISOUTH', 'PH_DESERT'):
        block = re.search(rf'elseif {season}\s.*?(?=elseif PH_)', seasons, re.S)[0]
        pairs[season] = [number(block, name) for name in ('FISH_A', 'FISH_B', 'MELKARYBA')]
    return dict(shore=dict(tiles=number(shore, 'number_of_objects'), spacing=number(normal_shore, 'temp_min_distance_group_placement')),
                deep=deep, seasons=pairs)


if __name__ == '__main__':
    print(json.dumps(extract(), indent=2))
