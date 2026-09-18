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
import paintedProof from './maps/painted-proof.json';
import senlac from './maps/senlac.json';
import windsor from './maps/windsor.json';
import { random01, seedFrom } from './random';
import type { AnimalKind, BuildingKind, Point, UnitKind } from './types';

/** DAT terrain ids the grid speaks. Grass is Arabia's base; forest carries
 * the wood. The grid is authoritative data ahead of the renderer knowing how
 * to draw more than one ground (docs/overnight.md, terrain blend edges). */
export const TERRAIN_GRASS = 0;
export const TERRAIN_FOREST = 10;
/** `Water, Shallow`: the `POND_TERRAIN` every one of Arabia's biomes names,
 * and the one water DE's Islands deals (`VODA`). */
export const TERRAIN_WATER = 1;
/** `Beach`: what the engine paints on land that touches water. */
export const TERRAIN_BEACH = 2;
/**
 * Which terrains are water for the shore sweep: the DAT's `is_water` flag is
 * 1 (medium), 2 (deep) or 4 (shallow water) for open water, 8 for shallows,
 * 16 for beach and 32 for land. Only open water makes a beach.
 */
const OPEN_WATER = new Set([TERRAIN_WATER, 22, 23, 15, 96, 97, 98]);

/**
 * The terrains one of Arabia's biomes dresses the board in.
 *
 * DE's Arabia rolls a biome per match — eleven of them at roughly nine percent
 * each — and each names its own ground, its own forest, two forest variations
 * and four "blend" terrains that are scattered over the ground in clumps. That
 * scattering is what stops the board reading as one flat sheet of green, and
 * it is the thing a terrain-blend pass has to have before it has anything to
 * blend. Ids are the DAT's own terrain slots, read out of `Arabia.rms`'s
 * `MAP_CONSTANTS` block.
 */
export interface BiomeSpec {
  /** The script's own name for it, kept so a board can say what it dealt. */
  name: string;
  base: number;
  blendA: number;
  blendB: number;
  blendC: number;
  blendD: number;
  forest: number;
  forestEdge: number;
  forestVariationA: number;
  forestVariationB: number;
  forestBlend: number;
  /** The leaf litter a lone tree stands on, and the patch inside that. */
  stragglerForest: number;
  stragglerForestVariation: number;
}

type BiomeTerrain = Exclude<keyof BiomeSpec, 'name'>;

/**
 * Arabia's `<TERRAIN_GENERATION>` passes, in the script's own order, with its
 * own percentages and clump counts. Each paints one terrain over tiles that
 * are currently another, so the order matters: a later pass can sit on what an
 * earlier one laid.
 *
 * `set_scale_by_groups` and `terrain_mask` are DE extensions this does not
 * model; `land_percent` is read as a percentage of the board, which is what
 * makes the numbers land at the script's own coverage.
 */
const BIOME_PASSES: {
  paint: BiomeTerrain; over: BiomeTerrain; percent: number; clumps: number; clumping?: number;
}[] = [
  { paint: 'forestVariationA', over: 'forest', percent: 2, clumps: 128 },
  { paint: 'forestVariationB', over: 'forest', percent: 1, clumps: 128 },
  { paint: 'blendA', over: 'base', percent: 8, clumps: 4, clumping: 80 },
  { paint: 'blendA', over: 'base', percent: 4, clumps: 6 },
  { paint: 'blendB', over: 'base', percent: 16, clumps: 24 },
  { paint: 'blendA', over: 'forest', percent: 4, clumps: 24 },
  { paint: 'blendC', over: 'base', percent: 4, clumps: 24 },
  { paint: 'blendD', over: 'base', percent: 6, clumps: 24 },
  { paint: 'forestBlend', over: 'forest', percent: 4, clumps: 24 },
];

/**
 * Four of the eleven biomes `Arabia.rms` rolls between, chosen to span its
 * range: the desert everyone pictures, two temperate greens and a
 * Mediterranean. The other seven are a data addition — each is twelve terrain
 * ids out of the same block — and are left out only so the import does not
 * carry textures no board deals; see `docs/backlog.md`.
 */
