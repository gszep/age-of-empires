import { describe, expect, it } from 'vitest';
import { checksumState } from './checksum';
import { FALLBACK_RULES } from './data';
import { createGame, stepGame } from './game';
import type { Entity, GameState } from './types';

/** Tiles of the player-1 half holding a tree, as a set of `y*width+x`. */
const treeTiles = (state: GameState): Set<number> => {
  const tiles = new Set<number>();
  for (const e of state.entities) {
    if (e.kind !== 'resource' || e.resourceKind !== 'wood') continue;
    tiles.add(Math.floor(e.position.y) * state.width + Math.floor(e.position.x));
  }
  return tiles;
};

const occupiedTiles = (state: GameState): Set<number> => {
  const tiles = new Set<number>();
  for (const e of state.entities) {
    if (e.kind === 'resource' && e.resourceKind === 'wood') continue;
    tiles.add(Math.floor(e.position.y) * state.width + Math.floor(e.position.x));
  }
  return tiles;
};

describe('the grown map', () => {
  // The acceptance for M1 (docs/map-build-plan.md): the old frontier-at-random
  // growth left 19 of 63 interior tiles open in one wood and a diagonal gap a
  // determined unit threaded (docs/backlog.md). The original's growth plus
  // cleanTerrain is the fix, and these assert its two guarantees directly.
  it('leaves no pinhole inside a wood on seed 7', () => {
    const state = createGame(7, FALLBACK_RULES);
    const trees = treeTiles(state);
    const occupied = occupiedTiles(state);
    expect(trees.size).toBeGreaterThan(100);
    for (let y = 1; y < state.height - 1; y++) {
      for (let x = 1; x < state.width - 1; x++) {
        const tile = y * state.width + x;
        if (trees.has(tile) || occupied.has(tile)) continue;
        const n = trees.has(tile - state.width);
        const s = trees.has(tile + state.width);
        const w = trees.has(tile - 1);
        const e = trees.has(tile + 1);
        expect((n && s) || (w && e), `pinhole at ${x},${y}`).toBe(false);
      }
    }
  });

  it('leaves no diagonal-only squeeze through a wood on seed 7', () => {
    const state = createGame(7, FALLBACK_RULES);
    const trees = treeTiles(state);
    const occupied = occupiedTiles(state);
    for (let y = 0; y < state.height - 1; y++) {
      for (let x = 0; x < state.width - 1; x++) {
        const a = y * state.width + x;          // top-left of the 2x2
        const b = a + 1;                         // top-right
        const c = a + state.width;               // bottom-left
        const d = c + 1;                         // bottom-right
        const squeeze =
          (trees.has(a) && trees.has(d) && !trees.has(b) && !trees.has(c)
            && !occupied.has(b) && !occupied.has(c))
          || (trees.has(b) && trees.has(c) && !trees.has(a) && !trees.has(d)
            && !occupied.has(a) && !occupied.has(d));
        expect(squeeze, `diagonal squeeze in the 2x2 at ${x},${y}`).toBe(false);
      }
    }
  });

  // M2's acceptance: the distance bands are the original's boxes, tested per
  // axis, so resources reach a band's corners -- further out by straight-line
  // distance than the old polar scatter's `far` could ever put them.
  it('keeps every opening resource inside its box and no group overlapping', () => {
    for (const seed of [1, 7, 51, 90]) {
      const state = createGame(seed, FALLBACK_RULES);
      const seen = new Set<number>();
      for (const e of state.entities) {
        if (e.kind !== 'resource' && e.kind !== 'sheep' && e.kind !== 'deer' && e.kind !== 'boar') continue;
        const tile = Math.floor(e.position.y) * state.width + Math.floor(e.position.x);
        expect(seen.has(tile), `two placements share tile ${tile} on seed ${seed}`).toBe(false);
        seen.add(tile);
      }
      // Gold's widest band is 35 per axis; grouping can spill a couple of
      // tiles past the box the seed tile was drawn from.
      const start = { x: 30, y: 60 };
      for (const e of state.entities) {
        if (e.kind !== 'resource' || e.resourceKind !== 'gold') continue;
        if (e.position.x > state.width / 2) continue; // player 1's half
        expect(Math.abs(e.position.x - start.x)).toBeLessThanOrEqual(38);
        expect(Math.abs(e.position.y - start.y)).toBeLessThanOrEqual(38);
      }
    }
  });

  it('reaches the corners of a band across a seed sweep', () => {
    // A polar scatter cannot put berries further than 12 straight-line tiles
    // out; a box band's corner is ~17. Seeing one past 13.5 in a sweep is the
    // box working. (Tight grouping can drift ~2 tiles from the seed tile.)
    let furthest = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const state = createGame(seed, FALLBACK_RULES);
      for (const e of state.entities) {
        if (e.kind !== 'resource' || e.resourceKind !== 'food' || e.position.x > 60) continue;
        furthest = Math.max(furthest, Math.hypot(e.position.x - 30.5, e.position.y - 60.5));
      }
    }
    expect(furthest).toBeGreaterThan(13.5);
  });

  it('mirrors the two halves exactly', () => {
    const state = createGame(11, FALLBACK_RULES);
    const half = (predicate: (e: Entity) => boolean) => state.entities.filter(predicate).length;
    for (const kind of ['gold', 'stone', 'food', 'wood'] as const) {
      const left = half(e => e.kind === 'resource' && e.resourceKind === kind && e.position.x < 60);
      const right = half(e => e.kind === 'resource' && e.resourceKind === kind && e.position.x >= 60);
      expect(left, kind).toBe(right);
    }
  });

  it('generates the same board and match for the same seed', () => {
    const play = () => {
      const state = createGame(29, FALLBACK_RULES);
      for (let i = 0; i < 200; i++) stepGame(state);
      return checksumState(state);
    };
    expect(play()).toBe(play());
  });
});
