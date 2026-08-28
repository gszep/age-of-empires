/**
 * The map generator, rebuilt as the original's two primitives
 * (docs/map-generation-design.md, from the owned scripts in the resources
 * depot and the genie-rms reverse engineering, reimplemented here):
 *
 * 1. Cost-ordered round-robin growth. Every shape on an AoE2 map -- a wood, a
 *    land, a hill -- is grown one tile at a time from seeded clumps, popping
 *    the cheapest frontier tile, where
 *    `cost = 250 - clumping * neighbours + random(100)`; high clumping fills
 *    concavities into round blobs, low leaves tendrils. `cleanMask` then
 *    closes single-tile pinholes and diagonal squeezes, which is the
 *    original's own answer to the ragged forest interiors this replaced.
 *
 * 2. A randomised candidate scan for objects. Distance bands are *boxes*, not
 *    rings: every tile of the band is a candidate in randomised order, so
 *    resources reach the band's corners, which a polar scatter never did.
 *
 * Everything here is deterministic over the state's own RNG stream and works
 * in whole tiles; game.ts owns turning placements into entities.
 */
import type { NodeKind } from './data';
import { random01 } from './random';
import type { AnimalKind, Point } from './types';

/** DAT terrain ids the grid speaks. Grass is Arabia's base; forest carries
 * the wood. The grid is authoritative data ahead of the renderer knowing how
 * to draw more than one ground (docs/overnight.md, terrain blend edges). */
export const TERRAIN_GRASS = 0;
export const TERRAIN_FOREST = 10;

export interface ObjectGroupSpec {
  kind: NodeKind | AnimalKind;
  /** Members per group (`number_of_objects`). */
  count: number;
  /** How many groups of this line (`number_of_groups`). */
  groups?: number;
  /** The band, per axis: outside the `near` square, inside the `far` box. */
  near: number;
  far: number;
  /** `set_tight_grouping` flood-fills a contiguous lump; `loose` scans a
   * radius (`group_placement_radius`) for spots. */
  grouping: 'tight' | 'loose';
  spread?: number;
  /** `min_distance_group_placement`: candidates cleared around a placed group. */
  groupSpacing?: number;
}

export interface ForestSpec {
  /** Tiles per wood, and how many woods. */
  tiles: number;
  groups: number;
  near: number;
  far: number;
  /** `min_distance_group_placement` between woods of this line. */
  groupSpacing: number;
}

export interface MapDescriptor {
  playerForest: ForestSpec;
  opening: ObjectGroupSpec[];
}

/**
 * The player opening, from the owned `land_resources.inc` (resources depot,
 * `gamedata_x2`). Grouping, spacing and bands are the include's own numbers;
 * FORAGE, GOLD and STONE are tight, the animals loose.
 */
export const ARABIA: MapDescriptor = {
  // The spawn wood: two clumps sized as the 1999 include's smallest
  // PLAYER_FOREST (55 tiles x 2 clumps); spacing between them borrows the DE
  // script's forest spacing of 6, which the include does not state.
  playerForest: { tiles: 55, groups: 2, near: 14, far: 26, groupSpacing: 6 },
  opening: [
    { kind: 'berries', count: 6, near: 10, far: 12, grouping: 'tight', groupSpacing: 6 },
    { kind: 'gold', count: 7, near: 12, far: 16, grouping: 'tight', groupSpacing: 7 },
    { kind: 'gold', count: 4, near: 18, far: 26, grouping: 'tight', groupSpacing: 7 },
    { kind: 'gold', count: 4, near: 25, far: 35, grouping: 'tight', groupSpacing: 7 },
    { kind: 'stone', count: 5, near: 14, far: 18, grouping: 'tight', groupSpacing: 7 },
    { kind: 'stone', count: 4, near: 20, far: 26, grouping: 'tight', groupSpacing: 7 },
    { kind: 'sheep', count: 4, near: 10, far: 12, grouping: 'loose', spread: 3 },
    { kind: 'sheep', count: 2, groups: 2, near: 14, far: 30, grouping: 'loose', spread: 3 },
    { kind: 'deer', count: 4, near: 14, far: 30, grouping: 'loose', spread: 3 },
    { kind: 'boar', count: 1, near: 16, far: 22, grouping: 'loose', spread: 1 },
    { kind: 'boar', count: 1, near: 16, far: 22, grouping: 'loose', spread: 1 },
  ],
};

