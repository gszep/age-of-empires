/**
 * What the reference calls things, from its own strings (issue #48).
 *
 * The DAT names every unit, building and technology by an id into the owned
 * string table, and the importer carries the strings through as `text`. This
 * is the one place they are turned into what a panel or a tooltip shows.
 */
import type { Cost } from '../sim/data';

/**
 * A display name from the DAT's `language_dll_name`, or the slug spelled out
 * when no string was imported (the open fallback, or a key with no unit
 * behind it).
 *
 * The DAT's names carry the scenario editor's qualifiers in parentheses --
 * "Villager (Male)", "Trade Cart (Empty)", "Palisade Gate (up.)" -- and the
 * reference's own panel shows none of them: the buildable gate (DAT unit 792)
 * is plain "Palisade Gate" where its directional leaves are "(up.)" and
 * "(down.)", which is the file itself saying the qualifier is not the name.
 * Dropping a trailing parenthetical is that rule; it is recorded in
 * `docs/status.md` as the one chosen part of this.
 */
export function displayName(key: string, imported?: string): string {
  if (imported) return imported.replace(/\s*\([^)]*\)\s*$/, '');
  return key.split('-').map(part => part[0].toUpperCase() + part.slice(1)).join(' ');
}

/**
 * The reference's tooltip as plain text for a `title` attribute.
 *
 * The strings use a small markup: `<b>..<b>` and `<i>..<i>` toggles, colour
 * tags like `<GREY>` and `<DEFAULT>`, `<cost>` for the price, a literal `\n`
 * for a line break, and stat placeholders (`<hp> <attack> <armor>
 * <piercearmor> <range>`) the reference renders as its own stat line. Text
 * cannot carry bold or colour, so the toggles go, the cost is spelled out,
 * and the stat line is left to the panel that already shows it.
 */
export function plainHelp(help: string, cost?: Cost): string {
  return help
    .replace(/\\n/g, '\n')
    .replace(/<cost>/g, cost ? costLabel(cost) : '')
    .replace(/<[^>]*>/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function costLabel(cost: Cost): string {
  const parts = (['food', 'wood', 'gold', 'stone'] as const)
    .filter(resource => cost[resource] > 0)
    .map(resource => `${cost[resource]} ${resource}`);
  return parts.length ? parts.join(', ') : 'free';
}
