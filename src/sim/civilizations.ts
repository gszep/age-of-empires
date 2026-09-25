import type { GameRules } from './data';
import type { Entity, GameState, ReadonlyGameState } from './types';

/** Resolve a loaded civilisation, never a label pretending to be a ruleset.
 * The root remains the default civilisation and the shared Gaia/map rules.
 * Entries are complete rulesets, so missing values cannot leak from an enemy.
 */
export function civilizationRules(rules: GameRules, key: string): GameRules | undefined {
  if (key === rules.civilization.key) return rules;
  const entry = Object.hasOwn(rules.civilizations ?? {}, key) ? rules.civilizations?.[key] : undefined;
  return entry?.civilization.key === key && entry.civilization.enabled !== false ? entry : undefined;
}

export function rulesForPlayer(state: GameState, owner: Entity['owner']): GameRules;
export function rulesForPlayer(state: ReadonlyGameState, owner: Entity['owner']): ReadonlyGameState['rules'];
export function rulesForPlayer(state: GameState | ReadonlyGameState, owner: Entity['owner']): ReadonlyGameState['rules'] {
  if (owner === 0) return state.rules;
  const key = state.players[owner].civilization;
  const rules = civilizationRules(state.rules as GameRules, key);
  if (!rules) throw new Error(`civilisation ${key} is not loaded for player ${owner}`);
  return rules;
}
