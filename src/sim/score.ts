/** AoK manual p18 scoring, with DE localization 42300–42304 column names.
 * This is inferred, not calibrated against the native DE score table. */
import { isBuilding, isUnit, type Cost } from './data';
import { buildingRulesForEntity, unitRulesForEntity } from './rules';
import type { DeepReadonly, Entity, GameState, PlayerId, ReadonlyGameState } from './types';

export interface ScoreBreakdown {
  military: number;
  economy: number;
  technology: number;
  society: number;
  total: number;
}

export const resourceValue = (cost: DeepReadonly<Cost>): number => cost.food + cost.wood + cost.gold + cost.stone;

/** Replay setup only: pre-v4 records had no receipts/counters in their hashes. */
export function useLegacyScore(state: GameState): void {
  delete state.scoreVersion;
  const visit = (entities: Entity[]) => {
    for (const entity of entities) {
      delete entity.scorePaidCost; delete entity.scoreConverted;
      if (entity.garrison) visit(entity.garrison);
    }
  };
  visit(state.entities);
}

/** Paid prices survive discounts, upgrades and ownership changes. Starting and
 * legacy assets without a receipt use their current entity-local DAT price. */
export function assetScore(state: ReadonlyGameState, entity: DeepReadonly<Entity>): number {
  if (entity.owner === 0 || entity.dead || entity.buildProgress !== undefined) return 0;
  if (!isBuilding(entity.kind) && !isUnit(entity.kind)) return 0;
  const cost = entity.scorePaidCost ?? resourceValue(isBuilding(entity.kind)
    ? buildingRulesForEntity(state, entity).cost : unitRulesForEntity(state, entity).cost);
  return cost / 5;
}

export function calculateScore(state: ReadonlyGameState, player: PlayerId): ScoreBreakdown {
  const p = state.players[player];
  let economy = resourceValue(p) / 10;
  let society = 0;
  let military = p.scoreKilledValue ?? 0;
  const visit = (entities: readonly DeepReadonly<Entity>[]) => {
    for (const entity of entities) {
      if (entity.dead) continue;
      if (entity.owner === player) {
        const value = assetScore(state, entity);
        // The manual transfers conversion value once, not once as a military
        // award AND again as a new economic asset. Keep held captures here.
        if (entity.scoreConverted) military += value;
        else if (entity.kind === 'castle' || entity.kind === 'wonder') society += value;
        else economy += value;
      }
      if (entity.garrison) visit(entity.garrison);
    }
  };
  visit(state.entities);
  const explored = state.visibility[player].explored.reduce((sum, tile) => sum + tile, 0);
  const technology = (p.scoreSpentOnResearch ?? 0) / 5
    + (state.width * state.height > 0 ? explored * 1000 / (state.width * state.height) : 0);
  // Retain fractions internally; only the public total is displayed as an
  // integer. Native rounding remains uncalibrated (see ledger).
  return { military, economy, technology, society, total: Math.floor(military + economy + technology + society) };
}
