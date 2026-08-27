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

/** What stands on a tile: nothing, somebody's building, or gaia's scenery. */
export const CLEAR = 0;
export const WALLED = 1;
export const SCENERY = 2;

export interface NavGrid {
  width: number;
  height: number;
  /** `CLEAR`, `WALLED` or `SCENERY` per tile. */
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
    const fill = entity.kind === 'resource' ? SCENERY : WALLED;
    const minX = Math.max(0, Math.floor(entity.position.x - half.x + 1e-6));
    const maxX = Math.min(grid.width - 1, Math.ceil(entity.position.x + half.x - 1e-6) - 1);
    const minY = Math.max(0, Math.floor(entity.position.y - half.y + 1e-6));
    const maxY = Math.min(grid.height - 1, Math.ceil(entity.position.y + half.y - 1e-6) - 1);
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const at = index(grid, x, y);
        // A wall over scenery is still a wall; scenery never softens one.
        if (fill === WALLED || grid.blocked[at] === CLEAR) grid.blocked[at] = fill;
      }
    }
  }
  return grid;
}

export const isBlocked = (grid: NavGrid, x: number, y: number): boolean =>
  x < 0 || y < 0 || x >= grid.width || y >= grid.height || grid.blocked[index(grid, x, y)] !== CLEAR;

/**
 * Whether a tile is blocked by something somebody built rather than by gaia's
 * trees and rocks. A unit that has ended up among scenery can squeeze back out
 * of it — AoE2 trees do not fill their tile the way a wall does — but a wall is
 * built to stop people and stops them.
 */
export const isWalled = (grid: NavGrid, x: number, y: number): boolean =>
  x < 0 || y < 0 || x >= grid.width || y >= grid.height || grid.blocked[index(grid, x, y)] === WALLED;

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

  // Small maps: an array-backed open list with linear extraction keeps the
  // implementation minimal and fully deterministic.
  const open: number[] = [startIndex];
  gScore[startIndex] = 0;
  // The best the search actually reached, in case the goal is walled off.
  let closest = startIndex;
  let closestH = heuristic(startIndex);

  while (open.length) {
    let bestPosition = 0;
    let bestF = Infinity;
    let bestH = Infinity;
    for (let i = 0; i < open.length; i++) {
      const node = open[i];
      const f = gScore[node] + heuristic(node);
      const h = heuristic(node);
      if (f < bestF - 1e-9 || (Math.abs(f - bestF) <= 1e-9 && (h < bestH - 1e-9 || (Math.abs(h - bestH) <= 1e-9 && node < open[bestPosition])))) {
        bestF = f;
        bestH = h;
        bestPosition = i;
      }
    }
    const current = open.splice(bestPosition, 1)[0];
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
          open.push(neighbor);
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
