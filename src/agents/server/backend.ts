/**
 * Local HTTP/WebSocket surface for live agent matches (#352).
 *
 * Exposes exactly the reviewed host API to the `?agents=2` browser page:
 * a sanitized model catalogue, an explicit capability-gated Start/Stop, a
 * status readout, and a read-only event stream. There is deliberately no
 * spectator gameplay channel -- no route accepts a Command -- and no OpenCode
 * session, shell or credential route is ever reachable. Failures leaving this
 * module are typed codes with sanitized messages; raw transport or provider
 * errors never cross the wire.
 *
 * Strictly local: every request and websocket upgrade must come from a
 * loopback peer with a loopback Host header and, when a browser sends Origin,
 * an origin identical to this server. Start/Stop additionally require the
 * per-boot capability token, which only a same-origin page can read.
 * Request bodies are size-capped, inbound websocket frames are ignored (the
 * stream is read-only) and bounded by ws maxPayload, and outbound sockets are
 * closed once their buffer exceeds `wsBufferBytes` so a stalled spectator
 * forces its own resubscribe-with-fresh-snapshot instead of blocking anyone.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Duplex } from 'node:stream';
import type { TLSSocket } from 'node:tls';
import { WebSocketServer, type WebSocket } from 'ws';
import { AgentHostError, AgentMatchHost } from '../host';
import { OpenCodeError, type OpenCodeClient } from '../../headless/opencode-client';
import { FALLBACK_RULES } from '../../sim/data';
import type { AgentMatchEvent, AgentMatchStatus, OpenCodeModelSummary } from '../protocol';

export const AGENTS_API_PREFIX = '/agents/api/';
export const AGENTS_WS_PATH = '/agents/ws';

const DEFAULT_MAX_BODY_BYTES = 64 * 1024;
const DEFAULT_WS_BUFFER_BYTES = 1024 * 1024;
/** Inbound frames are ignored; this only bounds a hostile peer's frame size. */
const MAX_WS_PAYLOAD_BYTES = 4096;

export interface AgentsBackendOptions {
  /**
   * Test setup may inject a client or factory; the production plugin passes
   * nothing, so the host discovers the shared local OpenCode service itself.
   * No built-in fake is ever constructed here.
   */
  client?: OpenCodeClient | (() => OpenCodeClient | Promise<OpenCodeClient>);
  /** Per-subscriber event buffer before the host ends the subscription. */
  bufferLimit?: number;
  /** HTTP request body cap; larger requests are refused before parsing. */
  maxBodyBytes?: number;
  /** Outbound websocket cap; a slower spectator is closed to force a resnapshot. */
  wsBufferBytes?: number;
}

/** Sanitized wire failure: a stable code plus an already-safe message. */
export interface AgentsWireError {
  code: string;
  message: string;
}

/** Internal route failure carrying its HTTP status; never leaves raw errors. */
class HttpFailure extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

/** Request keys the start route accepts; everything else is stripped. */
const START_KEYS = [
  'seed', 'models', 'civilizations', 'map', 'mode', 'populationLimit',
  'wonderVictory', 'maxTimeSeconds', 'decideIntervalSeconds', 'timeoutMs', 'maxRequests',
] as const;

function hostnameOf(host: string): string {
  if (host.startsWith('[')) return host.slice(0, host.indexOf(']') + 1);
  const colon = host.lastIndexOf(':');
  return colon === -1 ? host : host.slice(0, colon);
}

function isLoopbackHost(host: string | undefined): boolean {
  if (typeof host !== 'string' || !host) return false;
  const hostname = hostnameOf(host);
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
}

/** Strip every key the start route does not accept, cloning allowed values. */
function sanitizeStartSpec(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new HttpFailure(400, 'invalid-request', 'start body must be a JSON object');
  }
  const spec: Record<string, unknown> = {};
  for (const key of START_KEYS) {
    if (Object.hasOwn(raw as Record<string, unknown>, key)) spec[key] = structuredClone((raw as Record<string, unknown>)[key]);
  }
  return spec;
}

