import { describe, expect, it } from 'vitest';
import { exampleAiCommands } from './ai';
import { applyCommand, createGame, stepGame } from './game';
import { observe } from './observe';
import { checksumState } from './checksum';
import { validateObservation } from '../protocol/validate';
import type { AnimalKind, Entity, GameState } from './types';

function fixture(kind: AnimalKind = 'sheep') {
  const state = createGame(85);
  state.entities = state.entities.filter(e => e.kind === 'town-center' || e.kind === 'villager');
  state.terrain.fill(0);
  const home = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
  const workers = state.entities.filter(e => e.owner === 1 && e.kind === 'villager');
  const rule = state.rules.units[kind];
  const herd: Entity[] = Array.from({ length: 3 }, (_, i) => ({
    id: state.nextId++, kind, owner: 1, hp: rule.hp, maxHp: rule.hp, radius: rule.radius,
    position: { x: home.position.x + 5, y: home.position.y + i * 2 },
    resourceKind: 'food', amount: rule.foodAmount, order: { kind: 'idle' }, activity: 'idle',
  }));
  state.entities.push(...herd);
  workers.forEach((w, i) => { w.position = { x: herd[i].position.x + 0.5, y: herd[i].position.y }; });
  state.players[1].food = 0; state.players[1].wood = 0;
  return { state, herd, workers };
}
function run(state: GameState, ticks: number, ai = false) {
  for (let i = 0; i < ticks; i++) {
    if (ai && i % 20 === 0) {
      for (const c of exampleAiCommands(JSON.parse(JSON.stringify(observe(state, 1))))) applyCommand(state, c);
    }
    stepGame(state);
  }
}

describe('herd food and spoilage (#85)', () => {
  it('shows edible carcasses and only own gather assignments over the public wire', () => {
    const { state, herd, workers } = fixture();
    applyCommand(state, { kind: 'order', player: 1, entityIds: [workers[0].id], target: herd[0].position, targetId: herd[0].id });
    run(state, 1);
    expect(herd[0].dead).toBe(true);
    const own = JSON.parse(JSON.stringify(observe(state, 1)));
    expect(validateObservation(own)).toBe(true);
    expect(own.entities.find((e: any) => e.id === herd[0].id)).toMatchObject({ hp: 0, amount: 100 });
    expect(own.entities.find((e: any) => e.id === workers[0].id)).toHaveProperty('gatherTargetId', herd[0].id);
    state.visibility[2].visible.fill(1);
    expect(observe(state, 2).entities.find(e => e.id === workers[0].id)).not.toHaveProperty('gatherTargetId');
    applyCommand(state, { kind: 'stop', player: 1, entityIds: [workers[0].id] });
    expect(observe(state, 1).entities.find(e => e.id === workers[0].id)).not.toHaveProperty('gatherTargetId');
  });

  it('eats one sheep before killing the next, even with workers beside different sheep', () => {
    const { state, herd } = fixture();
    run(state, 20 * 20, true);
    expect(herd.filter(e => e.dead)).toHaveLength(1);
    expect(herd.find(e => e.dead)!.amount).toBeGreaterThan(0);
    // The next carcass must not appear while the first still has food.
    for (let i = 0; i < 20 * 240 && herd.filter(e => e.dead).length < 2; i++) {
      run(state, 1, i % 20 === 0);
      expect(herd.filter(e => e.dead && e.amount! > 0).length).toBeLessThanOrEqual(1);
    }
    expect(herd.filter(e => e.dead).length).toBeGreaterThanOrEqual(2);
  });

  it.each(['sheep', 'deer', 'boar'] as const)('decays %s only after death, by elapsed time even with no gatherer', kind => {
    const { state, herd } = fixture(kind);
    const animal = herd[0];
    state.entities = state.entities.filter(e => e.kind === 'town-center' || e.id === animal.id);
    const initial = animal.amount!;
    run(state, 200);
    expect(animal.amount).toBe(initial);
    // Public Delete supplies the death without a worker taking any food.
    expect(applyCommand(state, { kind: 'delete', player: 1, entityIds: [animal.id] }).ok).toBe(true);
    run(state, 20 * 20);
    expect(animal.amount).toBe(initial - (kind === 'boar' ? 8 : 5));
    animal.amount = 1;
    run(state, 20 * 5);
    expect(animal.amount).toBe(0);
    expect(observe(state, 1).entities.some(e => e.id === animal.id)).toBe(false);
  });

  it('automatic continuation shares the next sheep without an AI correcting orders', () => {
    const { state, herd, workers } = fixture();
    herd[0].amount = 1;
    for (const w of [workers[0], workers[2]]) {
      applyCommand(state, { kind: 'order', player: 1, entityIds: [w.id], target: herd[0].position, targetId: herd[0].id });
    }
    run(state, 20 * 30);
    expect(herd[0].amount).toBe(0);
    expect(herd.filter(e => e.dead && e.amount! > 0)).toHaveLength(1);
    const targets = [workers[0], workers[2]].map(w => w.order.kind === 'gather' ? w.order.targetId : undefined);
    expect(new Set(targets).size).toBe(1);
    expect(targets[0]).toBe(herd.find(e => e.dead && e.amount! > 0)!.id);
  });

  it('accounts for both collected and spoiled food while a shepherd works', () => {
    const { state, herd, workers } = fixture();
    state.entities = state.entities.filter(e => e.kind === 'town-center' || e.id === herd[0].id || e.id === workers[0].id);
    const initial = herd[0].amount! + state.players[1].food;
    applyCommand(state, { kind: 'order', player: 1, entityIds: [workers[0].id], target: herd[0].position, targetId: herd[0].id });
    run(state, 20 * 20);
    const remaining = herd[0].amount! + state.players[1].food + (workers[0].carrying?.amount ?? 0);
    expect(workers[0].carrying?.amount).toBeGreaterThan(0);
    expect(initial - remaining).toBe(5);
  });

  it('does not reveal a foreign carcass outside sight or leave it selectable after food runs out', () => {
    const { state, herd } = fixture();
    applyCommand(state, { kind: 'delete', player: 1, entityIds: [herd[0].id] });
    state.visibility[2].visible.fill(0);
    expect(observe(state, 2).entities.some(e => e.id === herd[0].id)).toBe(false);
    state.visibility[2].visible.fill(1);
    expect(observe(state, 2).entities.find(e => e.id === herd[0].id)).toMatchObject({ hp: 0, amount: 100 });
    herd[0].amount = 0;
    expect(observe(state, 2).entities.some(e => e.id === herd[0].id)).toBe(false);
  });

  it('replays food decay and automatic herd continuation identically', () => {
    const a = fixture().state;
    const b = JSON.parse(JSON.stringify(a));
    run(a, 1200, true); run(b, 1200, true);
    expect(checksumState(a)).toBe(checksumState(b));
  });
});
