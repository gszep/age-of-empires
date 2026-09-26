import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { loadSession, loadSessionSetup, saveSession, SNAPSHOT_VERSION } from './dev-session';
import { createGame } from './sim/game';
import { checksumState } from './sim/checksum';
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

it('preserves Regicide state/setup and temporary Treason while admitting only mode-less legacy snapshots', () => {
  let value = '';
  vi.stubGlobal('sessionStorage', { getItem: () => value, setItem: (_key: string, text: string) => { value = text; } });
  const state = createGame(7, FALLBACK_RULES, undefined, 'islands', 'regicide');
  state.treasonUntil = { 1: 200 };
  const setup = { map: 'islands', seed: 7, mode: 'regicide' as const };
  saveSession(state, setup);
  expect(JSON.parse(value).version).toBe(SNAPSHOT_VERSION);
  expect(loadSession(FALLBACK_RULES)).toMatchObject({ mode: 'regicide', treasonUntil: { 1: 200 } });
  expect(loadSessionSetup(FALLBACK_RULES)).toEqual(setup);
  const stored = JSON.parse(value);
  value = JSON.stringify({ ...stored, version: 2 });
  expect(loadSession(FALLBACK_RULES)).toBeUndefined();
  const { rules, ...legacy } = createGame(7);
  value = JSON.stringify({ version: 2, rulesOrigin: rules.origin, state: legacy, setup: { map: 'arabia', seed: 7 } });
  expect(loadSession(FALLBACK_RULES)?.mode).toBeUndefined();
  expect(loadSession(FALLBACK_RULES)).toBeDefined();
  expect(loadSessionSetup(FALLBACK_RULES)).toEqual({ map: 'arabia', seed: 7 });
  value = JSON.stringify({ ...stored, state: { ...stored.state, mode: 'unknown' } });
  expect(loadSession(FALLBACK_RULES)).toBeUndefined();
  value = JSON.stringify({ ...stored, setup: { ...setup, mode: 'random-map' } });
  expect(loadSessionSetup(FALLBACK_RULES)).toBeUndefined();
});
