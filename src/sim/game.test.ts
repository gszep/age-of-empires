import { describe, expect, it } from 'vitest';
import { runExampleAi } from './ai';
import { applyCommand, createGame, stepGame } from './game';

function digest(state: ReturnType<typeof createGame>): string {
  return JSON.stringify(state);
}

describe('simulation', () => {
  it('is deterministic for a seed and command stream', () => {
    const a = createGame(123);
    const b = createGame(123);
    for (let i = 0; i < 100; i++) { stepGame(a, 0.1); stepGame(b, 0.1); }
    expect(digest(a)).toBe(digest(b));
  });

  it('trains a villager from a town center', () => {
    const state = createGame();
    const tc = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
    expect(applyCommand(state, { kind: 'train', player: 1, buildingId: tc.id, unit: 'villager' })).toBe(true);
    for (let i = 0; i < 81; i++) stepGame(state, 0.1);
    expect(state.players[1].population).toBe(4);
  });

  it('walks into range before attacking', () => {
    const state = createGame();
    const builder = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
    expect(applyCommand(state, { kind: 'build', player: 1, builderId: builder.id, building: 'barracks', target: { x: 7, y: 9 } })).toBe(true);
    const barracks = state.entities.find(e => e.owner === 1 && e.kind === 'barracks')!;
    expect(applyCommand(state, { kind: 'train', player: 1, buildingId: barracks.id, unit: 'militia' })).toBe(true);
    for (let i = 0; i < 101; i++) stepGame(state, 0.1);

    const militia = state.entities.find(e => e.owner === 1 && e.kind === 'militia')!;
    const target = state.entities.find(e => e.owner === 2 && e.kind === 'town-center')!;
    applyCommand(state, { kind: 'order', player: 1, entityIds: [militia.id], target: target.position, targetId: target.id });
    const initialHp = target.hp;
    stepGame(state, 0.1);
    expect(militia.activity).toBe('moving');
    expect(target.hp).toBe(initialHp);

    for (let i = 0; i < 200 && militia.activity !== 'attacking'; i++) stepGame(state, 0.1);
    expect(militia.activity).toBe('attacking');
    expect(target.hp).toBeLessThan(initialHp);
  });

  it('lets the example AI finish a match against a passive opponent', () => {
    const state = createGame(7);
    for (let i = 0; i < 6_000 && !state.winner; i++) {
      if (i % 5 === 0) runExampleAi(state, 2);
      stepGame(state, 0.1);
    }
    expect(state.winner).toBe(2);
  });
});
