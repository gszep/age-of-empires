import { describe, expect, it } from 'vitest';
import { applyCommand, createGame, stepGame } from './game';
import { inheritConvertedUnit } from './rules';
import { researchCostFor } from './technologies';
import { observe } from './observe';
import { checksumState } from './checksum';
import { useLegacyScore } from './score';
import { MATCH_FORMAT_VERSION } from '../protocol/types';
import { FALLBACK_RULES } from './data';
import { validateCommand, validateObservation, validateMatchRecord } from '../protocol/validate';
import { replayRecord, runMatch } from '../headless/runner';
import type { GameState } from './types';

const townCenter = (s: GameState) => s.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
const purse = (s: GameState, owner: 1 | 2 = 1) => {
  const { food, wood, gold, stone } = s.players[owner];
  return { food, wood, gold, stone };
};
function fixture() {
  const state = createGame(293);
  Object.assign(state.players[1], { food: 2000, wood: 2000, gold: 2000, stone: 2000 });
  return { state, tc: townCenter(state) };
}
function research(s: GameState, tech: string, buildingId = townCenter(s).id) {
  expect(applyCommand(s, { kind: 'research', player: 1, buildingId, tech })).toEqual({ ok: true });
}
function until(s: GameState, tech: string) {
  for (let i = 0; i < 5000 && !s.players[1].researched.includes(tech); i++) stepGame(s);
  expect(s.players[1].researched).toContain(tech);
}
function queued() {
  const f = fixture();
  research(f.state, 'loom'); research(f.state, 'feudal-age');
  return f;
}

