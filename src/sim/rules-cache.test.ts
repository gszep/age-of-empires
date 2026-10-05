import { describe, it, expect } from 'vitest';
import { createGame } from './game';
import { FALLBACK_RULES } from './data';
import { unitRulesFor, withRulesCache } from './rules';

describe('rules cache', () => {
  it('no cache outside withRulesCache: mutations to base rules are visible on next call', () => {
    const state = createGame(131, structuredClone(FALLBACK_RULES));
    const owner = 1;

    // Get rules for a unit with no research applied.
    const rules1 = unitRulesFor(state, owner, 'archer');
    const hpBefore = rules1.hp;

    // Mutate the source base rules directly (outside cache).
    const source = state.rules.units['archer'];
    source.hp = hpBefore + 10;

    // Get rules again; should reflect the mutation since cache is not active.
    const rules2 = unitRulesFor(state, owner, 'archer');
    expect(rules2.hp).toBe(hpBefore + 10);

    // Restore for other tests.
    source.hp = hpBefore;
  });

  it('cache is active inside withRulesCache: identical inputs return identical object references', () => {
    const state = createGame(131, structuredClone(FALLBACK_RULES));
    const owner = 1;
    // An effect that really changes archers, so the uncached path would
    // return a fresh object on every call.
    state.rules.technologies.loom.effects.push({ unit: 'archer', attribute: 'hitPoints', operation: 'add', amount: 7 } as never);
    state.players[owner].researched.push('loom');

    let rules1: any, rules2: any;
    expect(unitRulesFor(state, owner, 'archer')).not.toBe(unitRulesFor(state, owner, 'archer'));
    withRulesCache(() => {
      rules1 = unitRulesFor(state, owner, 'archer');
      rules2 = unitRulesFor(state, owner, 'archer');
    });
    expect(rules1).toBe(rules2);
    expect(rules1).not.toBe(state.rules.units.archer);

    // Completing research inside the same step is a different key.
    state.players[owner].researched.splice(0, Infinity, 'feudal-age');
    withRulesCache(() => {
      const cached = unitRulesFor(state, owner, 'archer');
      state.players[owner].researched.push('loom');
      const fresh = unitRulesFor(state, owner, 'archer');
      expect(fresh).not.toBe(cached);
      expect(fresh.hp - cached.hp).toBe(7);
    });
  });

  it('cache is cleared after withRulesCache returns; mutations outside cache persist', () => {
    const state = createGame(131, structuredClone(FALLBACK_RULES));
    const owner = 1;
    state.players[owner].researched.push('loom');

    let rulesInFirstCache: any;
    withRulesCache(() => {
      rulesInFirstCache = unitRulesFor(state, owner, 'archer');
    });

    // Mutate the base rules after the first cache context.
    const hpBefore = state.rules.units['archer'].hp;
    state.rules.units['archer'].hp = hpBefore + 5;

    let rulesInSecondCache: any;
    withRulesCache(() => {
      rulesInSecondCache = unitRulesFor(state, owner, 'archer');
    });

    // The cache was cleared, so mutations to the base rules should affect
    // the second computation. This verifies the cache didn't persist.
    expect(rulesInSecondCache.hp).toBe(hpBefore + 5);

    // Restore.
    state.rules.units['archer'].hp = hpBefore;
  });
});
