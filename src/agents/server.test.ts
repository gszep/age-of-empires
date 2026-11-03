/**
 * Unit tests for the local agents HTTP/WebSocket backend (#352): loopback and
 * same-origin enforcement, capability-gated Start/Stop, request bounds, the
 * read-only stream (late join, stop, overflow resnapshot, disconnect
 * unsubscribe) and typed failure surfacing -- all against a fake OpenCode
 * transport, never a live service.
 */
import { afterAll, beforeEach, expect, it } from 'vitest';
import type { ServerResponse } from 'node:http';
import { createServer, IncomingMessage, request as httpRequest } from 'node:http';
import { WebSocket as WireSocket } from 'ws';
import { Socket } from 'node:net';
import { TLSSocket } from 'node:tls';
import { OpenCodeClient, OpenCodeError } from '../headless/opencode-client';
import {
  catalogueWire,
  declaredError,
  fakeOpenCodeTransport,
  promptObservation,
  textWire,
  type RecordedCall,
} from '../headless/opencode-fake';
import { AgentsBackend, AGENTS_WS_PATH } from './server/backend';
import type { AgentMatchEvent, AgentMatchSnapshot } from './protocol';

const seed = 12;
/** Long enough that a paced fake match is still running when we stop it. */
const longSpec = {
  seed,
  models: { 1: { id: 'model-a', providerID: 'provider-a' }, 2: { id: 'model-b', providerID: 'provider-b' } },
  maxTimeSeconds: 60,
  decideIntervalSeconds: 0.5,
};

/** An always-accepted stop command for one of the caller's own units, paced. */
async function pacedStop(call: RecordedCall): Promise<unknown> {
  await new Promise(resolve => setTimeout(resolve, 1));
  const seen = promptObservation(call.prompt);
  const unit = seen.entities.find(e => e.owner === seen.player && e.kind === 'villager');
  return textWire(JSON.stringify({
    type: 'commands', time: call.time,
    commands: unit ? [{ kind: 'stop', player: call.player, entityIds: [unit.id] }] : [],
  }));
}

interface Fixture {
  backend: AgentsBackend;
  base: string;
  close(): Promise<void>;
}

const fixtures: (() => Promise<void>)[] = [];

async function startBackend(
  generate: (call: RecordedCall) => unknown | Promise<unknown>,
  options: { client?: () => OpenCodeClient; bufferLimit?: number } = {},
): Promise<Fixture> {
  const transport = fakeOpenCodeTransport({ generate });
  const backend = new AgentsBackend({
    client: options.client ?? (() => new OpenCodeClient(transport, { timeoutMs: 5_000 })),
    bufferLimit: options.bufferLimit,
  });
  const server = createServer((req: IncomingMessage, res: ServerResponse) => { void backend.handle(req, res); });
  server.on('upgrade', (req, socket, head) => { backend.upgrade(req, socket, head); });
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  const base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  const close = async (): Promise<void> => {
    await backend.close();
    server.closeAllConnections?.();
    await new Promise<void>(resolve => { server.close(() => resolve()); });
  };
  fixtures.push(close);
  return { backend, base, close };
}

afterAll(async () => {
  await Promise.all(fixtures.splice(0).map(close => close()));
});

async function json(path: string, init: RequestInit = {}): Promise<{ status: number; body: any }> {
  const response = await fetch(path, init);
  return { status: response.status, body: await response.json().catch(() => undefined) };
}

async function capability(base: string): Promise<string> {
  const reply = await json(`${base}/agents/api/capability`);
  return reply.body.capability as string;
}

function startRequest(base: string, token: string, body: unknown = longSpec): RequestInit {
  return { method: 'POST', headers: { 'content-type': 'application/json', 'x-agents-capability': token }, body: JSON.stringify(body) };
}

function connectEvents(base: string): { events: AgentMatchEvent[]; socket: WebSocket; opened: Promise<void> } {
  const events: AgentMatchEvent[] = [];
  const socket = new WebSocket(base.replace(/^http/, 'ws') + AGENTS_WS_PATH);
  const opened = new Promise<void>(resolve => { socket.onopen = () => resolve(); });
  socket.onmessage = message => { events.push(JSON.parse(String(message.data)) as AgentMatchEvent); };
  return { events, socket, opened };
}

