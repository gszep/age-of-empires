import { createHash } from 'node:crypto';
import { ARABIA_ADDED_TERRAINS, type GameRules } from '../sim/data';
import type { GameState } from '../sim/types';

const added = new Set(ARABIA_ADDED_TERRAINS);

/** The #118 import only extends these terrain rows. A pre-118 board cannot
 * observe those entries, but a general rules mismatch must remain fatal.
 * Reconstruct and hash the exact prior rules, including every civ profile;
 * never trust just a marker, version number, or selected field comparison. */
export function compatibleArabiaTerrainExtension(saved: { rulesHash?: string; state?: Partial<GameState> }, rules: GameRules): boolean {
  if (!saved.state || saved.state.mapgenVersion !== undefined || !Array.isArray(saved.state.terrain)
    || saved.state.terrain.some(id => added.has(id))) return false;
  const prior = structuredClone(rules);
  const strip = (profile: GameRules) => {
    for (const [row, ids] of Object.entries(profile.terrainRestrictions)) {
      profile.terrainRestrictions[Number(row)] = ids.filter(id => !added.has(id));
    }
    for (const civ of Object.values(profile.civilizations ?? {})) strip(civ);
  };
  strip(prior);
  return saved.rulesHash === createHash('sha256').update(JSON.stringify(prior)).digest('hex');
}
