import { expect, it } from 'vitest';
import preTargetingRecord from './fixtures/pre-trebuchet-targeting-v7.json';
import { replayRecord, runMatch } from './runner';
import { trebuchetReplayRules } from './trebuchet-replay.fixture';
import { MATCH_FORMAT_VERSION, type MatchRecord } from '../protocol/types';
import { validateMatchConfig, validateMatchRecord, validateMatchResult } from '../protocol/validate';
import { applyCommand, createGame, stepGame } from '../sim/game';
import { synchronizationHash } from '../shared/checksum';
import type { GameState } from '../sim/types';

it('replays frozen pre-change v7 idle packed acquisition, setup and actual damage', () => {
  const record = JSON.parse(JSON.stringify(preTargetingRecord)) as MatchRecord;
  expect(validateMatchRecord(record)).toBe(true);
  const rules = trebuchetReplayRules(), original = JSON.stringify(rules);
  let acquired: number | undefined, deployed: number | undefined, damaged: number | undefined;
  expect(replayRecord(record, rules, state => {
    expect(state).not.toHaveProperty('trebuchetTargetingVersion');
    const treb = state.entities.find(e => e.kind === 'trebuchet');
    if (treb?.order.kind === 'attack' && treb.order.automatic && acquired === undefined) acquired = state.tick;
    if (treb?.unpacked && deployed === undefined) deployed = state.tick;
    if (state.entities.some(e => e.owner === 2 && e.kind === 'town-center' && e.hp < e.maxHp)
      && damaged === undefined) damaged = state.tick;
  })).toEqual({ ok: true, checked: 12 });
  // Generated and independently replayed by untouched1c316d8, not this engine.
  expect({ acquired, deployed, damaged }).toEqual({ acquired: 10, deployed: 233, damaged: 660 });
  expect(JSON.stringify(rules)).toBe(original);
  expect(replayRecord({ ...record, version: MATCH_FORMAT_VERSION }, rules).ok).toBe(false);
});

it('writes v8 for a v7 launch and replays packed idle without damage', async () => {
  expect(MATCH_FORMAT_VERSION).toBe(8);
  for (const version of [1, 2, 3, 4, 5, 6, 7, 8]) expect(validateMatchConfig({ version, seed: 131 })).toBe(true);
  expect(validateMatchConfig({ version: 9, seed: 131 })).toBe(false);
  const prior = preTargetingRecord as MatchRecord, rules = trebuchetReplayRules();
  const { record, result } = await runMatch({ version: 7, seed: 131, maxTimeSeconds: 60, decideIntervalSeconds: .05 }, {
    1: { decide: ({ observation: o }) => prior.commands.filter(c => c.tick === Math.round(o.time * 20)).map(c => c.command) },
    2: { decide: () => [] },
  }, rules);
  expect(record.version).toBe(8); expect(result.version).toBe(8);
  expect(result.rejectedCommands).toEqual([]);
  expect(validateMatchResult(result)).toBe(true);
  const wire = JSON.parse(JSON.stringify(record));
  expect(validateMatchRecord(wire)).toBe(true);
  expect(validateMatchRecord({ ...wire, version: 9 })).toBe(false);
  expect(validateMatchResult({ ...result, version: 9 })).toBe(false);
  expect(replayRecord(wire, rules, state => {
    expect(state.trebuchetTargetingVersion).toBe(1);
    const treb = state.entities.find(e => e.kind === 'trebuchet');
    if (treb) {
      expect(treb.order.kind).toBe('idle'); expect(treb.unpacked).toBeFalsy();
      expect(treb.packingTicks).toBeUndefined();
    }
    expect(state.projectiles).toHaveLength(0);
    expect(state.entities.find(e => e.owner === 2 && e.kind === 'town-center')!.hp)
      .toBe(state.entities.find(e => e.owner === 2 && e.kind === 'town-center')!.maxHp);
  })).toEqual({ ok: true, checked: 12 });
  expect(replayRecord({ ...wire, version: 7 }, rules).ok).toBe(false);
  expect(replayRecord({ ...wire, version: 9 }, rules).ok).toBe(false);
});

it.each([
  { legacy: false, suppressed: false }, { legacy: true, suppressed: false },
  { legacy: false, suppressed: true }, { legacy: true, suppressed: true },
])('continues JSON idle/packing state without upgrading policy ($legacy, manual Pack=$suppressed)', ({ legacy, suppressed }) => {
  const state = createGame(131, trebuchetReplayRules());
  if (legacy) delete state.trebuchetTargetingVersion;
  expect(applyCommand(state, (preTargetingRecord as MatchRecord).commands[0].command).ok).toBe(true);
  stepGame(state);
  const treb = state.entities.find(e => e.kind === 'trebuchet')!;
  if (suppressed) expect(applyCommand(state, { kind: 'pack', player: 1, entityIds: [treb.id], unpacked: false }).ok).toBe(true);
  let resumed: GameState = JSON.parse(JSON.stringify(state));
  for (let i = 0; i < 700; i++) {
    stepGame(state); stepGame(resumed);
    // Save again during legacy automatic setup (or current/suppressed idle).
    if (i === 100) {
      expect(treb.packingTicks !== undefined).toBe(legacy && !suppressed);
      expect(synchronizationHash(resumed)).toBe(synchronizationHash(state));
      resumed = JSON.parse(JSON.stringify(resumed));
    }
  }
  const check = (shouldAttack: boolean) => {
    for (const game of [state, resumed]) {
      expect(game.trebuchetTargetingVersion).toBe(legacy ? undefined : 1);
      const engine = game.entities.find(e => e.id === treb.id)!;
      expect(engine.unpacked === true).toBe(shouldAttack);
      expect(engine.packingTicks).toBeUndefined();
      const target = game.entities.find(e => e.owner === 2 && e.kind === 'town-center')!;
      expect(target.hp < target.maxHp).toBe(shouldAttack);
    }
    expect(synchronizationHash(resumed)).toBe(synchronizationHash(state));
  };
  check(legacy && !suppressed);
  if (suppressed) {
    // Old manual Pack suppresses idle deployment until Stop clears the hold;
    // current Stop still leaves it packed. Neither JSON restore upgrades it.
    for (const game of [state, resumed]) expect(applyCommand(game, { kind: 'stop', player: 1, entityIds: [treb.id] }).ok).toBe(true);
    for (let i = 0; i < 700; i++) { stepGame(state); stepGame(resumed); }
    check(legacy);
  }
});
