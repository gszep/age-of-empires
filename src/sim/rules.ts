/**
 * What a player's research does to the base rules. These lived in game.ts
 * until visibility needed them too (issue #29: Town Watch changed the rules
 * table and nothing that computes sight ever read it); game.ts imports
 * visibility, so they moved here to keep the import graph acyclic.
 */
import type { BuildingRules, TechEffect, UnitRules } from './data';
import { isUnit } from './data';
import { rulesForPlayer } from './civilizations';
import type { BuildingKind, DeepReadonly, Entity, GameState, PlayerId, ReadonlyGameState, UnitKind } from './types';

/** Shared by the build menu, placement preview and public build command. */
export function buildingLimitReached(state: GameState, owner: PlayerId, kind: BuildingKind): boolean {
  const age = buildingRulesFor(state, owner, kind).additionalAge;
  return age !== undefined && state.players[owner].age < age
    && state.entities.some(e => e.owner === owner && e.kind === kind && !e.dead);
}

/** Apply one number to one attribute, in the way the DAT's command says. */
export function combine(operation: TechEffect['operation'], current: number, amount: number): number {
  if (operation === 'set') return amount;
  if (operation === 'multiply') return current * amount;
  return current + amount;
}

/** Initial DAT value plus completed research, in completion order. Unknown
 * names stay undefined. These are rule parameters, not live stockpiles or
 * counters: e.g. imported `food` is not the player's current food bank.
 * Legacy fields preserve open rules and snapshots made before issue #53.
 */
export function playerAttributeFor(
  state: GameState, owner: Entity['owner'], name: string,
): number | undefined {
  const rules = rulesForPlayer(state, owner);
  const legacy = name === 'farmFoodAmount' ? rules.buildings.farm.farmAmount
    : name === 'unitRepairCost' ? rules.repairCostFraction.unit
      : name === 'buildingRepairCost' ? rules.repairCostFraction.building : undefined;
  const attributes = rules.playerAttributes;
  let value = (attributes && Object.hasOwn(attributes, name) ? attributes[name] : undefined) ?? legacy;
  if (value === undefined || owner === 0) return value;
  for (const key of state.players[owner as PlayerId].researched) {
    for (const effect of rules.technologies[key]?.effects ?? []) {
      if (effect.resource === name) value = combine(effect.operation, value, effect.amount);
    }
  }
  return value;
}

/** Existing units may carry a conversion snapshot; creation/availability uses
 * unitRulesFor instead. Never resolve a captured unique unit through its new
 * owner's trainable catalogue. */
export function unitRulesForEntity(state: GameState, entity: Entity): UnitRules;
export function unitRulesForEntity(state: ReadonlyGameState, entity: DeepReadonly<Entity>): DeepReadonly<UnitRules>;
export function unitRulesForEntity(state: ReadonlyGameState, entity: DeepReadonly<Entity>): DeepReadonly<UnitRules> {
  return entity.convertedRules ?? unitRulesFor(state as GameState, entity.owner, entity.kind as UnitKind);
}

/** Capture before changing ownership, including passengers. A second conversion
 * keeps the first snapshot, not either player's intervening upgrades. The
 * locked-unit / live-player split is inferred; see ledger #178. */
export function inheritConvertedUnit(state: GameState, entity: Entity, owner: PlayerId): void {
  if (isUnit(entity.kind) && !entity.convertedRules) {
    entity.convertedRules = structuredClone(unitRulesForEntity(state, entity));
  }
  for (const passenger of entity.garrison ?? []) inheritConvertedUnit(state, passenger, owner);
  entity.owner = owner;
}

/** What a player has researched, applied to one unit kind's rules. */
export function unitRulesFor(state: GameState, owner: Entity['owner'], kind: UnitKind): UnitRules {
  const source = rulesForPlayer(state, owner);
  const base = source.units[kind];
  if (owner === 0) return base;
  const researched = state.players[owner as PlayerId].researched;
  if (!researched.length) return base;
  let rules = base;
  for (const key of researched) {
    for (const effect of source.technologies[key]?.effects ?? []) {
      if (base.piercing && effect.unit === base.piercing.unit && effect.attribute === 'attack') {
        const attacks = (rules.piercing ?? base.piercing).attacks.map(a => ({ ...a }));
        const entry = attacks.find(a => a.class === effect.armorClass);
        if (entry) entry.amount = combine(effect.operation, entry.amount, effect.amount);
        else attacks.push({ class: effect.armorClass ?? 0, amount: combine(effect.operation, 0, effect.amount) });
        rules = { ...rules, piercing: { ...base.piercing, attacks } };
        continue;
      }
      if (effect.unit !== kind) continue;
      if (rules.attacks === base.attacks) {
        rules = {
          ...rules,
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
  const source = rulesForPlayer(state, owner);
  const base = source.buildings[kind];
  if (owner === 0) return base;
  const researched = state.players[owner as PlayerId].researched;
  if (!researched.length) return base;
  let rules = base;
  for (const key of researched) {
    for (const effect of source.technologies[key]?.effects ?? []) {
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
