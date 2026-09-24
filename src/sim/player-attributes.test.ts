import { describe, expect, it } from 'vitest';
import { FALLBACK_RULES, rulesFromManifest, type GameRules } from './data';
import { createGame, farmFoodAmountFor, playerAttributeFor } from './game';

describe('named player attributes', () => {
  it('preserves unmodelled initial values without treating them as live player counters', () => {
    const attributes = { food: 999, feudalTownCenterLimit: 1, tradeVigRate: 0, startingScoutID: -1 };
    const rules = rulesFromManifest({ entities: {}, playerAttributes: attributes });
    expect(rules.playerAttributes).toEqual(attributes);
    expect(rules.playerAttributes).not.toBe(attributes);
    const state = createGame(53, rules);
    state.players[1].food = 10;
    expect(playerAttributeFor(state, 1, 'food')).toBe(999);
    expect(playerAttributeFor(state, 1, 'tradeVigRate')).toBe(0);
    expect(playerAttributeFor(state, 1, 'startingScoutID')).toBe(-1);
    expect(playerAttributeFor(state, 1, 'unrecognised')).toBeUndefined();
    expect(playerAttributeFor(state, 1, 'toString')).toBeUndefined();
    expect(playerAttributeFor(state, 1, 'constructor')).toBeUndefined();
  });

  it('applies research in completion order without mutating the baseline or other players', () => {
    const rules = structuredClone(FALLBACK_RULES);
    rules.playerAttributes = { farmFoodAmount: 200 };
    rules.technologies['set-fixture'] = {
      ...rules.technologies.loom,
      effects: [{ resource: 'farmFoodAmount', operation: 'set', amount: 300 }],
    };
    rules.technologies['add-fixture'] = {
      ...rules.technologies.loom,
      effects: [{ resource: 'farmFoodAmount', operation: 'add', amount: 75 }],
    };
    const state = createGame(53, rules);
    state.players[1].researched = ['set-fixture', 'add-fixture'];
    expect(farmFoodAmountFor(state, 1)).toBe(375);
    expect(farmFoodAmountFor(state, 2)).toBe(200);
    expect(playerAttributeFor(state, 0, 'farmFoodAmount')).toBe(200);
    state.players[1].researched.reverse();
    expect(farmFoodAmountFor(state, 1)).toBe(300);
    expect(rules.playerAttributes.farmFoodAmount).toBe(200);
  });

  it('keeps open rules and older snapshot rules working through their existing fields', () => {
    const { playerAttributes: _, ...legacy } = structuredClone(FALLBACK_RULES);
    for (const rules of [FALLBACK_RULES, legacy as GameRules]) {
      const state = createGame(53, rules);
      expect(farmFoodAmountFor(state, 1)).toBe(rules.buildings.farm.farmAmount);
      expect(playerAttributeFor(state, 1, 'unitRepairCost')).toBe(rules.repairCostFraction.unit);
      expect(playerAttributeFor(state, 1, 'buildingRepairCost')).toBe(rules.repairCostFraction.building);
      expect(playerAttributeFor(state, 1, 'relicRate')).toBeUndefined();
    }
  });
});
