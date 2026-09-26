import { describe, expect, it } from 'vitest';
import { exampleAiCommands } from './ai';
import { addNode, applyCommand, createGame, stepGame } from './game';
import { observe } from './observe';
import { checksumState } from './checksum';
import { validateObservation } from '../protocol/validate';
import type { Entity, GameState, Point } from './types';

function fixture() {
  const state = createGame(146);
  state.entities = state.entities.filter(e => e.owner !== 0);
  state.terrain = state.terrain.map(() => 0);
  const workers = state.entities.filter(e => e.owner === 1 && e.kind === 'villager');
  const home = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
  const build = (worker: Entity, at: Point) => {
    expect(applyCommand(state, { kind: 'build', player: 1, builderIds: [worker.id], building: 'house', target: at }).ok).toBe(true);
    return state.entities.find(e => e.id === (worker.order as { targetId: number }).targetId)!;
  };
  const house = build(workers[0], { x: home.position.x + 6, y: home.position.y + 4 });
  for (let i = 0; i < 1000 && house.buildProgress! < 0.1; i++) stepGame(state);
  expect(house.buildProgress).toBeGreaterThanOrEqual(0.1);
  return { state, workers, home, house, build };
}
const decide = (state: GameState) => exampleAiCommands(JSON.parse(JSON.stringify(observe(state, 1))));
function finishWithAi(state: GameState, houses: Entity[]) {
  for (let i = 0; i < 2500 && houses.some(e => e.buildProgress !== undefined); i++) {
    if (i % 10 === 0) for (const command of decide(state)) applyCommand(state, command);
    stepGame(state);
  }
  for (const house of houses) expect(house.buildProgress).toBeUndefined();
}

describe('AI house completion (#146)', () => {
  it('reports an own builder’s target over JSON, hides enemy assignments and clears stopped orders', () => {
    const { state, workers, house } = fixture();
    const own = JSON.parse(JSON.stringify(observe(state, 1)));
    expect(own.version).toBe(6);
    expect(validateObservation(own)).toBe(true);
    expect(own.entities.find((e: Entity) => e.id === workers[0].id).buildTargetId).toBe(house.id);
    state.visibility[2].visible.fill(1);
    expect(observe(state, 2).entities.find(e => e.id === workers[0].id)).not.toHaveProperty('buildTargetId');
    applyCommand(state, { kind: 'stop', player: 1, entityIds: [workers[0].id] });
    expect(observe(state, 1).entities.find(e => e.id === workers[0].id)).not.toHaveProperty('buildTargetId');
  });

  it.each(['stop', 'delete'] as const)('resumes an abandoned paid house after builder %s, even with no wood', action => {
    const { state, workers, house } = fixture();
    applyCommand(state, { kind: action, player: 1, entityIds: [workers[0].id] });
    state.players[1].wood = 0;
    state.players[1].food = 0;
    finishWithAi(state, [house]);
    expect(state.players[1].populationCap).toBe(10);
    expect(state.players[1].wood).toBe(0);
    expect(state.entities.filter(e => e.kind === 'house')).toHaveLength(1);
  });

  it('finishes a foundation whose displayed progress has rounded to 100%', () => {
    const { state, workers, house } = fixture();
    applyCommand(state, { kind: 'stop', player: 1, entityIds: [workers[0].id] });
    house.buildProgress = 0.9999999999999961;
    expect(observe(state, 1).entities.find(e => e.id === house.id)?.buildProgress).toBe(1);
    state.players[1].wood = 0;
    finishWithAi(state, [house]);
  });

  it('does not confuse an approaching builder with an abandoned house', () => {
    const { state, workers, home, house, build } = fixture();
    const second = build(workers[1], { x: home.position.x - 6, y: home.position.y + 4 });
    // Its builder has a long walk, passing nearer the first house en route.
    workers[1].position = { x: home.position.x + 12, y: home.position.y + 4 };
    state.players[1].wood = 0;
    const commands = decide(state);
    expect(commands.filter(c => c.kind === 'order' && [house.id, second.id].includes(c.targetId ?? -1))).toEqual([]);
    finishWithAi(state, [house, second]);
  });

  it('gives two abandoned houses distinct builders without later gathering orders overriding them', () => {
    const { state, workers, home, house, build } = fixture();
    const second = build(workers[1], { x: home.position.x - 6, y: home.position.y + 4 });
    applyCommand(state, { kind: 'stop', player: 1, entityIds: workers.map(e => e.id) });
    addNode(state, 'berries', { x: home.position.x + 3, y: home.position.y });
    addNode(state, 'tree', { x: home.position.x - 3, y: home.position.y });
    stepGame(state);
    state.players[1].wood = 0;
    const commands = decide(state);
    const assigned = commands.filter(c => c.kind === 'order' && [house.id, second.id].includes(c.targetId ?? -1));
    expect(assigned).toHaveLength(2);
    const ids = assigned.flatMap(c => c.kind === 'order' ? c.entityIds : []);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) expect(commands.filter(c => c.kind === 'order' && c.entityIds.includes(id))).toHaveLength(1);
    finishWithAi(state, [house, second]);
  });

  it('keeps existing and newly assigned builders out of the demolition force', () => {
    const { state, workers, home, house, build } = fixture();
    // Index 1 is a wood worker, eligible for the old endgame demolition rule.
    applyCommand(state, { kind: 'order', player: 1, entityIds: [workers[1].id], target: house.position, targetId: house.id });
    const second = build(workers[0], { x: home.position.x - 6, y: home.position.y + 4 });
    applyCommand(state, { kind: 'stop', player: 1, entityIds: [workers[0].id] });
    const infantry = state.rules.units.militia;
    for (let i = 0; i < 6; i++) state.entities.push({ id: state.nextId++, kind: 'militia', owner: 1,
      position: { ...home.position }, hp: infantry.hp, maxHp: infantry.hp, radius: infantry.radius,
      activity: 'idle', order: { kind: 'idle' } });
    state.entities = state.entities.filter(e => e.owner !== 2 || e.kind === 'town-center');
    state.visibility[1].visible.fill(1);
    const commands = decide(state);
    for (const command of commands) applyCommand(state, command);
    expect(workers[1].order).toEqual({ kind: 'build', targetId: house.id });
    expect(workers.some(e => e.order.kind === 'build' && e.order.targetId === second.id)).toBe(true);
  });

  it('replays resumed houses deterministically from a JSON snapshot', () => {
    const { state, workers, house } = fixture();
    applyCommand(state, { kind: 'stop', player: 1, entityIds: [workers[0].id] });
    state.players[1].wood = 0;
    const replay = JSON.parse(JSON.stringify(state)) as GameState;
    finishWithAi(state, [house]);
    finishWithAi(replay, [replay.entities.find(e => e.id === house.id)!]);
    expect(checksumState(replay)).toBe(checksumState(state));
  });
});
