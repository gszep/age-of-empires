/**
 * What a player's research does to the base rules. These lived in game.ts
 * until visibility needed them too (issue #29: Town Watch changed the rules
 * table and nothing that computes sight ever read it); game.ts imports
 * visibility, so they moved here to keep the import graph acyclic.
 */
import type { BuildingRules, TechEffect, UnitRules } from './data';
import type { BuildingKind, Entity, GameState, PlayerId, UnitKind } from './types';

/** Apply one number to one attribute, in the way the DAT's command says. */
export function combine(operation: TechEffect['operation'], current: number, amount: number): number {
  if (operation === 'set') return amount;
  if (operation === 'multiply') return current * amount;
  return current + amount;
}

/** What a player has researched, applied to one unit kind's rules. */
export function unitRulesFor(state: GameState, owner: Entity['owner'], kind: UnitKind): UnitRules {
  const base = state.rules.units[kind];
  if (owner === 0) return base;
  const researched = state.players[owner as PlayerId].researched;
  if (!researched.length) return base;
  let rules = base;
  for (const key of researched) {
    for (const effect of state.rules.technologies[key]?.effects ?? []) {
      if (effect.unit !== kind) continue;
      if (rules === base) {
        rules = {
          ...base,
          armors: base.armors.map(a => ({ ...a })),
          attacks: base.attacks.map(a => ({ ...a })),
        };
      }
      applyEffect(rules, effect);
    }
  }
  return rules;
}

/**
 * One technology effect against one thing's rules. Armour and attack are
 * per-class lists rather than single numbers -- Forging is "+1 against melee",
 * not "+1 attack" -- so a class the thing has no entry for gains one, which is
 * what makes a bonus against a class it never fought before take effect.
 */
function applyEffect(rules: UnitRules, effect: TechEffect): void {
  const armorClass = effect.armorClass ?? 0;
  switch (effect.attribute) {
    case 'hitPoints': rules.hp = combine(effect.operation, rules.hp, effect.amount); break;
    case 'lineOfSight':
      rules.lineOfSight = combine(effect.operation, rules.lineOfSight, effect.amount); break;
    case 'speed': rules.speed = combine(effect.operation, rules.speed, effect.amount); break;
    case 'reloadSeconds':
      rules.attackReloadSeconds =
        combine(effect.operation, rules.attackReloadSeconds, effect.amount); break;
    case 'accuracyPercent':
      rules.accuracyPercent = combine(effect.operation, rules.accuracyPercent ?? 100, effect.amount);
      break;
    case 'range':
      if (rules.range !== undefined) {
        rules.range = combine(effect.operation, rules.range, effect.amount);
      }
      break;
    case 'armor': {
      const existing = rules.armors.find(a => a.class === armorClass);
      if (existing) existing.amount = combine(effect.operation, existing.amount, effect.amount);
      else rules.armors.push({ class: armorClass, amount: effect.amount });
      break;
    }
    case 'attack': {
      const existing = rules.attacks.find(a => a.class === armorClass);
      if (existing) existing.amount = combine(effect.operation, existing.amount, effect.amount);
      else rules.attacks.push({ class: armorClass, amount: effect.amount });
      break;
    }
    default: break; // workRate and carryCapacity are not unit attributes here
  }
}

/**
 * A building's rules under what its owner has researched. The Castle Age gives
 * a watch tower a fifth more hit points, Arrowslits gives it another arrow,
 * Heated Shot multiplies what it does to ships, and Murder Holes takes away
 * the minimum range that stops it shooting somebody stood against its wall --
 * so this reaches the same attributes a unit's does, not hit points alone.
 */
export function buildingRulesFor(
  state: GameState, owner: Entity['owner'], kind: BuildingKind,
): BuildingRules {
  const base = state.rules.buildings[kind];
  if (owner === 0) return base;
  const researched = state.players[owner as PlayerId].researched;
  if (!researched.length) return base;
  let rules = base;
  for (const key of researched) {
    for (const effect of state.rules.technologies[key]?.effects ?? []) {
      if (effect.unit !== kind) continue;
      if (rules === base) {
        rules = {
          ...base,
          armors: base.armors.map(a => ({ ...a })),
          ...(base.attack ? { attack: { ...base.attack, attacks: base.attack.attacks.map(a => ({ ...a })) } } : {}),
        };
      }
      applyBuildingEffect(rules, effect);
    }
  }
  return rules;
}

function applyBuildingEffect(rules: BuildingRules, effect: TechEffect): void {
  const armorClass = effect.armorClass ?? 0;
  switch (effect.attribute) {
    case 'hitPoints': rules.hp = combine(effect.operation, rules.hp, effect.amount); break;
    case 'lineOfSight':
      rules.lineOfSight = combine(effect.operation, rules.lineOfSight, effect.amount); break;
    case 'armor': {
      const existing = rules.armors.find(a => a.class === armorClass);
      if (existing) existing.amount = combine(effect.operation, existing.amount, effect.amount);
      else rules.armors.push({ class: armorClass, amount: effect.amount });
      break;
    }
    case 'attack': {
      if (!rules.attack) break;
      const existing = rules.attack.attacks.find(a => a.class === armorClass);
      if (existing) existing.amount = combine(effect.operation, existing.amount, effect.amount);
      else rules.attack.attacks.push({ class: armorClass, amount: effect.amount });
      break;
    }
    case 'range':
      if (rules.attack) rules.attack.range = combine(effect.operation, rules.attack.range, effect.amount);
      break;
    case 'minRange':
      if (rules.attack) {
        rules.attack.minRange = combine(effect.operation, rules.attack.minRange ?? 0, effect.amount);
      }
      break;
    case 'reloadSeconds':
      if (rules.attack) {
        rules.attack.reloadSeconds =
          combine(effect.operation, rules.attack.reloadSeconds, effect.amount);
      }
      break;
    case 'accuracyPercent':
      if (rules.attack) {
        rules.attack.accuracyPercent =
          combine(effect.operation, rules.attack.accuracyPercent ?? 100, effect.amount);
      }
      break;
    default: break;
  }
}
