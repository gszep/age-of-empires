import { describe, expect, it } from 'vitest';
import { SharedMatch } from './match';
import { applyCommand, createGame, stepGame } from '../sim/game';
import { synchronizationHash } from './checksum';
import type { GameState } from '../sim/types';
import { completeWonder, WONDER_VICTORY_TICKS } from '../sim/wonder';
import { siphonsReplayRules } from '../headless/siphons-replay.fixture';

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
  it.each([false, true])('preserves the Siphons snapshot policy on both clients and uses current rules after restart (legacy=%s)', legacy => {
    const state = createGame(242, siphonsReplayRules());
    if (legacy) delete state.siphonsVersion;
    const host = new SharedMatch(JSON.parse(JSON.stringify(state))); host.humanTwo = true;
    const clients: GameState[] = [1, 2].map(() => JSON.parse(JSON.stringify(host.snapshot())).state);
    const rejected: string[] = [];
    const tc = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
    host.enqueue(1, { kind: 'train', player: 1, buildingId: tc.id, unit: 'fire-galley' }, reason => rejected.push(reason));
    for (let i = 0; i < 20; i++) follow(host, ...clients);
    const ship = host.state.entities.find(e => e.kind === 'fire-galley')!;
    const target = host.state.entities.find(e => e.owner === 2 && e.kind === 'town-center')!;
    host.enqueue(1, { kind: 'order', player: 1, entityIds: [ship.id], targetId: target.id, target: target.position }, reason => rejected.push(reason));
    for (let i = 0; i < 100; i++) {
      follow(host, ...clients);
      for (const game of [host.state, ...clients]) {
        expect(game.siphonsVersion).toBe(legacy ? undefined : 1);
        expect((game.entities.find(e => e.id === ship.id)!.charge ?? 1) < 1).toBe(legacy);
        expect(game.projectiles.some(p => p.art === 'fire-charge')).toBe(legacy);
      }
      if (i === 0) clients[1] = JSON.parse(JSON.stringify(host.snapshot())).state;
    }
    expect(rejected).toEqual([]);
    for (const client of clients) expect(synchronizationHash(client)).toBe(synchronizationHash(host.state));
    host.restart(242, 'arabia');
    expect(host.state.siphonsVersion).toBe(1);
  });

  it('restores an active Wonder deadline over JSON to both clients, wins identically, and clears it on restart', () => {
    const state = createGame(110, undefined, undefined, 'arabia', 'random-map', undefined, true);
    const home = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
    const wonder = { ...structuredClone(home), kind: 'wonder' as const, id: state.nextId++, position: { x: 50.5, y: 50.5 } };
    state.entities.push(wonder); completeWonder(state, wonder);
    state.tick = WONDER_VICTORY_TICKS - 2; // late-join/checkpoint boundary; full duration is exercised in wonder.test
    const host = new SharedMatch(JSON.parse(JSON.stringify(state))); host.humanTwo = true;
    const clients = [JSON.parse(JSON.stringify(host.state)), JSON.parse(JSON.stringify(host.state))];
    follow(host, ...clients); expect(host.state.winner).toBeUndefined();
    follow(host, ...clients); expect(host.state.winner).toBe(1);
    for (const client of clients) expect(synchronizationHash(client)).toBe(synchronizationHash(host.state));
    host.restart(111, 'arabia');
    expect(host.state.wonderVictory).toBe(true); expect(host.setup?.wonderVictory).toBe(true);
    expect(host.state.wonderCountdowns).toBeUndefined(); expect(host.state.winner).toBeUndefined();
    host.restart(112, 'arabia', undefined, undefined, undefined, false);
    expect(host.state.wonderVictory).toBeUndefined();
  });

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
