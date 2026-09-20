import { describe, expect, it } from 'vitest';
import { SharedMatch } from './match';
import { applyCommand, createGame, stepGame } from '../sim/game';
import { synchronizationHash } from './checksum';
import type { GameState } from '../sim/types';

function follow(host: SharedMatch, ...clients: GameState[]): void {
  const message = JSON.parse(JSON.stringify(host.advance())) as ReturnType<SharedMatch['advance']>;
  if (message.type !== 'tick') throw new Error('Expected a tick');
  for (const client of clients) {
    expect(message.tick).toBe(client.tick + 1);
    for (const command of message.commands) expect(applyCommand(client, command).ok).toBe(true);
    stepGame(client);
    if (message.hash) expect(synchronizationHash(client)).toBe(message.hash);
  }
}

describe('one household match', () => {
  it('orders both human players, rejects spoofed ownership, and reproduces queues and training', () => {
    const host = new SharedMatch(createGame(42));
    host.humanTwo = true;
    const clients: GameState[] = [JSON.parse(JSON.stringify(host.state)), JSON.parse(JSON.stringify(host.state))];
    const refused: string[] = [];
    for (const player of [1, 2] as const) {
      const tc = host.state.entities.find(e => e.owner === player && e.kind === 'town-center')!;
      host.enqueue(player, { kind: 'train', player, buildingId: tc.id, unit: 'villager' }, reason => refused.push(reason));
    }
    host.enqueue(2, { kind: 'stop', player: 1, entityIds: [1] }, reason => refused.push(reason));
    for (let i = 0; i < 520; i++) {
      follow(host, ...clients);
    }
    expect(refused).toHaveLength(1);
    for (const client of clients) expect(synchronizationHash(client)).toBe(synchronizationHash(host.state));
    for (const player of [1, 2] as const) {
      expect(host.state.entities.filter(e => e.owner === player && e.kind === 'villager')).toHaveLength(4);
    }
  });

  it('late-joins an evolved Islands match and resumes deterministically, including AI commands', () => {
    const host = new SharedMatch(createGame(7, undefined, undefined, 'islands'));
    for (let i = 0; i < 150; i++) host.advance();
    const guest = JSON.parse(JSON.stringify(host.state));
    expect(guest.tick).toBe(150);
    for (let i = 0; i < 150; i++) follow(host, guest);
    // Switching the second seat to a human stops the host generating their orders.
    host.humanTwo = true;
    for (let i = 0; i < 20; i++) {
      const message = host.advance();
      expect(message.type === 'tick' && message.commands).toEqual([]);
    }
  });

  it('clears pending orders on restart and changes the match generation', () => {
    const host = new SharedMatch(createGame(42));
    host.humanTwo = true;
    const tc = host.state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
    host.enqueue(1, { kind: 'delete', player: 1, entityIds: [tc.id] }, () => {});
    host.restart(8, 'islands');
    expect(host.snapshot()).toMatchObject({ setup: { map: 'islands', seed: 8 } });
    expect(host.settings.generation).toBe(1);
    expect(host.state.tick).toBe(0);
    const message = host.advance();
    expect(message.type === 'tick' && message.commands).toEqual([]);
    expect(host.state.entities.find(e => e.id === tc.id)?.dead).not.toBe(true);
  });
});
