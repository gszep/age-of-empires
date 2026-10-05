import { describe, expect, it } from 'vitest';
import { applyCommand, createGame } from './game';
import { validateCommand } from '../protocol/validate';

describe('local resource cheat', () => {
  it('gives the issuing player 1000 of each resource and leaves the opponent alone', () => {
    const state = createGame(1);
    const before = { ...state.players[1] }, opponent = { ...state.players[2] };
    expect(applyCommand(state, { kind: 'cheat-resources', player: 1 }).ok).toBe(true);
    for (const resource of ['food', 'wood', 'gold', 'stone'] as const) {
      expect(state.players[1][resource]).toBe(before[resource] + 1000);
      expect(state.players[2][resource]).toBe(opponent[resource]);
    }
  });

  it('is not a protocol command, so shared servers and agents refuse it', () => {
    expect(validateCommand({ kind: 'cheat-resources', player: 1 })).toBe(false);
  });
});
