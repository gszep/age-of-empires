/**
 * Unit tests for the spectator-side match machinery (#352): MatchView
 * reconstruction (verified rules and initial checksum, live snapshot plus
 * deltas, late join, overflow resnapshot without duplicates) and the
 * AgentsClient transport (typed failures, capability headers, resubscribe).
 * Everything runs against a fake OpenCode transport, never a live service.
 */
import { expect, it, vi } from 'vitest';
import { createGame } from '../../sim/game';
import { observe } from '../../sim/observe';
import { checksumState } from '../../sim/checksum';
import { OpenCodeClient } from '../../headless/opencode-client';
import { fakeOpenCodeTransport, promptObservation, textWire, type RecordedCall } from '../../headless/opencode-fake';
import { AgentMatchHost, type AgentMatchSpec } from '../host';
import type { AgentMatchEvent, AgentMatchSnapshot } from '../protocol';
import { AgentsClient, AgentsClientError } from './agents-client';
import { MatchView } from './match-view';

const seed = 12;
const base = createGame(seed);
const entityId = {
  1: observe(base, 1).entities.find(e => e.owner === 1 && e.kind === 'villager')!.id,
  2: observe(base, 2).entities.find(e => e.owner === 2 && e.kind === 'villager')!.id,
};

function stopReply(call: RecordedCall): unknown {
  const seen = promptObservation(call.prompt);
  const unit = seen.entities.find(e => e.owner === seen.player && e.kind === 'villager');
  return textWire(JSON.stringify({
    type: 'commands', time: call.time,
    commands: unit ? [{ kind: 'stop', player: call.player, entityIds: [unit.id] }] : [],
  }));
}

/** Paced variant so a spectator can genuinely attach mid-match. */
async function pacedStop(call: RecordedCall): Promise<unknown> {
  await new Promise(resolve => setTimeout(resolve, 5));
  return stopReply(call);
}

function spec(overrides: Partial<AgentMatchSpec> = {}): AgentMatchSpec {
  return {
    seed,
    models: { 1: { id: 'model-a', providerID: 'provider-a' }, 2: { id: 'model-b', providerID: 'provider-b' } },
    maxTimeSeconds: 12,
    decideIntervalSeconds: 3,
    ...overrides,
  };
}

function hostWith(generate: (call: RecordedCall) => unknown | Promise<unknown>): AgentMatchHost {
  const transport = fakeOpenCodeTransport({ generate });
  return new AgentMatchHost({ client: () => new OpenCodeClient(transport, { timeoutMs: 5_000 }) });
}

function collector(): { events: AgentMatchEvent[]; listener: (event: AgentMatchEvent) => void } {
  const events: AgentMatchEvent[] = [];
  return { events, listener: event => { events.push(event); } };
}

/** Player 1 trains villagers at its town center; player 2 stops its villager. */
function mixedReply(call: RecordedCall): unknown {
  const seen = promptObservation(call.prompt);
  const tc = seen.entities.find(e => e.owner === seen.player && e.kind === 'town-center');
  if (seen.player === 1 && tc) {
    return textWire(JSON.stringify({ type: 'commands', time: seen.time,
      commands: [{ kind: 'train', player: seen.player, buildingId: tc.id, unit: 'villager' }] }));
  }
  return stopReply(call);
}

it('refuses a snapshot built with other rules instead of rendering it', () => {
  const view = new MatchView();
  const snapshot = fakeSnapshot();
  snapshot.start.rulesOrigin = 'imported';
  view.apply({ type: 'snapshot', snapshot });
  expect(view.summary().viewError).toBe('rules-mismatch');
  expect(view.gameState).toBeUndefined();
});

it('refuses a snapshot whose initial checksum does not verify, and applies nothing', () => {
  const view = new MatchView();
  const snapshot = fakeSnapshot();
  snapshot.start.initialChecksum = 'deadbeef';
  view.apply({ type: 'snapshot', snapshot });
  expect(view.summary().viewError).toBe('checksum-mismatch');
  expect(view.gameState).toBeUndefined();
  view.apply({ type: 'command', tick: 0, command: { kind: 'stop', player: 1, entityIds: [entityId[1]] } as never });
  expect(view.gameState).toBeUndefined();
});