export class AgentsBackend {
  readonly host: AgentMatchHost;
  private readonly capability: string;
  private readonly maxBodyBytes: number;
  private readonly wsBufferBytes: number;
  private readonly wss: WebSocketServer;

  constructor(options: AgentsBackendOptions = {}) {
    if (options.maxBodyBytes !== undefined && (!Number.isInteger(options.maxBodyBytes) || options.maxBodyBytes < 1)) {
      throw new Error('maxBodyBytes must be a positive integer');
    }
    if (options.wsBufferBytes !== undefined && (!Number.isInteger(options.wsBufferBytes) || options.wsBufferBytes < 1)) {
      throw new Error('wsBufferBytes must be a positive integer');
    }
    this.host = new AgentMatchHost({ client: options.client, bufferLimit: options.bufferLimit });
    this.capability = randomBytes(32).toString('hex');
    this.maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
    this.wsBufferBytes = options.wsBufferBytes ?? DEFAULT_WS_BUFFER_BYTES;
    this.wss = new WebSocketServer({ noServer: true, maxPayload: MAX_WS_PAYLOAD_BYTES });
    this.wss.on('connection', ws => this.attach(ws));
  }

  /** Number of live spectator sockets (tests and status displays). */
  get sockets(): number {
    return this.wss.clients.size;
  }

