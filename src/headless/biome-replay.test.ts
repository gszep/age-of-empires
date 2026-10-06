import { expect, it } from 'vitest';
import { replayRecord, runMatch } from './runner';
import { MATCH_FORMAT_VERSION } from '../protocol/types';
import { validateMatchConfig, validateMatchRecord, validateMatchResult } from '../protocol/validate';
import { createGame } from '../sim/game';
import { checksumState } from '../sim/checksum';

it.each([17, 23, 30, 40])('records new Arabia seed %s as v5 and replays its exact map through JSON', async seed => {
  // As with score/research evolution, input config versions are launch formats:
  // even an old config starts a current match and writes a current recording.
  const config = { version: 4 as const, seed, maxTimeSeconds: 5 };
  expect(MATCH_FORMAT_VERSION).toBe(5);
  expect(validateMatchConfig({ ...config, version: MATCH_FORMAT_VERSION })).toBe(true);
  const { record, result } = await runMatch(config, { 1: { decide: () => [] }, 2: { decide: () => [] } });
  const wire = JSON.parse(JSON.stringify(record));
  expect(wire.version).toBe(5);
  expect(validateMatchRecord(wire)).toBe(true);
  expect(validateMatchResult(result)).toBe(true);
  let ticks = 0;
  expect(replayRecord(wire, undefined, s => { expect(s.mapgenVersion).toBe(1); ticks++; }))
    .toEqual({ ok: true, checked: 1 });
  expect(ticks).toBe(100);
  // Relabelling cannot turn the changed map into a legacy seed.
  expect(replayRecord({ ...wire, version: 4 }).ok).toBe(false);
  const old = createGame(seed, undefined, undefined, 'arabia', undefined, undefined, undefined, 0);
  expect(checksumState(old)).not.toBe(checksumState(createGame(seed)));
});
