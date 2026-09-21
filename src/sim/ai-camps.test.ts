import { describe, expect, it } from 'vitest';
import { exampleAiCommands } from './ai';
import { addNode, applyCommand, createGame, stepGame } from './game';
import { observe } from './observe';
import type { BuildingKind, Entity, GameState } from './types';

type Camp = 'mill' | 'lumber-camp' | 'mining-camp';
function fixture(kind: Camp = 'mill') {
  const state = createGame(147);
  state.entities = state.entities.filter(e => e.owner !== 0);
  state.terrain = state.terrain.map(() => 0);
  const home = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
  const building = (kind: BuildingKind, x: number, y: number) => {
    const rule = state.rules.buildings[kind];
    const entity: Entity = { id: state.nextId++, kind, owner: 1,
      position: { x: home.position.x + x, y: home.position.y + y },
      hp: rule.hp, maxHp: rule.hp, radius: rule.radius, activity: 'idle', order: { kind: 'idle' } };
    state.entities.push(entity);
    return entity;
  };
  building('barracks', 0, -8);
  if (kind !== 'lumber-camp') building('lumber-camp', 0, -12);
  for (let i = 0; i < 3; i++) building('house', i * 3, 14);
  const existing = building(kind, 20, 0);
  const resource = kind === 'mill' ? 'berries' : kind === 'mining-camp' ? 'gold' : 'tree';
  const node = addNode(state, resource, { x: home.position.x + 29, y: home.position.y });
  if (resource === 'tree') for (const [x, y] of [[30, 0], [31, 0], [29, 1], [30, 1]]) {
    addNode(state, 'tree', { x: home.position.x + x, y: home.position.y + y });
  }
  stepGame(state);
  state.tick = 48 * 20; // existing placement fan's 4.5-tile homeward candidate
  state.players[1].populationCap = 20;
  state.players[1].wood = 100;
  state.players[1].food = 400;
  state.visibility[1].visible.fill(1);
  return { state, home, existing, node };
}
const camps = (state: GameState, kind: Camp) => exampleAiCommands(JSON.parse(JSON.stringify(observe(state, 1))))
  .filter(c => c.kind === 'build' && c.building === kind);

describe('AI drop-site placement (#147)', () => {
  it('does not place a second mill beside the first for the far edge of the same food patch', () => {
    const { state } = fixture();
    // Every bearing and radius: rejecting just the current candidate must not
    // let the same redundant mill creep through when the placement fan turns.
    for (let step = 0; step < 24; step++) {
      state.tick = step * 3 * 20;
      expect(camps(state, 'mill'), `placement step ${step}`).toEqual([]);
    }
  });

  it('can serve a separate berry patch rather than retrying a redundant nearest mill', () => {
    const { state, home, existing } = fixture();
    const remote = addNode(state, 'berries', { x: home.position.x + 45, y: home.position.y });
    const commands = camps(state, 'mill');
    expect(commands).toHaveLength(1);
    const command = commands[0];
    if (command.kind !== 'build') throw new Error('expected camp placement');
    expect(Math.hypot(command.target.x - existing.position.x, command.target.y - existing.position.y)).toBeGreaterThan(8);
    expect(Math.hypot(command.target.x - remote.position.x, command.target.y - remote.position.y)).toBeLessThan(5);
    expect(applyCommand(state, command).ok).toBe(true);
    expect(state.players[1].wood).toBe(0);
  });

  it.each(['lumber-camp', 'mining-camp'] as const)('allows a nearby %s when it shortens a long resource walk', kind => {
    const { state, existing, node } = fixture(kind);
    const commands = camps(state, kind);
    expect(commands).toHaveLength(1);
    const command = commands[0];
    if (command.kind !== 'build') throw new Error('expected camp placement');
    const oldWalk = Math.hypot(existing.position.x - node.position.x, existing.position.y - node.position.y);
    const newWalk = Math.hypot(command.target.x - node.position.x, command.target.y - node.position.y);
    expect(newWalk).toBeLessThan(oldWalk);
    expect(applyCommand(state, command).ok).toBe(true);
  });

  it.each(['mill', 'lumber-camp', 'mining-camp'] as const)('treats a rounded 100%% %s foundation as still pending', kind => {
    const { state, existing } = fixture(kind);
    existing.buildProgress = 0.9999999999999961;
    expect(observe(state, 1).entities.find(e => e.id === existing.id)?.buildProgress).toBe(1);
    expect(camps(state, kind)).toEqual([]);
  });

  it.each(['fish', 'shore-fish'] as const)('does not buy a mill for %s that the land economy will not work', kind => {
    const { state, existing, node } = fixture();
    state.entities = state.entities.filter(e => e.id !== existing.id);
    node.node = kind;
    expect(camps(state, 'mill')).toEqual([]);
  });

  it('does not let an already served resource hide a separate unserved patch', () => {
    const { state, home, node } = fixture();
    node.position.x = home.position.x + 23; // three tiles from the old mill
    const remote = addNode(state, 'berries', { x: home.position.x + 45, y: home.position.y });
    const commands = camps(state, 'mill');
    expect(commands).toHaveLength(1);
    const command = commands[0];
    if (command.kind !== 'build') throw new Error('expected camp placement');
    expect(Math.hypot(command.target.x - remote.position.x, command.target.y - remote.position.y)).toBeLessThan(5);
  });
});
