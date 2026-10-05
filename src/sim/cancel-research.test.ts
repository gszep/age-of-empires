import { describe, expect, it } from 'vitest';
import { applyCommand, createGame, stepGame } from './game';
import type { GameState } from './types';
import { validateCommand } from '../protocol/validate';

const townCenter = (state: GameState) => state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
const purse = (state: GameState) => {
  const { food, wood, gold, stone } = state.players[1];
  return { food, wood, gold, stone };
};

describe('cancelling research (#295)', () => {
  it('stops the research and refunds what was paid, without completing it', () => {
    const state = createGame(295), tc = townCenter(state);
    const before = purse(state);
    expect(applyCommand(state, { kind: 'research', player: 1, buildingId: tc.id, tech: 'loom' }).ok).toBe(true);
    expect(purse(state)).not.toEqual(before);
    for (let i = 0; i < 20; i++) stepGame(state);
    expect(applyCommand(state, { kind: 'cancel-research', player: 1, buildingId: tc.id }).ok).toBe(true);
    expect(tc.researching).toBeUndefined();
    expect(purse(state)).toEqual(before);
    for (let i = 0; i < 2000; i++) stepGame(state);
    expect(state.players[1].researched).not.toContain('loom');
  });

  it('refunds the price paid, not a price that changed afterwards', () => {
    const state = createGame(295), tc = townCenter(state);
    state.players[1].food = 1000;
    expect(applyCommand(state, { kind: 'research', player: 1, buildingId: tc.id, tech: 'feudal-age' }).ok).toBe(true);
    const paid = tc.researching!.paidCost!;
    tc.researching!.paidCost = { food: 1, wood: 2, gold: 3, stone: 4 };
    const before = purse(state);
    expect(applyCommand(state, { kind: 'cancel-research', player: 1, buildingId: tc.id }).ok).toBe(true);
    expect(purse(state)).toEqual({ food: before.food + 1, wood: before.wood + 2, gold: before.gold + 3, stone: before.stone + 4 });
    expect(paid.food).toBeGreaterThan(0);
    expect(state.players[1].age).toBe(0);
  });

  it('refuses buildings that are not researching or not owned', () => {
    const state = createGame(295), tc = townCenter(state);
    expect(applyCommand(state, { kind: 'cancel-research', player: 1, buildingId: tc.id }).ok).toBe(false);
    expect(applyCommand(state, { kind: 'research', player: 1, buildingId: tc.id, tech: 'loom' }).ok).toBe(true);
    expect(applyCommand(state, { kind: 'cancel-research', player: 2, buildingId: tc.id }).ok).toBe(false);
    expect(tc.researching).toBeDefined();
  });

  it('is a protocol command', () => {
    expect(validateCommand({ kind: 'cancel-research', player: 1, buildingId: 7 })).toBe(true);
  });
});
