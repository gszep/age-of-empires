import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checksumState } from './checksum';
import { FALLBACK_RULES } from './data';
import { createGame, stepGame } from './game';
import { buildNavGrid, findPath } from './nav';
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

describe('black forest', () => {
  // M4: a map type is a descriptor, not code. Black Forest is Arabia with the
  // base terrain set to forest, a clearing carved per player at the owned
  // script's numbers, and one road between them.
  const towncenters = (state: GameState): [Entity, Entity] => {
    const tcs = state.entities.filter(e => e.kind === 'town-center');
    return [tcs.find(e => e.owner === 1)!, tcs.find(e => e.owner === 2)!];
  };

  /** Whether `to`'s neighbourhood is walkable from `from`. findPath never
   * says no -- it walks as close as it can by design -- so the question
   * needs a flood fill. 8-connected, so a "no" is a strong no. */
  const reachable = (grid: ReturnType<typeof buildNavGrid>, from: Entity, to: Entity): boolean => {
    const seen = new Uint8Array(grid.width * grid.height);
    const start = { x: Math.floor(from.position.x + 2), y: Math.floor(from.position.y) };
    const queue = [start.y * grid.width + start.x];
    seen[queue[0]] = 1;
    const goal = { x: Math.floor(to.position.x), y: Math.floor(to.position.y) };
    while (queue.length) {
      const tile = queue.pop()!;
      const x = tile % grid.width;
      const y = Math.floor(tile / grid.width);
      if (Math.abs(x - goal.x) <= 2 && Math.abs(y - goal.y) <= 2) return true;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= grid.width || ny >= grid.height) continue;
        const next = ny * grid.width + nx;
        if (seen[next] || grid.blocked[next]) continue;
        seen[next] = 1;
        queue.push(next);
      }
    }
    return false;
  };

  it('is a wood with two clearings and a road that connects them', () => {
    const state = createGame(7, FALLBACK_RULES, undefined, 'black-forest');
    const trees = state.entities.filter(
      e => e.kind === 'resource' && e.resourceKind === 'wood').length;
    expect(trees).toBeGreaterThan(8000);
    const [home, enemy] = towncenters(state);
    const grid = buildNavGrid(state);
    expect(reachable(grid, home, enemy)).toBe(true);
    expect(findPath(grid, home.position, enemy.position)).toBeDefined();
  });

  it('has no route but the road', () => {
    // Cutting the road's cross-section at the centreline must disconnect the
    // two town centers: if any other way round existed -- a gap in the wood,
    // a walkable rim along the map edge -- the flood fill would find it.
    const state = createGame(7, FALLBACK_RULES, undefined, 'black-forest');
    const [home, enemy] = towncenters(state);
    const grid = buildNavGrid(state);
    for (const y of [59, 60, 61]) {
      grid.blocked[y * state.width + 60] = 1;
    }
    expect(reachable(grid, home, enemy)).toBe(false);
  });

  it('replays identically and keeps its opening fair', () => {
    const play = () => {
      const state = createGame(11, FALLBACK_RULES, undefined, 'black-forest');
      for (let i = 0; i < 200; i++) stepGame(state);
      return checksumState(state);
    };
    expect(play()).toBe(play());
    const state = createGame(11, FALLBACK_RULES, undefined, 'black-forest');
    for (const kind of ['gold', 'stone', 'food'] as const) {
      const left = state.entities.filter(
        e => e.kind === 'resource' && e.resourceKind === kind && e.position.x < 60).length;
      const right = state.entities.filter(
        e => e.kind === 'resource' && e.resourceKind === kind && e.position.x >= 60).length;
      expect(left, kind).toBe(right);
    }
  });

  it('refuses a map type nobody defined', () => {
    expect(() => createGame(1, FALLBACK_RULES, undefined, 'atlantis')).toThrow(/unknown map/);
  });
});

describe('a painted map', () => {
  // C1 (docs/map-build-plan.md): the whole conditioning architecture proved
  // with a hand-painted PNG -- offline image in, committed descriptor out,
  // playable board from a pure function of (descriptor, seed).
  it('lays the painted terrain down as the board, tile for tile', () => {
    const state = createGame(7, FALLBACK_RULES, undefined, 'painted-proof');
    const baked = JSON.parse(
      readFileSync('src/sim/maps/painted-proof.json', 'utf8')) as { terrain: number[] };
    expect(state.terrain).toEqual(baked.terrain);
    const treeTiles = new Set(state.entities
      .filter(e => e.kind === 'resource' && e.resourceKind === 'wood')
      .map(e => Math.floor(e.position.y) * state.width + Math.floor(e.position.x)));
    let missing = 0;
    for (let tile = 0; tile < baked.terrain.length; tile++) {
      if (baked.terrain[tile] === 10 && !treeTiles.has(tile)) missing++;
    }
    // A painted forest tile is a tree unless something already stood there.
    expect(missing).toBeLessThan(5);
    expect(treeTiles.size).toBeGreaterThan(2000);
  });

  it('records what it was painted from, verifiably', () => {
    const descriptor = JSON.parse(readFileSync('src/sim/maps/painted-proof.json', 'utf8')) as {
      source: { file: string; sha256: string };
    };
    const painted = readFileSync(`tools/maps/${descriptor.source.file}`);
    expect(createHash('sha256').update(painted).digest('hex')).toBe(descriptor.source.sha256);
  });

  it('gives the same checksum for the same descriptor and seed', () => {
    const play = () => {
      const state = createGame(13, FALLBACK_RULES, undefined, 'painted-proof');
      for (let i = 0; i < 200; i++) stepGame(state);
      return checksumState(state);
    };
    expect(play()).toBe(play());
  });
});

