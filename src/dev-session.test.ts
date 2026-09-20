import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createGame } from './sim/game';
import { checksumState } from './sim/checksum';
import { loadSession, loadSessionSetup, saveSession } from './dev-session';

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
