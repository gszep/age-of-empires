import { expect, it } from 'vitest';
import { createGame, stepGame } from './game';
import { BLACK_FOREST, descriptorForMapgen } from './mapgen';
import { checksumState } from './checksum';
import legacy from './refdata/black-forest-48987.json';
import current from './refdata/relic-placement.json';

it('selects source-attributed land parameters before generation and changes the new board', () => {
  expect(legacy.source).toContain('48987');
  expect(legacy.land.clumping).toBe(2);
  expect(current['black-forest'].land.clumping).toBe(10);
  expect(descriptorForMapgen(BLACK_FOREST).land).toEqual(legacy.land);
  expect(descriptorForMapgen(BLACK_FOREST, 3).land).toEqual(current['black-forest'].land);
  const old = createGame(7, undefined, undefined, 'black-forest', undefined, undefined, undefined, 2);
  const fresh = createGame(7, undefined, undefined, 'black-forest');
  expect(old).not.toHaveProperty('mapgenVersion');
  expect(fresh.mapgenVersion).toBe(3);
  expect(fresh.terrain).not.toEqual(old.terrain); // not just a checksum/marker difference
  expect(fresh.entities).not.toEqual(old.entities);
});

it.each([0, 1, 2] as const)('keeps pre-v12 generation ceiling %s on the same Black Forest board', version => {
  const old = createGame(42, undefined, undefined, 'black-forest', undefined, undefined, undefined, 0);
  const selected = createGame(42, undefined, undefined, 'black-forest', undefined, undefined, undefined, version);
  expect(selected).not.toHaveProperty('mapgenVersion');
  expect(checksumState(selected)).toBe(checksumState(old));
});

it('preserves the historical omitted-map-policy/pre-v10-spawn call without coupling explicit generation3', () => {
  const historical = createGame(7, undefined, undefined, 'black-forest', undefined, undefined, undefined, undefined, 0);
  const explicit = createGame(7, undefined, undefined, 'black-forest', undefined, undefined, undefined, 3, 0);
  expect(historical).not.toHaveProperty('mapgenVersion');
  expect(explicit.mapgenVersion).toBe(3);
  expect(explicit).not.toHaveProperty('gridSpawnVersion');
  expect(explicit.terrain).not.toEqual(historical.terrain);
});

it.each([0, 3] as const)('JSON continuation preserves Black Forest generation%s without adding markers', version => {
  const state = createGame(29, undefined, undefined, 'black-forest', undefined, undefined, undefined, version);
  const restored = JSON.parse(JSON.stringify(state));
  expect(restored.mapgenVersion).toBe(version || undefined);
  expect(descriptorForMapgen(BLACK_FOREST, restored.mapgenVersion).land?.clumping).toBe(version ? 10 : 2);
  for (let i = 0; i < 20; i++) { stepGame(state); stepGame(restored); }
  expect(checksumState(restored)).toBe(checksumState(state));
});
