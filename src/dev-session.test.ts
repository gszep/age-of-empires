import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createGame } from './sim/game';
import { checksumState } from './sim/checksum';
import { loadSession, loadSessionSetup, saveSession } from './dev-session';
import { FALLBACK_RULES } from './sim/data';

beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());

it('resumes a chosen map and seed without adding launch metadata to game/replay state', () => {
  const state = createGame(2, undefined, undefined, 'islands');
  saveSession(state, { map: 'islands', seed: 2 });
  expect(loadSessionSetup(state.rules)).toEqual({ map: 'islands', seed: 2 });
  const resumed = loadSession(state.rules)!;
  expect(checksumState(resumed)).toBe(checksumState(state));
  expect(resumed).not.toHaveProperty('setup');
});

it('keeps older matches playable without inventing a seed for them', () => {
  const state = createGame(42);
  saveSession(state);
  expect(loadSession(state.rules)?.matchSeed).toBe(state.matchSeed);
  expect(loadSessionSetup(state.rules)).toBeUndefined();
  saveSession(state, { map: 'arabia', seed: 2 });
  expect(loadSessionSetup(state.rules)).toBeUndefined();
});

it('restores mixed selections only while both civilisation rulesets remain loaded', () => {
  const rules = structuredClone(FALLBACK_RULES);
  const other = structuredClone(FALLBACK_RULES);
  other.civilization.key = 'fixture-other';
  rules.civilizations = { 'fixture-other': other };
  const state = createGame(122, rules, { 1: 'open', 2: 'fixture-other' });
  saveSession(state);
  expect(loadSession(rules)?.players[2].civilization).toBe('fixture-other');
  expect(loadSession(FALLBACK_RULES)).toBeUndefined();
});
