import { describe, expect, it } from 'vitest';
import { FALLBACK_RULES, TICKS_PER_SECOND } from './data';
import { applyCommand, createGame, placementLegal, queuedCount, stepGame, TRAINING_QUEUE_LIMIT } from './game';
import { checksumState } from './checksum';
import type { Entity, GameState, Point } from './types';

function fixture() {
  const state = createGame(143);
  const tc = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
  state.players[1].food = 10_000;
  state.players[1].gold = 10_000;
  const train = () => applyCommand(state, { kind: 'train', player: 1, buildingId: tc.id, unit: 'villager' });
  const duration = Math.round(state.rules.units.villager.trainSeconds * TICKS_PER_SECOND);
  return { state, tc, train, duration };
}
const run = (state: GameState, ticks: number) => { for (let i = 0; i < ticks; i++) stepGame(state); };

function buildHouse(state: GameState) {
  const worker = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
  let position: Point | undefined;
  for (let y = worker.position.y - 10; y <= worker.position.y + 10 && !position; y++) {
    for (let x = worker.position.x - 10; x <= worker.position.x + 10; x++) {
      const at = { x: Math.round(x), y: Math.round(y) };
      if (placementLegal(state, 'house', at).ok) { position = at; break; }
    }
  }
  expect(position, 'nearby legal house site').toBeDefined();
  expect(applyCommand(state, { kind: 'build', player: 1, builderIds: [worker.id], building: 'house', target: position! }).ok).toBe(true);
  return state.entities.find(e => e.kind === 'house' && e.owner === 1)!;
}

describe('population-blocked production (#143)', () => {
  it('accepts and charges all fifteen entries despite insufficient housing, but no more', () => {
    const { state, tc, train } = fixture();
    const before = state.players[1].food;
    const opening = state.players[1].population;
    for (let i = 0; i < TRAINING_QUEUE_LIMIT; i++) expect(train()).toEqual({ ok: true });
    expect(queuedCount(tc)).toBe(15);
    expect(state.players[1].food).toBe(before - 15 * state.rules.units.villager.cost.food);
    expect(state.players[1].population).toBe(opening);
    expect(train()).toEqual({ ok: false, reason: 'training queue is full' });
  });

  it('finishes at the cap, waits at 100%, then releases and advances after a real house completes', () => {
    const { state, tc, train, duration } = fixture();
    for (let i = 0; i < 3; i++) expect(train().ok).toBe(true);
    const paid = state.players[1].food;
    run(state, duration * 3);
    expect(state.players[1].population).toBe(state.players[1].populationCap);
    expect(tc.training).toEqual({ kind: 'villager', remainingTicks: 0 });
    expect(tc.trainingQueue).toEqual(['villager']);
    const blockedPopulation = state.players[1].population;
    const house = buildHouse(state);
    const replay = JSON.parse(JSON.stringify(state)) as GameState;
    for (let i = 0; i < 4000 && house.buildProgress !== undefined; i++) { stepGame(state); stepGame(replay); }
    expect(house.buildProgress).toBeUndefined();
    stepGame(state); stepGame(replay);
    expect(state.players[1].population).toBe(blockedPopulation + 1);
    expect(tc.training).toEqual({ kind: 'villager', remainingTicks: duration });
    expect(tc.trainingQueue).toBeUndefined();
    run(state, duration); run(replay, duration);
    expect(state.players[1].population).toBe(blockedPopulation + 2);
    expect(queuedCount(tc)).toBe(0);
    expect(state.players[1].food).toBe(paid);
    expect(checksumState(state)).toBe(checksumState(replay));
  });

  it('can add and cancel queued entries while the active unit is blocked, refunding each once', () => {
    const { state, tc, train, duration } = fixture();
    train(); run(state, duration); // opening 4/5 becomes 5/5
    const before = state.players[1].food;
    expect(train().ok).toBe(true);
    run(state, duration + 10);
    expect(tc.training?.remainingTicks).toBe(0);
    expect(train().ok).toBe(true);
    expect(applyCommand(state, { kind: 'cancel-train', player: 1, buildingId: tc.id, index: 0 }).ok).toBe(true);
    expect(tc.training?.remainingTicks).toBe(duration);
    expect(applyCommand(state, { kind: 'cancel-train', player: 1, buildingId: tc.id, index: 0 }).ok).toBe(true);
    expect(state.players[1].food).toBe(before);
    expect(queuedCount(tc)).toBe(0);
  });

  it('allocates the final place only once across simultaneous producers, then resumes after a death', () => {
    const { state, tc, train } = fixture();
    const rule = state.rules.buildings.barracks;
    const barracks: Entity = { id: state.nextId++, kind: 'barracks', owner: 1,
      position: { x: tc.position.x + 8, y: tc.position.y + 8 },
      hp: rule.hp, maxHp: rule.hp, radius: rule.radius, activity: 'idle', order: { kind: 'idle' } };
    state.entities.push(barracks);
    expect(train().ok).toBe(true);
    expect(applyCommand(state, { kind: 'train', player: 1, buildingId: barracks.id, unit: 'militia' }).ok).toBe(true);
    tc.training!.remainingTicks = 1;
    barracks.training!.remainingTicks = 1;
    stepGame(state);
    expect(state.players[1].population).toBe(5);
    expect(tc.training).toBeUndefined();
    expect(barracks.training?.remainingTicks).toBe(0);
    const scout = state.entities.find(e => e.owner === 1 && e.kind === 'scout-cavalry')!;
    applyCommand(state, { kind: 'delete', player: 1, entityIds: [scout.id] });
    stepGame(state);
    expect(barracks.training).toBeUndefined();
    expect(state.players[1].population).toBe(5);
  });

  it('does not confuse queue permission with affordability', () => {
    const { state, tc, train } = fixture();
    state.players[1].populationCap = state.players[1].population;
    state.players[1].food = FALLBACK_RULES.units.villager.cost.food - 1;
    expect(train()).toEqual({ ok: false, reason: 'not enough food' });
    expect(queuedCount(tc)).toBe(0);
  });

  it('waits for the full population cost, not merely one empty slot', () => {
    const { state, tc } = fixture();
    state.rules = structuredClone(state.rules);
    state.rules.units.militia.popCost = 2;
    const rule = state.rules.buildings.barracks;
    const barracks: Entity = { id: state.nextId++, kind: 'barracks', owner: 1,
      position: { x: tc.position.x + 8, y: tc.position.y + 8 },
      hp: rule.hp, maxHp: rule.hp, radius: rule.radius, activity: 'idle', order: { kind: 'idle' } };
    state.entities.push(barracks);
    expect(state.players[1].populationCap - state.players[1].population).toBe(1);
    expect(applyCommand(state, { kind: 'train', player: 1, buildingId: barracks.id, unit: 'militia' }).ok).toBe(true);
    barracks.training!.remainingTicks = 1;
    stepGame(state);
    expect(barracks.training?.remainingTicks).toBe(0);
    const scout = state.entities.find(e => e.owner === 1 && e.kind === 'scout-cavalry')!;
    applyCommand(state, { kind: 'delete', player: 1, entityIds: [scout.id] });
    stepGame(state);
    expect(barracks.training).toBeUndefined();
    expect(state.players[1].population).toBe(5);
  });
});
