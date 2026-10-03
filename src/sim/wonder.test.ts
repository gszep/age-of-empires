import { describe, expect, it } from 'vitest';
import { applyCommand, createGame, stepGame } from './game';
import { FALLBACK_RULES } from './data';
import { completeWonder, wonderCountdowns, WONDER_VICTORY_TICKS, WONDER_YEAR_TICKS } from './wonder';
import { checksumState } from './checksum';
import { runMatch, replayRecord } from '../headless/runner';
import { validateMatchConfig, validateMatchRecord } from '../protocol/validate';

function fixture(enabled = true) {
  const rules = structuredClone(FALLBACK_RULES);
  // Fixture-only fast construction; the200-year victory clock is never shortened.
  Object.assign(rules.buildings.wonder, { buildable: true, buildSeconds: .1 });
  const state = createGame(110, rules, undefined, 'arabia', 'random-map', undefined, enabled);
  const worker = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
  state.entities = state.entities.filter(e => e.kind === 'town-center' || e.id === worker.id);
  state.terrain.fill(0); state.elevation.fill(0);
  state.visibility[1].explored.fill(1); state.visibility[2].explored.fill(1);
  state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!.position = { x: 10.5, y: 10.5 };
  state.entities.find(e => e.owner === 2 && e.kind === 'town-center')!.position = { x: 90.5, y: 90.5 };
  worker.position = { x: 20, y: 20 };
  Object.assign(state.players[1], { age: 3, wood: 10000, gold: 10000, stone: 10000 });
  return { state, worker };
}
function build(f: ReturnType<typeof fixture>, x = 26.5) {
  const { state, worker } = f;
  expect(applyCommand(state, { kind: 'build', player: 1, builderIds: [worker.id], building: 'wonder', target: { x, y: 20.5 } }).ok).toBe(true);
  const site = state.entities.at(-1)!;
  expect(site.kind).toBe('wonder'); expect(site.buildProgress).toBeDefined();
  for (let i = 0; i < 500 && site.buildProgress !== undefined; i++) stepGame(state);
  expect(site.buildProgress).toBeUndefined();
  return site;
}

describe('opt-in Wonder victory', () => {
  it('starts only after paid completion, runs the full200-year clock and wins with the opponent still alive', () => {
    const f = fixture(), { state } = f;
    expect(state.wonderCountdowns).toBeUndefined();
    const site = build(f);
    expect(state.players[1]).toMatchObject({ wood: 9000, gold: 9000, stone: 9000 });
    const timer = state.wonderCountdowns![0];
    expect(timer).toEqual({ entityId: site.id, owner: 1, finishTick: state.tick + 20000 });
    expect(WONDER_YEAR_TICKS).toBe(100);
    const saved = JSON.parse(JSON.stringify(state));
    while (state.tick < timer.finishTick - 1) stepGame(state);
    expect(state.winner).toBeUndefined();
    stepGame(state);
    expect(state.winner).toBe(1);
    expect(state.entities.some(e => e.owner === 2 && !e.dead)).toBe(true);
    while (saved.tick < state.tick) stepGame(saved);
    expect(checksumState(saved)).toBe(checksumState(state));
  });

  it('cancels on public deletion even on the expiry tick and gives a rebuilt Wonder a fresh deadline', () => {
    const f = fixture(), site = build(f), { state } = f;
    state.tick = state.wonderCountdowns![0].finishTick - 1;
    expect(applyCommand(state, { kind: 'delete', player: 1, entityIds: [site.id] }).ok).toBe(true);
    expect(wonderCountdowns(state)).toHaveLength(0);
    stepGame(state);
    expect(state.winner).toBeUndefined(); expect(state.wonderCountdowns).toBeUndefined();
    const rebuilt = build(f);
    expect(state.wonderCountdowns).toEqual([{ entityId: rebuilt.id, owner: 1, finishTick: state.tick + WONDER_VICTORY_TICKS }]);
  });

  it('keeps independent standing deadlines and cancels a changed owner instead of transferring elapsed credit', () => {
    const f = fixture(), first = build(f), before = structuredClone(f.state.wonderCountdowns![0]);
    build(f, 34.5);
    expect(f.state.wonderCountdowns).toHaveLength(2);
    expect(f.state.wonderCountdowns![0]).toEqual(before);
    first.owner = 2; // fixture for the uncalibrated conversion/ownership boundary
    stepGame(f.state);
    expect(f.state.wonderCountdowns).toHaveLength(1);
    expect(f.state.wonderCountdowns![0].owner).toBe(1);
  });

  it('draws simultaneous opposing expiries but lets conquest resolve before a timer', () => {
    const f = fixture(), first = build(f), { state } = f;
    const other = { ...structuredClone(first), id: state.nextId++, owner: 2 as const, position: { x: 60.5, y: 60.5 } };
    state.entities.push(other); completeWonder(state, other);
    const fork = JSON.parse(JSON.stringify(state));
    state.tick = state.wonderCountdowns![0].finishTick - 1; stepGame(state);
    expect(state.draw).toBe(true); expect(state.winner).toBeUndefined();
    fork.tick = fork.wonderCountdowns[0].finishTick - 1;
    for (const e of fork.entities.filter((e: typeof first) => e.owner === 1)) applyCommand(fork, { kind: 'delete', player: 1, entityIds: [e.id] });
    stepGame(fork); expect(fork.winner).toBe(2); expect(fork.draw).toBeUndefined();
  });

  it('retains cosmetic legacy matches and does not arm preplaced Wonders', () => {
    const disabled = fixture(false), site = build(disabled);
    expect(disabled.state.wonderVictory).toBeUndefined(); expect(disabled.state.wonderCountdowns).toBeUndefined();
    const enabled = fixture();
    enabled.state.entities.push({ ...structuredClone(site), id: enabled.state.nextId++ });
    stepGame(enabled.state); expect(enabled.state.wonderCountdowns).toBeUndefined();
  });

  it('validates settings and carries the option through real JSON records without changing omitted-field replay', async () => {
    expect(validateMatchConfig({ version: 1, seed: 110, wonderVictory: true })).toBe(false);
    expect(validateMatchConfig({ version: 2, seed: 110, wonderVictory: 'true' })).toBe(false);
    expect(() => createGame(110, FALLBACK_RULES, undefined, 'arabia', 'random-map', undefined, 1 as never)).toThrow('Wonder');
    const idle = { decide: () => [] };
    for (const wonderVictory of [undefined, true, false]) {
      const { record } = await runMatch({ version: 2, seed: 110, maxTimeSeconds: 5, wonderVictory }, { 1: idle, 2: idle });
      const wire = JSON.parse(JSON.stringify(record));
      expect(validateMatchRecord(wire)).toBe(true); expect(replayRecord(wire)).toMatchObject({ ok: true, checked: 1 });
      if (wonderVictory) { delete wire.wonderVictory; expect(replayRecord(wire).ok).toBe(false); }
    }
  });
});