/** What the generator needs from the game: its RNG stream, whether a tile
 * can take a one-tile footprint, and somewhere to put what it places. */
export interface MapgenContext {
  rng: { seed: number };
  width: number;
  height: number;
  /** Tile centre free of the edge and of every footprint already placed. */
  free(at: Point): boolean;
  place(kind: NodeKind | AnimalKind, at: Point): void;
}

const randInt = (rng: { seed: number }, bound: number): number =>
  Math.floor(random01(rng) * bound);

const tileCentre = (x: number, y: number): Point => ({ x: x + 0.5, y: y + 0.5 });

/**
 * The candidate stack, as the original builds it: every tile of a box once,
 * then a quarter as many random re-adds. An add moves a tile already listed,
 * and pops come newest-first -- so the front of the queue is the random
 * re-adds and the box is walked in randomised order without ever repeating a
 * tile.
 */
function candidateOrder(
  ctx: MapgenContext, centre: Point, far: number,
): number[] {
  const minX = Math.max(0, Math.floor(centre.x) - far);
  const minY = Math.max(0, Math.floor(centre.y) - far);
  const maxX = Math.min(ctx.width - 1, Math.floor(centre.x) + far);
  const maxY = Math.min(ctx.height - 1, Math.floor(centre.y) + far);
  const stamp = new Map<number, number>();
  let sequence = 0;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) stamp.set(y * ctx.width + x, sequence++);
  }
  const spanX = maxX - minX + 1;
  const spanY = maxY - minY + 1;
  for (let i = Math.floor(spanX * spanY / 4); i > 0; i--) {
    const x = minX + randInt(ctx.rng, spanX);
    const y = minY + randInt(ctx.rng, spanY);
    stamp.set(y * ctx.width + x, sequence++);
  }
  return [...stamp.entries()].sort((a, b) => b[1] - a[1]).map(([tile]) => tile);
}

/** Inside the per-axis exclusion square of any start -- the original tests
 * each axis alone, so the shape really is a square, not a disc. */
const tooClose = (starts: Point[], x: number, y: number, near: number): boolean =>
  starts.some(s => Math.abs(s.x - (x + 0.5)) < near && Math.abs(s.y - (y + 0.5)) < near);

interface FrontierNode { cost: number; sequence: number; x: number; y: number }

/** Pop the cheapest frontier tile; the sequence makes the order total. */
class Frontier {
  private heap: FrontierNode[] = [];
  private sequence = 0;
  get size(): number { return this.heap.length; }
  push(x: number, y: number, cost: number): void {
    const node = { cost, sequence: this.sequence++, x, y };
    const heap = this.heap;
    heap.push(node);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!lessThan(heap[i], heap[parent])) break;
      [heap[i], heap[parent]] = [heap[parent], heap[i]];
      i = parent;
    }
  }
  pop(): FrontierNode | undefined {
    const heap = this.heap;
    if (!heap.length) return undefined;
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        const right = left + 1;
        let smallest = i;
        if (left < heap.length && lessThan(heap[left], heap[smallest])) smallest = left;
        if (right < heap.length && lessThan(heap[right], heap[smallest])) smallest = right;
        if (smallest === i) break;
        [heap[i], heap[smallest]] = [heap[smallest], heap[i]];
        i = smallest;
      }
    }
    return top;
  }
}

const lessThan = (a: FrontierNode, b: FrontierNode): boolean =>
  a.cost !== b.cost ? a.cost < b.cost : a.sequence < b.sequence;

const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/**
 * Grow one clump of `tiles` tiles from a seed, the original's way: the
 * frontier is popped cheapest-first, and a tile with more same-mask
 * neighbours in its 5x5 is cheaper, so `clumping` decides how round the blob
 * comes out. The default 20 is the scripts' own default clumping factor.
 */
