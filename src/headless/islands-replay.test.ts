import { expect, it } from 'vitest';
import oldRecord from './fixtures/pre-offshore-islands-v8.json';
import { runMatch, replayRecord } from './runner';
import { MATCH_FORMAT_VERSION, type MatchRecord } from '../protocol/types';
import { validateMatchConfig, validateMatchRecord, validateMatchResult } from '../protocol/validate';
import { createReplayGame } from '../sim/replay';
import { checksumState } from '../sim/checksum';

it('replays the untouched pre-correction Islands recording and never upgrades record formats1–8', () => {
  const wire = JSON.parse(JSON.stringify(oldRecord)) as MatchRecord;
  expect(validateMatchRecord(wire)).toBe(true);
  expect(replayRecord(wire, undefined, s => expect(s).not.toHaveProperty('mapgenVersion')))
    .toEqual({ ok: true, checked: 2 });
  expect(replayRecord({ ...wire, version: MATCH_FORMAT_VERSION }).ok).toBe(false);
  const original = createReplayGame(wire);
  // Formats5–8 share the old Islands map; their later simulation markers are
  // independently covered by replay.test and frozen pre-v5 map digests.
  for (const version of [1, 2, 3, 4, 5, 6, 7, 8] as const) {
    const state = createReplayGame({ ...wire, version, mode: version === 1 ? undefined : 'random-map' });
    expect(state).not.toHaveProperty('mapgenVersion');
    expect(state.terrain).toEqual(original.terrain);
    expect(state.entities).toEqual(original.entities.map(({ scorePaidCost, ...entity }) =>
      version < 4 ? entity : { ...entity, ...(scorePaidCost !== undefined ? { scorePaidCost } : {}) }));
  }
});

it('records offshore Islands as v9 even for a legacy launch; JSON replays the exact new map', async () => {
  const config = { version: 8 as const, seed: 95, map: 'islands', maxTimeSeconds: 10 };
  const { record, result } = await runMatch(config, { 1: { decide: () => [] }, 2: { decide: () => [] } });
  expect(MATCH_FORMAT_VERSION).toBe(9);
  expect(record.version).toBe(MATCH_FORMAT_VERSION);
  expect(result.version).toBe(MATCH_FORMAT_VERSION);
  const wire = JSON.parse(JSON.stringify(record));
  expect(validateMatchConfig({ ...config, version: MATCH_FORMAT_VERSION })).toBe(true);
  expect(validateMatchRecord(wire)).toBe(true);
  expect(validateMatchResult(result)).toBe(true);
  expect(validateMatchRecord({ ...wire, version: MATCH_FORMAT_VERSION + 1 })).toBe(false);
  expect(validateMatchResult({ ...result, version: MATCH_FORMAT_VERSION + 1 })).toBe(false);
  expect(validateMatchConfig({ ...config, version: MATCH_FORMAT_VERSION + 1 })).toBe(false);
  let ticks = 0;
  expect(replayRecord(wire, undefined, s => { expect(s.mapgenVersion).toBe(2); ticks++; }))
    .toEqual({ ok: true, checked: 2 });
  expect(ticks).toBe(200);
  expect(replayRecord({ ...wire, version: 8 }).ok).toBe(false);
  expect(replayRecord({ ...wire, version: MATCH_FORMAT_VERSION + 1 }).ok).toBe(false);
  expect(checksumState(createReplayGame(wire))).not.toBe(checksumState(createReplayGame(oldRecord as MatchRecord)));
});
