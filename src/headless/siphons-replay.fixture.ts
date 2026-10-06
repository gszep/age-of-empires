import { FALLBACK_RULES, type GameRules } from '../sim/data';

/** Open-content replay fixture, not a balance preset: a free charged Fire
 * Galley trains on land at the TC and can see/reach the enemy TC without a
 * navigation fixture. Charge/projectile values are the inspected Siphons DAT
 * tuple; the engine under test still decides eligibility and expenditure. */
export function siphonsReplayRules(base: GameRules = FALLBACK_RULES): GameRules {
  const rules = structuredClone(base);
  Object.assign(rules.units['fire-galley'], { age: 0, trainedAt: 'town-center', trainSeconds: 0,
    cost: { food: 0, wood: 0, gold: 0, stone: 0 }, terrainRestriction: 7,
    lineOfSight: 200, range: 200, searchRadius: 0 });
  rules.units['fire-galley'].fireCharge = {
    maximum: 1, type: 6, rechargePerSecond: .04, event: 0, target: 64,
    projectile: { id: 2629, speed: 3, attacks: [
      { class: 11, amount: 1 }, { class: 16, amount: 0 }, { class: 2, amount: 0 },
      { class: 4, amount: 2 }, { class: 60, amount: 1 },
    ], radius: .5, level: 2, impactEffect: 'impact_grenade', impactSeconds: 1.5 },
  };
  return rules;
}
