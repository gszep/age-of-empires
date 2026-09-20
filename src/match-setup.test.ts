import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadMapPreference, saveMapPreference, validMatchSetup, mapChoices } from './match-setup';
import { MAPS } from './sim/mapgen';

afterEach(() => vi.unstubAllGlobals());

describe('map setup', () => {
  it('offers every registered map, including surveyed boards, and uses imported names', () => {
    const choices = mapChoices({ mapIslands: 'Owned Islands label' });
    expect(choices.map(choice => choice.id)).toEqual(Object.keys(MAPS));
    expect(choices.find(choice => choice.id === 'islands')?.label).toBe('Owned Islands label');
  });

  it('rejects unregistered/prototype maps and seeds that cannot name a supported board', () => {
    for (const setup of [null, {}, { map: '__proto__', seed: 2 }, { map: 'constructor', seed: 2 },
      ...[0, -1, 1.5, NaN, Infinity, 4294967296, '2'].map(seed => ({ map: 'islands', seed }))]) {
      expect(validMatchSetup(setup)).toBe(false);
    }
    expect(validMatchSetup({ map: 'islands', seed: 2 })).toBe(true);
  });

  it('remembers a valid choice and tolerates blocked or obsolete browser storage', () => {
    let value: string | null = null;
    vi.stubGlobal('localStorage', { getItem: () => value, setItem: (_key: string, next: string) => { value = next; } });
    saveMapPreference({ map: 'windsor', seed: 7 });
    expect(loadMapPreference()).toEqual({ map: 'windsor', seed: 7 });
    value = '{"map":"removed-map","seed":7}';
    expect(loadMapPreference()).toBeUndefined();
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
    expect(() => saveMapPreference({ map: 'arabia', seed: 2 })).not.toThrow();
    expect(loadMapPreference()).toBeUndefined();
  });
});
