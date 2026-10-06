import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { ARABIA_ADDED_TERRAINS, FALLBACK_RULES } from '../sim/data';
import { createGame } from '../sim/game';
import { useLegacyPacking } from '../sim/packing';
import { compatibleArabiaTerrainExtension } from './checkpoint-compat';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const legacyHash = '6468a1958aed242623b46f3a31b50152f8db42696df2c3bc841a7980cae6da40';

it('accepts only the exact terrain extension for a marker-less board that cannot observe it', () => {
  const saved = { rulesHash: legacyHash, state: { terrain: [0, 1, 2, 10, 14, 110] } };
  // Keep the actual frozen pre-118 hash: it is compatible only when packing
  // also matches. #259 deliberately does NOT expand this admission exception.
  const legacy = createGame(259); useLegacyPacking(legacy);
  const rules = legacy.rules, before = JSON.stringify(rules);
  expect(compatibleArabiaTerrainExtension(saved, rules)).toBe(true);
  expect(compatibleArabiaTerrainExtension(saved, FALLBACK_RULES)).toBe(false);
  expect(JSON.stringify(rules)).toBe(before);
  for (const id of ARABIA_ADDED_TERRAINS) {
    expect(compatibleArabiaTerrainExtension({ ...saved, state: { terrain: [id] } }, rules)).toBe(false);
  }
  expect(compatibleArabiaTerrainExtension({ ...saved, state: { ...saved.state, mapgenVersion: 1 } }, rules)).toBe(false);
  expect(compatibleArabiaTerrainExtension({ rulesHash: legacyHash }, rules)).toBe(false);
  const unrelated = structuredClone(rules);
  unrelated.units.villager.hp++;
  expect(compatibleArabiaTerrainExtension(saved, unrelated)).toBe(false);
  unrelated.units.villager.hp--;
  unrelated.terrainRestrictions[7] = unrelated.terrainRestrictions[7].filter(id => id !== 14);
  expect(compatibleArabiaTerrainExtension(saved, unrelated)).toBe(false);
});

it('checks every imported civilisation profile, not just the root rules', () => {
  const current = structuredClone(FALLBACK_RULES);
  current.civilizations = { fixture: structuredClone(FALLBACK_RULES) };
  const prior = structuredClone(current);
  for (const profile of [prior, prior.civilizations!.fixture]) for (const row in profile.terrainRestrictions) {
    profile.terrainRestrictions[row] = profile.terrainRestrictions[row].filter(id => !ARABIA_ADDED_TERRAINS.includes(id));
  }
  const saved = { rulesHash: hash(prior), state: { terrain: [0, 14, 110] } };
  expect(compatibleArabiaTerrainExtension(saved, current)).toBe(true);
  current.civilizations.fixture.units.villager.hp++;
  expect(compatibleArabiaTerrainExtension(saved, current)).toBe(false);
});
