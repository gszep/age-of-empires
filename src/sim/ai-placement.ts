/** Observation-only placement screening. The public command is still final:
 * remembered blockers may be stale and imported profiles can differ from the
 * public default metadata this example strategy knows (as with its prices).
 */
import { BUILDING_RESTRICTION, FALLBACK_RULES, isBuilding, terrainAllows } from './data';
import { elevationAllowsPlacement } from './elevation';
import { decodeObservedTerrain } from '../protocol/terrain';
import type { PlayerObservation } from '../protocol/types';
import type { BuildingKind, Point } from './types';

export function observedBuildingSites(observation: PlayerObservation) {
  const grid = decodeObservedTerrain(observation);
  const obstacles = [...observation.entities, ...observation.memory]
    .filter(e => isBuilding(e.kind) || e.kind === 'resource');
  return (kind: BuildingKind, at: Point): boolean => {
    if (!grid) return false;
    const rule = FALLBACK_RULES.buildings[kind];
    const half = rule.footprint ?? { x: rule.radius, y: rule.radius };
    if (at.x - half.x < 0 || at.y - half.y < 0
      || at.x + half.x > grid.width || at.y + half.y > grid.height) return false;
    const minX = Math.floor(at.x - half.x + 1e-6), maxX = Math.ceil(at.x + half.x - 1e-6) - 1;
    const minY = Math.floor(at.y - half.y + 1e-6), maxY = Math.ceil(at.y + half.y - 1e-6) - 1;
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const tile = grid.tiles[y * grid.width + x];
      // Unknown terrain/elevation is not flat, empty ground.
      if (tile < 0 || !terrainAllows(FALLBACK_RULES, rule.terrainRestriction ?? BUILDING_RESTRICTION, tile)) return false;
    }
    if (!elevationAllowsPlacement(grid, at, half, rule.hillMode ?? 0)) return false;
    return obstacles.every(e => {
      const building = isBuilding(e.kind) ? FALLBACK_RULES.buildings[e.kind] : undefined;
      const radius = building?.radius ?? (e.node ? FALLBACK_RULES.nodes[e.node]?.radius : undefined) ?? .5;
      // Unknown node identity reserves a whole tile, as the existing AI does.
      const size = building?.footprint ?? { x: radius, y: radius };
      return Math.abs(at.x - e.x) >= half.x + size.x || Math.abs(at.y - e.y) >= half.y + size.y;
    });
  };
}