  /**
   * Connect middleware for every `/agents/api/*` request. Callers hand it the
   * request only after deciding the path is ours; loopback, origin and
   * capability rules are enforced here.
   */
  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const route = url.pathname.startsWith(AGENTS_API_PREFIX) ? url.pathname.slice(AGENTS_API_PREFIX.length) : '';
    if (!route) { this.fail(res, 404, 'not-found', 'unknown agents route'); return; }
    try {
      if (!this.localRequest(req)) throw new HttpFailure(403, 'forbidden', 'agents API is local and same-origin only');
      if (route === 'models' && req.method === 'GET') return this.json(res, 200, { models: await this.host.listModels() });
      if (route === 'status' && req.method === 'GET') {
        return this.json(res, 200, {
          status: this.host.status(),
          rulesOrigin: FALLBACK_RULES.origin,
          rulesMode: 'fallback',
          rulesNote: 'the backend runs built-in fallback rules only; owned imported rules are never applied',
        });
      }
      if (route === 'capability' && req.method === 'GET') return this.json(res, 200, { capability: this.capability });
      if (route === 'start' && req.method === 'POST') {
        this.requireCapability(req);
        const spec = sanitizeStartSpec(await this.readBody(req));
        const matchId = await this.host.start(spec as never);
        return this.json(res, 200, { matchId });
      }
      if (route === 'stop' && req.method === 'POST') {
        this.requireCapability(req);
        // Never awaits subscriber queues: a stalled spectator cannot hang a stop.
        await this.host.stop();
        return this.json(res, 200, { status: this.host.status() });
      }
      if (['models', 'status', 'capability'].includes(route)) throw new HttpFailure(405, 'method-not-allowed', 'use GET');
      if (['start', 'stop'].includes(route)) throw new HttpFailure(405, 'method-not-allowed', 'use POST');
      throw new HttpFailure(404, 'not-found', 'unknown agents route');
    } catch (error) {
      if (error instanceof HttpFailure) { this.fail(res, error.status, error.code, error.message); return; }
      if (error instanceof AgentHostError) {
        this.fail(res, error.code === 'match-running' ? 409 : 400, error.code, error.message);
        return;
      }
      if (error instanceof OpenCodeError) {
        const status = error.code === 'unavailable' ? 503 : error.code === 'unauthorized' ? 401 : 502;
        this.fail(res, status, error.code, error.message);
        return;
      }
      // Anything else is intentionally opaque: no stack, no raw provider text.
      this.fail(res, 500, 'unknown', 'agents backend request failed');
    }
  }

  /**
   * Websocket upgrade handler. Returns false when the path is not ours so the
   * caller leaves the socket to other handlers (Vite HMR).
   */
  upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== AGENTS_WS_PATH) return false;
    if (!this.localRequest(req) || !socket.writable) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return true;
    }
    this.wss.handleUpgrade(req, socket, head, ws => this.wss.emit('connection', ws, req));
    return true;
  }

  /** Stop the match and close every spectator socket. Never waits on subscribers. */
  async close(): Promise<void> {
    await this.host.stop().catch(() => {});
    // ws only invokes its close callback once every client is gone, so
    // terminating them keeps teardown deterministic even for open sockets.
    for (const client of this.wss.clients) client.terminate();
    await new Promise<void>(resolve => { this.wss.close(() => resolve()); });
  }

  /** Loopback Host, matching Origin when present, and loopback peer. */
  private localRequest(req: IncomingMessage): boolean {
    if (!isLoopbackHost(req.headers.host)) return false;
    const origin = req.headers.origin;
    if (origin !== undefined) {
      const host = req.headers.host as string;
      // Only the accepted socket establishes transport security. This local
      // surface has no trusted reverse-proxy configuration; Forwarded and
      // X-Forwarded-Proto must never upgrade an arbitrary client's authority.
      const scheme = (req.socket as TLSSocket).encrypted === true ? 'https' : 'http';
      if (origin !== `${scheme}://${host}`) return false;
    }
    const remote = req.socket.remoteAddress ?? '';
    return remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  }

  private requireCapability(req: IncomingMessage): void {
    const header = req.headers['x-agents-capability'];
    if (typeof header !== 'string') throw new HttpFailure(403, 'forbidden', 'missing agents capability');
    const given = Buffer.from(header);
    const expected = Buffer.from(this.capability);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new HttpFailure(403, 'forbidden', 'invalid agents capability');
    }
  }

  private async readBody(req: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > this.maxBodyBytes) throw new HttpFailure(413, 'too-large', `request body exceeds ${this.maxBodyBytes} bytes`);
      chunks.push(chunk as Buffer);
    }
    const text = Buffer.concat(chunks).toString('utf8');
    if (!text) throw new HttpFailure(400, 'invalid-request', 'request body must be JSON');
    try {
      return JSON.parse(text);
    } catch {
      throw new HttpFailure(400, 'invalid-request', 'request body must be valid JSON');
    }
  }

  /** Wire a spectator socket: strictly ordered events, read-only inbound. */
  private attach(ws: WebSocket): void {
    let unsubscribe: () => void = () => {};
    const send = (payload: string): boolean => {
      if (ws.readyState !== ws.OPEN) return false;
      try { ws.send(payload); } catch { return false; }
      return ws.bufferedAmount <= this.wsBufferBytes;
    };
    unsubscribe = this.host.subscribe(event => {
      const payload = JSON.stringify(event);
      if (!send(payload)) {
        // Slow or closed spectator: detach immediately and close with 4009 so
        // the client resubscribes for a fresh snapshot instead of dropping deltas.
        unsubscribe();
        try { ws.close(4009, 'overflow'); } catch { /* already closing */ }
        return;
      }
      if (event.type === 'subscription-ended') {
        try { ws.close(4009, event.reason); } catch { /* already closing */ }
      }
    });
    ws.on('close', unsubscribe);
    ws.on('error', unsubscribe);
    // The spectator stream is read-only: inbound frames are never interpreted.
    ws.on('message', () => {});
  }

  private json(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  }

  private fail(res: ServerResponse, status: number, code: string, message: string): void {
    const error: AgentsWireError = { code, message };
    if (!res.headersSent) this.json(res, status, { error });
    else res.destroy();
  }
}
