import type { PlayerId, ReadonlyGameState } from '../sim/types';
import type { PlayerObservation, TerrainRun } from './types';

/** Row runs keep large unexplored surveyed maps compact. Unknown terrain and
 * elevation both use -1; no hidden neighbour participates in the encoding.
 */
export function observedTerrain(state: ReadonlyGameState, player: PlayerId): TerrainRun[][] {
  const rows: TerrainRun[][] = [];
  const explored = state.visibility[player].explored;
  for (let y = 0; y < state.height; y++) {
    const row: TerrainRun[] = [];
    for (let x = 0; x < state.width; x++) {
      const index = y * state.width + x;
      const known = explored[index] && state.terrain[index] !== undefined;
      const terrain = known ? state.terrain[index] : -1;
      const height = known ? state.elevation?.[index] ?? 0 : -1;
      const previous = row[row.length - 1];
      if (previous && previous[1] === terrain && previous[2] === height) previous[0]++;
      else row.push([1, terrain, height]);
    }
    rows.push(row);
  }
  return rows;
}

export interface TerrainGrid { width: number; height: number; tiles: Int32Array; elevation: Float64Array }

export function decodeObservedTerrain(observation: Pick<PlayerObservation, 'mapWidth' | 'mapHeight' | 'terrain'>): TerrainGrid | undefined {
  const { mapWidth: width, mapHeight: height, terrain } = observation;
  if (!terrain || !Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || terrain.length !== height) return;
  const tiles = new Int32Array(width * height).fill(-1);
  const elevation = new Float64Array(width * height).fill(-1);
  for (let y = 0; y < height; y++) {
    let x = 0;
    for (const [length, tile, level] of terrain[y]) {
      if (!Number.isInteger(length) || length < 1 || x + length > width || !Number.isInteger(tile) || tile < -1 || !Number.isFinite(level)) return;
      tiles.fill(tile, y * width + x, y * width + x + length);
      elevation.fill(level, y * width + x, y * width + x + length);
      x += length;
    }
    if (x !== width) return;
  }
  return { width, height, tiles, elevation };
}
