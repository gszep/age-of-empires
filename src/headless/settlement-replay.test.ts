import { expect, it } from 'vitest';
import { runMatch, replayRecord } from './runner';
import { applyCommand, createGame, offersFarmReseed, stepGame } from '../sim/game';
import { createReplayGame } from '../sim/replay';
import { checksumState } from '../sim/checksum';
import { FALLBACK_RULES } from '../sim/data';
import { freeSpot } from '../sim/test-helpers/economy';
import { SharedMatch } from '../shared/match';
import { validateMatchRecord } from '../protocol/validate';

// Synthetic venue plumbing: real Inca construction/costs are covered by the
// imported economy tests. Keep this compatibility test runnable without assets.
function fixture() {
  const rules = structuredClone(FALLBACK_RULES);
  rules.buildings.settlement = { ...rules.buildings.mill, buildable: true, buildSeconds: 0.05 };
  const state = createGame(321, rules);
  const worker = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
  const target = freeSpot(state, 'settlement', worker.position);
  return { rules, state, worker, target };
}

it.each([12, 13] as const)('v%s replays a recorded Settlement reseed with version-correct acceptance and checksums', async version => {
  const { rules, worker, target } = fixture();
  // A v12 launch config starts current rules; only recorded v12 playback is legacy.
  const { record } = await runMatch({ version: 12, seed: 321, maxTimeSeconds: 20 }, {
    1: { decide: ({ observation: o }) => {
      if (o.time === 0) return [{ kind: 'build', player: 1, building: 'settlement', builderIds: [worker.id], target }];
      if (o.time !== 10) return [];
      const venue = o.entities.find(e => e.owner === 1 && e.kind === 'settlement')!;
      expect(venue.buildProgress).toBeUndefined();
      return [{ kind: 'reseed', player: 1, buildingId: venue.id, enabled: true }];
    } }, 2: { decide: () => [] },
  }, rules);
  expect(record.version).toBe(13);
  expect(record.result.rejectedCommands).toEqual([]);
  const reseed = record.commands.find(c => c.command.kind === 'reseed')!;
  expect(reseed).toBeDefined();
  const wire = JSON.parse(JSON.stringify({ ...record, version, result: { ...record.result, version } }));
  if (version === 12) {
    // Independent legacy expectation: execute the build, omit the rejected
    // reseed from state evolution, but retain it in the recording being replayed.
    const expected = createReplayGame(wire, rules);
    wire.checksums = [];
    while (expected.tick < record.checksums.at(-1)!.tick) {
      for (const entry of record.commands.filter(c => c.tick === expected.tick)) {
        if (entry.command.kind === 'reseed') {
          const before = checksumState(expected);
          expect(applyCommand(expected, entry.command).ok).toBe(false);
          expect(checksumState(expected)).toBe(before);
        } else expect(applyCommand(expected, entry.command).ok).toBe(true);
      }
      stepGame(expected);
      if (record.checksums.some(c => c.tick === expected.tick)) {
        wire.checksums.push({ tick: expected.tick, hash: checksumState(expected) });
      }
    }
  }
  const valid = validateMatchRecord(wire);
  expect(valid, JSON.stringify(validateMatchRecord.errors)).toBe(true);
  let checkedOutcome = false;
  expect(replayRecord(wire, rules, state => {
    if (state.tick <= reseed.tick) return;
    checkedOutcome = true;
    expect(state.players[1].autoReseedFarms).toBe(version === 13 ? true : undefined);
  })).toEqual({ ok: true, checked: wire.checksums.length });
  expect(checkedOutcome).toBe(true);
});

it.each([false, true])('saved Settlement reseed policy survives JSON and shared restart enables it (legacy=%s)', legacy => {
  const { state, worker, target } = fixture();
  expect(applyCommand(state, { kind: 'build', player: 1, building: 'settlement', builderIds: [worker.id], target }).ok).toBe(true);
  const venue = state.entities.find(e => e.kind === 'settlement')!;
  for (let i = 0; i < 1000 && venue.buildProgress !== undefined; i++) stepGame(state);
  expect(venue.buildProgress).toBeUndefined();
  if (legacy) delete state.settlementReseedVersion;
  const host = new SharedMatch(JSON.parse(JSON.stringify(state)));
  expect(offersFarmReseed('settlement', host.state)).toBe(!legacy);
  expect(applyCommand(host.state, { kind: 'reseed', player: 1, buildingId: venue.id, enabled: true }).ok).toBe(!legacy);
  expect(host.state.players[1].autoReseedFarms).toBe(legacy ? undefined : true);
  // Mill commands stay valid regardless of this marker.
  const restoredVenue = host.state.entities.find(e => e.id === venue.id)!;
  restoredVenue.kind = 'mill';
  expect(offersFarmReseed('mill', host.state)).toBe(true);
  expect(applyCommand(host.state, { kind: 'reseed', player: 1, buildingId: venue.id, enabled: true }).ok).toBe(true);
  host.restart(321, 'arabia');
  expect(host.state.settlementReseedVersion).toBe(1);
  expect(offersFarmReseed('settlement', host.state)).toBe(true);
});
