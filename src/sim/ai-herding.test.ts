import { describe, expect, it } from 'vitest';
import { exampleAiCommands } from './ai';
import { applyCommand, createGame, stepGame } from './game';
import { TICK_SECONDS } from './data';
import { observe } from './observe';
import { synchronizationHash } from '../shared/checksum';
import type { Entity, GameState } from './types';
import { herdingComparison } from './test-helpers/herding';

function fixture() {
  const state = createGame(136);
  state.entities = state.entities.filter(e => e.kind === 'town-center' || e.kind === 'villager');
  state.terrain.fill(0); state.elevation.fill(0);
  const home = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
  const rule = state.rules.units.sheep;
  const sheep: Entity = { id: state.nextId++, kind: 'sheep', owner: 1,
    position: { x: home.position.x + 8, y: home.position.y }, hp: rule.hp, maxHp: rule.hp,
    radius: rule.radius, amount: rule.foodAmount, resourceKind: 'food', order: { kind: 'idle' }, activity: 'idle' };
  state.entities.push(sheep);
  Object.assign(state.players[1], { food: 0, wood: 0, gold: 0, stone: 0 });
  return { state, home, sheep };
}

describe('AI livestock return (#136)', () => {
  it('moves its own idle sheep home through public orders and does not send shepherds after it', () => {
    const { state, home, sheep } = fixture();
    const before = synchronizationHash(state);
    const commands = exampleAiCommands(JSON.parse(JSON.stringify(observe(state, 1))));
    expect(synchronizationHash(state)).toBe(before);
    expect(commands).toContainEqual({ kind: 'order', player: 1, entityIds: [sheep.id], target: { ...home.position } });
    expect(commands.some(c => c.kind === 'order' && c.targetId === sheep.id)).toBe(false);
    const command = commands.find(c => c.kind === 'order' && c.entityIds.includes(sheep.id))!;
    expect(applyCommand(state, command).ok).toBe(true);
    expect(exampleAiCommands(observe(state, 1)).some(c => c.kind === 'order' && c.entityIds.includes(sheep.id))).toBe(false);
  });

  it('does not herd foreign sheep, redirect an existing sheep move, or use an unfinished TC', () => {
    for (const condition of ['foreign', 'moving', 'foundation'] as const) {
      const { state, home, sheep } = fixture();
      if (condition === 'foreign') sheep.owner = 2;
      if (condition === 'moving') sheep.order = { kind: 'move', target: { x: 10, y: 10 } };
      if (condition === 'foundation') home.buildProgress = 0.5;
      expect(exampleAiCommands(observe(state, 1)).some(c => c.kind === 'order' && c.entityIds.includes(sheep.id))).toBe(false);
    }
  });

  it('brings a sheep home before slaughter, banks food, and continues identically through JSON', () => {
    const { state, home, sheep } = fixture();
    const clone = JSON.parse(JSON.stringify(state)) as GameState;
    let clock = 0;
    for (let tick = 0; tick < 2000 && state.players[1].food === 0; tick++) {
      stepGame(state); stepGame(clone); clock += TICK_SECONDS;
      if (clock >= 0.5) {
        for (const game of [state, clone]) for (const c of exampleAiCommands(JSON.parse(JSON.stringify(observe(game, 1))))) {
          expect(applyCommand(game, c).ok).toBe(true);
        }
        clock = 0;
      }
      if (sheep.dead) expect(Math.hypot(sheep.position.x - home.position.x, sheep.position.y - home.position.y)).toBeLessThanOrEqual(2.5);
    }
    expect(sheep.dead).toBe(true);
    expect(state.players[1].food).toBeGreaterThan(0);
    expect(synchronizationHash(state)).toBe(synchronizationHash(clone));
  });
});

// Seeds 7 and 42 run in ai-herding-seeds.test.ts: Vitest parallelises by file.
herdingComparison([1]);
