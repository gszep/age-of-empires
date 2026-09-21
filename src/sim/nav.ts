/**
 * Deterministic grid navigation for the AoE slice.
 *
 * A tile-grid obstruction map plus 8-connected A* with strict tie-breaking,
 * following the algorithmic approach of OpenRA/0 A.D. grid pathfinders
 * (referenced, not copied). Evaluated alternative: recast-navigation-js; its
 * navmesh/crowd model is built for free-space 3D movement and does not
 * reproduce AoE tile/clearance behavior deterministically, so the smallest
 * grid search is implemented instead (see docs/library-strategy.md).
 */
import { groundAllows, isBuilding, LAND_RESTRICTION } from './data';
import type { Entity, GameState, PlayerId, Point } from './types';

/** A building's half-extents in tiles: square unless it says otherwise. */
/** Euclidean distance between two points, in tiles. */
export const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

export const halfExtent = (entity: Entity): { x: number; y: number } =>
  entity.footprint ?? { x: entity.radius, y: entity.radius };

export interface NavGrid {
  width: number;
  height: number;
  /** 1 where something stands, 0 where a unit may walk. */
  blocked: Uint8Array;
}

const index = (grid: NavGrid, x: number, y: number) => y * grid.width + x;
export const tileOf = (p: Point) => ({ x: Math.floor(p.x), y: Math.floor(p.y) });

/**
 * Static obstructions: the ground itself, then complete buildings,
 * foundations, and resource nodes.
 *
 * `forOwner` builds the map one player walks on rather than the map everybody
 * shares: a gate is a hole in its owner's wall and a wall to everyone else, so
 * passability is per player and the grid has to be too. `restriction` is the
 * DAT row the walker obeys -- which terrains it may stand on -- so a pond is
 * a wall to a villager on row 7 and, one day, a road to a ship on row 3.
 */
export function buildNavGrid(
  state: GameState, ignoreEntityId?: number, forOwner?: PlayerId,
  restriction: number = LAND_RESTRICTION,
): NavGrid {
  return entityGrid(state, ignoreEntityId, forOwner, terrainLayer(state, restriction));
}

/**
 * The ground a restriction row may not stand on, 1 per refused tile. The
 * terrain is fixed for the match, so each row's layer is computed once per
 * board and kept against the board's own array; building it per tick for
 * every row in play doubled the tick.
 */
const terrainLayers = new WeakMap<number[], Map<number, Uint8Array>>();
export function terrainLayer(state: GameState, restriction: number): Uint8Array {
  const terrain = state.terrain;
  let rows = terrainLayers.get(terrain);
  if (!rows) {
    rows = new Map();
    terrainLayers.set(terrain, rows);
  }
  let layer = rows.get(restriction);
  if (layer) return layer;
  // Rows that agree over this board's terrains share one layer object -- the
  // scout's row 28 and the villager's row 7 differ only on shores no board
  // paints -- so a caller keying on the layer sees one map, not three.
  const allowed = state.rules.terrainRestrictions[restriction];
  for (const [other, built] of rows) {
    const otherAllowed = state.rules.terrainRestrictions[other];
    const same = allowed === otherAllowed
      || (allowed !== undefined && otherAllowed !== undefined
        && allowed.length === otherAllowed.length && allowed.every(id => otherAllowed.includes(id)));
    if (same) {
      rows.set(restriction, built);
      return built;
    }
  }
  layer = new Uint8Array(state.width * state.height);
  // A board dealt before the grid existed has no terrain and is all land.
  if (terrain.length === layer.length) {
    // Terrain ids repeat across thousands of tiles, so the row is asked once
    // per id rather than once per tile.
    const refused = new Map<number, boolean>();
    for (let tile = 0; tile < terrain.length; tile++) {
      const id = terrain[tile];
      let blocked = refused.get(id);
      if (blocked === undefined) {
        blocked = !groundAllows(state.rules, restriction, id);
        refused.set(id, blocked);
      }
      if (blocked) layer[tile] = 1;
    }
  }
  rows.set(restriction, layer);
  return layer;
}

/**
 * The obstructions entities make, for one walker, scanned onto `base` -- a
 * terrain layer, or nothing for a board that is all land. Starting from a
 * copy of the layer is a memcpy; laying it over afterwards was a pass over
 * the board that cost a twentieth of the tick.
 */
