import type { ImportedHotkey, HotkeyProfile } from './assets';

const KEY_NAMES: Record<string, string> = { OEM_PERIOD: '.', OEM_COMMA: ',', SPACE: ' ', ESCAPE: 'Escape', RETURN: 'Enter',
  OEM_MINUS: '-', OEM_PLUS: '=', DELETE: 'Delete' };
export const browserKey = (key: string): string => KEY_NAMES[key] ?? key;
export const hotkeyLabel = (binding: ImportedHotkey): string => [
  binding.control && 'Ctrl', binding.alt && 'Alt', binding.shift && 'Shift', browserKey(binding.key).toUpperCase(),
].filter(Boolean).join('+');

export function matchesHotkey(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>,
  binding: ImportedHotkey | null | undefined, batchShift = false,
): boolean {
  return !!binding && event.key.toLowerCase() === browserKey(binding.key).toLowerCase()
    && (event.ctrlKey || event.metaKey) === !!binding.control && event.altKey === !!binding.alt
    && (batchShift && !binding.shift || event.shiftKey === !!binding.shift);
}

/** Explicit null is an unbound native profile entry, not permission to use
 * another layout's key. The fallback is only for commands absent from metadata.
 */
export function commandHotkey(
  profile: HotkeyProfile | undefined, civilization: string, command: string,
  fallback: string | undefined, action?: number,
): ImportedHotkey | undefined {
  if (profile) {
    const scoped = `civilizations/${civilization}/${command}`;
    if (Object.hasOwn(profile.commands, scoped)) return profile.commands[scoped] ?? undefined;
    if (Object.hasOwn(profile.commands, command)) return profile.commands[command] ?? undefined;
    if (action !== undefined && Object.hasOwn(profile.actions, String(action))) return profile.actions[String(action)] ?? undefined;
  }
  return fallback ? { key: fallback } : undefined;
}
