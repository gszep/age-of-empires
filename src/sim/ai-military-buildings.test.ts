import { describe, expect, it } from 'vitest';
import { exampleAiCommands } from './ai';
import { createGame, stepGame, applyCommand } from './game';
import { observe } from './observe';
import type { BuildingKind, Entity } from './types';

function fixture(withRange: boolean) {
  const state = createGame(86);
  state.entities = state.entities.filter(e => e.kind === 'town-center' || e.kind === 'villager');
  state.terrain.fill(0);
  const home = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
  const add = (kind: BuildingKind, x: number, y: number) => {
    const r = state.rules.buildings[kind];
    const e: Entity = { id: state.nextId++, kind, owner: 1,
      position: { x: home.position.x + x, y: home.position.y + y }, hp: r.hp, maxHp: r.hp,
      radius: r.radius, activity: 'idle', order: { kind: 'idle' } };
    if (kind === 'farm') { e.resourceKind = 'food'; e.amount = 175; }
    state.entities.push(e);
    return e;
  };
  add('barracks', 12, 12);
  add('lumber-camp', 16, 12); add('mill', 20, 12); add('mining-camp', 24, 12);
  add('house', -12, 12); add('house', -16, 12);
  add('farm', -6, -6);
  if (withRange) add('archery-range', 12, 18);
  state.players[1].age = 1;
  state.players[1].researched = ['feudal-age', 'loom'];
  Object.assign(state.players[1], { food: 0, wood: 125, gold: 100, populationCap: 15 });
  stepGame(state);
  return { state, add };
}

describe('AI Feudal infrastructure budget (#86)', () => {
  it.each([false, true])('saves small wood deposits, then completes the next military building (range exists: %s)', withRange => {
    const { state } = fixture(withRange);
    let commands = exampleAiCommands(observe(state, 1));
    expect(commands.filter(c => c.kind === 'build')).toEqual([]);
    expect(commands.filter(c => c.kind === 'train' && c.unit === 'archer')).toEqual([]);
    const kind = withRange ? 'blacksmith' : 'archery-range';
    state.players[1].wood = withRange ? 150 : 175;
    commands = exampleAiCommands(observe(state, 1));
    const build = commands.find(c => c.kind === 'build' && c.building === kind);
    expect(build).toBeDefined();
    expect(applyCommand(state, build!).ok).toBe(true);
    for (let i = 0; i < 4000; i++) {
      if (i % 100 === 0) for (const c of exampleAiCommands(observe(state, 1))) applyCommand(state, c);
      stepGame(state);
      if (state.entities.some(e => e.owner === 1 && e.kind === kind && e.buildProgress === undefined)) break;
    }
    expect(state.entities.some(e => e.owner === 1 && e.kind === kind && e.buildProgress === undefined)).toBe(true);
  });

  it('still buys urgent housing before the reserved military building', () => {
    const { state } = fixture(true);
    state.players[1].populationCap = state.players[1].population;
    const builds = exampleAiCommands(observe(state, 1)).filter(c => c.kind === 'build');
    expect(builds).toHaveLength(1);
    expect(builds[0].building).toBe('house');
  });

  it('releases the reserve after the blacksmith exists', () => {
    const { state, add } = fixture(true);
    add('blacksmith', 16, 18);
    const commands = exampleAiCommands(observe(state, 1));
    expect(commands.some(c => c.kind === 'build' && c.building === 'farm')).toBe(true);
    expect(commands.some(c => c.kind === 'train' && c.unit === 'archer')).toBe(true);
  });
});
