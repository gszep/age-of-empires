import { describe, expect, it } from 'vitest';
import { exampleAiCommands } from './ai';
import { addNode, applyCommand, createGame, stepGame } from './game';
import { observe } from './observe';
import type { BuildingKind, Entity, GameState } from './types';

function fixture() {
  const state = createGame(7);
  const tc = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
  state.entities = state.entities.filter(e => e.kind === 'town-center' || (e.owner === 1 && e.kind === 'villager'));
  state.visibility[1].memory = {};
  state.terrain.fill(0); state.elevation.fill(0);
  const workers = state.entities.filter(e => e.kind === 'villager');
  for (let i = 0; i < 2; i++) {
    const worker = { ...structuredClone(workers[0]), id: state.nextId++,
      position: { x: tc.position.x + 4, y: tc.position.y + i } };
    workers.push(worker); state.entities.push(worker);
  }
  const put = (kind: BuildingKind, dx: number, dy: number) => {
    const r = state.rules.buildings[kind];
    const entity: Entity = { id: state.nextId++, kind, owner: 1,
      position: { x: tc.position.x + dx, y: tc.position.y + dy },
      hp: r.hp, maxHp: r.hp, radius: r.radius, order: { kind: 'idle' }, activity: 'idle',
      ...(kind === 'farm' ? { resourceKind: 'food' as const, amount: 175 } : {}) };
    state.entities.push(entity); return entity;
  };
  const farm = put('farm', -5, -5);
  workers[0].order = { kind: 'gather', targetId: farm.id };
  workers[0].activity = 'moving';
  Object.assign(state.players[1], { food: 0, wood: 0, gold: 0, populationCap: 20 });
  // Slots0,2,4 are food workers in the unchanged assignment policy.
  return { state, tc, workers, hungry: [workers[2], workers[4]], farm, put };
}
function decision(state: GameState) {
  state.visibility[1].visible.fill(1); state.visibility[1].explored.fill(1);
  return exampleAiCommands(JSON.parse(JSON.stringify(observe(state, 1))));
}

describe('AI farm reservations (#326)', () => {
  it.each(['moving', 'gathering', 'carrying'] as const)('does not send idle workers to a farmer who is %s; works another food source', activity => {
    const { state, tc, workers, hungry, farm } = fixture();
    workers[0].activity = activity;
    if (activity === 'carrying') workers[0].carrying = { kind: 'food', amount: 10 };
    const berries = addNode(state, 'berries', { x: tc.position.x + 5.5, y: tc.position.y + 5.5 });
    for (let attempt = 0; attempt < 3; attempt++) {
      const commands = decision(state);
      const foodOrders = commands.filter(c => c.kind === 'order' && c.entityIds.some(id => hungry.some(w => w.id === id)));
      if (!attempt) expect(foodOrders).toHaveLength(2);
      for (const command of foodOrders) {
        expect(command.kind === 'order' && command.targetId).not.toBe(farm.id);
        expect(command.kind === 'order' && command.targetId).toBe(berries.id);
      }
      for (const command of commands) expect(applyCommand(state, command).ok).toBe(true);
      for (let i = 0; i < 10; i++) stepGame(state);
      expect(hungry.filter(w => w.order.kind === 'idle')).toHaveLength(0);
    }
    const initial = berries.amount!;
    for (let i = 0; i < 400 && berries.amount === initial; i++) stepGame(state);
    expect(berries.amount).toBeLessThan(initial);
  });

  it('reserves a free farm within the command batch and sends the next worker elsewhere', () => {
    const { state, tc, hungry, put } = fixture();
    const free = put('farm', 4, 4);
    const berries = addNode(state, 'berries', { x: tc.position.x + 12.5, y: tc.position.y + 12.5 });
    const commands = decision(state);
    const orders = commands.filter(c => c.kind === 'order' && c.entityIds.some(id => hungry.some(w => w.id === id)));
    expect(orders).toHaveLength(2);
    expect(orders.map(c => c.kind === 'order' && c.targetId)).toEqual([free.id, berries.id]);
    for (const c of commands) expect(applyCommand(state, c).ok).toBe(true);
    expect(hungry.every(w => w.order.kind === 'gather')).toBe(true);
    expect(hungry.filter(w => w.order.kind === 'gather' && w.order.targetId === free.id)).toHaveLength(1);
  });

  it('recognizes a released reservation on the next observation, without private AI state', () => {
    const { state, workers, hungry, farm } = fixture();
    expect(applyCommand(state, { kind: 'stop', player: 1, entityIds: [workers[0].id] }).ok).toBe(true);
    // Keep the former farmer occupied so the next food worker claims the plot.
    expect(applyCommand(state, { kind: 'order', player: 1, entityIds: [workers[0].id],
      target: { x: 50, y: 50 } }).ok).toBe(true);
    const commands = decision(state);
    const claims = commands.filter(c => c.kind === 'order' && c.targetId === farm.id);
    expect(claims).toHaveLength(1);
    expect(claims[0].kind === 'order' && claims[0].entityIds).toEqual([hungry[0].id]);
  });

  it('does not treat a rounded 100% farm foundation as a free food source', () => {
    const { state, tc, hungry, put } = fixture();
    const pending = put('farm', 4, 4); pending.buildProgress = .9999;
    const berries = addNode(state, 'berries', { x: tc.position.x + 12.5, y: tc.position.y + 12.5 });
    const orders = decision(state).filter(c => c.kind === 'order' && c.entityIds.some(id => hungry.some(w => w.id === id)));
    expect(orders).toHaveLength(2);
    for (const c of orders) expect(c.kind === 'order' && c.targetId).toBe(berries.id);
  });

  it('builds and works another farm when food is needed and no free food source exists', () => {
    const { state, workers, farm, put } = fixture();
    const idleBefore = workers.filter(e => e.order.kind === 'idle').length;
    for (const [kind, dx] of [['barracks', 15], ['archery-range', 20], ['blacksmith', 25]] as const) put(kind, dx, 15);
    state.players[1].age = 1;
    state.players[1].wood = 60;
    const commands = decision(state);
    expect(commands.some(c => c.kind === 'order' && c.targetId === farm.id)).toBe(false);
    const build = commands.find(c => c.kind === 'build' && c.building === 'farm');
    expect(build).toBeDefined();
    for (const c of commands) expect(applyCommand(state, c).ok).toBe(true);
    const added = state.entities.find(e => e.kind === 'farm' && e.id !== farm.id)!;
    for (let i = 0; i < 1000 && (added.buildProgress !== undefined || added.amount === 175); i++) {
      if (i % 10 === 0) for (const c of decision(state)) applyCommand(state, c);
      stepGame(state);
    }
    expect(added.buildProgress).toBeUndefined();
    expect(added.amount).toBeLessThan(175);
    // Whoever the existing builder-selection policy used now has a productive plot.
    expect(state.entities.some(e => e.order.kind === 'gather' && e.order.targetId === added.id)).toBe(true);
    expect(workers.filter(e => e.order.kind === 'idle').length).toBeLessThan(idleBefore);
  });
});