export const ARABIA_BIOMES: BiomeSpec[] = [
  {
    name: 'PALAEARCTIC_MIDDLE_EAST_DESERT',
    stragglerForest: 48, stragglerForestVariation: 110,
    base: 14, blendA: 11, blendB: 6, blendC: 14, blendD: 14,
    forest: 13, forestEdge: 13, forestVariationA: 110, forestVariationB: 13, forestBlend: 3,
  },
  {
    name: 'PALAEARCTIC_EUROPE_TEMPERATE',
    stragglerForest: 19, stragglerForestVariation: 71,
    base: 12, blendA: 5, blendB: 9, blendC: 12, blendD: 12,
    forest: 10, forestEdge: 89, forestVariationA: 19, forestVariationB: 104, forestBlend: 12,
  },
  {
    name: 'NEARCTIC_TEMPERATE',
    stragglerForest: 89, stragglerForestVariation: 110,
    base: 3, blendA: 0, blendB: 9, blendC: 12, blendD: 3,
    forest: 19, forestEdge: 89, forestVariationA: 10, forestVariationB: 19, forestBlend: 0,
  },
  {
    name: 'PALAEARCTIC_EUROPE_MEDITERRANEAN',
    stragglerForest: 19, stragglerForestVariation: 71,
    base: 9, blendA: 100, blendB: 117, blendC: 121, blendD: 3,
    forest: 88, forestEdge: 89, forestVariationA: 19, forestVariationB: 104, forestBlend: 0,
  },
];

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

/**
 * Ponds in the woods, as the owned `Arabia.rms` deals them: one roll per
 * match over how many, then `WATER_SHALLOW` clumps grown over forest with
 * `spacing_to_other_terrain_types 1`, so a pond is ringed by trees and never
 * touches open ground. `number_of_tiles` and `number_of_clumps` are the
 * script's own, at its `set_scale_by_size` reference of a 100x100 board, and
 * are totals for the whole map; the generator grows half and mirrors.
 */
export interface PondSpec {
  /** `percent_chance` per level, in order; a level is tiles and clumps. */
  levels: { chance: number; tiles: number; clumps: number }[];
}

export interface NeutralSpec {
  /** The middle of the map: neutral wood at the owned Arabia's density
   * (~8% of the board in a dozen clumps, kept off the start areas by the
   * script's own probabilistic fade rather than a hard radius). Counts are
   * per half; every placement is mirrored. */
  forest: { tiles: number; clumps: number };
  /** Lone trees scattered over open ground, per half. */
  stragglers: number;
  /** `set_avoid_player_start_areas`: rejection chance is
   * `(radius - distance) * fade`, capped at 101, per start. */
  avoid: { radius: number; fade: number };
}

export interface MapDescriptor {
  /** What the board is before anything is carved. This one line decides the
   * genre: grass makes Arabia, forest makes Black Forest, water makes
   * Islands. */
  base: 'grass' | 'forest' | 'water';
  /** Carved out of a forest or water base for each player: the clearing, or
   * the island. `clearance` is `other_zone_avoidance_distance` -- how far
   * the land must stay from the mirrored land, which under exact mirroring
   * is a margin off the centreline; `border` is the script's
   * `left/right/top/bottom_border`, a percentage of the map the land keeps
   * from every edge. */
  land?: {
    tiles: number; baseSize: number; clearance: number; clumping?: number; border?: number;
    /** `border_fuzziness`: how softly the land meets its limits, as the
     * width in tiles over which a tile's chance of being taken fades from
     * all to none. A hard limit cuts a coast dead straight. */
    fuzziness?: number;
  };
  /** Woods on an island keep this many tiles from the coast
   * (`spacing_to_other_terrain_types` on the script's wood passes). */
  woodShoreSpacing?: number;
  /** The connection between the two clearings, cut through the wood. */
  road?: { width: number };
  playerForest?: ForestSpec;
  neutral?: NeutralSpec;
  ponds?: PondSpec;
  /**
   * A fixed terrain layer, produced offline (tools/paint_map.py) and
   * committed beside the rules: geography is data the generator reads, not
   * something it invents. When present it replaces the grown terrain -- and,
   * like DE's own Real World maps, it is deliberately *not* mirrored; only
   * the object pass is. The descriptor records the hash of what it was
   * painted from.
   */
  baked?: {
    width: number;
    height: number;
    terrain: number[];
    elevation?: number[];
    landmarks?: { kind: BuildingKind | UnitKind; x: number; y: number; sourcePoint?: number[] }[];
  };
  /** High-resolution survey boards keep the forest ground but thin individual
   * tree entities to this deterministic fraction for rendering/playability. */
  bakedTreeStride?: number;
  /**
   * Biomes this map type rolls between, one per match. Absent means the board
   * keeps the plain grass-and-forest pair, which is what a baked survey map
   * wants: its ground is the geography, not a dressing.
   */
  biomes?: BiomeSpec[];
  opening: ObjectGroupSpec[];
}

