import type { GameRules } from '../data';

// Authored, narrowly48987-shaped regression fixtures, not alternative live
// content or full48987 balance. Source evidence: #324 generated-content diff,
// Effects.xs Function5/7, DAT tech83/effect291. Keep obsolete shared machinery
// covered without putting removed/excluded185872 features back into the game.
export function legacyBimaristan(base: GameRules): GameRules {
  const result = structuredClone(base), profile = result.civilizations!.saracens;
  profile.technologies.bimaristan = {
    techId: 28, name: 'Bimaristan', cost: { food: 0, wood: 300, gold: 200, stone: 0 },
    researchSeconds: 50, researchedAt: 'castle', requiresAge: 2,
    requiredTechs: [102], requiredTechCount: 1,
    effects: ['monk', 'monk-relic'].map(unit => ({ unit, attribute: 'healingAura', operation: 'set', amount: 1,
      healingAura: { range: 5, hitPointsPerSecond: 1.25, helpStringId: 13404,
        targetClasses: [0, 4, 6, 12, 18, 19, 23, 35, 36, 43, 44, 47, 49, 59] } })),
  };
  return result;
}

export function legacyChieftains(base: GameRules): GameRules {
  const result = structuredClone(base), profile = result.civilizations!.vikings;
  profile.technologies.chieftains.effects.push({ resource: 'infantryKillReward', operation: 'add', amount: 1 });
  for (const [unit, rule] of Object.entries(profile.units)) if (rule.datClass === 6) {
    profile.technologies.chieftains.effects.push({ unit, attribute: 'killReward', operation: 'set', amount: 1,
      killReward: { resource: 'infantryKillReward', targets: [
        { classId: 2, amount: 20 }, { classId: 43, amount: 20 }, { classId: 18, amount: 20 },
        { unitId: 1831, amount: 20 }, { classId: 4, amount: 5 },
      ] } });
  }
  return result;
}

export function legacyBeardedAxe(base: GameRules): GameRules {
  const result = structuredClone(base), profile = result.civilizations!.franks;
  profile.units['dat-unit-281'].range = 3;
  profile.units['dat-unit-531'].range = 4;
  profile.technologies['bearded-axe'] = {
    techId: 83, name: 'Bearded Axe', cost: { food: 300, wood: 0, gold: 300, stone: 0 },
    researchSeconds: 60, researchedAt: 'castle', requiresAge: 2,
    requiredTechs: [102], requiredTechCount: 1,
    effects: ['dat-unit-281', 'dat-unit-531'].map(unit => ({
      unit, attribute: 'range', operation: 'add', amount: 2,
    })),
  };
  return result;
}