function growMask(
  ctx: MapgenContext, mask: Uint8Array, seed: { x: number; y: number },
  tiles: number, accept: (x: number, y: number) => boolean, clumping = 20,
): number {
  const frontier = new Frontier();
  frontier.push(seed.x, seed.y, 0);
  let placed = 0;
  while (placed < tiles && frontier.size) {
    const next = frontier.pop()!;
    const tile = next.y * ctx.width + next.x;
    if (mask[tile]) continue;
    if (!accept(next.x, next.y)) continue;
    mask[tile] = 1;
    placed++;
    let neighbours = 1;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const nx = next.x + dx;
        const ny = next.y + dy;
        if (nx < 0 || ny < 0 || nx >= ctx.width || ny >= ctx.height) continue;
        if (mask[ny * ctx.width + nx]) neighbours++;
      }
    }
    const cost = 250 - clumping * neighbours;
    for (const [dx, dy] of STEPS) {
      const nx = next.x + dx;
      const ny = next.y + dy;
      if (nx < 0 || ny < 0 || nx >= ctx.width || ny >= ctx.height) continue;
      if (!mask[ny * ctx.width + nx]) frontier.push(nx, ny, cost + randInt(ctx.rng, 100));
    }
  }
  return placed;
}

/**
 * The original's `cleanTerrain`, over a mask: repeat until nothing changes --
 * pass one fills any tile whose north and south, or east and west, neighbours
 * are both set (a pinhole); pass two fills a tile whose corner joins two set
 * tiles that touch only diagonally through it (the squeeze a determined unit
 * threads). `fillable` keeps it off tiles something else already occupies.
 */
export function cleanMask(
  mask: Uint8Array, width: number, height: number,
  fillable: (x: number, y: number) => boolean = () => true,
): void {
  const at = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] === 1;
  let changed = true;
  while (changed) {
    changed = false;
    for (let pass = 0; pass < 2; pass++) {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (mask[y * width + x]) continue;
          const n = at(x, y - 1);
          const s = at(x, y + 1);
          const w = at(x - 1, y);
          const e = at(x + 1, y);
          let fill = false;
          if (pass === 0) {
            fill = (n && s) || (w && e);
          } else {
            const nw = at(x - 1, y - 1);
            const ne = at(x + 1, y - 1);
            const sw = at(x - 1, y + 1);
            const se = at(x + 1, y + 1);
            // Each case is two set tiles joined only around this corner.
            fill =
              (nw && ((ne && !n) || (e && !ne) || (sw && !w) || (s && !sw) || (se && !s && !e)))
              || (ne && ((nw && !n) || (w && !nw) || (se && !e) || (s && !se) || (sw && !w && !s)))
              || (se && ((ne && !e) || (n && !ne) || (sw && !s) || (w && !sw) || (nw && !w && !n)))
              || (sw && ((nw && !w) || (n && !nw) || (se && !s) || (e && !se) || (ne && !e && !n)));
          }
          if (fill && fillable(x, y)) {
            mask[y * width + x] = 1;
            changed = true;
          }
        }
      }
    }
  }
}

/** Clear candidates in a per-axis square, `min_distance_group_placement`. */
function clearAround(
  candidates: number[], width: number, x: number, y: number, margin: number,
): number[] {
  return candidates.filter(tile => {
    const tx = tile % width;
    const ty = Math.floor(tile / width);
    return Math.abs(tx - x) >= margin || Math.abs(ty - y) >= margin;
  });
}

/**
 * Generate the board: the players' woods first (terrain runs before objects
 * in the original's phase order), then the opening objects. `starts[0]` is
 * the scanning player; every placement is mirrored through `mirror` so the
 * two openings stay exact copies -- a named divergence from the original's
 * independent draws (docs/status.md), kept because the paired evaluation
 * batch rests on it.
 */