/**
 * The player opening, from the owned `land_resources.inc` (resources depot,
 * `gamedata_x2`). Grouping, spacing and bands are the include's own numbers;
 * FORAGE, GOLD and STONE are tight, the animals loose.
 */
export const ARABIA: MapDescriptor = {
  base: 'grass',
  biomes: ARABIA_BIOMES,
  // The spawn wood: two clumps sized as the 1999 include's smallest
  // PLAYER_FOREST (55 tiles x 2 clumps); spacing between them borrows the DE
  // script's forest spacing of 6, which the include does not state.
  playerForest: { tiles: 55, groups: 2, near: 14, far: 26, groupSpacing: 6 },
  // The owned Arabia's global forest is 6-10% of the board in 10-14 clumps,
  // avoiding start areas; with the two spawn woods that lands total tree
  // cover at the script's own ~8%. Stragglers are the classic thirty lone
  // trees at map scale, fifteen a half.
  neutral: { forest: { tiles: 460, clumps: 6 }, stragglers: 15, avoid: { radius: 18, fade: 10 } },
  // The script's global forest ponds: NONE 30, FEW 40 (16 tiles in 2 clumps),
  // NORMAL 25 (32 in 4), MANY 5 (48 in 6). Its per-player forest ponds are
  // compiled out by `GOODBYE_PONDS` and are not dealt here either.
  ponds: {
    levels: [
      { chance: 30, tiles: 0, clumps: 0 },
      { chance: 40, tiles: 16, clumps: 2 },
      { chance: 25, tiles: 32, clumps: 4 },
      { chance: 5, tiles: 48, clumps: 6 },
    ],
  },
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

/**
 * Black Forest is not a different algorithm: it is Arabia with the base
 * terrain set to forest, a grass clearing carved out per player (the 1999
 * script's GRASS at half the map across the lands, base 13, avoidance 6),
 * and a three-wide road cut between the clearings -- the script's own
 * `terrain_size FOREST 3 1`. The opening resources are the same include.
 */
export const BLACK_FOREST: MapDescriptor = {
  base: 'forest',
  // The owned script's own numbers: `create_player_lands` at land_percent 44
  // shared across both players (~1580 tiles each on this board), a circular
  // base of 14, clumping_factor 2 -- a round core with a soft ragged fringe --
  // and 6 tiles of avoidance to the other land's zone.
  land: { tiles: 1580, baseSize: 14, clearance: 6, clumping: 2 },
  road: { width: 3 },
  opening: ARABIA.opening,
};

/**
 * Islands is Arabia with the base terrain set to water: one land per player
 * carved out of the sea, dressed in a biome, wooded, and shored by the
 * engine's beach. The owned `Islands.rms` (2023): `create_player_lands` at
 * `land_percent 35` shared across the players, `base_size 15`, borders 7,
 * `border_fuzziness 11`, `other_zone_avoidance_distance 11`,
 * `clumping_factor 22`; one water terrain, `VODA` (1); woods
 * (`WOODIES`) at `spacing_to_other_terrain_types 3` from anything else, so
 * they stand back from the coast; the opening from the same include. The
 * script's resource islets (`land_id 20-23`, 1% each) are not dealt.
 */
export const ISLANDS: MapDescriptor = {
  base: 'water',
  biomes: ARABIA_BIOMES,
  land: { tiles: 2520, baseSize: 15, clearance: 11, clumping: 22, border: 7, fuzziness: 11 },
  woodShoreSpacing: 3,
  playerForest: { tiles: 55, groups: 2, near: 14, far: 26, groupSpacing: 6 },
  // The script's island woods: 450-550 tiles in 9-10 clumps at map scale,
  // avoiding the start areas; halved here because every placement mirrors.
  neutral: { forest: { tiles: 250, clumps: 5 }, stragglers: 8, avoid: { radius: 18, fade: 10 } },
  opening: ARABIA.opening,
};

/** The map types a match can name. A map type is data, not code. */
export const MAPS: Record<string, MapDescriptor> = {
  arabia: ARABIA,
  'black-forest': BLACK_FOREST,
  islands: ISLANDS,
  // The proof that a painted image is a playable board: a wooded river with
  // one ford, from tools/maps/painted-proof.png through tools/paint_map.py.
  'painted-proof': {
    base: 'grass',
    baked: paintedProof,
    opening: ARABIA.opening,
  },
  // The ridge at Senlac: the ground the Battle of Hastings was fought on,
  // 1.2 km around Battle, East Sussex, at 10 m a tile -- Environment Agency
  // 1 m LIDAR for the relief (committed in the descriptor, waiting on an
  // elevation renderer) and its Vegetation Object Model for every wood,
  // copse and hedgerow line, all Open Government Licence. Built by
  // tools/import_terrain.py; the descriptor carries its sources, their
  // hashes and the attribution.
  senlac: {
    base: 'grass',
    baked: senlac,
    opening: ARABIA.opening,
  },
  // Windsor Castle, the Long Walk and the Thames corridor in a 168-tile
  // diamond whose south corner is the Copper Horse. Water is still classified
  // as grass; this first pass exists to validate the real-world footprint.
  windsor: {
    base: 'grass',
    baked: windsor as MapDescriptor['baked'],
    bakedTreeStride: 4,
    opening: ARABIA.opening,
  },
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
  return candidateOrderBox(ctx,
    Math.max(0, Math.floor(centre.x) - far), Math.max(0, Math.floor(centre.y) - far),
    Math.min(ctx.width - 1, Math.floor(centre.x) + far),
    Math.min(ctx.height - 1, Math.floor(centre.y) + far));
}

function candidateOrderBox(
  ctx: MapgenContext, minX: number, minY: number, maxX: number, maxY: number,
): number[] {
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
 * Grow clumps to a shared tile budget, the original's way: one tile per clump
 * per outer pass, so clumps racing for the same ground advance at the same
 * rate; each clump's frontier pops cheapest-first, and a tile with more
 * same-mask neighbours in its 5x5 is cheaper, so `clumping` decides how round
 * the blobs come out (20 is the scripts' own default). A rejected pop --
 * occupied ground, or a failed avoid-start-area roll -- consumes that clump's
 * turn, exactly as the engine's does.
 */
function growClumps(
  ctx: MapgenContext, mask: Uint8Array, seeds: { x: number; y: number }[],
  tiles: number, accept: (x: number, y: number) => boolean, clumping = 20,
): number {
  const frontiers = seeds.map(seed => {
    const frontier = new Frontier();
    frontier.push(seed.x, seed.y, 0);
    return frontier;
  });
  let placed = 0;
  let grew = true;
  while (placed < tiles && grew) {
    grew = false;
    for (const frontier of frontiers) {
      if (placed >= tiles) break;
      const next = frontier.pop();
      if (!next) continue;
      grew = true;
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
/**
 * Dress the board in a biome: run Arabia's own `create_terrain` passes over
 * ground that has already been grown.
 *
 * Each pass grows clumps with the same primitive the woods use and writes its
 * terrain only where the tile is currently the one the pass names, so the
 * script's ordering — a later pass sitting on what an earlier one laid — comes
 * out of the data rather than out of special cases here.
 *
 * Deliberately not mirrored. The rest of the board is, because resources
 * decide matches and a paired evaluation has to be fair; a dressing does not
 * touch play (the terrain grid is read by the renderer and the minimap and by
 * nothing in the rules), and mirroring it makes the two halves visibly the
 * same picture, which no map in the reference looks like.
 */
function paintBiome(
  ctx: MapgenContext, terrain: number[], biome: BiomeSpec, rng: { seed: number },
): void {
  // Grow against the dressing's own stream rather than the board's.
  const dressed: MapgenContext = { ...ctx, rng };
  const area = ctx.width * ctx.height;
  for (const pass of BIOME_PASSES) {
    const paint = biome[pass.paint];
    const over = biome[pass.over];
    // A pass whose two terrains are the same id would paint nothing; the
    // script has several (a biome may set BLEND_C to its own base).
    if (paint === over) continue;
    const on = (x: number, y: number): boolean => terrain[y * ctx.width + x] === over;
    const order = candidateOrderBox(dressed, 0, 0, ctx.width - 1, ctx.height - 1)
      .filter(tile => on(tile % ctx.width, Math.floor(tile / ctx.width)));
    // `land_percent` is a share of the ground the pass is painting over, not
    // of the whole board. The two readings barely differ for a pass over the
    // base terrain, which is most of the map, and differ enormously for one
    // over forest: at 4% of the *board*, two passes between them repainted
    // half of every wood, and 674 of 1228 trees stood on grass instead of on
    // leaf litter (issue #34).
    const tiles = Math.round(order.length * pass.percent / 100);
    if (tiles <= 0) continue;
    void area;
    if (!order.length) continue;
    const seeds: { x: number; y: number }[] = [];
    for (const tile of order) {
      if (seeds.length >= pass.clumps) break;
      seeds.push({ x: tile % ctx.width, y: Math.floor(tile / ctx.width) });
    }
    const mask = new Uint8Array(area);
    growClumps(dressed, mask, seeds, tiles, on, pass.clumping);
    for (let tile = 0; tile < area; tile++) if (mask[tile]) terrain[tile] = paint;
  }
}

export function generateMap(
  ctx: MapgenContext, descriptor: MapDescriptor, starts: Point[],
  mirror: (p: Point) => Point,
): { terrain: number[]; elevation: number[] } {
  // One biome per match, rolled before anything is laid so the base ground is
  // already the biome's own. A baked survey board names no biomes: its ground
  // is the geography.
  //
  // It draws from its own stream, not the board's. A dressing must not move a
  // single sheep: sharing `ctx.rng` would shift every draw after it and deal a
  // different board for the same seed, which is a large price for a change
  // that only decides what colour the ground is. The stream is derived from
  // the match seed, so it is still the same dressing every time.
  const dressing = { seed: seedFrom(ctx.rng.seed ^ 0x5ee_d1) };
  const biome = descriptor.biomes?.length
    ? descriptor.biomes[randInt(dressing, descriptor.biomes.length)]
    : undefined;
  const terrain = new Array<number>(ctx.width * ctx.height).fill(
    descriptor.base === 'water' ? TERRAIN_WATER : biome?.base ?? TERRAIN_GRASS);
  const elevation = new Array<number>(ctx.width * ctx.height).fill(0);
  const start = starts[0];
  const reserved = new Uint8Array(ctx.width * ctx.height);
  const freeBoth = (x: number, y: number): boolean => {
    if (reserved[y * ctx.width + x]) return false;
    const here = tileCentre(x, y);
    return ctx.free(here) && ctx.free(mirror(here));
  };

  /** Pop seed tiles from a candidate order, keeping them `separation` apart. */
  const pickSeeds = (
    order: number[], count: number, separation: number,
    ok: (x: number, y: number) => boolean,
  ): { x: number; y: number }[] => {
    const seeds: { x: number; y: number }[] = [];
    let candidates = order;
    for (const tile of candidates) {
      if (seeds.length >= count) break;
      const x = tile % ctx.width;
      const y = Math.floor(tile / ctx.width);
      if (!ok(x, y)) continue;
      seeds.push({ x, y });
      candidates = clearAround(candidates, ctx.width, x, y, separation);
    }
    return seeds;
  };

  // A baked terrain layer is the geography, laid down whole and unmirrored,
  // exactly as DE's own Real World maps fix the ground and randomise only the
  // objects. The random object pass below still mirrors, which is what keeps
  // the paired evaluation fair on ground that is not.
  if (descriptor.baked) {
    const baked = descriptor.baked;
    for (let y = 0; y < Math.min(ctx.height, baked.height); y++) {
      for (let x = 0; x < Math.min(ctx.width, baked.width); x++) {
        const id = baked.terrain[y * baked.width + x];
        const tile = y * ctx.width + x;
        terrain[tile] = id;
        elevation[tile] = baked.elevation?.[y * baked.width + x] ?? 0;
        if (id !== TERRAIN_FOREST) continue;
        const stride = descriptor.bakedTreeStride ?? 1;
        const hash = (Math.imul(x, 73_856_093) ^ Math.imul(y, 19_349_663)) >>> 0;
        if (hash % stride !== 0) continue;
        const here = tileCentre(x, y);
        if (ctx.free(here)) ctx.place('tree', here);
      }
    }
  }

  // The forest mask for the scanning half; its mirror fills the other. On a
  // grass base the woods are grown onto it; on a forest base the whole half
  // is wood and the player's clearing and the road are carved out of it.
  const mask = new Uint8Array(ctx.width * ctx.height);
  const halfWidth = Math.floor(ctx.width / 2);
  // On a water base, the island: 1 where the player's land is, for both
  // halves once mirrored. Everything else stays sea.
  const island = new Uint8Array(ctx.width * ctx.height);

  if (!descriptor.baked && descriptor.base !== 'grass' && descriptor.land) {
    // The clearing, or the island: one land grown from the player's origin,
    // kept off the centreline by half the avoidance distance -- under exact
    // mirroring that *is* the distance to the other land's zone -- and, on a
    // water base, inside the script's border box.
    const margin = Math.ceil(descriptor.land.clearance / 2);
    const border = Math.ceil((descriptor.land.border ?? 0) / 100 * Math.min(ctx.width, ctx.height));
    const land = new Uint8Array(ctx.width * ctx.height);
    // How far inside every limit a tile is; the land fades out over the
    // script's fuzziness rather than stopping at a line, so a coast is
    // ragged where it meets the map's edge or the other land's zone.
    const fuzz = descriptor.land.fuzziness ?? 0;
    const inside = (x: number, y: number): number => Math.min(
      halfWidth - margin - x, x - border + 1, y - border + 1, ctx.height - border - y);
    const inLand = (x: number, y: number): boolean => {
      const room = inside(x, y);
      if (room <= 0) return false;
      if (room > fuzz) return true;
      return randInt(ctx.rng, fuzz) < room;
    };
    // The circular base the script asks for (`base_size N, set_circular_base`)
    // is stamped whole, then the rest grows from the ring around it -- each
    // ring tile its own round-robin frontier, so the fringe advances evenly
    // and the clumping factor only shapes how soft its edge is.
    const cx = Math.floor(start.x);
    const cy = Math.floor(start.y);
    const base = descriptor.land.baseSize;
    let stamped = 0;
    const ring: { x: number; y: number }[] = [];
    for (let y = Math.max(0, cy - base - 1); y <= Math.min(ctx.height - 1, cy + base + 1); y++) {
      for (let x = Math.max(0, cx - base - 1); x <= Math.min(ctx.width - 1, cx + base + 1); x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d <= base && inLand(x, y)) {
          land[y * ctx.width + x] = 1;
          stamped++;
        } else if (d <= base + 1.5) {
          ring.push({ x, y });
        }
      }
    }
    growClumps(ctx, land, ring, Math.max(0, descriptor.land.tiles - stamped),
      inLand, descriptor.land.clumping ?? 20);
    cleanMask(land, ctx.width, ctx.height);
    if (descriptor.base === 'forest') {
      for (let y = 0; y < ctx.height; y++) {
        for (let x = 0; x < halfWidth; x++) {
          if (!land[y * ctx.width + x]) mask[y * ctx.width + x] = 1;
        }
      }
      // The road, the script's own three-wide corridor: with uniform wood and
      // mirrored origins the cheapest path between them is the straight line.
      // Its tiles are reserved against objects -- a gold lump square in the one
      // corridor between the clearings would be a wall until somebody mined it.
      const roadHalf = Math.floor((descriptor.road?.width ?? 3) / 2);
      for (let x = Math.floor(start.x); x < ctx.width - Math.floor(start.x); x++) {
        for (let dy = -roadHalf; dy <= roadHalf; dy++) {
          const tile = (Math.floor(start.y) + dy) * ctx.width + x;
          if (x < halfWidth) mask[tile] = 0; // the mirror carves the other half
          reserved[tile] = 1;
        }
      }
    } else {
      // The island, and its mirror, painted in the biome's ground; the sea
      // stays what the board was filled with, and takes no object.
      const ground = biome?.base ?? TERRAIN_GRASS;
      for (let y = 0; y < ctx.height; y++) {
        for (let x = 0; x < halfWidth; x++) {
          if (!land[y * ctx.width + x]) continue;
          const here = tileCentre(x, y);
          const other = mirror(here);
          for (const tile of [y * ctx.width + x, Math.floor(other.y) * ctx.width + Math.floor(other.x)]) {
            island[tile] = 1;
            terrain[tile] = ground;
          }
        }
      }
      for (let tile = 0; tile < island.length; tile++) if (!island[tile]) reserved[tile] = 1;
    }
  }
  // Where a wood may stand: on land, and on an island back from the coast
  // by the script's spacing, so the trees never stand on the beach.
  const shoreSpacing = descriptor.woodShoreSpacing ?? 0;
  const onDryLand = (x: number, y: number): boolean => {
    if (descriptor.base !== 'water') return true;
    for (let dy = -shoreSpacing; dy <= shoreSpacing; dy++) {
      for (let dx = -shoreSpacing; dx <= shoreSpacing; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= ctx.width || ny >= ctx.height) return false;
        if (!island[ny * ctx.width + nx]) return false;
      }
    }
    return true;
  };

  // The avoid-start-areas field: `(radius - distance) * fade` per start,
  // capped at 101, rolled against random(100) -- so a wood thins out towards
  // a town center rather than stopping at a line.
  const avoid = descriptor.neutral?.avoid;
  const startField = new Uint8Array(ctx.width * ctx.height);
  if (avoid) {
    for (let y = 0; y < ctx.height; y++) {
      for (let x = 0; x < ctx.width; x++) {
        let modifier = 0;
        for (const s of starts) {
          const reach = Math.floor(avoid.radius - Math.hypot(x + 0.5 - s.x, y + 0.5 - s.y));
          if (reach > 0) modifier += reach * avoid.fade;
        }
        startField[y * ctx.width + x] = Math.min(101, modifier);
      }
    }
  }

  // The woods on a grass base, grown as masks so the shape is the original's
  // and placed as tree entities so the resource model is unchanged. The spawn
  // woods sit in the player band; the neutral wood is the middle of the map,
  // seeded over the scanning half and faded off the starts.
  const forest = descriptor.playerForest;
  if (forest) {
    const playerSeeds = pickSeeds(
      candidateOrder(ctx, start, forest.far), forest.groups, forest.groupSpacing,
      (x, y) => !tooClose(starts, x, y, forest.near) && freeBoth(x, y) && onDryLand(x, y));
    growClumps(ctx, mask, playerSeeds, forest.tiles * forest.groups,
      (x, y) => freeBoth(x, y) && onDryLand(x, y) && !tooClose(starts, x, y, forest.near));
  }

  const neutral = descriptor.neutral;
  const inHalf = (x: number, y: number): boolean =>
    x < halfWidth && freeBoth(x, y) && onDryLand(x, y)
    && startField[y * ctx.width + x] <= randInt(ctx.rng, 100);
  if (neutral) {
    const separation = Math.floor(2 * Math.sqrt(neutral.forest.tiles / neutral.forest.clumps));
    const neutralSeeds = pickSeeds(
      candidateOrderBox(ctx, 0, 0, halfWidth - 1, ctx.height - 1),
      neutral.forest.clumps, separation,
      (x, y) => !mask[y * ctx.width + x] && inHalf(x, y));
    growClumps(ctx, mask, neutralSeeds, neutral.forest.tiles, inHalf);
  }

  cleanMask(mask, ctx.width, ctx.height, (x, y) => freeBoth(x, y) && onDryLand(x, y));

  // Ponds, carved out of the woods before the trees go in. They decide play
  // -- a pond is ground nothing walks on and a wood with fewer trees -- so
  // they are mirrored like the wood, and they draw from their own stream
  // derived from the match seed rather than from the board's: a pond must
  // not move a sheep, and a stream of their own keeps every board dealt
  // before ponds existed dealing the same objects.
  if (descriptor.ponds && !descriptor.baked) {
    const pondStream = { seed: seedFrom(ctx.rng.seed ^ 0x90_4d) };
    const roll = randInt(pondStream, 100);
    let level = descriptor.ponds.levels[0];
    for (let at = 0, sum = 0; at < descriptor.ponds.levels.length; at++) {
      sum += descriptor.ponds.levels[at].chance;
      if (roll < sum) { level = descriptor.ponds.levels[at]; break; }
    }
    // `set_scale_by_size` / `set_scale_by_groups`: the script's numbers are
    // for a 100x100 board and scale with the area; and they are for the
    // whole map, so the scanning half grows half and the mirror does the rest.
    const scale = (ctx.width * ctx.height) / 10_000;
    const tiles = Math.round(level.tiles * scale / 2);
    const clumps = Math.max(tiles > 0 ? 1 : 0, Math.round(level.clumps * scale / 2));
    // `spacing_to_other_terrain_types 1`: a pond tile is a wood tile whose
    // every neighbour is wood, so the water never touches open ground and
    // the trees ring it.
    const deepInWood = (x: number, y: number): boolean => {
      if (x >= halfWidth || !mask[y * ctx.width + x]) return false;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= ctx.width || ny >= ctx.height) return false;
          if (!mask[ny * ctx.width + nx]) return false;
        }
      }
      return true;
    };
    const pondCtx: MapgenContext = { ...ctx, rng: pondStream };
    const water = new Uint8Array(ctx.width * ctx.height);
    if (tiles > 0) {
      const seeds = pickSeeds(
        candidateOrderBox(pondCtx, 0, 0, halfWidth - 1, ctx.height - 1), clumps,
        Math.floor(2 * Math.sqrt(tiles / clumps)), deepInWood);
      growClumps(pondCtx, water, seeds, tiles, deepInWood);
    }
    for (let tile = 0; tile < water.length; tile++) {
      if (!water[tile]) continue;
      mask[tile] = 0;
      reserved[tile] = 1;
      terrain[tile] = TERRAIN_WATER;
      const other = mirror(tileCentre(tile % ctx.width, Math.floor(tile / ctx.width)));
      const mirrored = Math.floor(other.y) * ctx.width + Math.floor(other.x);
      mask[mirrored] = 0;
      reserved[mirrored] = 1;
      terrain[mirrored] = TERRAIN_WATER;
    }
  }

  // The engine's beach: once the water is laid, every land tile with open
  // water among its eight neighbours becomes Beach -- the one tile of sand
  // between the sea and the grass on every reference map. It applies to a
  // survey board too: a river bank is a bank. Beach carries no trees and
  // takes no object, so a wood tile that became shore is struck from the
  // mask before anything is planted (a survey's trees are its own).
  beachify(terrain, ctx.width, ctx.height);
  for (let tile = 0; tile < terrain.length; tile++) {
    if (terrain[tile] !== TERRAIN_BEACH) continue;
    mask[tile] = 0;
    reserved[tile] = 1;
  }

  // Each mask tile is planted here and again at its mirror, so a tile that is
  // *itself* the mirror of another mask tile would take two trees on one
  // square. `cleanMask` mends pinholes without regard for which half it is in,
  // which is how a tile on the far side of the centre line got into the mask
  // at all; rather than constrain the mend and leave a pinhole at the seam,
  // the planting refuses to fill a square twice.
  const planted = new Set<number>();
  const plant = (at: Point): void => {
    const tile = Math.floor(at.y) * ctx.width + Math.floor(at.x);
    if (planted.has(tile)) return;
    planted.add(tile);
    ctx.place('tree', at);
  };
  for (let tile = 0; tile < mask.length; tile++) {
    if (!mask[tile]) continue;
    const here = tileCentre(tile % ctx.width, Math.floor(tile / ctx.width));
    plant(here);
    plant(mirror(here));
    terrain[tile] = biome?.forest ?? TERRAIN_FOREST;
    const other = mirror(here);
    terrain[Math.floor(other.y) * ctx.width + Math.floor(other.x)] = biome?.forest ?? TERRAIN_FOREST;
  }

  // The dressing goes on once the woods are down, so a pass that paints over
  // forest has forest to paint over.
  if (biome) paintBiome(ctx, terrain, biome, dressing);

  // Lone trees over the open ground, the classic thirty oaks at map scale. A
  // straggler keeps two clear tiles from every other tree: one tile of gap
  // beside a wood reads as a pinhole and walks like one, and the engine's
  // cleaner only mends terrain, never objects.
  const nearTree = (x: number, y: number): boolean => {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= ctx.width || ny >= ctx.height) continue;
        if (mask[ny * ctx.width + nx]) return true;
      }
    }
    return false;
  };
  let stragglers = 0;
  for (const tile of neutral ? candidateOrderBox(ctx, 0, 0, halfWidth - 1, ctx.height - 1) : []) {
    if (stragglers >= neutral!.stragglers) break;
    const x = tile % ctx.width;
    const y = Math.floor(tile / ctx.width);
    if (mask[tile] || nearTree(x, y) || !inHalf(x, y)) continue;
    mask[tile] = 1; // so the next straggler keeps its distance too
    const here = tileCentre(x, y);
    ctx.place('tree', here);
    ctx.place('tree', mirror(here));
    // Leaf litter under it. The script grows patches of STRAGGLER_FOREST and
    // drops the lone trees onto them; painting the tile a tree has just taken
    // reaches the same picture without the placement having to consult the
    // dressing, which would move the trees themselves. A third of them take
    // the variation, as the script's 24 tiles in 64 do -- and in two of the
    // four biomes that variation is terrain 71, which the DAT calls
    // "Underbrush, Leaves" (issue #34).
    if (biome) {
      const litter = randInt(dressing, 3) === 0
        ? biome.stragglerForestVariation : biome.stragglerForest;
      terrain[tile] = litter;
      const other = mirror(here);
      terrain[Math.floor(other.y) * ctx.width + Math.floor(other.x)] = litter;
    }
    stragglers++;
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

  return { terrain, elevation };
}

/**
 * Paint Beach on every land tile touching open water (eight neighbours),
 * in place. Shallows and beach itself are not land for this purpose and do
 * not become beach again; the sea keeps its own tiles.
 */
export function beachify(terrain: number[], width: number, height: number): void {
  const shore: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const here = terrain[y * width + x];
      if (OPEN_WATER.has(here) || here === TERRAIN_BEACH || here === 4 || here === 59) continue;
      let wet = false;
      for (let dy = -1; dy <= 1 && !wet; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          if (OPEN_WATER.has(terrain[ny * width + nx])) { wet = true; break; }
        }
      }
      if (wet) shore.push(y * width + x);
    }
  }
  for (const tile of shore) terrain[tile] = TERRAIN_BEACH;
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
