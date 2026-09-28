import type { Cost, GameRules, TechRules } from './data';
import { rulesForPlayer } from './civilizations';
import type { Entity, GameState, PlayerId } from './types';

/** Automatic research-time bonuses preserve their own activation gates. */
export function researchSecondsFor(state: GameState, owner: PlayerId, key: string): number {
  const rules = rulesForPlayer(state, owner), tech = rules.technologies[key];
  let seconds = tech.researchSeconds;
  for (const completed of state.players[owner].researched) {
    for (const effect of technologyFor(rules, completed)?.effects ?? []) {
      if (effect.technologyId !== tech.techId || effect.attribute !== 'researchSeconds') continue;
      seconds = effect.operation === 'set' ? effect.amount : effect.operation === 'add'
        ? seconds + effect.amount : seconds * effect.amount;
    }
  }
  return Math.max(0, seconds);
}

/** Random-map Spies: paid at acceptance, including villagers inside carriers. */
export function researchCostFor(state: GameState, owner: PlayerId, key: string): Cost {
  const tech = rulesForPlayer(state, owner).technologies[key];
  if (!tech.effects.some(e => e.resource === 'spies')) return tech.cost;
  const count = (entities: Entity[]): number => entities.reduce((n, e) => e.dead ? n : n
    + (e.owner !== 0 && e.owner !== owner && e.kind === 'villager' ? 1 : 0) + count(e.garrison ?? []), 0);
  return { ...tech.cost, gold: tech.cost.gold * count(state.entities) };
}

/** Hidden nodes share the same ordered research history and effect consumers. */
export function technologyFor(rules: GameRules, key: string) {
  // Legacy imports lost these live relic-count prerequisites. Fail closed.
  if (/^automatic-(699|700|701|702)$/.test(key)) return undefined;
  return rules.technologies[key] ?? (key.startsWith('automatic-')
    ? rules.civilizationBonuses?.nodes[key.slice('automatic-'.length)] : undefined);
}

export function technologyRequirementsMet(
  state: GameState, owner: PlayerId, tech: Pick<TechRules, 'requires' | 'requiredTechs' | 'requiredTechCount'>,
): boolean {
  const player = state.players[owner];
  if (tech.requiredTechCount === undefined) {
    return (tech.requires ?? []).every(key => player.researched.includes(key));
  }
  const nodes = rulesForPlayer(state, owner).civilizationBonuses?.nodes ?? {};
  return (tech.requiredTechs ?? []).filter(id => {
    const node = nodes[id];
    return node && !node.disabled && (player.researched.includes(node.key)
      || (node.age !== undefined && player.age >= node.age));
  }).length >= tech.requiredTechCount;
}
