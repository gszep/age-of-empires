import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type ContentManifest, FALLBACK_RULES, type GameRules, rulesFromManifest } from './data';
import type { UnitKind } from './types';

// Issue #105: `rulesFromManifest` merges the open fallback into the imported
// rules field by field, and a field the manifest states but the merge did not
// read shipped the fallback's number silently for a month (the onager's
// projectile at 5, the DAT's 3.5). These tests hold the boundary: where the
// manifest states a value, the imported rule carries that value.

const MANIFEST_PATH = 'public/imported/aoe2/manifest.json';
const manifest: ContentManifest | undefined = existsSync(MANIFEST_PATH)
  ? JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as ContentManifest
  : undefined;
const imported: GameRules | undefined = manifest && rulesFromManifest(manifest);

// Rule field on the left, the manifest path that states it on the right.
const UNIT_FIELDS: Array<[keyof GameRules['units'][UnitKind], (e: ContentManifest['entities'][string]) => unknown]> = [
  ['hp', e => e.hitPoints],
  ['speed', e => e.speedTilesPerSecond],
  ['lineOfSight', e => e.lineOfSight],
  ['range', e => e.combat?.maximumRange || undefined],
  ['projectileSpeed', e => e.combat?.projectileSpeed],
  ['accuracyPercent', e => e.combat?.accuracyPercent],
  ['accuracyDispersion', e => e.combat?.accuracyDispersion],
  ['trainSeconds', e => e.train?.seconds],
];

describe('imported rules read the manifest, not the fallback', () => {
  it.skipIf(!imported)('every unit field the manifest states is the value the rules carry', () => {
    const misses: string[] = [];
    for (const [kind, rules] of Object.entries(imported!.units)) {
      const entity = manifest!.entities[kind];
      if (!entity) continue;
      for (const [field, read] of UNIT_FIELDS) {
        const stated = read(entity);
        if (stated === undefined || stated === null) continue;
        if (rules[field] !== stated) misses.push(`${kind}.${String(field)}: rules ${String(rules[field])}, manifest ${String(stated)}`);
      }
    }
    expect(misses).toEqual([]);
  });

  it.skipIf(!imported)('a shot flies at the projectile unit\'s own speed', () => {
    // The value the fallback had wrong: projectile 656 is shared by the
    // mangonel and the onager and moves at 3.5.
    expect(imported!.units.onager.projectileSpeed).toBe(3.5);
    expect(imported!.units.mangonel.projectileSpeed).toBe(3.5);
    expect(imported!.units.villager.hunt?.projectileSpeed).toBe(manifest!.entities['villager-hunter'].combat?.projectileSpeed);
    expect(FALLBACK_RULES.units.onager.projectileSpeed).not.toBe(imported!.units.onager.projectileSpeed);
  });

  it.skipIf(!imported)('the match opens on the reference\'s Standard resources', () => {
    // A game setting, not a DAT value; decided on issue #109.
    expect(imported!.startingResources).toEqual({ food: 200, wood: 200, gold: 100, stone: 200 });
  });

  it.skipIf(!imported)('a herdable is claimed at its own line of sight', () => {
    expect(imported!.units.sheep.herdRange).toBe(manifest!.entities.sheep.lineOfSight);
    expect(imported!.units.deer.herdRange).toBeUndefined();
  });
});
