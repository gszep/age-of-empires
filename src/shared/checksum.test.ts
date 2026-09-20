import { describe, expect, it } from 'vitest';
import { createGame } from '../sim/game';
import { checksumState } from '../sim/checksum';
import { synchronizationHash } from './checksum';
import type { GameState } from '../sim/types';

describe('transport-stable synchronization checksums', () => {
  it('survives a cleared path gaining values after a JSON snapshot join', () => {
    const host = createGame(42);
    const worker = host.entities.find(e => e.kind === 'villager')!;
    worker.path = undefined;
    worker.pathGoal = undefined;
    worker.carrying = { kind: 'food', amount: 5 };
    const guest: GameState = JSON.parse(JSON.stringify(host));
    const other = guest.entities.find(e => e.id === worker.id)!;
    for (const entity of [worker, other]) {
      entity.path = [{ x: 30, y: 60 }];
      entity.pathGoal = { x: 30, y: 60 };
    }
    expect(host.entities).toEqual(guest.entities);
    expect(checksumState(host)).not.toBe(checksumState(guest)); // the reported false alarm
    expect(synchronizationHash(host)).toBe(synchronizationHash(guest));
  });

  it('still detects changed game values and simulation-significant entity ordering', () => {
    const state = createGame(42);
    const original = synchronizationHash(state);
    state.players[1].food++;
    expect(synchronizationHash(state)).not.toBe(original);
    state.players[1].food--;
    state.entities.reverse();
    expect(synchronizationHash(state)).not.toBe(original);
  });
});
