import type { GameRules, TechRules } from './data';
import { rulesForPlayer } from './civilizations';
import type { GameState, PlayerId } from './types';

/** Hidden nodes share the same ordered research history and effect consumers. */
export function technologyFor(rules: GameRules, key: string) {
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
