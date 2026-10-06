"""Owned source contract for #118; no manifest publication/full import required."""
import json
from pathlib import Path
import re
import tempfile
import unittest

from convert_sld import convert_terrain
from depot import depot_root
from test_import_aoe2 import DAT, TERRAIN, _dat, extracted_content

REPO = Path(__file__).parents[1]
RMS = depot_root() / 'depot_813784/resources/_common/drs/gamedata_x2/Arabia.rms'
FIELDS = {
    'base': 'BASE_TERRAIN', 'blendA': 'BASE_BLEND_A', 'blendB': 'BASE_BLEND_B',
    'blendC': 'BASE_BLEND_C', 'blendD': 'BASE_BLEND_D', 'forest': 'BASE_FOREST',
    'forestEdge': 'BASE_FOREST_EDGE', 'forestVariationA': 'BASE_FOREST_VARIATION_A',
    'forestVariationB': 'BASE_FOREST_VARIATION_B', 'forestBlend': 'BASE_FOREST_BLEND',
    'stragglerForest': 'STRAGGLER_FOREST', 'stragglerForestVariation': 'STRAGGLER_FOREST_VARIATION',
}


def runtime_biomes():
    # Deliberately fail on an unrecognized representation instead of silently
    # comparing a subset. This bounded table is numeric data, not an RMS parser.
    source = (REPO / 'src/sim/mapgen.ts').read_text().split('export const ARABIA_BIOMES:')[1].split('\n];')[0]
    result = {}
    for block in re.findall(r'^  \{\n(.*?)\n  \}', source, re.M | re.S):
        name = re.search(r"name: '([^']+)'", block)[1]
        alternate = re.search(r'alternate: \{([^}]+)\}', block)
        aesthetics = re.search(r'aesthetics: \{([^}]+)\}', block)[1]
        plain = re.sub(r'(?:alternate|aesthetics): \{[^}]+\}', '', block)
        numbers = {k: int(v) for k, v in re.findall(r'(\w+): (\d+)', plain)}
        result[name] = (numbers, {k: int(v) for k, v in re.findall(r'(\w+): (\d+)', alternate[1])} if alternate else {},
                        dict(re.findall(r"(\w+): '([^']+)'", aesthetics)))
    return result


@unittest.skipUnless(RMS.exists() and DAT.exists() and TERRAIN.exists(), 'owned Arabia RMS/DAT/textures unavailable')
class ArabiaBiomeTest(unittest.TestCase):
    def test_all_biome_constants_weights_variants_and_aesthetics_match_rms(self):
        text = re.sub(r'/\*.*?\*/', '', RMS.read_text(), flags=re.S)
        selection = text.split('if THEME_SELECTION')[1].split('end_random')[0]
        chances = {name: int(chance) for chance, name in re.findall(r'percent_chance (\d+) #define (\w+)', selection)}
        constants = text.split('if MAP_CONSTANTS')[1].split('#include_drs')[0]
        blocks = dict(re.findall(r'^\t(?:if|elseif) (\w+)\n(.*?)(?=^\t(?:elseif|endif))', constants, re.M | re.S))
        runtime = runtime_biomes()
        self.assertEqual(len(runtime), 11)
        self.assertEqual(set(runtime), set(chances))
        self.assertEqual(set(runtime), set(blocks))
        self.assertEqual(sum(chances.values()), 100)
        spec = json.loads((REPO / 'tools/import-spec.json').read_text())
        entities = {e['key']: e['unitId'] for e in spec['entities']}
        for name, (numbers, alternate, aesthetics) in runtime.items():
            with self.subTest(biome=name):
                self.assertEqual(set(numbers), {*FIELDS, 'percentChance'})
                self.assertEqual(numbers['percentChance'], chances[name])
                block = blocks[name]
                for key, constant in FIELDS.items():
                    values = [int(v) for v in re.findall(rf'#const {constant} (\d+)\b', block)]
                    self.assertEqual(numbers[key], values[0])
                    self.assertEqual(alternate.get(key), values[1] if len(values) == 2 else None)
                if alternate:
                    self.assertEqual(re.findall(r'percent_chance (\d+)', block), ['50', '50'])
                for key in ('flat', 'grouped', 'scatter'):
                    value = int(re.search(rf'#const AESTHETIC_{key.upper()} (\d+)', block)[1])
                    self.assertEqual(entities[aesthetics[key]], value)

    def test_every_dealt_terrain_has_dat_metadata_texture_and_published_mapping(self):
        content = extracted_content()
        terrain = content['terrain']
        by_id = {slot['terrainId']: (key, slot) for key, slot in terrain.items()}
        ids = {1, 2}
        for numbers, alternate, aesthetics in runtime_biomes().values():
            ids.update(numbers[k] for k in FIELDS)
            ids.update(alternate.values())
            for key in aesthetics.values():
                entity = content['entities'][key]
                self.assertEqual(entity['category'], 'decoration')
                self.assertTrue(entity['animations']['idle']['source'])
        self.assertTrue(ids <= by_id.keys(), f'missing terrain ids: {ids - by_id.keys()}')
        for i in ids:
            slot = by_id[i][1]
            source = _dat().terrain_block.terrains[i]
            self.assertEqual(slot['texture'], source.name_2)
            self.assertTrue((TERRAIN / f"{slot['texture']}.dds").is_file())
            for row, allowed in content['terrainRestrictions'].items():
                self.assertEqual(i in allowed, _dat().terrain_restrictions[int(row)].passable_buildable_dmg_multiplier[i] != 0)
        # Publish into an isolated test directory, never public/imported or a
        # live manifest. Cover new terrain slots, including shared DDS aliases.
        new_ids = {17, 18, 20, 21, 41, 46, 56, 60, 76, 77, 83, 102, 105, 106, 113, 122, 128}
        with tempfile.TemporaryDirectory() as tmp:
            published = convert_terrain(dict(by_id[i] for i in new_ids), TERRAIN, Path(tmp), {})
            self.assertEqual({s['terrainId'] for s in published.values()}, new_ids)
            for key, slot in published.items():
                self.assertTrue((Path(tmp) / slot['image']).is_file())
                self.assertEqual(slot['texture'], terrain[key]['texture'])


if __name__ == '__main__':
    unittest.main()
