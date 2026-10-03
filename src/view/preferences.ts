/** Local presentation preferences never enter authoritative game state. */
import { DEFAULT_GAME_SPEED } from '../shared/protocol';
export const HOTKEY_PROFILES = ['definitive', 'classic', 'high definition', 'left handed'] as const;
export const UI_PALETTES = ['default', 'deuteranopia', 'protanopia', 'tritanopia'] as const;
export interface Preferences {
  speed: number;
  hotkeys: typeof HOTKEY_PROFILES[number];
  palette: typeof UI_PALETTES[number];
  music: number;
  sound: number;
}
export const DEFAULT_PREFERENCES: Preferences = { speed: DEFAULT_GAME_SPEED, hotkeys: 'definitive', palette: 'default', music: 35, sound: 100 };
export const PREFERENCES_KEY = 'open-empires-lab:preferences';

export function normalizePreferences(value: unknown): Preferences {
  const data = value && typeof value === 'object' ? value as Partial<Preferences> : {};
  const volume = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(100, Math.round(value))) : fallback;
  return {
    speed: Number.isInteger(data.speed) && data.speed! >= 0 && data.speed! < 6 ? data.speed! : DEFAULT_PREFERENCES.speed,
    hotkeys: HOTKEY_PROFILES.includes(data.hotkeys!) ? data.hotkeys! : DEFAULT_PREFERENCES.hotkeys,
    palette: UI_PALETTES.includes(data.palette!) ? data.palette! : DEFAULT_PREFERENCES.palette,
    music: volume(data.music, DEFAULT_PREFERENCES.music), sound: volume(data.sound, DEFAULT_PREFERENCES.sound),
  };
}

export function loadPreferences(): Preferences {
  try { return normalizePreferences(JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? 'null')); }
  catch { return { ...DEFAULT_PREFERENCES }; }
}

export function savePreferences(preferences: Preferences): void {
  try { localStorage.setItem(PREFERENCES_KEY, JSON.stringify(normalizePreferences(preferences))); }
  catch { /* preferences remain usable when browser storage is unavailable */ }
}
