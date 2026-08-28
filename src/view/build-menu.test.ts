import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  FALLBACK_RULES, rulesFromManifest, type ContentManifest, type GameRules,
} from '../sim/data';
import type { BuildingKind } from '../sim/types';
import { MILITARY_BUILDINGS, buildMenu, pageOf } from './build-menu';

const MANIFEST_PATH = 'public/imported/aoe2/manifest.json';
const importedRules: GameRules | undefined = existsSync(MANIFEST_PATH)
  ? rulesFromManifest(JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as ContentManifest)
  : undefined;

const buildable = (rules: GameRules) =>
  (Object.keys(rules.buildings) as BuildingKind[]).filter(k => rules.buildings[k].buildable);

describe('the villager build menu', () => {
  // Issue #25. The DAT gives each building the villager can put up a build
  // button, which is its slot in the command grid. It never says which page a
  // building is on -- but it says the shape of the pages, because two
  // buildings can only share a slot when they are on different ones.
  const noPageCollidesWithItself = (rules: GameRules, label: string) => {
    for (const page of ['economic', 'military'] as const) {
      const taken = new Map<number, BuildingKind>();
      for (const kind of buildMenu(rules, 3, page)) {
        const slot = rules.buildings[kind].buildButton;
        if (slot === undefined) continue;
        const already = taken.get(slot);
        expect(already, `${label}: ${kind} and ${already} both sit in ${page} slot ${slot}`)
          .toBeUndefined();
        taken.set(slot, kind);
      }
    }
  };

  it('never puts two buildings in one slot of the same page', () => {
    // This is the check that catches a wrong split. The hand-written set this
    // replaced had the blacksmith on the military page against the palisade
    // wall, and the monastery there against the watch tower.
    noPageCollidesWithItself(FALLBACK_RULES, 'open rules');
  });

  it.skipIf(!importedRules)('holds against the DAT\'s own slots', () => {
    noPageCollidesWithItself(importedRules!, 'imported rules');
    // And the slots really are the DAT's: the pairs it states, either side.
    const slot = (kind: BuildingKind) => importedRules!.buildings[kind].buildButton;
    for (const [economic, military] of [
      ['house', 'barracks'], ['mill', 'archery-range'], ['mining-camp', 'stable'],
      ['lumber-camp', 'siege-workshop'], ['blacksmith', 'palisade-wall'],
      ['monastery', 'watch-tower'],
    ] as [BuildingKind, BuildingKind][]) {
      expect(slot(economic), `${economic}/${military}`).toBe(slot(military));
      expect(pageOf(economic)).toBe('economic');
      expect(pageOf(military)).toBe('military');
    }
  });

  it('puts every buildable building on exactly one page', () => {
    // A kind added without a page would land silently on the economic one;
    // this is what says so.
    for (const rules of [FALLBACK_RULES, ...(importedRules ? [importedRules] : [])]) {
      const economic = buildMenu(rules, 3, 'economic');
      const military = buildMenu(rules, 3, 'military');
      expect([...economic, ...military].sort()).toEqual(buildable(rules).sort());
      expect(economic.filter(k => military.includes(k))).toEqual([]);
    }
  });

  it('lists each page in the order the DAT numbers it', () => {
    const slots = buildMenu(FALLBACK_RULES, 3, 'economic')
      .map(k => FALLBACK_RULES.buildings[k].buildButton ?? Infinity);
    expect(slots).toEqual([...slots].sort((a, b) => a - b));
    // The economic page opens on the house, as AoE2's does.
    expect(buildMenu(FALLBACK_RULES, 3, 'economic')[0]).toBe('house');
    expect(buildMenu(FALLBACK_RULES, 3, 'military')[0]).toBe('barracks');
  });

  it('shows only what the age has opened', () => {
    const dark = buildMenu(FALLBACK_RULES, 0, 'military');
    expect(dark).toContain('barracks');
    expect(dark).not.toContain('castle');
    expect(buildMenu(FALLBACK_RULES, 3, 'military')).toContain('castle');
  });

  it('keeps walls and their gates with the defences', () => {
    // Neither is picked from a slot -- a wall is dragged and the DAT gives the
    // gate no build button at all -- but both belong on the military page.
    expect(MILITARY_BUILDINGS.has('palisade-wall')).toBe(true);
    expect(MILITARY_BUILDINGS.has('palisade-gate')).toBe(true);
  });
});