describe('the Windsor footprint', () => {
  const descriptor = JSON.parse(readFileSync('src/sim/maps/windsor.json', 'utf8')) as {
    width: number; height: number; terrain: number[];
    source: { clearedStarts: { tiles: [number, number][] } };
  };

  it('deals the full 392-tile baked board with starts in its recorded clearings', () => {
    const state = createGame(42, FALLBACK_RULES, undefined, 'windsor');
    expect([state.width, state.height]).toEqual([392, 392]);
    expect(state.terrain).toEqual(descriptor.terrain);
    expect(state.terrain.filter(id => id === 1).length).toBeGreaterThan(13_000);
    expect(state.terrain.filter(id => id === 24).length).toBeGreaterThan(20_000);
    expect(state.entities.filter(e => e.kind === 'resource' && e.resourceKind === 'wood').length)
      .toBeLessThan(6_000);
    const castle = state.entities.find(e => e.owner === 0 && e.kind === 'castle');
    const horse = state.entities.find(e => e.owner === 0 && e.kind === 'scout-cavalry');
    expect(castle?.position).toEqual({ x: 183.007, y: 158.543 });
    expect(horse?.position).toEqual({ x: 375.012, y: 375.012 });
    const townCentres = state.entities
      .filter(e => e.kind === 'town-center')
      .map(e => [e.position.x, e.position.y]);
    expect(townCentres).toEqual(descriptor.source.clearedStarts.tiles);
  });

  it('remains deterministic at the larger dimensions', () => {
    const play = () => {
      const state = createGame(17, FALLBACK_RULES, undefined, 'windsor');
      for (let i = 0; i < 50; i++) stepGame(state);
      return checksumState(state);
    };
    expect(play()).toBe(play());
  });
});

describe('the ridge at senlac', () => {
  // C2: real ground. The descriptor was built offline from the Environment
  // Agency's 1m LIDAR and Vegetation Object Model over the registered
  // battlefield at Battle, East Sussex; these tests pin the board to it.
  const descriptor = JSON.parse(readFileSync('src/sim/maps/senlac.json', 'utf8')) as {
    width: number; height: number; terrain: number[]; elevation: number[];
    attribution: string;
    source: { clearedStarts: { tiles: [number, number][]; radius: number } };
  };

  it('puts the real woods and hedgerows on the board', () => {
    const state = createGame(7, FALLBACK_RULES, undefined, 'senlac');
    expect(state.terrain).toEqual(descriptor.terrain);
    const treeTiles = new Set(state.entities
      .filter(e => e.kind === 'resource' && e.resourceKind === 'wood')
      .map(e => Math.floor(e.position.y) * state.width + Math.floor(e.position.x)));
    const painted = descriptor.terrain.filter(t => t === 10).length;
    expect(treeTiles.size).toBeGreaterThan(painted - 5);
  });

  it('keeps both start areas open ground, and says so', () => {
    const { tiles, radius } = descriptor.source.clearedStarts;
    expect(radius).toBeGreaterThan(0);
    const state = createGame(7, FALLBACK_RULES, undefined, 'senlac');
    for (const e of state.entities) {
      if (e.kind !== 'resource' || e.resourceKind !== 'wood') continue;
      for (const [sx, sy] of tiles) {
        const d = Math.hypot(e.position.x - sx, e.position.y - sy);
        expect(d, `a tree ${d.toFixed(1)} tiles from the start at ${sx},${sy}`)
          .toBeGreaterThan(radius - 1);
      }
    }
  });

  it('carries the relief and the licence it owes', () => {
    // The descriptor carries the real ridge consumed by the elevated renderer.
    expect(descriptor.elevation.length).toBe(descriptor.width * descriptor.height);
    expect(Math.max(...descriptor.elevation)).toBeGreaterThan(5);
    expect(descriptor.attribution).toContain('Environment Agency');
    expect(descriptor.attribution).toContain('Open Government Licence');
  });

  it('gives the same checksum for the same seed', () => {
    const play = () => {
      const state = createGame(17, FALLBACK_RULES, undefined, 'senlac');
      for (let i = 0; i < 200; i++) stepGame(state);
      return checksumState(state);
    };
    expect(play()).toBe(play());
  });
});
