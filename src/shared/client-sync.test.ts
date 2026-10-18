import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { applyCommand, createGame, stepGame } from '../sim/game';
import type { MatchSetup } from '../match-setup';
import type { Command, GameState } from '../sim/types';
import { SharedClient } from './client';
import { synchronizationHash } from './checksum';
import { SHARED_VERSION, type HostMessage, type MatchSettings } from './protocol';

/** Exercise the client's real message handling and playback across JSON, with
 * only browser scheduling/socket transport replaced by controlled fixtures. */
class Socket {
  static OPEN = 1;
  static current: Socket;
  readyState = Socket.OPEN;
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  sent: object[] = [];
  constructor() { Socket.current = this; }
  send(text: string): void { this.sent.push(JSON.parse(text)); }
  receive(message: HostMessage): void { this.onmessage?.({ data: JSON.stringify(message) }); }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  vi.stubGlobal('location', { href: 'http://localhost/' });
  vi.stubGlobal('WebSocket', Socket);
  vi.stubGlobal('MessageChannel', class {
    port1 = { onmessage: undefined as ((event: { data: number }) => void) | undefined };
    port2 = { postMessage: (data: number) => setTimeout(() => this.port1.onmessage?.({ data }), 0) };
  });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const settings: MatchSettings = { generation: 7, paused: false, speed: 0 };
async function join(host: GameState, setup?: MatchSetup): Promise<{ client: SharedClient; socket: Socket }> {
  const client = new SharedClient(2);
  const connected = client.connect();
  const socket = Socket.current;
  socket.onopen?.();
  socket.receive({ type: 'snapshot', state: host, settings, setup });
  await connected;
  return { client, socket };
}
function tick(host: GameState, commands: Command[] = [], matchSettings = settings): HostMessage {
  for (const command of commands) expect(applyCommand(host, command)).toEqual({ ok: true });
  stepGame(host);
  return { type: 'tick', tick: host.tick, commands, hash: synchronizationHash(host), settings: matchSettings };
}

it('keeps matching JSON-wire command playback free of mismatch evidence', async () => {
  const host = createGame(123);
  const { client, socket } = await join(host);
  const unit = host.entities.find(entity => entity.owner === 2 && entity.kind === 'villager')!;
  socket.receive(tick(host, [{ kind: 'stop', player: 2, entityIds: [unit.id] }]));
  await vi.advanceTimersByTimeAsync(150);
  expect(client.stats.checks).toBe(1);
  expect(client.stats.resyncs).toBe(0);
  expect(client.stats.lastChecksumMismatch).toBeUndefined();
  expect(synchronizationHash(client.state)).toBe(synchronizationHash(host));
  expect(socket.sent).toEqual([{ type: 'join', version: SHARED_VERSION }, { type: 'ready' }]);
});

it('captures divergence before clearing queued ticks and retains it through recovery', async () => {
  const host = createGame(123);
  const setup: MatchSetup = { map: 'arabia', seed: 123, civilizations: { 1: 'britons', 2: 'inca' } };
  const { client, socket } = await join(host, setup);
  client.state.players[2].wood++;
  const divergent = JSON.parse(JSON.stringify(client.state)) as GameState;
  stepGame(divergent);
  stepGame(host);
  const expectedHash = synchronizationHash(host);
  socket.receive({ type: 'tick', tick: host.tick, commands: [], hash: expectedHash, settings });
  socket.receive(tick(host));
  await vi.advanceTimersByTimeAsync(150);

  const evidence = {
    version: SHARED_VERSION, player: 2, generation: 7, matchSeed: host.matchSeed, setup,
    hostTick: 1, localTick: 1, receivedTick: 2, pendingTicks: 1,
    expectedHash, actualHash: synchronizationHash(divergent),
  };
  expect(client.stats.lastChecksumMismatch).toEqual(evidence);
  client.setup!.civilizations![2] = 'britons';
  expect(client.stats.lastChecksumMismatch).toEqual(evidence); // Detached launch metadata.
  expect(client.stats.resyncs).toBe(1);
  expect(client.pendingTicks).toBe(0);
  expect(client.state.tick).toBe(1); // The later queued tick was discarded.
  expect(socket.sent.at(-1)).toEqual({ type: 'resync' });
  socket.receive({ type: 'snapshot', state: host, settings });
  expect(client.stats.lastChecksumMismatch).toEqual(evidence);
  socket.receive(tick(host));
  await vi.advanceTimersByTimeAsync(150);
  expect(synchronizationHash(client.state)).toBe(synchronizationHash(host));
  expect(client.stats.lastChecksumMismatch).toEqual(evidence);

  client.requestResync();
  expect(client.stats.lastReason).toBe('diagnostic request');
  expect(client.stats.lastChecksumMismatch).toEqual(evidence);
});

it('keeps original context across a new match and replaces only on another checksum mismatch', async () => {
  const host = createGame(123);
  const { client, socket } = await join(host);
  client.state.players[2].wood++;
  socket.receive(tick(host));
  await vi.advanceTimersByTimeAsync(150);
  const original = structuredClone(client.stats.lastChecksumMismatch);

  const nextHost = createGame(456);
  const nextSettings = { ...settings, generation: 8 };
  socket.receive({ type: 'snapshot', state: nextHost, settings: nextSettings });
  expect(client.stats.lastChecksumMismatch).toEqual(original);
  socket.receive({ type: 'tick', tick: 2, commands: [], settings: nextSettings });
  expect(client.stats.lastReason).toBe('tick gap');
  expect(client.stats.lastChecksumMismatch).toEqual(original);

  socket.receive({ type: 'snapshot', state: nextHost, settings: nextSettings });
  client.state.players[2].wood++;
  socket.receive(tick(nextHost, [], nextSettings));
  await vi.advanceTimersByTimeAsync(150);
  expect(client.stats.lastChecksumMismatch).toMatchObject({ matchSeed: nextHost.matchSeed, generation: 8, hostTick: 1, localTick: 1 });
  expect(client.stats.lastChecksumMismatch).not.toHaveProperty('setup');
  expect(client.stats.lastChecksumMismatch).not.toEqual(original);
  expect(client.stats.resyncs).toBe(3);
});