export function generateMap(
  ctx: MapgenContext, descriptor: MapDescriptor, starts: Point[],
  mirror: (p: Point) => Point,
): { terrain: number[] } {
  const terrain = new Array<number>(ctx.width * ctx.height).fill(TERRAIN_GRASS);
  const start = starts[0];

  // The spawn woods. Grown as masks so the shape is the original's, placed as
  // tree entities so the resource model is unchanged.
  const forest = descriptor.playerForest;
  const mask = new Uint8Array(ctx.width * ctx.height);
  const freeBoth = (x: number, y: number): boolean => {
    const here = tileCentre(x, y);
    return ctx.free(here) && ctx.free(mirror(here));
  };
  let candidates = candidateOrder(ctx, start, forest.far);
  let woods = 0;
  for (const tile of candidates) {
    if (woods >= forest.groups) break;
    const x = tile % ctx.width;
    const y = Math.floor(tile / ctx.width);
    if (tooClose(starts, x, y, forest.near)) continue;
    if (!freeBoth(x, y) || mask[tile]) continue;
    const before = mask.slice();
    const grown = growMask(ctx, mask, { x, y }, forest.tiles,
      (gx, gy) => freeBoth(gx, gy) && !tooClose(starts, gx, gy, forest.near));
    if (grown < forest.tiles / 2) { mask.set(before); continue; }
    candidates = clearAround(candidates, ctx.width, x, y, forest.groupSpacing);
    woods++;
  }
  cleanMask(mask, ctx.width, ctx.height, freeBoth);
  for (let tile = 0; tile < mask.length; tile++) {
    if (!mask[tile]) continue;
    const here = tileCentre(tile % ctx.width, Math.floor(tile / ctx.width));
    ctx.place('tree', here);
    ctx.place('tree', mirror(here));
    terrain[tile] = TERRAIN_FOREST;
    const other = mirror(here);
    terrain[Math.floor(other.y) * ctx.width + Math.floor(other.x)] = TERRAIN_FOREST;
  }

  // The opening objects, one candidate scan per line.
  for (const spec of descriptor.opening) {
    let order = candidateOrder(ctx, start, spec.far);
    let groupsLeft = spec.groups ?? 1;
    for (const tile of order) {
      if (groupsLeft <= 0) break;
      const x = tile % ctx.width;
      const y = Math.floor(tile / ctx.width);
      if (tooClose(starts, x, y, spec.near)) continue;
      if (!freeBoth(x, y)) continue;
      if (spec.groupSpacing) order = clearAround(order, ctx.width, x, y, spec.groupSpacing);
      const placed = spec.grouping === 'tight'
        ? placeTight(ctx, spec, x, y, freeBoth, mirror)
        : placeLoose(ctx, spec, x, y, freeBoth, mirror);
      if (placed) groupsLeft--;
    }
  }

  return { terrain };
}

/** `set_tight_grouping`: flood outward on purely random costs -- a contiguous
 * lump you can put one mining camp against. */
function placeTight(
  ctx: MapgenContext, spec: ObjectGroupSpec, x: number, y: number,
  freeBoth: (x: number, y: number) => boolean, mirror: (p: Point) => Point,
): number {
  const frontier = new Frontier();
  frontier.push(x, y, 0);
  const seen = new Set<number>();
  let placed = 0;
  while (placed < spec.count && frontier.size) {
    const next = frontier.pop()!;
    const tile = next.y * ctx.width + next.x;
    if (seen.has(tile)) continue;
    seen.add(tile);
    if (freeBoth(next.x, next.y)) {
      const here = tileCentre(next.x, next.y);
      ctx.place(spec.kind, here);
      ctx.place(spec.kind, mirror(here));
      placed++;
    }
    for (const [dx, dy] of STEPS) {
      const nx = next.x + dx;
      const ny = next.y + dy;
      if (nx < 0 || ny < 0 || nx >= ctx.width || ny >= ctx.height) continue;
      frontier.push(nx, ny, randInt(ctx.rng, 1000));
    }
  }
  return placed;
}

/** `set_loose_grouping`: a second candidate scan inside the group's radius. */
function placeLoose(
  ctx: MapgenContext, spec: ObjectGroupSpec, x: number, y: number,
  freeBoth: (x: number, y: number) => boolean, mirror: (p: Point) => Point,
): number {
  const order = candidateOrder(ctx, tileCentre(x, y), spec.spread ?? 1);
  let placed = 0;
  for (const tile of order) {
    if (placed >= spec.count) break;
    const tx = tile % ctx.width;
    const ty = Math.floor(tile / ctx.width);
    if (!freeBoth(tx, ty)) continue;
    const here = tileCentre(tx, ty);
    ctx.place(spec.kind, here);
    ctx.place(spec.kind, mirror(here));
    placed++;
  }
  return placed;
}