export function entityGrid(
  state: GameState, ignoreEntityId?: number, forOwner?: PlayerId, base?: Uint8Array,
): NavGrid {
  const grid: NavGrid = {
    width: state.width,
    height: state.height,
    blocked: base ? new Uint8Array(base) : new Uint8Array(state.width * state.height),
  };
  for (const entity of state.entities) {
    if (entity.dead || entity.id === ignoreEntityId) continue;
    if (!isBuilding(entity.kind) && entity.kind !== 'resource') continue;
    const building = state.rules.buildings[entity.kind as keyof typeof state.rules.buildings];
    // A farm is a building nothing walks round, for either side and whether or
    // not it is finished — the DAT gives it no collision height and no
    // obstruction class (issue #40).
    if (building?.passable) continue;
    if (forOwner !== undefined && entity.owner === forOwner && entity.buildProgress === undefined
      && building?.passableForOwner) {
      continue;
    }
    const half = halfExtent(entity);
    const minX = Math.max(0, Math.floor(entity.position.x - half.x + 1e-6));
    const maxX = Math.min(grid.width - 1, Math.ceil(entity.position.x + half.x - 1e-6) - 1);
    const minY = Math.max(0, Math.floor(entity.position.y - half.y + 1e-6));
    const maxY = Math.min(grid.height - 1, Math.ceil(entity.position.y + half.y - 1e-6) - 1);
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) grid.blocked[index(grid, x, y)] = 1;
    }
  }
  return grid;
}

export const isBlocked = (grid: NavGrid, x: number, y: number): boolean =>
  x < 0 || y < 0 || x >= grid.width || y >= grid.height || grid.blocked[index(grid, x, y)] === 1;

/** Nearest free tile to a target, by ring search with deterministic ordering. */
export function nearestFreeTile(grid: NavGrid, target: Point): { x: number; y: number } | undefined {
  const start = tileOf(target);
  if (!isBlocked(grid, start.x, start.y)) return start;
  for (let radius = 1; radius <= Math.max(grid.width, grid.height); radius++) {
    let best: { x: number; y: number } | undefined;
    let bestDistance = Infinity;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const x = start.x + dx;
        const y = start.y + dy;
        if (isBlocked(grid, x, y)) continue;
        const d = (x + 0.5 - target.x) ** 2 + (y + 0.5 - target.y) ** 2;
        if (d < bestDistance) { bestDistance = d; best = { x, y }; }
      }
    }
    if (best) return best;
  }
  return undefined;
}

const SQRT2 = Math.SQRT2;

/**
 * Minimum-first binary heap of (tile, f, h), ordered by f then h then tile.
 * The tile index makes the order total, so the minimum is unique and the pop
 * sequence is fixed — which is what a deterministic simulation needs from its
 * pathfinder, and what a heap keyed on f alone would not give.
 */
class Heap {
  private nodes: number[] = [];
  private f: number[] = [];
  private h: number[] = [];

  get size(): number { return this.nodes.length; }

  private before(a: number, b: number): boolean {
    if (this.f[a] < this.f[b] - 1e-9) return true;
    if (this.f[a] > this.f[b] + 1e-9) return false;
    if (this.h[a] < this.h[b] - 1e-9) return true;
    if (this.h[a] > this.h[b] + 1e-9) return false;
    return this.nodes[a] < this.nodes[b];
  }

  private swap(a: number, b: number): void {
    [this.nodes[a], this.nodes[b]] = [this.nodes[b], this.nodes[a]];
    [this.f[a], this.f[b]] = [this.f[b], this.f[a]];
    [this.h[a], this.h[b]] = [this.h[b], this.h[a]];
  }

  push(node: number, f: number, h: number): void {
    this.nodes.push(node);
    this.f.push(f);
    this.h.push(h);
    for (let at = this.nodes.length - 1; at > 0;) {
      const parent = (at - 1) >> 1;
      if (!this.before(at, parent)) break;
      this.swap(at, parent);
      at = parent;
    }
  }

