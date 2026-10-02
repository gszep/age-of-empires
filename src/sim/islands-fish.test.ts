import { expect, it } from 'vitest';
import { FALLBACK_RULES, isFishKind, type NodeKind } from './data';
import { createGame } from './game';
import { ARABIA_BIOMES, generateMap, ISLANDS, isOpenWater } from './mapgen';
import type { Point } from './types';

it('recognises every fish rule as fish through shared consumers', () => {
  for (const [kind, rule] of Object.entries(FALLBACK_RULES.nodes)) {
    expect(isFishKind(kind)).toBe(rule.datClass === 5 || rule.datClass === 33);
  }
});

it.each([2, 3, 7, 42, 95, 130])('deals neritic fish on both unpaired resource-islet coasts, seed %i', seed => {
  const state = createGame(seed, FALLBACK_RULES, undefined, 'islands');
  for (const fish of state.entities.filter(e => isFishKind(e.node) && e.node !== 'shore-fish')) {
    let nearLand = false;
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = Math.floor(fish.position.x) + dx, y = Math.floor(fish.position.y) + dy;
      if (x >= 0 && x < state.width && y >= 0 && y < state.height
        && !isOpenWater(state.terrain[y * state.width + x])) nearLand = true;
    }
    expect(nearLand, `deep fish ${fish.id} within four tiles of land`).toBe(true);
  }
  for (const land of [20, 23]) {
    const shore = state.entities.filter(e => e.node === 'shore-fish' && [-1, 0, 1].some(dy =>
      [-1, 0, 1].some(dx => {
        const x = Math.floor(e.position.x) + dx, y = Math.floor(e.position.y) + dy;
        return state.landIds![y * state.width + x] === land;
      })));
    expect(shore.length, `land ${land} shore fish`).toBeGreaterThan(0);
    for (const fish of shore) {
      expect(isOpenWater(state.terrain[Math.floor(fish.position.y) * state.width + Math.floor(fish.position.x)])).toBe(true);
    }
  }
});

it.each(ARABIA_BIOMES.map(b => [b.name, b] as const))('uses the season fish on %s without re-dealing land objects', (_, biome) => {
  const run = (fish = ISLANDS.fish) => {
    const objects: { kind: string; at: Point }[] = [];
    const layers = generateMap({ rng: { seed: 95 }, width: 120, height: 120,
      free: () => true, place: (kind, at) => { objects.push({ kind, at }); },
    }, { ...ISLANDS, biomes: [biome], fish }, [{ x: 30, y: 60 }, { x: 90, y: 60 }],
    p => ({ x: 120 - p.x, y: p.y }));
    return { objects, layers };
  };
  const withFish = run(), without = run({ ...ISLANDS.fish!, deep: [], shore: { spacing: 1000 } });
  expect(withFish.objects.filter(e => !isFishKind(e.kind))).toEqual(without.objects.filter(e => !isFishKind(e.kind)));
  expect(withFish.layers).toEqual(without.layers);
  const kind: NodeKind = biome.name === 'PALAEARCTIC_MIDDLE_EAST_DESERT' ? 'fish-dorado' : 'fish-salmon';
  expect(withFish.objects.filter(e => e.kind === kind)).toHaveLength(Math.round(6 * 120 * 120 / 10000));
  expect(withFish.objects.filter(e => e.kind === 'fish').length).toBeGreaterThan(10);
  expect(withFish.objects.some(e => e.kind === (kind === 'fish-salmon' ? 'fish-dorado' : 'fish-salmon'))).toBe(false);
});
