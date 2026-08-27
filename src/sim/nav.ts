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
import { isBuilding } from './data';
import type { Entity, GameState, PlayerId, Point } from './types';

/** A building's half-extents in tiles: square unless it says otherwise. */
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
 * Static obstructions: complete buildings, foundations, and resource nodes.
 *
 * `forOwner` builds the map one player walks on rather than the map everybody
 * shares: a gate is a hole in its owner's wall and a wall to everyone else, so
 * passability is per player and the grid has to be too.
 */
export function buildNavGrid(
  state: GameState, ignoreEntityId?: number, forOwner?: PlayerId,
): NavGrid {
  const grid: NavGrid = {
    width: state.width,
    height: state.height,
    blocked: new Uint8Array(state.width * state.height),
  };
  for (const entity of state.entities) {
    if (entity.dead || entity.id === ignoreEntityId) continue;
    if (!isBuilding(entity.kind) && entity.kind !== 'resource') continue;
    if (forOwner !== undefined && entity.owner === forOwner && entity.buildProgress === undefined
      && state.rules.buildings[entity.kind as keyof typeof state.rules.buildings]?.passableForOwner) {
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
export function findPath(grid: NavGrid, from: Point, to: Point): Point[] | undefined {
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
      // Perfectly stacked units break the tie along the x axis.
      const ux = d > 1e-9 ? dx / d : 1;
      const uy = d > 1e-9 ? dy / d : 0;
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
