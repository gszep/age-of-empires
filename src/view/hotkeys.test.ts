import { describe, expect, it } from 'vitest';
import { commandHotkey, hotkeyLabel, matchesHotkey } from './hotkeys';
import type { HotkeyProfile } from './assets';

const event = (key: string, extra = {}) => ({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...extra });
describe('owned hotkey profiles', () => {
  it('keeps an explicitly unbound classic research key unbound', () => {
    const profile: HotkeyProfile = { names: {}, actions: {}, commands: { 'train-villager': { key: 'C' }, 'research-loom': null } };
    expect(commandHotkey(profile, 'britons', 'train-villager', 'q')).toEqual({ key: 'C' });
    expect(commandHotkey(profile, 'britons', 'research-loom', 'a')).toBeUndefined();
    expect(commandHotkey(undefined, 'britons', 'train-villager', 'q')).toEqual({ key: 'q' });
  });

  it('resolves the owner profile before the root and action bindings before fallback', () => {
    const profile: HotkeyProfile = { names: {}, commands: { 'train-unit': { key: 'Q' }, 'civilizations/franks/train-unit': { key: 'Y' } }, actions: { 51: { key: 'I' } } };
    expect(commandHotkey(profile, 'franks', 'train-unit', 'q')?.key).toBe('Y');
    expect(commandHotkey(profile, 'britons', 'set-gather-point', 't', 51)?.key).toBe('I');
  });

  it('matches modifiers exactly, allowing Shift only for batch training', () => {
    expect(matchesHotkey(event('C'), { key: 'C' })).toBe(true);
    expect(matchesHotkey(event('c', { ctrlKey: true }), { key: 'C' })).toBe(false);
    expect(matchesHotkey(event('c', { shiftKey: true }), { key: 'C' })).toBe(false);
    expect(matchesHotkey(event('c', { shiftKey: true }), { key: 'C' }, true)).toBe(true);
    expect(matchesHotkey(event('.', { ctrlKey: true, shiftKey: true }), { key: 'OEM_PERIOD', control: true, shift: true })).toBe(true);
    expect(hotkeyLabel({ key: 'OEM_PERIOD', control: true })).toBe('Ctrl+.');
  });
});
