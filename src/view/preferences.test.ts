import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PREFERENCES, loadPreferences, normalizePreferences, PREFERENCES_KEY, savePreferences } from './preferences';

afterEach(() => vi.unstubAllGlobals());
describe('local presentation preferences', () => {
  it('persists independent sound, music, speed, palette and hotkey choices across loads', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key), setItem: (key: string, value: string) => values.set(key, value) });
    const wanted = { speed: 4, music: 0, sound: 42, hotkeys: 'classic', palette: 'deuteranopia' } as const;
    savePreferences(wanted);
    expect(loadPreferences()).toEqual(wanted);
    values.set(PREFERENCES_KEY, 'broken JSON');
    expect(loadPreferences()).toEqual(DEFAULT_PREFERENCES);
  });

  it('retains valid fields while rejecting coercion, unknown profiles and invalid speeds', () => {
    const source = Object.freeze({ speed: 99, music: -1, sound: 1000, hotkeys: 'invented', palette: 'tritanopia' });
    expect(normalizePreferences(source)).toEqual({ ...DEFAULT_PREFERENCES, music: 0, sound: 100, palette: 'tritanopia' });
    expect(normalizePreferences({ speed: '3', music: NaN, sound: Infinity })).toEqual(DEFAULT_PREFERENCES);
  });

  it('keeps the game usable when storage is denied', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } });
    expect(loadPreferences()).toEqual(DEFAULT_PREFERENCES);
    expect(() => savePreferences(DEFAULT_PREFERENCES)).not.toThrow();
  });
});
