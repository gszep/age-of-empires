import { describe, expect, it } from 'vitest';
import { FALLBACK_RULES, TICK_SECONDS } from './data';
import { addNode, applyCommand, createGame, holdOf, rateOn, stepGame } from './game';
import { checksumState } from './checksum';
import type { Entity, GameState } from './types';

function fixture() {
  const state = createGame(82);
  state.entities = state.entities.filter(e => e.owner !== 0);
  state.terrain.fill(0);
  const villagers = state.entities.filter(e => e.kind === 'villager' && e.owner === 1);
  const home = state.entities.find(e => e.kind === 'town-center' && e.owner === 1)!;
  const rules = FALLBACK_RULES.buildings.farm;
  const farm: Entity = {
    id: state.nextId++, kind: 'farm', owner: 1,
    position: { x: home.position.x + 5, y: home.position.y },
    hp: rules.hp, maxHp: rules.hp, radius: rules.radius,
    resourceKind: 'food', amount: 100, activity: 'idle', order: { kind: 'idle' },
  };
  state.entities.push(farm);
  for (const worker of villagers) worker.position = { ...farm.position };
  stepGame(state);
  return { state, farm, villagers, home };
}
const order = (state: GameState, workers: Entity[], farm: Entity, queue = false) =>
  applyCommand(state, { kind: 'order', player: 1, entityIds: workers.map(e => e.id), target: farm.position, targetId: farm.id, queue });
const farmers = (state: GameState, farm: Entity) => state.entities.filter(e =>
  !e.dead && e.order.kind === 'gather' && e.order.targetId === farm.id);

describe('one villager per farm (#82)', () => {
  it('a group order assigns one farmer and gathers only one worker’s food', () => {
    const { state, farm, villagers } = fixture();
    expect(order(state, villagers, farm).ok).toBe(true);
    expect(farmers(state, farm)).toHaveLength(1);
    const worker = farmers(state, farm)[0];
    for (let i = 0; i < 200; i++) stepGame(state);
    expect(100 - farm.amount!).toBe(Math.floor(rateOn(state, worker, farm) * TICK_SECONDS * 200));
    expect(villagers.filter(e => e.activity === 'gathering')).toHaveLength(1);
  });

  it('spreads surplus villagers across nearby free farms without replacing the incumbent', () => {
    const { state, farm, villagers } = fixture();
    // A higher-id incumbent must not lose its farm to a later lower-id order.
    const incumbent = villagers.at(-1)!;
    order(state, [incumbent], farm);
    const second = { ...farm, id: state.nextId++, position: { x: farm.position.x, y: farm.position.y + 3 } };
    state.entities.push(second);
    order(state, villagers.slice(0, -1), farm);
    expect(farmers(state, farm).map(e => e.id)).toEqual([incumbent.id]);
    expect(farmers(state, second)).toHaveLength(1);
    expect(villagers.filter(e => e.order.kind === 'idle')).toHaveLength(1);
  });

  it('keeps the reservation while approaching, dropping off food, and returning', () => {
    const { state, farm, villagers, home } = fixture();
    const [worker, other] = villagers;
    worker.position = { x: home.position.x - 10, y: home.position.y };
    order(state, [worker], farm);
    order(state, [other], farm);
    expect(farmers(state, farm).map(e => e.id)).toEqual([worker.id]);
    worker.position = { ...home.position };
    const amount = holdOf(state, worker);
    worker.carrying = { kind: 'food', amount };
    const before = state.players[1].food;
    stepGame(state);
    expect(state.players[1].food - before).toBe(amount);
    order(state, [other], farm);
    expect(farmers(state, farm).map(e => e.id)).toEqual([worker.id]);
  });

  it.each(['stop', 'delete', 'move'] as const)('%s releases a farmer’s reservation immediately', action => {
    const { state, farm, villagers } = fixture();
    const [worker, next] = villagers;
    order(state, [worker], farm);
    if (action === 'move') applyCommand(state, { kind: 'order', player: 1, entityIds: [worker.id], target: { x: 10, y: 10 } });
    else applyCommand(state, { kind: action, player: 1, entityIds: [worker.id] });
    order(state, [next], farm);
    expect(farmers(state, farm).map(e => e.id)).toEqual([next.id]);
  });

  it('only one participating builder becomes the farmer on completion', () => {
    const { state, farm, villagers } = fixture();
    farm.buildProgress = 0.999;
    farm.amount = undefined;
    villagers[0].position = { x: farm.position.x + 15, y: farm.position.y };
    order(state, villagers, farm);
    expect(villagers.every(e => e.order.kind === 'build')).toBe(true);
    stepGame(state);
    expect(farm.buildProgress).toBeUndefined();
    expect(farmers(state, farm)).toHaveLength(1);
    expect(farmers(state, farm)[0].id).not.toBe(villagers[0].id);
    expect(villagers.filter(e => e.order.kind === 'idle')).toHaveLength(2);
  });

  it('automatic continuation skips occupied farms, and queued orders check at execution', () => {
    const { state, farm, villagers } = fixture();
    const [farmer, forager, queued] = villagers;
    order(state, [farmer], farm);
    const berry = addNode(state, 'berries', { x: farm.position.x, y: farm.position.y + 3 });
    berry.amount = 0;
    forager.order = { kind: 'gather', targetId: berry.id };
    forager.lastResource = 'food';
    forager.lastWorked = 'resource';
    queued.order = { kind: 'move', target: { ...queued.position } };
    order(state, [queued], farm, true);
    for (let i = 0; i < 5; i++) stepGame(state);
    expect(farmers(state, farm).map(e => e.id)).toEqual([farmer.id]);
    expect(forager.order.kind).toBe('idle');
    expect(queued.order.kind).toBe('idle');
  });

  it('repairs duplicate pre-fix orders deterministically without multiplying the yield', () => {
    const { state, farm, villagers } = fixture();
    for (const worker of villagers) worker.order = { kind: 'gather', targetId: farm.id };
    const replay = JSON.parse(JSON.stringify(state)) as GameState;
    for (let i = 0; i < 200; i++) { stepGame(state); stepGame(replay); }
    expect(farmers(state, farm)).toHaveLength(1);
    expect(100 - farm.amount!).toBe(3);
    expect(checksumState(state)).toBe(checksumState(replay));
  });
});
