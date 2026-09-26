import { buildNavGrid } from './nav';
import { random01, seedFrom } from './random';
import { addRelic } from './relics';
import type { GameState, Point } from './types';

const boxDistance = (a: Point, b: Point) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

/** Tiny Arabia's balanced RMS branch: one central and two per player.
 * Zone approximation is documented in the ledger, not claimed as exact RMS. */
export function placeArabiaRelics(state: GameState): void {
  const homes = [1, 2].map(owner => state.entities.find(e => e.owner === owner && e.kind === 'town-center')!);
  // Placement is an initialization query, before callers finish their map
  // setup. Do not seed the live terrain-layer cache with this intermediate map.
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
  const rng = { seed: seedFrom(state.matchSeed ^ 285) };
  const candidates: { point: Point; roll: number }[] = [];
  for (let y = 8; y < state.height - 8; y++) for (let x = 8; x < state.width - 8; x++) {
    const index = y * state.width + x;
    if (!reachable.every(r => r[index]) || grid.blocked[index]) continue;
    if ([-1, 1, -state.width, state.width].some(d => grid.blocked[index + d])) continue;
    const point = { x: x + 0.5, y: y + 0.5 };
    if (homes.every(h => boxDistance(point, h.position) >= 32)) candidates.push({ point, roll: random01(rng) });
  }
  const placed: Point[] = [];
  for (const owner of [-1, 0, 1, 0, 1]) {
    const valid = candidates.filter(c => placed.every(p => boxDistance(p, c.point) >= 24)
      && (owner < 0 ? Math.abs(c.point.x - state.width / 2) <= 8
        : boxDistance(c.point, homes[owner].position) <= boxDistance(c.point, homes[1 - owner].position)));
    valid.sort((a, b) => owner < 0 ? a.roll - b.roll
      : boxDistance(a.point, homes[owner].position) - boxDistance(b.point, homes[owner].position) || a.roll - b.roll);
    if (valid[0]) { placed.push(valid[0].point); addRelic(state, valid[0].point); }
  }
}
