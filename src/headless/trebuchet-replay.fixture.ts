import { FALLBACK_RULES, type GameRules } from '../sim/data';

/** Open-content replay fixture, not a balance preset: free instant TC training
 * and enlarged sight/search/deployed range expose the enemy TC without moving.
 * The engine still decides idle acquisition, setup and actual projectile damage.
 * No packing duration, attack, reload or projectile values are overridden. */
export function trebuchetReplayRules(base: GameRules = FALLBACK_RULES): GameRules {
  const rules = structuredClone(base);
  Object.assign(rules.units.trebuchet, { age: 0, trainedAt: 'town-center', trainSeconds: 0,
    cost: { food: 0, wood: 0, gold: 0, stone: 0 }, lineOfSight: 200, searchRadius: 200 });
  rules.units.trebuchet.unpacked!.range = 200;
  return rules;
}
