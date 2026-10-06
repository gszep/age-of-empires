import { createGame, useLegacyTrebuchetTargeting } from './game';
import { FALLBACK_RULES, type GameRules } from './data';
import { useLegacyScore } from './score';
import { useLegacyPacking } from './packing';
import { useLegacySiphons } from './fire-charge';
import type { MatchRecord } from '../protocol/types';

/** Shared browser/headless replay initialization, after boundary validation.
 * Never use this for saved states: their absent markers already select legacy
 * behavior and their embedded rules/timers must not be rewritten. */
export function createReplayGame(record: Pick<MatchRecord, 'version' | 'seed' | 'civilizations'
  | 'map' | 'mode' | 'populationLimit' | 'wonderVictory'>, rules: GameRules = FALLBACK_RULES) {
  const state = createGame(record.seed, rules, record.civilizations, record.map ?? 'arabia',
    record.mode, record.populationLimit, record.wonderVictory, record.version >= 9 ? 2 : record.version >= 5 ? 1 : 0);
  if (record.version < 3) delete state.researchQueueVersion;
  if (record.version < 4) useLegacyScore(state);
  if (record.version < 6) useLegacyPacking(state);
  if (record.version < 7) useLegacySiphons(state);
  if (record.version < 8) useLegacyTrebuchetTargeting(state);
  return state;
}
