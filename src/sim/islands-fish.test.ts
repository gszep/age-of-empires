import { expect, it } from 'vitest';
import { FALLBACK_RULES, isFishKind, type NodeKind } from './data';
import { createGame, stepGame } from './game';
import { ARABIA_BIOMES, generateMap, ISLANDS, isOpenWater } from './mapgen';
import type { Point } from './types';
import { checksumState } from './checksum';

it('recognises every fish rule as fish through shared consumers', () => {
  for (const [kind, rule] of Object.entries(FALLBACK_RULES.nodes)) {
    expect(isFishKind(kind)).toBe(rule.datClass === 5 || rule.datClass === 33);
  }
});

it.each([2, 3, 7, 42, 95, 130])('preserves legacy near-land fish and both resource-islet shores, seed %i', seed => {
  const state = createGame(seed, FALLBACK_RULES, undefined, 'islands', undefined, undefined, undefined, 1);
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

// Captured with untouched94dc0ff BEFORE the correction. Do not update these
// when changing current generation: record formats1–8 must keep the old map.
it.each([
  [1, '0c379c21', '004b9772'], [2, '7edc5661', 'c0d07245'],
  [3, 'f39b38ae', '7513e5b8'], [7, '97a59aea', 'd0d2dcc4'],
  [29, '0e88e48c', '9f250216'], [42, 'c2e293ad', '9f14a807'],
  [95, '6a2b4511', '1be90969'], [130, 'dc4842d2', 'd83355da'],
] as const)('keeps the pre-offshore Islands state/JSON digest, seed %i', (seed, initial, tick20) => {
  const state = createGame(seed, undefined, undefined, 'islands', undefined, undefined, undefined, 1);
  expect(state).not.toHaveProperty('mapgenVersion');
  expect(checksumState(state)).toBe(initial);
  expect(checksumState(createGame(seed, undefined, undefined, 'islands', undefined, undefined, undefined, 0))).toBe(initial);
  const restored = JSON.parse(JSON.stringify(state));
  for (let i = 0; i < 20; i++) { stepGame(state); stepGame(restored); }
  expect(checksumState(state)).toBe(tick20);
  expect(checksumState(restored)).toBe(tick20);
});

it.each([2, 3, 7, 42, 95, 130])('new Islands seed %i clears land, reaches offshore water and preserves the pre-relic objects', seed => {
  const state = createGame(seed, FALLBACK_RULES, undefined, 'islands');
  const repeat = createGame(seed, FALLBACK_RULES, undefined, 'islands');
  const legacy = createGame(seed, FALLBACK_RULES, undefined, 'islands', undefined, undefined, undefined, 1);
  expect(state.mapgenVersion).toBe(2);
  expect(checksumState(repeat)).toBe(checksumState(state));
  expect(state.terrain).toEqual(legacy.terrain);
  expect(state.elevation).toEqual(legacy.elevation);
  expect(state.landIds).toEqual(legacy.landIds);
  // Relics run later against the nav grid: removing near-shore fish footprints
  // changes their legal candidates/rolls, not just IDs. Their full placement
  // and path contract remains covered over50 seeds by relic-placement.test.ts.
  const nonDeep = (s: typeof state) => s.entities.filter(e => e.kind !== 'relic' && (!isFishKind(e.node) || e.node === 'shore-fish'))
    .map(e => ({ kind: e.kind, node: e.node, owner: e.owner, position: e.position, amount: e.amount }));
  expect(nonDeep(state)).toEqual(nonDeep(legacy));
  const relics = state.entities.filter(e => e.kind === 'relic');
  expect(relics).toHaveLength(5);
  for (const [landId, count] of [[1, 2], [2, 2], [20, 1]]) {
    expect(relics.filter(e => state.landIds![Math.floor(e.position.y) * state.width + Math.floor(e.position.x)] === landId)).toHaveLength(count);
  }
  const fish = state.entities.filter(e => isFishKind(e.node) && e.node !== 'shore-fish');
  const land = state.terrain.flatMap((t, i) => isOpenWater(t) ? [] : [{ x: i % state.width + .5, y: Math.floor(i / state.width) + .5 }]);
  const distances = fish.map(f => Math.min(...land.map(p => Math.max(Math.abs(p.x - f.position.x), Math.abs(p.y - f.position.y)))));
  const euclidean = fish.map(f => Math.min(...land.map(p => Math.hypot(p.x - f.position.x, p.y - f.position.y))));
  expect(fish.length).toBeGreaterThan(20);
  expect(Math.min(...distances)).toBeGreaterThan(4);
  // Native distance table is Euclidean, whereas the adapter's zone stencil
  // above is a box. The offshore outcome must use the comparison's metric.
  expect(Math.max(...euclidean)).toBeGreaterThan(20);
  expect(fish.some(f => state.terrain[Math.floor(f.position.y) * state.width + Math.floor(f.position.x)] === 23)).toBe(true);
  for (const f of fish) {
    expect(f.owner).toBe(0);
    const terrain = state.terrain[Math.floor(f.position.y) * state.width + Math.floor(f.position.x)];
    expect(FALLBACK_RULES.terrainRestrictions[FALLBACK_RULES.nodes[f.node!].terrainRestriction!]).toContain(terrain);
    for (const g of fish) if (g.id !== f.id && g.node === f.node) {
      const spacing = f.node === 'fish' ? 8 : 4;
      expect(Math.max(Math.abs(f.position.x - g.position.x), Math.abs(f.position.y - g.position.y))).toBeGreaterThanOrEqual(spacing);
    }
  }
  expect(fish.filter(f => f.node !== 'fish')).toHaveLength(Math.round(6 * state.width * state.height / 10000));
  expect(fish.filter(f => f.node === 'fish').length).toBeLessThanOrEqual(Math.round(170 * state.width * state.height / 10000));
  const restored = JSON.parse(JSON.stringify(state));
  for (let i = 0; i < 20; i++) { stepGame(state); stepGame(restored); }
  expect(restored.mapgenVersion).toBe(2);
  expect(checksumState(restored)).toBe(checksumState(state));
});

it.each(ARABIA_BIOMES.flatMap(b => [undefined, 2 as const].map(version => [b.name, b, version] as const)))('uses the season fish on %s without re-dealing land objects (both policies)', (_, biome, version) => {
  const run = (fish = ISLANDS.fish) => {
    const objects: { kind: string; at: Point }[] = [];
    const layers = generateMap({ rng: { seed: 95 }, width: 120, height: 120,
      mapgenVersion: version, free: () => true, place: (kind, at) => { objects.push({ kind, at }); },
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