/** Poll until the condition holds, with a bounded number of attempts. */
async function until(condition: () => boolean, label: string, attempts = 4_000): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    if (condition()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${label}`);
}

const firstSnapshot = (events: AgentMatchEvent[]): AgentMatchSnapshot =>
  (events.find(event => event.type === 'snapshot') as Extract<AgentMatchEvent, { type: 'snapshot' }>).snapshot;

beforeEach(() => { expect((globalThis as Record<string, unknown>).WebSocket).toBeDefined(); });

it('serves a sanitized catalogue, status and capability', async () => {
  const { base } = await startBackend(pacedStop);
  const models = await json(`${base}/agents/api/models`);
  expect(models.status).toBe(200);
  expect(models.body.models).toEqual([
    { id: 'model-a', providerID: 'provider-a', name: 'Model A', type: 'chat', enabled: true },
    { id: 'model-b', providerID: 'provider-b', name: 'Model B', type: 'chat', enabled: true },
  ]);
  const status = await json(`${base}/agents/api/status`);
  expect(status.body).toMatchObject({ status: 'idle', rulesOrigin: 'fallback', rulesMode: 'fallback' });
  expect(await capability(base)).toMatch(/^[0-9a-f]{64}$/);
});

it('refuses foreign hosts, foreign origins and missing or wrong capabilities', async () => {
  const { base } = await startBackend(pacedStop);
  await capability(base);

  const raw = (headers: Record<string, string>): Promise<number> => new Promise((resolve, reject) => {
    const url = new URL(`${base}/agents/api/status`);
    const req = httpRequest({ host: '127.0.0.1', port: url.port, path: '/agents/api/status' });
    for (const [key, value] of Object.entries(headers)) req.setHeader(key, value);
    req.on('response', response => { resolve(response.statusCode ?? 0); response.resume(); });
    req.on('error', reject);
    req.end();
  });
  // The authority check is the Host *hostname*: only loopback names are
  // accepted, with any port (a port is not an authority claim without an
  // Origin, and browsers always send Origin for POST and websockets).
  expect(await raw({ Host: 'evil.example' })).toBe(403);
  expect(await raw({ Host: 'localhost.evil.example' })).toBe(403);
  expect(await raw({ Host: '127.0.0.1:999', Origin: 'http://evil.example' })).toBe(403);
  expect(await raw({ Host: 'localhost:1' })).toBe(200);

  const noCapability = await json(`${base}/agents/api/start`, { method: 'POST', body: '{}' });
  expect(noCapability.status).toBe(403);
  const wrongCapability = await json(`${base}/agents/api/start`, startRequest(base, '0'.repeat(64)));
  expect(wrongCapability.status).toBe(403);
  const stopWithout = await json(`${base}/agents/api/stop`, { method: 'POST', body: '{}' });
  expect(stopWithout.status).toBe(403);
});

it('bounds request bodies and rejects unknown routes and methods', async () => {
  const { base } = await startBackend(pacedStop);
  const token = await capability(base);
  const huge = await json(`${base}/agents/api/start`, startRequest(base, token, { seed, models: longSpec.models, padding: 'x'.repeat(70_000) }));
  expect(huge.status).toBe(413);
  const unknown = await json(`${base}/agents/api/command`, startRequest(base, token));
  expect(unknown.status).toBe(404);
  const spectator = await json(`${base}/agents/api/order`, startRequest(base, token, { kind: 'order' }));
  expect(spectator.status).toBe(404);
  const badMethod = await json(`${base}/agents/api/start`);
  expect(badMethod.status).toBe(405);
  const invalidSpec = await json(`${base}/agents/api/start`, startRequest(base, token, { seed: 'no' }));
  expect(invalidSpec.status).toBe(400);
  expect(invalidSpec.body.error.code).toBe('invalid-spec');
});

it('requires the actual HTTP origin for requests and upgrades, ignoring forwarded scheme claims', async () => {
  const { base } = await startBackend(pacedStop);
  const opposite = base.replace('http:', 'https:');
  const attemptedHeaders: Record<string, string>[] = [
    { Origin: opposite },
    { Origin: opposite, 'X-Forwarded-Proto': 'https', Forwarded: 'proto=https' },
  ];
  for (const headers of attemptedHeaders) {
    expect((await json(`${base}/agents/api/capability`, { headers })).status).toBe(403);
  }
  expect((await json(`${base}/agents/api/capability`, { headers: { Origin: base, 'X-Forwarded-Proto': 'https' } })).status).toBe(200);
  const upgrade = (origin: string): Promise<number> => new Promise((resolve, reject) => {
    const ws = new WireSocket(base.replace('http:', 'ws:') + AGENTS_WS_PATH, {
      origin, headers: { 'X-Forwarded-Proto': 'https', Forwarded: 'proto=https' }, handshakeTimeout: 2_000,
    });
    ws.on('error', reject);
    ws.once('unexpected-response', (_req, res) => { res.resume(); ws.terminate(); resolve(res.statusCode ?? 0); });
    ws.once('open', () => { ws.close(); resolve(101); });
  });
  expect(await upgrade(opposite)).toBe(403);
  expect(await upgrade(base)).toBe(101);
});

it('uses the TLS socket flag, not forwarded headers, for HTTPS origin decisions', async () => {
  const { backend } = await startBackend(pacedStop);
  // No TLS network handshake is claimed here: exercise Node's TLSSocket
  // metadata branch; actual HTTP and websocket handshakes are covered above.
  const socket = new TLSSocket(new Socket());
  Object.defineProperty(socket, 'remoteAddress', { value: '127.0.0.1' });
  try {
    expect(socket.encrypted).toBe(true);
    for (const [origin, expected] of [['https://localhost:5317', 200], ['http://localhost:5317', 403]] as const) {
      let status = 0;
      const response = { headersSent: false, writeHead(code: number) { status = code; }, end() {} } as unknown as ServerResponse;
      const request = new IncomingMessage(socket);
      request.method = 'GET';
      request.url = '/agents/api/status';
      request.headers = { host: 'localhost:5317', origin, 'x-forwarded-proto': 'http', forwarded: 'proto=http' };
      await backend.handle(request, response);
      expect(status).toBe(expected);
    }
  } finally { socket.destroy(); }
});

it('runs a live match over the wire: snapshot, ticks, commands, late join, read-only inbound, stop', async () => {
  const { base, backend } = await startBackend(pacedStop);
  const token = await capability(base);
  const first = connectEvents(base);
  await first.opened;

  const started = await json(`${base}/agents/api/start`, startRequest(base, token));
  expect(started.status).toBe(200);
  expect(started.body.matchId).toMatch(/^match-/);

  await until(() => first.events[0]?.type === 'snapshot', 'first snapshot');
  const snapshot = firstSnapshot(first.events);
  expect(snapshot.start.initialChecksum).toMatch(/^[0-9a-f]+$/);
  expect(snapshot.start.rulesOrigin).toBe('fallback');

  await until(() => first.events.filter(e => e.type === 'tick').length >= 20
    && first.events.some(e => e.type === 'command'), 'live ticks and commands');
  expect(backend.host.status()).toBe('running');

  // Late joiner receives the prefix snapshot immediately.
  const late = connectEvents(base);
  await late.opened;
  await until(() => late.events[0]?.type === 'snapshot', 'late snapshot');

  // Read-only stream: gameplay-shaped routes do not exist, inbound frames are ignored.
  const rejected = await json(`${base}/agents/api/command`, startRequest(base, token, { kind: 'order', player: 1, entityIds: [1] }));
  expect(rejected.status).toBe(404);
  first.socket.send('{"type":"command","command":{"kind":"order","player":1}}');
  await new Promise(resolve => setTimeout(resolve, 50));
  expect(backend.sockets).toBe(2);

  // A hung subscriber cannot delay stop: the route returns promptly.
  backend.host.subscribe(() => new Promise<void>(() => {}));
  const stoppedAt = Date.now();
  const stopped = await json(`${base}/agents/api/stop`, startRequest(base, token));
  expect(stopped.status).toBe(200);
  expect(Date.now() - stoppedAt).toBeLessThan(2_000);

  await until(() => first.events.some(e => e.type === 'match-ended') && late.events.some(e => e.type === 'match-ended'), 'match-ended everywhere');
  try {
    const ended = first.events.find(e => e.type === 'match-ended') as Extract<AgentMatchEvent, { type: 'match-ended' }>;
    expect(ended.status).toBe('aborted');
    expect(ended.record?.commands.length).toBeGreaterThan(0);

    // No gaps, no duplicates: the late joiner's snapshot prefix plus its own
    // deltas is exactly the first spectator's stream, and both equal the record.
    const streamed = first.events.filter(e => e.type === 'command').map(e => (e as { command: unknown }).command);
    const lateView = firstSnapshot(late.events).commands.map(entry => entry.command)
      .concat(late.events.filter(e => e.type === 'command').map(e => e.command));
    expect(lateView).toEqual(streamed);
    expect(streamed).toEqual(ended.record!.commands.map(entry => entry.command));

    // A post-stop subscriber still gets the full retained prefix and record.
    const after = connectEvents(base);
    await after.opened;
    await until(() => after.events[0]?.type === 'snapshot', 'post-stop snapshot');
    const afterSnapshot = firstSnapshot(after.events);
    expect(afterSnapshot.status).toBe('aborted');
    expect(afterSnapshot.record?.commands).toEqual(ended.record?.commands);
    after.socket.close();
  } finally {
    first.socket.close();
    late.socket.close();
  }
  await until(() => backend.sockets === 0, 'sockets drained');
});

it('ends overflowing subscriptions and serves fresh snapshots to new spectators', async () => {
  const { base, backend } = await startBackend(pacedStop, { bufferLimit: 4 });
  const token = await capability(base);
  const seen: AgentMatchEvent[] = [];
  // This subscriber hangs on its first event: its queue fills and overflows.
  backend.host.subscribe(event => { seen.push(event); return new Promise<void>(() => {}); });

  const started = await json(`${base}/agents/api/start`, startRequest(base, token));
  expect(started.status).toBe(200);
  await until(() => seen.some(e => e.type === 'subscription-ended'), 'overflow goodbye');
  const goodbye = seen.at(-1) as Extract<AgentMatchEvent, { type: 'subscription-ended' }>;
  expect(goodbye.type).toBe('subscription-ended');
  expect(goodbye.reason).toBe('overflow');
  // Intermediate queued events were discarded, never delivered late.
  expect(seen.filter(e => e.type === 'tick')).toHaveLength(0);

  // A websocket spectator also fills its tiny buffer on the first burst of
  // ticks (ten per decision, emitted synchronously): the server must detach it
  // explicitly with an overflow goodbye and close 4009, forcing a resnapshot.
  const late = connectEvents(base);
  await late.opened;
  await until(() => late.events.some(e => e.type === 'subscription-ended'), 'socket overflow goodbye');
  await until(() => late.socket.readyState === 3, 'socket closed');
  const lateSnapshot = firstSnapshot(late.events);
  const overflow = late.events.find(e => e.type === 'subscription-ended') as Extract<AgentMatchEvent, { type: 'subscription-ended' }>;
  expect(overflow.reason).toBe('overflow');

  await json(`${base}/agents/api/stop`, startRequest(base, token));
  // After the overflow gap a *fresh* subscription is the only correct rebuild:
  // it receives the settled match, with the earlier snapshot an exact prefix.
  const fresh = connectEvents(base);
  await fresh.opened;
  await until(() => fresh.events[0]?.type === 'snapshot', 'fresh post-stop snapshot');
  try {
    const afterSnapshot = firstSnapshot(fresh.events);
    expect(afterSnapshot.status).toBe('aborted');
    expect(afterSnapshot.record!.commands.slice(0, lateSnapshot.commands.length).map(entry => entry.command))
      .toEqual(lateSnapshot.commands.map(entry => entry.command));
    expect(afterSnapshot.record!.commands.length).toBeGreaterThanOrEqual(lateSnapshot.commands.length);
  } finally {
    fresh.socket.close();
  }
});

it('surfaces typed catalogue and auth failures without leaking raw errors', async () => {
  const unavailable = await startBackend(pacedStop, {
    client: () => { throw new OpenCodeError('unavailable', 'no healthy registered OpenCode service found'); },
  });
  const models = await json(`${unavailable.base}/agents/api/models`);
  expect(models.status).toBe(503);
  expect(models.body.error).toEqual({ code: 'unavailable', message: expect.stringContaining('no healthy registered') });
  expect(JSON.stringify(models.body)).not.toContain('stack');
  const start = await json(`${unavailable.base}/agents/api/start`, startRequest(unavailable.base, await capability(unavailable.base)));
  expect(start.status).toBe(503);

  const unauthorized = await startBackend(() => { throw declaredError('UnauthorizedError', 'secret bearer token value'); }, {
    client: () => new OpenCodeClient({
      async listModels() { return catalogueWire([{ id: 'model-a', providerID: 'provider-a', name: 'Model A', type: 'chat', enabled: true }]); },
      async generateText() { throw declaredError('UnauthorizedError', 'secret bearer token value'); },
    }),
  });
  const catalogue = await json(`${unauthorized.base}/agents/api/models`);
  expect(catalogue.status).toBe(200);
  const token = await capability(unauthorized.base);
  const started = await json(`${unauthorized.base}/agents/api/start`, startRequest(unauthorized.base, token, {
    ...longSpec, models: { 1: { id: 'model-a', providerID: 'provider-a' }, 2: { id: 'model-a', providerID: 'provider-a' } },
  }));
  expect(started.status).toBe(200);
  const events: AgentMatchEvent[] = [];
  const socket = new WebSocket(unauthorized.base.replace(/^http/, 'ws') + AGENTS_WS_PATH);
  socket.onmessage = message => { events.push(JSON.parse(String(message.data)) as AgentMatchEvent); };
  try {
    // The match may fail before or after the socket attaches: either way the
    // failure arrives typed and sanitized, with no fabricated record.
    await until(() => events.some(e => e.type === 'match-ended')
      || firstSnapshotOrNull(events)?.status === 'failed', 'typed failure');
    const failure = (events.find(e => e.type === 'match-ended') as Extract<AgentMatchEvent, { type: 'match-ended' }> | undefined)?.failure
      ?? firstSnapshotOrNull(events)?.failure;
    expect(failure?.code).toBe('unauthorized');
    const ended = events.find(e => e.type === 'match-ended') as Extract<AgentMatchEvent, { type: 'match-ended' }> | undefined;
    const snapshotRecord = firstSnapshotOrNull(events)?.record;
    expect(ended?.record ?? snapshotRecord).toBeUndefined(); // no fabricated successful record
    expect(JSON.stringify(events)).not.toContain('secret bearer token value');
  } finally {
    socket.close();
  }
});

function firstSnapshotOrNull(events: AgentMatchEvent[]): AgentMatchSnapshot | undefined {
  const found = events.find(event => event.type === 'snapshot') as Extract<AgentMatchEvent, { type: 'snapshot' }> | undefined;
  return found?.snapshot;
}

it('reports running status and exposes no gameplay route', async () => {
  const { base } = await startBackend(pacedStop);
  const token = await capability(base);
  await json(`${base}/agents/api/start`, startRequest(base, token));
  const status = await json(`${base}/agents/api/status`);
  expect(status.body.status).toBe('running');
  // There is no gameplay route to reach: even a correct-looking order is a 404.
  const attempt = await fetch(`${base}/agents/api/order`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"kind":"order"}',
  });
  expect(attempt.status).toBe(404);
  await json(`${base}/agents/api/stop`, startRequest(base, token));
  const after = await json(`${base}/agents/api/status`);
  expect(['aborted', 'finished']).toContain(after.body.status);
});