  pop(): number {
    const top = this.nodes[0];
    const last = this.nodes.length - 1;
    this.swap(0, last);
    this.nodes.pop();
    this.f.pop();
    this.h.pop();
    for (let at = 0;;) {
      const left = at * 2 + 1;
      if (left >= this.nodes.length) break;
      const right = left + 1;
      const child = right < this.nodes.length && this.before(right, left) ? right : left;
      if (!this.before(child, at)) break;
      this.swap(at, child);
      at = child;
    }
    return top;
  }
}

/**
 * 8-connected A* from a start tile to a goal tile. Diagonal moves may not cut
 * blocked corners. Ties break on f, then h, then tile index, so equal-cost
 * paths are stable across runs and platforms.
 *
 * A goal that cannot be reached — a market sealed in by trees, a villager that
 * hunted its way into a wood line — returns the path to the reachable tile
 * closest to it rather than nothing. Returning nothing made the caller report
 * "arrived", and a unit that believes it has arrived somewhere it never left
 * walks on the spot for the rest of the match.
 */
/**
 * Paths already found against *this* grid, which lives for exactly one tick.
 * A group ordered to one point asks the same question once per unit, and the
 * answer is the same whenever both ends reduce to the same tiles -- the search
 * is over tiles and nothing else.
 *
 * Only used when both the start tile and the goal tile are free. When either
 * is blocked, `nearestFreeTile` breaks its ties on the *fractional* position,
 * so two units in one tile can legitimately get different answers, and the
 * cache would be wrong rather than slow. A `WeakMap` on the grid means the
 * entries go when the tick's grid does, with nothing to invalidate.
 */
const pathCache = new WeakMap<NavGrid, Map<string, Point[] | undefined>>();

/** Its own copy, because the caller shifts waypoints off the front as it walks. */
const copyPath = (path: Point[] | undefined) => path?.map(point => ({ ...point }));

export function findPath(grid: NavGrid, from: Point, to: Point): Point[] | undefined {
  const startTile = tileOf(from);
  const goalTile = tileOf(to);
  const cacheable = !isBlocked(grid, startTile.x, startTile.y)
    && !isBlocked(grid, goalTile.x, goalTile.y);
  if (!cacheable) return searchPath(grid, from, to);
  let cache = pathCache.get(grid);
  if (!cache) { cache = new Map(); pathCache.set(grid, cache); }
  const key = `${startTile.x},${startTile.y}|${goalTile.x},${goalTile.y}`;
  if (cache.has(key)) return copyPath(cache.get(key));
  const path = searchPath(grid, from, to);
  cache.set(key, path);
  return copyPath(path);
}

function searchPath(grid: NavGrid, from: Point, to: Point): Point[] | undefined {
  const startTile = tileOf(from);
  const goal = nearestFreeTile(grid, to);
  if (!goal) return undefined;
  if (isBlocked(grid, startTile.x, startTile.y)) {
    const freeStart = nearestFreeTile(grid, from);
    if (!freeStart) return undefined;
    startTile.x = freeStart.x;
    startTile.y = freeStart.y;
  }
  const size = grid.width * grid.height;
  const gScore = new Float64Array(size).fill(Infinity);
  const parent = new Int32Array(size).fill(-1);
  const closed = new Uint8Array(size);
  const startIndex = index(grid, startTile.x, startTile.y);
  const goalIndex = index(grid, goal.x, goal.y);

  const heuristic = (i: number) => {
    const dx = Math.abs((i % grid.width) - goal.x);
    const dy = Math.abs(Math.floor(i / grid.width) - goal.y);
    return Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy);
  };

  // The open list is a binary heap ordered by the same total order the search
  // has always used: f, then h, then tile index. No two entries compare equal
  // unless they are the same tile, so the node it pops is exactly the one a
  // linear scan of the whole list would have found — which is what this used
  // to do, and what made the search quadratic in the size of its own frontier.
  // On a 32x18 board nobody could tell; on 120x120 one villager looking for a
  // way into a wood could cost a whole tick.
  const open = new Heap();
  gScore[startIndex] = 0;
  open.push(startIndex, heuristic(startIndex), heuristic(startIndex));
  // The best the search actually reached, in case the goal is walled off.
  let closest = startIndex;
  let closestH = heuristic(startIndex);

  while (open.size) {
    const current = open.pop();
    if (current === goalIndex) break;
    if (closed[current]) continue;
    closed[current] = 1;
    const currentH = heuristic(current);
    if (currentH < closestH - 1e-9 || (Math.abs(currentH - closestH) <= 1e-9 && current < closest)) {
      closest = current;
      closestH = currentH;
    }
    const cx = current % grid.width;
    const cy = Math.floor(current / grid.width);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (isBlocked(grid, nx, ny)) continue;
        // No corner cutting through blocked orthogonal neighbors.
        if (dx !== 0 && dy !== 0 && (isBlocked(grid, cx + dx, cy) || isBlocked(grid, cx, cy + dy))) continue;
        const neighbor = index(grid, nx, ny);
        if (closed[neighbor]) continue;
        const cost = gScore[current] + (dx !== 0 && dy !== 0 ? SQRT2 : 1);
        if (cost < gScore[neighbor] - 1e-9) {
          gScore[neighbor] = cost;
          parent[neighbor] = current;
          const h = heuristic(neighbor);
          open.push(neighbor, cost + h, h);
        }
      }
    }
  }

  const reached = parent[goalIndex] !== -1 || goalIndex === startIndex ? goalIndex : closest;
  if (reached === startIndex) return undefined;
  const tiles: number[] = [];
  for (let node = reached; node !== -1; node = parent[node]) tiles.push(node);
  tiles.reverse();
  const waypoints = tiles.map(node => ({
    x: (node % grid.width) + 0.5,
    y: Math.floor(node / grid.width) + 0.5,
  }));
  // Walk from the exact current position; drop the start-tile center.
  if (waypoints.length > 1) waypoints.shift();
  return waypoints;
}

