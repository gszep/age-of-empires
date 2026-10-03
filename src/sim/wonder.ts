import { TICKS_PER_SECOND } from './data';
import type { Entity, GameState, PlayerId, ReadonlyGameState } from './types';

/** Explicit small-map setting, not an invented automatic map-size table.
 * Native build185872 completion announced200years; localization9786 gives
 * 300years/25minutes. Matching-build and other map defaults remain#110. */
export const WONDER_YEARS = 200;
export const WONDER_YEAR_TICKS = 5 * TICKS_PER_SECOND;
export const WONDER_VICTORY_TICKS = WONDER_YEARS * WONDER_YEAR_TICKS;
export const validWonderVictory = (value: unknown): value is boolean | undefined => value === undefined || typeof value === 'boolean';

/** Completion is the trigger: an editor/preplaced standing Wonder is not one. */
export function completeWonder(state: GameState, entity: Entity): void {
  if (!state.wonderVictory || entity.kind !== 'wonder' || entity.owner === 0 || entity.dead || entity.hp <= 0) return;
  const timers = state.wonderCountdowns ??= [];
  if (!timers.some(timer => timer.entityId === entity.id)) {
    timers.push({ entityId: entity.id, owner: entity.owner, finishTick: state.tick + WONDER_VICTORY_TICKS });
  }
}

/** Public victory information, independent of ordinary entity visibility. */
export function wonderCountdowns(state: ReadonlyGameState) {
  return (state.wonderCountdowns ?? []).filter(timer => state.wonderVictory && state.entities.some(entity =>
    entity.id === timer.entityId && entity.owner === timer.owner && !entity.dead && entity.hp > 0 && entity.buildProgress === undefined));
}

/** Called after combat/death and conquest/royal checks. Destruction wins an
 * expiry-tick race; simultaneous opposing expiries draw. These tie policies
 * and ownership cancellation are explicit integration inferences. */
export function updateWonderVictory(state: GameState): void {
  if (!state.wonderCountdowns) return;
  state.wonderCountdowns = [...wonderCountdowns(state)];
  if (!state.wonderCountdowns.length) { delete state.wonderCountdowns; return; }
  if (state.winner || state.draw) return;
  const winners = new Set<PlayerId>(state.wonderCountdowns.filter(timer => timer.finishTick <= state.tick).map(timer => timer.owner));
  if (winners.size === 2) { state.draw = true; state.wonderDraw = true; }
  else if (winners.size === 1) state.winner = [...winners][0];
}