it('rebuilds a live match from a start snapshot plus deltas with verified checksums', async () => {
  const host = hostWith(mixedReply);
  const stream = collector();
  host.subscribe(stream.listener);
  await host.start(spec());
  await host.waitForMatch();
  await host.settled(); // the per-event drain is asynchronous; wait for delivery
  const view = new MatchView();
  for (const event of stream.events) view.apply(event);
  const summary = view.summary();
  const ended = stream.events.find(e => e.type === 'match-ended') as Extract<AgentMatchEvent, { type: 'match-ended' }>;
  const record = ended.record!;
  expect(summary.status).toBe('finished');
  expect(summary.verified).toBe(true);
  expect(summary.reconstructionOk).toBe(true);
  expect(summary.reconstructionFailures).toBe(0);
  expect(summary.reconstructionChecked).toBe(record.checksums.length);
  expect(summary.entities).toBeGreaterThan(0);
  expect(summary.tick).toBeGreaterThanOrEqual(record.checksums.at(-1)!.tick);
  // Commands streamed once and were counted once: no duplicates, no gaps.
  expect(summary.players[1].commands + summary.players[2].commands).toBe(record.commands.length);
  // Non-idempotent train commands prove the prefix was applied exactly once:
  // a duplicate train would change the population and break the checksums.
  expect(record.commands.some(entry => (entry.command as { kind: string }).kind === 'train')).toBe(true);

  // Prove verification actually reads terminal hashes, rather than reporting
  // success because no checksums were supplied with the live start snapshot.
  const corrupt = structuredClone(stream.events);
  const terminal = corrupt.find(e => e.type === 'match-ended') as typeof ended;
  terminal.record!.checksums[0].hash = 'bad-hash';
  const broken = new MatchView();
  for (const event of corrupt) broken.apply(event);
  expect(broken.summary().reconstructionOk).toBe(false);
  expect(broken.summary().reconstructionFailures).toBe(1);
  expect(broken.summary().reconstructionChecked).toBe(record.checksums.length);

  const missing = new MatchView();
  let dropped = false;
  for (const event of stream.events) {
    if (!dropped && event.type === 'command') { dropped = true; continue; }
    missing.apply(event);
  }
  expect(missing.summary().reconstructionOk).toBe(false);
  const snapshot = host.snapshot()!;
  snapshot.record!.checksums[0].hash = 'bad-hash';
  const endedView = new MatchView();
  endedView.apply({ type: 'snapshot', snapshot });
  expect(endedView.summary().reconstructionOk).toBe(false);
});

it('late-joins from a mid-match snapshot and stays duplicate-free', async () => {
  const host = hostWith(pacedStop);
  const early = collector();
  host.subscribe(early.listener);
  await host.start(spec({ maxTimeSeconds: 8, decideIntervalSeconds: 2 }));
  await new Promise<void>(resolve => {
    const check = (): void => {
      if (early.events.some(e => e.type === 'command')) resolve();
      else setTimeout(check, 5);
    };
    check();
  });
  const late = collector();
  host.subscribe(late.listener);
  await host.waitForMatch();
  await host.settled(); // the late joiner's snapshot is queued, not synchronous

  // A genuine mid-match join: the first event is a prefix snapshot and the
  // stream continues to the terminal event.
  expect(late.events[0]?.type).toBe('snapshot');
  expect(late.events[0] && late.events[0].type === 'snapshot' && late.events[0].snapshot.status).toBe('running');
  expect(late.events.some(e => e.type === 'match-ended')).toBe(true);
  const view = new MatchView();
  for (const event of late.events) view.apply(event);
  const summary = view.summary();
  const record = (late.events.find(e => e.type === 'match-ended') as Extract<AgentMatchEvent, { type: 'match-ended' }>).record!;
  expect(summary.status).toBe('finished');
  expect(summary.reconstructionOk).toBe(true);
  expect(summary.commands).toBe(record.commands.length);
  // The early stream and the late rebuild agree on the canonical command list.
  const earlyCommands = early.events.filter(e => e.type === 'command').map(e => (e as { command: unknown }).command);
  expect(earlyCommands).toEqual(record.commands.map(entry => entry.command));
});

