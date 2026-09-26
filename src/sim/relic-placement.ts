import reference from './refdata/relic-placement.json';
import { buildNavGrid } from './nav';
import { random01, seedFrom } from './random';
import { addRelic } from './relics';
import type { GameState, Point } from './types';

export const boxDistance = (a: Point, b: Point) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const circularDistance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

interface Placement {
  count: number; minStart?: number; maxStart?: number; spacing?: number;
  forest?: number; cliff?: number; edge?: number; edgeScaled?: number;
  circular?: boolean; requirePath?: boolean; zoneDistance?: number;
  excludeNeutral?: boolean; landId?: number;
  closest?: boolean;
}

/** Analytic union of radius-three actor areas about the neutral marker's
 * circular candidate region. Placeholder sampling and actor rasterization are
 * inferred adapters, documented in the ledger; this is not an x-strip. */
export function inNeutralArea(p: Point, width: number, height: number): boolean {
  const r = reference.neutral.actorRadius;
  return Math.hypot(Math.max(0, Math.abs(p.x - width / 2) - r),
    Math.max(0, Math.abs(p.y - height / 2) - r)) <= width * reference.neutral.radiusFraction;
}

/** Source policies for the three RMS maps; authored survey fallback is explicit.
 * Cliffs are absent in the simulation: elevation is not a cliff entity. */
export function placeMapRelics(state: GameState, map: string, landIds: number[]): void {
  const homes = [1, 2].map(owner => state.entities.find(e => e.owner === owner && e.kind === 'town-center')!);
  // Never warm the live terrain cache with an intermediate initialization map.
  const grid = buildNavGrid({ ...state, terrain: state.terrain.slice() });
  const reachable = homes.map(home => {
    const seen = new Uint8Array(grid.blocked.length);
    const unit = state.entities.find(e => e.owner === home.owner && e.kind === 'villager')!;
    const start = Math.floor(unit.position.y) * state.width + Math.floor(unit.position.x);
    const queue = [start]; seen[start] = 1;
    for (let q = 0; q < queue.length; q++) {
      const index = queue[q], x = index % state.width, y = Math.floor(index / state.width);
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        const n = ny * state.width + nx;
        if (nx < 0 || nx >= state.width || ny < 0 || ny >= state.height || seen[n] || grid.blocked[n]) continue;
        seen[n] = 1; queue.push(n);
      }
    }
    return seen;
  });
  const forest = new Uint8Array(landIds.length);
  for (const e of state.entities) if (e.node === 'tree') forest[Math.floor(e.position.y) * state.width + Math.floor(e.position.x)] = 1;
  const rng = { seed: seedFrom(state.matchSeed ^ 285) };
  const candidates: { point: Point; roll: number; index: number }[] = [];
  for (let y = 0; y < state.height; y++) for (let x = 0; x < state.width; x++) {
    const index = y * state.width + x;
    if (!grid.blocked[index]) candidates.push({ point: { x: x + 0.5, y: y + 0.5 }, roll: random01(rng), index });
  }
  const placed: Point[] = [];
  let central: Point | undefined;
  const place = (spec: Placement, owner?: number, neutral = false) => {
    const metric = spec.circular ? circularDistance : boxDistance;
    const edge = spec.edge ?? (spec.edgeScaled ?? 0) * state.width / 100;
    const valid = candidates.filter(c => {
      const p = c.point, x = Math.floor(p.x), y = Math.floor(p.y);
      if (Math.min(p.x, p.y, state.width - p.x, state.height - p.y) < edge) return false;
      if (homes.some(h => metric(p, h.position) < (spec.minStart ?? 0))) return false;
      if (owner !== undefined && spec.maxStart !== undefined && metric(p, homes[owner].position) > spec.maxStart) return false;
      if (spec.landId !== undefined && landIds[c.index] !== spec.landId) return false;
      if (neutral && !inNeutralArea(p, state.width, state.height)) return false;
      if (spec.excludeNeutral && inNeutralArea(p, state.width, state.height)) return false;
      if (owner !== undefined) {
        if (spec.requirePath && !reachable[owner][c.index]) return false;
        if ((map === 'islands' || map === 'black-forest') && landIds[c.index] !== owner + 1) return false;
      }
      const radius = Math.max(spec.forest ?? 0, spec.zoneDistance ?? 0);
      for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= state.width || ny >= state.height) return false;
        const index = ny * state.width + nx;
        if (Math.max(Math.abs(dx), Math.abs(dy)) <= (spec.forest ?? 0) && forest[index]) return false;
        if (spec.zoneDistance && Math.max(Math.abs(dx), Math.abs(dy)) <= spec.zoneDistance
          && landIds[index] !== landIds[c.index]) return false;
      }
      if (central && !neutral && boxDistance(p, central) < reference.arabia.central.spacerRadius + reference.arabia.central.actorRadius) return false;
      return true;
    });
    valid.sort((a, b) => owner === undefined || !spec.closest ? a.roll - b.roll
      : metric(a.point, homes[owner].position) - metric(b.point, homes[owner].position) || a.roll - b.roll);
    let left = spec.count;
    for (const c of valid) {
      if (!left) break;
      if (placed.some(p => boxDistance(p, c.point) < Math.max(1, spec.spacing ?? 1))) continue;
      placed.push(c.point); addRelic(state, c.point); left--;
      if (neutral) central = c.point;
    }
    if (left) throw new Error(`${map}: cannot place ${left}/${spec.count} relics for ${neutral ? 'central' : owner ?? 'neutral'} without weakening RMS constraints`);
  };
  if (map === 'arabia') {
    place(reference.arabia.central, undefined, true);
    for (let owner = 0; owner < homes.length; owner++) place(reference.arabia.player, owner);
  } else if (map === 'black-forest') {
    for (let owner = 0; owner < homes.length; owner++) place(reference['black-forest'].player, owner);
  } else if (map === 'islands') {
    for (let owner = 0; owner < homes.length; owner++) place(reference.islands.player, owner);
    place(reference.islands.extra);
  } else {
    // Authored maps have no matching DE RMS. Deliberately authored policy:
    // five accessible relics, no claimed native distance/zone constraints.
    const accessible = candidates.filter(c => reachable.some(r => r[c.index]));
    accessible.sort((a, b) => a.roll - b.roll);
    for (const c of accessible.slice(0, 5)) addRelic(state, c.point);
  }
}