const isTraveling = (entity: Entity): boolean =>
  entity.activity === 'moving' || entity.activity === 'carrying';

/**
 * A unit that has reached its target and started swinging holds its ground.
 * Nudging it outward crosses the attack range margin, which discards the swing
 * in progress, so a tight group would trade hits for shoving.
 */
const isEngaged = (entity: Entity): boolean => entity.activity === 'attacking';

/**
 * Deterministic pairwise separation so stationary units do not stack.
 * Traveling units pass through others (AoE2 lets crossing groups overlap in
 * motion); they spread out once they stop.
 */
export function separateUnits(state: GameState, movable: Entity[], grid: NavGrid): void {
  for (let i = 0; i < movable.length; i++) {
    for (let j = i + 1; j < movable.length; j++) {
      const a = movable[i];
      const b = movable[j];
      if (isTraveling(a) || isTraveling(b)) continue;
      if (isEngaged(a) || isEngaged(b)) continue;
      const dx = b.position.x - a.position.x;
      const dy = b.position.y - a.position.y;
      const minDistance = a.radius + b.radius;
      const d = Math.hypot(dx, dy);
      if (d >= minDistance) continue;
      const push = (minDistance - d) / 2;
      // A shared destination makes positions exactly equal. An axis-only
      // tie-break traps every later arrival in the same line (#83). Give the
      // collision normal a tiny, stable two-dimensional perturbation instead;
      // it consumes no simulation RNG and never changes the contact distance.
      // Golden-angle phases avoid a short repeating sequence of directions.
      const phaseA = a.id * 2.399963229728653;
      const phaseB = b.id * 2.399963229728653;
      const nx = dx + (Math.cos(phaseB) - Math.cos(phaseA)) * 1e-6;
      const ny = dy + (Math.sin(phaseB) - Math.sin(phaseA)) * 1e-6;
      const normalLength = Math.hypot(nx, ny);
      const ux = nx / normalLength;
      const uy = ny / normalLength;
      tryNudge(grid, a, -ux * push, -uy * push, state);
      tryNudge(grid, b, ux * push, uy * push, state);
    }
  }
}

function tryNudge(grid: NavGrid, entity: Entity, dx: number, dy: number, state: GameState): void {
  const x = Math.min(state.width - 0.2, Math.max(0.2, entity.position.x + dx));
  const y = Math.min(state.height - 0.2, Math.max(0.2, entity.position.y + dy));
  if (!isBlocked(grid, Math.floor(x), Math.floor(y))) {
    entity.position.x = x;
    entity.position.y = y;
  }
}