describe('research queueing (#293)', () => {
  it('pays both costs up front and completes in FIFO order, not concurrently', () => {
    const { state, tc } = fixture(), before = purse(state);
    const a = researchCostFor(state, 1, 'loom'), b = researchCostFor(state, 1, 'feudal-age');
    research(state, 'loom'); research(state, 'feudal-age');
    for (const key of ['food', 'wood', 'gold', 'stone'] as const) {
      expect(purse(state)[key]).toBe(before[key] - a[key] - b[key]);
    }
    expect(tc.researchQueue).toEqual(['feudal-age']);
    until(state, 'loom');
    expect(state.players[1].researched).not.toContain('feudal-age');
    expect(tc.researching?.tech).toBe('feudal-age');
    expect(tc.researchQueue).toBeUndefined();
    until(state, 'feudal-age');
    expect(tc.researching).toBeUndefined();
  });

  it('rejects unaffordable entries without changing the queue or purse', () => {
    const { state, tc } = fixture();
    research(state, 'loom');
    state.players[1].food = 0;
    const before = checksumState(state);
    expect(applyCommand(state, { kind: 'research', player: 1, buildingId: tc.id, tech: 'feudal-age' })).toMatchObject({ ok: false });
    expect(checksumState(state)).toBe(before);
  });

  it('rejects an affordable dependent technology behind its unfinished queued prerequisite', () => {
    const { state, tc } = queued();
    const cost = researchCostFor(state, 1, 'castle-age');
    for (const key of ['food', 'wood', 'gold', 'stone'] as const) {
      expect(purse(state)[key]).toBeGreaterThanOrEqual(cost[key]);
    }
    expect(tc.researchQueue).toEqual(['feudal-age']);
    expect(state.players[1].researched).not.toContain('feudal-age');
    const before = checksumState(state);
    expect(applyCommand(state, { kind: 'research', player: 1, buildingId: tc.id, tech: 'castle-age' }))
      .toMatchObject({ ok: false, reason: expect.stringMatching(/needs/) });
    expect(checksumState(state)).toBe(before);
  });

  it.each([undefined, 1])('cancels waiting research at index %s with its original price', index => {
    const { state, tc } = queued(), before = purse(state);
    tc.researchQueueCosts![0] = { food: 1, wood: 2, gold: 3, stone: 4 };
    expect(applyCommand(state, { kind: 'cancel-research', player: 1, buildingId: tc.id, index }).ok).toBe(true);
    expect(purse(state)).toEqual({ food: before.food + 1, wood: before.wood + 2, gold: before.gold + 3, stone: before.stone + 4 });
    expect(tc.researching?.tech).toBe('loom');
    expect(tc.researchQueue).toBeUndefined(); expect(tc.researchQueueCosts).toBeUndefined();
  });

  it('cancels active research explicitly and promotes the waiting entry without charging again', () => {
    const { state, tc } = fixture(), before = purse(state);
    const cost = researchCostFor(state, 1, 'feudal-age');
    research(state, 'loom'); research(state, 'feudal-age');
    expect(applyCommand(state, { kind: 'cancel-research', player: 1, buildingId: tc.id, index: 0 }).ok).toBe(true);
    expect(tc.researching?.tech).toBe('feudal-age');
    for (const key of ['food', 'wood', 'gold', 'stone'] as const) expect(purse(state)[key]).toBe(before[key] - cost[key]);
    until(state, 'feudal-age');
    expect(state.players[1].researched).not.toContain('loom');
  });

  it('rejects duplicate active/waiting research in every own building without charging', () => {
    const { state, tc } = queued();
    const other = { ...structuredClone(tc), id: state.nextId++, researching: undefined, researchQueue: undefined, researchQueueCosts: undefined };
    state.entities.push(other);
    for (const buildingId of [tc.id, other.id]) for (const tech of ['loom', 'feudal-age']) {
      const before = checksumState(state);
      expect(applyCommand(state, { kind: 'research', player: 1, buildingId, tech }).ok).toBe(false);
      expect(checksumState(state)).toBe(before);
    }
    const enemy = state.entities.find(e => e.owner === 2 && e.kind === 'town-center')!;
    expect(applyCommand(state, { kind: 'research', player: 2, buildingId: enemy.id, tech: 'loom' }).ok).toBe(true);
  });

  it('persists prices, order and ticks across a JSON save/load and finishes identically', () => {
    const { state } = queued();
    for (let i = 0; i < 50; i++) stepGame(state);
    const saved: GameState = JSON.parse(JSON.stringify(state));
    expect(townCenter(saved)).toEqual(JSON.parse(JSON.stringify(townCenter(state))));
    until(state, 'feudal-age'); until(saved, 'feudal-age');
    expect(checksumState(saved)).toBe(checksumState(state));
  });

  it('ticks past an already-completed queued technology and refunds exactly once', () => {
    const { state, tc } = queued();
    const paid = tc.researchQueueCosts![0]!;
    const before = purse(state);
    // Stage a pre-existing duplicate from the old worker/save format. New
    // commands correctly cannot create it. Another building completes first.
    state.entities.push({ ...structuredClone(tc), id: state.nextId++,
      researching: { tech: 'feudal-age', remainingTicks: 1 }, researchQueue: undefined, researchQueueCosts: undefined });
    stepGame(state);
    expect(state.players[1].researched).toContain('feudal-age');
    expect(tc.researching?.tech).toBe('loom');
    until(state, 'loom');
    for (const key of ['food', 'wood', 'gold', 'stone'] as const) expect(purse(state)[key]).toBe(before[key] + paid[key]);
    expect(tc.researching).toBeUndefined(); expect(tc.researchQueue).toBeUndefined(); expect(tc.researchQueueCosts).toBeUndefined();
    const refunded = purse(state);
    for (let i = 0; i < 20; i++) stepGame(state);
    expect(purse(state)).toEqual(refunded);
  });

  it.each(['death', 'conversion'])('%s discards all research without refund or later completion', action => {
    const { state, tc } = queued(), before = [purse(state), purse(state, 2)];
    if (action === 'death') expect(applyCommand(state, { kind: 'delete', player: 1, entityIds: [tc.id] }).ok).toBe(true);
    else inheritConvertedUnit(state, tc, 2);
    expect(tc.researching).toBeUndefined(); expect(tc.researchQueue).toBeUndefined(); expect(tc.researchQueueCosts).toBeUndefined();
    for (let i = 0; i < 700; i++) stepGame(state);
    expect([purse(state), purse(state, 2)]).toEqual(before);
    for (const owner of [1, 2] as const) expect(state.players[owner].researched).not.toContain('loom');
  });

  it('exposes detached own queues through the JSON schema and validates cancellation indices', () => {
    const { state, tc } = queued();
    const own = observe(state, 1);
    expect(validateObservation(JSON.parse(JSON.stringify(own)))).toBe(true);
    own.entities.find(e => e.id === tc.id)!.researchQueue!.push('mutated');
    expect(tc.researchQueue).toEqual(['feudal-age']);
    state.visibility[2].visible.fill(1);
    const enemy = observe(state, 2).entities.find(e => e.id === tc.id)!;
    expect(enemy).toBeDefined(); expect(enemy.researchQueue).toBeUndefined(); expect(enemy.researching).toBeUndefined();
    for (const index of [undefined, 0, 1]) expect(validateCommand({ kind: 'cancel-research', player: 1, buildingId: tc.id, index })).toBe(true);
    for (const index of [-1, .5, '1']) expect(validateCommand({ kind: 'cancel-research', player: 1, buildingId: tc.id, index })).toBe(false);
    for (const index of [-1, .5, 2]) {
      const before = checksumState(state);
      expect(applyCommand(state, { kind: 'cancel-research', player: 1, buildingId: tc.id, index }).ok).toBe(false);
      expect(checksumState(state)).toBe(before);
    }
  });

  it('keeps training and research concurrent rather than silently introducing a mixed queue', () => {
    const { state, tc } = queued();
    expect(applyCommand(state, { kind: 'train', player: 1, buildingId: tc.id, unit: 'villager' }).ok).toBe(true);
    const researchTicks = tc.researching!.remainingTicks, trainTicks = tc.training!.remainingTicks;
    stepGame(state);
    expect(tc.training!.remainingTicks).toBeLessThan(trainTicks);
    expect(tc.researching!.remainingTicks).toBeLessThan(researchTicks);
  });

  it('versions new recordings and preserves rejected busy commands in v1/v2 replay', async () => {
    const rules = structuredClone(FALLBACK_RULES);
    // Keep the record schema public (cheats are deliberately not wire commands).
    rules.technologies['feudal-age'].cost.food = 100;
    const { record } = await runMatch({ version: 3, seed: 293, maxTimeSeconds: 5 }, {
      1: { decide: ({ observation: o }) => o.time ? [] : [
        ...['loom', 'feudal-age'].map(tech => ({ kind: 'research' as const, player: 1 as const, buildingId: o.entities.find(e => e.kind === 'town-center' && e.owner === 1)!.id, tech })),
      ] }, 2: { decide: () => [] },
    }, rules);
    expect(record.version).toBe(MATCH_FORMAT_VERSION); expect(validateMatchRecord(record)).toBe(true);
    expect(record.result.rejectedCommands).toEqual([]);
    let lastQueue: string[] | undefined;
    expect(replayRecord(record, rules, s => { lastQueue = townCenter(s).researchQueue; }).ok).toBe(true);
    expect(lastQueue).toEqual(['feudal-age']);
    const legacyState = createGame(record.seed, rules, undefined, 'arabia', undefined, undefined, undefined, 0);
    useLegacyScore(legacyState);
    delete legacyState.researchQueueVersion;
    // Original semantics: the first research is paid; busy second command is rejected.
    expect(applyCommand(legacyState, record.commands[0].command).ok).toBe(true);
    expect(applyCommand(legacyState, record.commands[1].command).ok).toBe(false);
    while (legacyState.tick < 100) stepGame(legacyState);
    for (const version of [1, 2] as const) {
      const legacy = { ...record, version, mode: version === 1 ? undefined : record.mode,
        checksums: [{ tick: 100, hash: checksumState(legacyState) }] };
      expect(validateMatchRecord(JSON.parse(JSON.stringify(legacy)))).toBe(true);
      expect(replayRecord(legacy, rules)).toEqual({ ok: true, checked: 1 });
    }
    expect(replayRecord({ ...record, checksums: [{ tick: 100, hash: checksumState(legacyState) }] }, rules).ok).toBe(false);
  });
});
