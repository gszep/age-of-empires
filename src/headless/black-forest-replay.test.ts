import { expect, it } from 'vitest';
import oldRecord from './fixtures/pre-black-forest185872-v11.json';
import { replayRecord, runMatch } from './runner';
import { createReplayGame } from '../sim/replay';
import { checksumState } from '../sim/checksum';
import { MATCH_FORMAT_VERSION, type MatchRecord } from '../protocol/types';
import { validateMatchConfig, validateMatchRecord, validateMatchResult } from '../protocol/validate';
import { validRecordedMode } from '../match-setup';

it.each(Array.from({ length: MATCH_FORMAT_VERSION }, (_, i) => (i + 1) as MatchRecord['version']))(
  'launches format %s input as a new current-format match', async version => {
    const idle = { decide: () => [] };
    const { record, result } = await runMatch({ version, seed: 7, maxTimeSeconds: 0.05 }, { 1: idle, 2: idle });
    expect(record.version).toBe(MATCH_FORMAT_VERSION);
    expect(result.version).toBe(MATCH_FORMAT_VERSION);
    expect(validateMatchRecord(record)).toBe(true);
    expect(createReplayGame(record).settlementReseedVersion).toBe(1);
  });

// Independently frozen using git archive faa8896ed3f48e867cdd875fd0eb82d99e9d8abe:
// v11 runMatch, fallback rules, seed7, Black Forest, idle strategies,10seconds.
// That archive has the48987 clumping2 contract, not the working tree's repin.
it('replays the pre-bump v11 Black Forest recording without regenerating its hashes', () => {
  const wire = JSON.parse(JSON.stringify(oldRecord)) as MatchRecord;
  expect(validateMatchRecord(wire)).toBe(true);
  const state = createReplayGame(wire);
  expect(state).not.toHaveProperty('mapgenVersion');
  expect(checksumState(state)).toBe('eeaf89ef');
  expect(replayRecord(wire, undefined, s => expect(s).not.toHaveProperty('mapgenVersion')))
    .toEqual({ ok: true, checked: 2 });
  expect(replayRecord({ ...wire, version: MATCH_FORMAT_VERSION }).ok).toBe(false);
  for (const version of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const) {
    const historical = createReplayGame({ ...wire, version, mode: version === 1 ? undefined : 'random-map' });
    expect(historical).not.toHaveProperty('mapgenVersion');
    // v10 changed initial placement, independently tested by frozen legacy
    // digests. Compare the entire board with the appropriate placement control.
    const control = createReplayGame({ ...wire, version: version >= 10 ? 11 : 9 });
    expect(historical.terrain).toEqual(control.terrain);
  }
});

it('accepts legacy launches but records/replays new Black Forest in the current format', async () => {
  expect(MATCH_FORMAT_VERSION).toBe(13);
  for (let version = 1; version <= MATCH_FORMAT_VERSION; version++) {
    expect(validateMatchConfig({ version, seed: 7, map: 'black-forest' })).toBe(true);
    expect(validRecordedMode(version, version === 1 ? undefined : 'random-map')).toBe(true);
  }
  const idle = { decide: () => [] };
  const { record, result } = await runMatch({ version: 11, seed: 7, map: 'black-forest', maxTimeSeconds: 10 },
    { 1: idle, 2: idle });
  expect(record.version).toBe(MATCH_FORMAT_VERSION); expect(result.version).toBe(MATCH_FORMAT_VERSION);
  expect(validateMatchRecord(record)).toBe(true); expect(validateMatchResult(result)).toBe(true);
  const wire = JSON.parse(JSON.stringify(record));
  expect(replayRecord(wire, undefined, state => expect(state.mapgenVersion).toBe(3)))
    .toEqual({ ok: true, checked: record.checksums.length });
  expect(replayRecord({ ...wire, version: 11 }).ok).toBe(false);
  expect(validateMatchConfig({ version: MATCH_FORMAT_VERSION + 1, seed: 7 })).toBe(false);
  expect(validateMatchRecord({ ...wire, version: MATCH_FORMAT_VERSION + 1 })).toBe(false);
  expect(validateMatchResult({ ...result, version: MATCH_FORMAT_VERSION + 1 })).toBe(false);
  expect(validRecordedMode(MATCH_FORMAT_VERSION + 1, 'random-map')).toBe(false);
});
