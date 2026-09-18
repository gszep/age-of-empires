import { describe, expect, it } from 'vitest';
import { createGame } from '../sim/game';
import { TERRAIN_BEACH, TERRAIN_WATER } from '../sim/mapgen';
import { biomeOf, scatterPlacements } from './scatter';

describe('the aesthetic scatter', () => {
  it('strews the biome\'s own objects, off the water, the woods and the players', () => {
    for (const seed of [3, 7, 20]) {
      const state = createGame(seed);
      const biome = biomeOf(state)!;
      const placed = scatterPlacements(state);
      expect(placed.length).toBeGreaterThan(20);
      const wanted = new Set(Object.values(biome.aesthetics!));
      const wood = new Set(state.entities
        .filter(e => e.kind === 'resource' && e.resourceKind === 'wood')
        .map(e => `${Math.floor(e.position.x)},${Math.floor(e.position.y)}`));
      const starts = state.entities.filter(e => e.kind === 'town-center');
      for (const { key, x, y } of placed) {
        expect(wanted.has(key), key).toBe(true);
        const id = state.terrain[Math.floor(y) * state.width + Math.floor(x)];
        expect([TERRAIN_WATER, TERRAIN_BEACH]).not.toContain(id);
        for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
          expect(wood.has(`${Math.floor(x) + dx},${Math.floor(y) + dy}`), `a ${key} in the wood at ${x},${y}`).toBe(false);
        }
        for (const s of starts) expect(Math.hypot(x - s.position.x, y - s.position.y)).toBeGreaterThanOrEqual(15);
      }
    }
  });

  it('is the same picture for the same seed and touches no state', () => {
    const a = createGame(11);
    const before = JSON.stringify(a.entities);
    const first = scatterPlacements(a);
    expect(JSON.stringify(a.entities)).toBe(before);
    expect(scatterPlacements(createGame(11))).toEqual(first);
    expect(scatterPlacements(createGame(12))).not.toEqual(first);
  });
});
