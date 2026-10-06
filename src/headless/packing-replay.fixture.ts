import { FALLBACK_RULES, type GameRules } from '../sim/data';

/** Controlled public-command recording fixture, not a playable balance preset.
 * Only production/research access is shortened. Crucially the packing duration
 * comes from the supplied engine's rules, never a fixture override. */
export function packingReplayRules(base: GameRules = FALLBACK_RULES): GameRules {
  const rules = structuredClone(base);
  Object.assign(rules.units.trebuchet, { age: 0, trainedAt: 'town-center', trainSeconds: 0,
    cost: { food: 0, wood: 0, gold: 0, stone: 0 } });
  rules.units.trebuchet.unpacked!.unit = 'trebuchet-unpacked';
  rules.units.trebuchet.unpacked!.workRate = 4.5;
  rules.technologies.kataparuto = {
    techId: 59, name: 'Kataparuto', cost: { food: 0, wood: 0, gold: 0, stone: 0 },
    researchSeconds: 0, researchedAt: 'town-center', requiresAge: 0, button: 1,
    effects: [{ unit: 'trebuchet-unpacked', attribute: 'workRate', operation: 'multiply', amount: 4 }],
  };
  return rules;
}