it.each(['finished', 'aborted'] as const)('rejects incomplete terminal progress and unapplied commands in %s matches', async status => {
  // 350 ticks ends beyond the last hash at 300. Aborting during player 2's
  // decision also leaves a valid player-1 command exactly at terminal tick 350.
  const host = hostWith(call => {
    if (status === 'aborted' && call.time === 17.5 && call.player === 2) void host.stop();
    return stopReply(call);
  });
  const stream = collector();
  host.subscribe(stream.listener);
  await host.start(spec({ maxTimeSeconds: status === 'finished' ? 17.5 : 60, decideIntervalSeconds: 0.5 }));
  await host.waitForMatch();
  await host.settled();
  const final = host.snapshot()!;
  expect(final.status).toBe(status);
  expect(final.tick).toBe(350);
  expect(final.record!.result.timeSeconds).toBe(17.5);
  expect(final.record!.checksums.at(-1)!.tick).toBe(300);
  expect(final.commands.some(c => c.tick > 300)).toBe(true);
  if (status === 'aborted') expect(final.commands.at(-1)!.tick).toBe(350);

  const complete = new MatchView();
  complete.apply({ type: 'snapshot', snapshot: final });
  expect(complete.summary().reconstructionOk).toBe(true);
  const live = new MatchView();
  for (const event of stream.events) live.apply(event);
  expect(live.summary().reconstructionOk).toBe(true);

  const truncated = new MatchView();
  truncated.apply({ type: 'snapshot', snapshot: { ...final, tick: 300, timeSeconds: 15 } });
  expect(truncated.summary().reconstructionChecked).toBe(final.record!.checksums.length);
  expect(truncated.summary().reconstructionOk).toBe(false);
  expect(truncated.summary().tick).toBe(300); // never fabricate missing progress

  const missingTail = new MatchView();
  for (const event of stream.events) {
    if (event.type === 'tick' && event.tick > 300) continue;
    missingTail.apply(event);
  }
  expect(missingTail.summary().reconstructionOk).toBe(false);
  const wrongTime = new MatchView();
  wrongTime.apply({ type: 'snapshot', snapshot: { ...final, timeSeconds: 15 } });
  expect(wrongTime.summary().reconstructionOk).toBe(false);

  // Isolate consumption from terminal progress: a future command in both the
  // supplied prefix and record must fail even when all terminal clocks agree.
  const future = structuredClone(final);
  const entry = { ...future.commands.at(-1)!, tick: 351 };
  future.commands.push(entry);
  future.record!.commands.push(entry);
  const unapplied = new MatchView();
  unapplied.apply({ type: 'snapshot', snapshot: future });
  expect(unapplied.summary().reconstructionOk).toBe(false);
});

it('checks canonical terminal time even when a truncated snapshot has consumed every command and hash', async () => {
  const host = hostWith(stopReply);
  await host.start(spec({ maxTimeSeconds: 17.5, decideIntervalSeconds: 20 }));
  await host.waitForMatch();
  const final = host.snapshot()!;
  expect(final.tick).toBe(350);
  expect(final.commands.every(entry => entry.tick === 0)).toBe(true);
  expect(final.record!.checksums.at(-1)!.tick).toBe(300);
  const truncated = new MatchView();
  truncated.apply({ type: 'snapshot', snapshot: { ...final, tick: 300, timeSeconds: 15 } });
  expect(truncated.summary().commands).toBe(final.record!.commands.length);
  expect(truncated.summary().reconstructionChecked).toBe(final.record!.checksums.length);
  expect(truncated.summary().reconstructionOk).toBe(false);
  expect(truncated.summary().tick).toBe(300);
});

it('resubscribes after an overflow gap and rebuilds from the fresh snapshot', async () => {
  const host = hostWith(stopReply);
  const early = collector();
  host.subscribe(early.listener);
  await host.start(spec({ maxTimeSeconds: 4 }));
  await host.waitForMatch();
  await host.settled();
  // Two snapshots of the same match: the start snapshot (early prefix) and
  // the post-match snapshot (full prefix plus the canonical record).
  const startSnapshot = early.events.find(e => e.type === 'snapshot') as Extract<AgentMatchEvent, { type: 'snapshot' }>;
  const late = collector();
  host.subscribe(late.listener);
  await host.settled(); // the post-match snapshot delivery is queued
  const finalSnapshot = late.events.find(e => e.type === 'snapshot') as Extract<AgentMatchEvent, { type: 'snapshot' }>;

  const scripts = [
    { events: [startSnapshot], close: 4009 }, // overflow: the server closed us
    { events: [finalSnapshot], close: undefined }, // resubscription: fresh snapshot, stays open
  ];
  class ScriptedSocket {
    static instances: ScriptedSocket[] = [];
    onmessage: ((event: { data: unknown }) => void) | undefined;
    onclose: ((event: { code: number }) => void) | undefined;
    onerror: (() => void) | undefined;
    constructor() {
      ScriptedSocket.instances.push(this);
      setTimeout(() => this.open(), 0);
    }
    get readyState(): number { return 1; }
    close(): void { /* the client-side closer; reconnecting stops via closed flag */ }
    send(): void { /* read-only stream: inbound frames are never interpreted */ }
    private open(): void {
      const script = scripts[ScriptedSocket.instances.indexOf(this)] ?? { events: [], close: undefined };
      for (const event of script.events) this.onmessage?.({ data: JSON.stringify(event) });
      if (script.close !== undefined) setTimeout(() => this.onclose?.({ code: script.close! }), 0);
    }
  }

  const gaps: string[] = [];
  const received: AgentMatchEvent[] = [];
  const client = new AgentsClient({
    baseUrl: 'http://127.0.0.1:9',
    WebSocketImpl: ScriptedSocket as unknown as new (url: string) => WebSocket,
  });
  const unsubscribe = client.subscribe(event => received.push(event), reason => gaps.push(reason));
  await new Promise(resolve => setTimeout(resolve, 50));
  unsubscribe();

  expect(gaps).toEqual(['overflow']);
  expect(received.map(event => event.type)).toEqual(['snapshot', 'snapshot']);
  const view = new MatchView();
  for (const event of received) view.apply(event);
  const summary = view.summary();
  expect(summary.matchId).toBe(finalSnapshot.snapshot.matchId);
  expect(summary.status).toBe('finished');
  expect(summary.commands).toBe(finalSnapshot.snapshot.commands.length);
  expect(summary.reconstructionOk).toBe(true);
});

