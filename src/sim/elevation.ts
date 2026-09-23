import type { GameState, Point, ReadonlyGameState } from './types';

/** Authoritative tile-centre level, shared by combat and the view. Old flat
 * snapshots may have no samples. Survey levels retain their fractional part. */
export function elevationAt(
  state: Pick<ReadonlyGameState, 'width' | 'height' | 'elevation'>, x: number, y: number,
): number {
  const tx = Math.max(0, Math.min(state.width - 1, Math.floor(x)));
  const ty = Math.max(0, Math.min(state.height - 1, Math.floor(y)));
  return state.elevation?.[ty * state.width + tx] ?? 0;
}

/** Fixed advantage, not proportional to hill height. Base multipliers are
 * community-documented engine behavior, not DAT resources (ledger #134). */
export function elevationDamageMultiplier(source: number, target: number): number {
  return source > target ? 1.25 : source < target ? 0.75 : 1;
}

/** Same half-open tile footprint used by terrain/obstruction placement. */
function bounds(at: Point, half: Point) {
  return {
    minX: Math.floor(at.x - half.x + 1e-6), maxX: Math.ceil(at.x + half.x - 1e-6) - 1,
    minY: Math.floor(at.y - half.y + 1e-6), maxY: Math.ceil(at.y + half.y - 1e-6) - 1,
  };
}

/** DAT chooses the mode; interpreting its relief limit over tile-centre
 * levels is documented in the ledger rather than claimed as DE slope geometry. */
export function elevationAllowsPlacement(
  state: ReadonlyGameState, at: Point, half: Point, hillMode: number,
): boolean {
  if (hillMode === 0) return true;
  const box = bounds(at, half);
  let low = Infinity, high = -Infinity;
  const allowance = hillMode === 3 ? 1 : 0;
  for (let y = box.minY; y <= box.maxY; y++) for (let x = box.minX; x <= box.maxX; x++) {
    const level = elevationAt(state, x, y);
    low = Math.min(low, level);
    high = Math.max(high, level);
    if (high - low > allowance) return false;
  }
  return true;
}

/** Match-generation-only playability adjustment. Preserve the centre's
 * authored level and touch only the starting TC footprint, never the source
 * survey arrays. Later construction must find legal ground rather than alter it. */
export function levelStartingFootprint(state: GameState, at: Point, half: Point): void {
  const box = bounds(at, half);
  const level = elevationAt(state, at.x, at.y);
  for (let y = Math.max(0, box.minY); y <= Math.min(state.height - 1, box.maxY); y++) {
    for (let x = Math.max(0, box.minX); x <= Math.min(state.width - 1, box.maxX); x++) {
      state.elevation[y * state.width + x] = level;
    }
  }
}
