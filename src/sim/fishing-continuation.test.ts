import { describe, expect, it } from 'vitest';
import { FALLBACK_RULES, terrainAllows } from './data';
import { addNode, applyCommand, createGame, holdOf, stepGame } from './game';
import { checksumState } from './checksum';
import { isEntityVisible } from './visibility';
import type { Entity, GameState } from './types';

function fishery() {
  const state = createGame(87);
  state.entities = state.entities.filter(e => e.owner !== 0);
  state.terrain = state.terrain.map(() => 0);
  for (let y = 15; y < 30; y++) for (let x = 20; x < 65; x++) state.terrain[y * state.width + x] = 1;
  const dockRules = FALLBACK_RULES.buildings.dock;
  const dock: Entity = { id: state.nextId++, kind: 'dock', owner: 1,
    position: { x: 20.5, y: 22.5 }, hp: dockRules.hp, maxHp: dockRules.hp,
    radius: dockRules.radius, activity: 'idle', order: { kind: 'idle' } };
  const shipRules = FALLBACK_RULES.units['fishing-ship'];
  const ship: Entity = { id: state.nextId++, kind: 'fishing-ship', owner: 1,
    position: { x: 42.5, y: 22.5 }, hp: shipRules.hp, maxHp: shipRules.hp,
    radius: shipRules.radius, activity: 'idle', order: { kind: 'idle' } };
  state.entities.push(dock, ship);
  const first = addNode(state, 'fish', { x: 43.5, y: 22.5 });
  const next = addNode(state, 'fish', { x: 46.5, y: 22.5 });
  const order = () => {
    stepGame(state);
    expect(applyCommand(state, { kind: 'order', player: 1, entityIds: [ship.id], target: first.position, targetId: first.id }).ok).toBe(true);
  };
  return { state, dock, ship, first, next, order };
}

function until(state: GameState, predicate: () => boolean, ticks = 6500) {
  for (let i = 0; i < ticks && !predicate(); i++) stepGame(state);
  expect(predicate(), `condition within ${ticks} ticks`).toBe(true);
}

describe('fishing continuation (#87)', () => {
  it.each(['full', 'partial'] as const)('continues the fishing ground after depleting a node with a %s hold', load => {
    const { state, ship, first, next, order } = fishery();
    first.amount = load === 'full' ? holdOf(state, ship) : 1;
    next.amount = 2;
    const total = first.amount + next.amount;
    const before = state.players[1].food;
    order();
    for (let i = 0; i < 6500 && state.players[1].food - before < total; i++) {
      stepGame(state);
      const tile = state.terrain[Math.floor(ship.position.y) * state.width + Math.floor(ship.position.x)];
      expect(terrainAllows(state.rules, 13, tile)).toBe(true);
    }
    expect(state.entities.some(e => e.id === first.id)).toBe(false);
    expect(next.amount, JSON.stringify({ ship, banked: state.players[1].food - before })).toBe(0);
    expect(state.players[1].food - before).toBe(total);
  });

  it('remembers the ground if another ship empties the node during banking, including a JSON reload', () => {
    const { state, ship, first, next, order } = fishery();
    first.amount = holdOf(state, ship) + 1;
    next.amount = 2;
    order();
    until(state, () => ship.activity === 'carrying');
    expect(first.amount).toBe(1);
    const helper: Entity = { ...ship, id: state.nextId++, position: { ...first.position },
      carrying: undefined, fishingPosition: undefined, path: undefined, pathGoal: undefined,
      order: { kind: 'idle' }, activity: 'idle' };
    state.entities.push(helper);
    expect(applyCommand(state, { kind: 'order', player: 1, entityIds: [helper.id], target: first.position, targetId: first.id }).ok).toBe(true);
    until(state, () => first.amount === 0);
    applyCommand(state, { kind: 'stop', player: 1, entityIds: [helper.id] });
    // The helper must not reveal the ground while the original ship banks.
    helper.position = { x: 21.5, y: 27.5 };
    until(state, () => !ship.carrying);
    expect(state.entities.some(e => e.id === first.id)).toBe(false);
    expect(isEntityVisible(state, 1, next)).toBe(false);
    const replay = JSON.parse(JSON.stringify(state)) as GameState;
    for (let i = 0; i < 2500; i++) { stepGame(state); stepGame(replay); }
    expect(next.amount).toBe(0);
    expect(checksumState(replay)).toBe(checksumState(state));
  });

  it.each(['empty', 'hidden', 'distant', 'land-food', 'enclosed'] as const)('banks and idles if the remaining supply is %s', situation => {
    const { state, ship, first, next, order } = fishery();
    first.amount = holdOf(state, ship);
    const before = state.players[1].food;
    if (situation === 'empty') next.amount = 0;
    if (situation === 'hidden') next.position = { x: 53.5, y: 22.5 };
    if (situation === 'distant') next.position = { x: 62.5, y: 22.5 };
    if (situation === 'land-food') next.node = 'berries';
    if (situation === 'enclosed') {
      // No water along the fish's footprint perimeter.
      state.terrain = state.terrain.map((tile, index) => {
        const x = index % state.width; const y = Math.floor(index / state.width);
        return x >= 44 && x <= 48 && y >= 20 && y <= 24
          && (x === 44 || x === 48 || y === 20 || y === 24) ? 0 : tile;
      });
    }
    if (situation === 'distant') {
      // Another ship reveals it, but it is beyond the local continuation bound.
      state.entities.push({ ...ship, id: state.nextId++, position: { ...next.position } });
    }
    order();
    until(state, () => ship.order.kind === 'idle');
    expect(state.players[1].food - before).toBe(holdOf(state, ship));
    expect(next.amount).toBe(situation === 'empty' ? 0 : FALLBACK_RULES.nodes.fish.amount);
    expect(ship.carrying).toBeUndefined();
    expect(ship.fishingPosition).toBeUndefined();
  });

  it.each(['stop', 'move', 'new-fish'] as const)('%s cancels the remembered fishing ground', action => {
    const { state, ship, first, next, order } = fishery();
    first.amount = holdOf(state, ship);
    order();
    until(state, () => ship.activity === 'carrying');
    expect(ship.fishingPosition).toBeDefined();
    if (action === 'stop') applyCommand(state, { kind: 'stop', player: 1, entityIds: [ship.id] });
    else applyCommand(state, { kind: 'order', player: 1, entityIds: [ship.id],
      target: next.position, targetId: action === 'new-fish' ? next.id : undefined });
    expect(ship.fishingPosition).toBeUndefined();
    expect(ship.order.kind).toBe(action === 'stop' ? 'idle' : action === 'move' ? 'move' : 'gather');
  });
});