it('maps typed wire failures and sends the capability on start and stop', async () => {
  const calls: { path: string; headers: Record<string, string> }[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push({ path: String(input), headers: (init?.headers ?? {}) as Record<string, string> });
    const path = String(input);
    if (path.endsWith('/models')) {
      return new Response(JSON.stringify({ error: { code: 'unavailable', message: 'no healthy registered OpenCode service found' } }), { status: 503 });
    }
    return new Response(JSON.stringify({ capability: 'tok', matchId: 'match-1', status: 'idle' }), { status: 200 });
  }) as unknown as typeof fetch;
  const client = new AgentsClient({ baseUrl: 'http://127.0.0.1:9', fetchImpl });

  await expect(client.models()).rejects.toBeInstanceOf(AgentsClientError);
  try { await client.models(); } catch (error) { expect((error as AgentsClientError).code).toBe('unavailable'); }
  const capability = await client.capability();
  expect(capability).toBe('tok');
  await client.start({ seed: 1, models: { 1: { id: 'a', providerID: 'p' }, 2: { id: 'b', providerID: 'q' } } }, capability);
  expect(calls.find(call => call.path.endsWith('/start'))?.headers['x-agents-capability']).toBe('tok');
  await client.stop(capability);
  expect(calls.find(call => call.path.endsWith('/stop'))?.headers['x-agents-capability']).toBe('tok');

  const offline = new AgentsClient({
    baseUrl: 'http://127.0.0.1:9',
    fetchImpl: (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch,
  });
  await expect(offline.models()).rejects.toMatchObject({ code: 'network' });
});

it.each(['parse', 'consumer'])('resnapshots after a %s failure and clears reconnect timers on unsubscribe', failure => {
  vi.useFakeTimers();
  try {
    class Socket {
      static instance: Socket;
      onmessage?: (event: { data: string }) => void;
      onclose?: (event: { code: number }) => void;
      onerror?: () => void;
      constructor() { Socket.instance = this; }
      close(code = 1000): void { this.onclose?.({ code }); }
    }
    const gaps: string[] = [];
    const client = new AgentsClient({ baseUrl: 'http://127.0.0.1:9', WebSocketImpl: Socket as never });
    const consume = vi.fn(() => { throw new Error('consumer failed'); });
    const stop = client.subscribe(consume, reason => gaps.push(reason));
    Socket.instance.onmessage?.({ data: failure === 'parse' ? 'not JSON' : '{}' });
    expect(gaps).toEqual(['invalid-event']);
    expect(consume).toHaveBeenCalledTimes(failure === 'parse' ? 0 : 1);
    expect(vi.getTimerCount()).toBe(1);
    stop();
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});

/** A structurally valid fallback-rules snapshot for the refusal tests. */
function fakeSnapshot(): AgentMatchSnapshot {
  const state = createGame(seed);
  return {
    matchId: 'match-1',
    status: 'running',
    start: {
      seed,
      civilizations: { 1: state.players[1].civilization, 2: state.players[2].civilization },
      map: 'arabia',
      mode: 'random-map',
      decideIntervalSeconds: 0.5,
      maxTimeSeconds: 4,
      rulesOrigin: 'fallback',
      initialChecksum: checksumState(state),
    },
    models: { 1: { id: 'model-a', providerID: 'provider-a' }, 2: { id: 'model-b', providerID: 'provider-b' } },
    usage: { 1: 0, 2: 0 },
    limits: { requestsPerPlayer: 4096, timeoutMs: 30_000 },
    tick: 0,
    timeSeconds: 0,
    commands: [],
  };
}
