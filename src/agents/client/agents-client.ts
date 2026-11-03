/**
 * Browser/Node client for the local agent-match wire (#352).
 *
 * Talks to the same strict local surface the vite plugin exposes: the
 * sanitized model catalogue, the capability-gated Start/Stop, status, and the
 * read-only event websocket. Every failure arrives as a typed
 * `{code, message}` from the server; this client adds nothing raw, so the
 * browser never sees OpenCode credentials or provider error bodies.
 *
 * A websocket that closes -- including the server's overflow close 4009 --
 * is treated as a gap: the client resubscribes with bounded backoff, and the
 * next `snapshot` event rebuilds the match, so deltas are never silently
 * dropped or replayed on top of a stale prefix.
 */
import type { AgentMatchEvent, OpenCodeModelSummary } from '../protocol';

export const AGENTS_WS_PATH = '/agents/ws';

/** Start request the page may send; the server whitelists the same keys. */
export interface AgentsStartRequest {
  seed: number;
  models: { 1: { id: string; providerID: string }; 2: { id: string; providerID: string } };
  civilizations?: { 1: string; 2: string };
  map?: string;
  maxTimeSeconds?: number;
  decideIntervalSeconds?: number;
}

export interface AgentsStatusReply {
  status: string;
  rulesOrigin: string;
  rulesMode: string;
  rulesNote: string;
}

/** Typed, already-sanitized failure from the server. */
export class AgentsClientError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'AgentsClientError';
  }
}

export interface AgentsClientOptions {
  /** Overrides for tests; defaults use the page's globals. */
  fetchImpl?: typeof fetch;
  WebSocketImpl?: new (url: string) => WebSocket;
  /** Origin to call; defaults to the current page's origin. */
  baseUrl?: string;
}

interface WireFailure {
  error?: { code?: unknown; message?: unknown };
}

function toError(status: number, body: WireFailure | undefined): AgentsClientError {
  const code = typeof body?.error?.code === 'string' ? body.error.code : 'network';
  const message = typeof body?.error?.message === 'string' ? body.error.message : `agents request failed (HTTP ${status})`;
  return new AgentsClientError(code, message);
}

export class AgentsClient {
  private readonly fetchImpl: typeof fetch;
  private readonly WebSocketImpl: new (url: string) => WebSocket;
  private readonly baseUrl: string;

  constructor(options: AgentsClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? (globalThis.fetch.bind(globalThis) as typeof fetch);
    this.WebSocketImpl = options.WebSocketImpl ?? (globalThis.WebSocket as new (url: string) => WebSocket);
    this.baseUrl = options.baseUrl ?? globalThis.location?.origin;
    if (!this.baseUrl) throw new Error('AgentsClient needs a baseUrl outside a page context');
  }

  /** The sanitized model catalogue; typed failure when the service is absent. */
  async models(): Promise<OpenCodeModelSummary[]> {
    const reply = await this.get<{ models?: unknown }>('/agents/api/models');
    if (!Array.isArray(reply.models)) throw new AgentsClientError('malformed-reply', 'model catalogue reply had no list');
    return reply.models as OpenCodeModelSummary[];
  }

  async status(): Promise<AgentsStatusReply> {
    return this.get<AgentsStatusReply>('/agents/api/status');
  }

  /** The per-boot capability token; only a same-origin page can read it. */
  async capability(): Promise<string> {
    const reply = await this.get<{ capability?: unknown }>('/agents/api/capability');
    if (typeof reply.capability !== 'string' || !reply.capability) {
      throw new AgentsClientError('malformed-reply', 'capability reply had no token');
    }
    return reply.capability;
  }

  async start(spec: AgentsStartRequest, capability: string): Promise<string> {
    const reply = await this.post<{ matchId?: unknown }>('/agents/api/start', spec, capability);
    if (typeof reply.matchId !== 'string' || !reply.matchId) {
      throw new AgentsClientError('malformed-reply', 'start reply had no match id');
    }
    return reply.matchId;
  }

  async stop(capability: string): Promise<string> {
    const reply = await this.post<{ status?: unknown }>('/agents/api/stop', {}, capability);
    return typeof reply.status === 'string' ? reply.status : 'idle';
  }

  /**
   * Subscribe to the read-only event stream. `onGap` reports why the current
   * socket ended (overflow or disconnect) just before this client resubscribes;
   * the resubscription's `snapshot` event is the authoritative rebuild point.
   * Returns a closer that stops reconnecting too.
   */
  subscribe(onEvent: (event: AgentMatchEvent) => void, onGap?: (reason: string) => void): () => void {
    let closed = false;
    let socket: WebSocket | undefined;
    let attempts = 0;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    const connect = (): void => {
      if (closed) return;
      let unusable = false;
      socket = new this.WebSocketImpl(`${this.baseUrl.replace(/^http/, 'ws')}${AGENTS_WS_PATH}`);
      socket.onmessage = message => {
        if (closed || unusable) return;
        attempts = 0;
        try { onEvent(JSON.parse(String(message.data)) as AgentMatchEvent); }
        catch {
          // A parse or consumer failure is a gap, not permission to silently
          // continue applying later deltas to a partially rebuilt world.
          unusable = true;
          socket?.close(4000, 'invalid event');
        }
      };
      socket.onclose = event => {
        if (closed) return;
        const reason = unusable ? 'invalid-event' : event.code === 4009 ? 'overflow' : 'disconnected';
        onGap?.(reason);
        // Overflow reconnects immediately for a fresh snapshot; other closes
        // back off so a gone server is not hammered.
        const delay = reason === 'overflow' ? 0 : Math.min(5000, 250 * 2 ** Math.min(attempts++, 4));
        reconnect = setTimeout(connect, delay);
      };
      socket.onerror = () => { /* onclose always follows */ };
    };
    connect();
    return () => { closed = true; clearTimeout(reconnect); socket?.close(); };
  }

  private async get<T>(path: string): Promise<T> {
    return this.request<T>(path, 'GET');
  }

  private async post<T>(path: string, body: unknown, capability: string): Promise<T> {
    return this.request<T>(path, 'POST', {
      'content-type': 'application/json',
      'x-agents-capability': capability,
    }, JSON.stringify(body));
  }

  private async request<T>(path: string, method: 'GET' | 'POST', headers?: Record<string, string>, body?: string): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, { method, headers, body });
    } catch {
      throw new AgentsClientError('network', 'could not reach the local agents backend');
    }
    let parsed: unknown;
    try { parsed = await response.json(); } catch { parsed = undefined; }
    if (!response.ok) throw toError(response.status, parsed as WireFailure | undefined);
    return parsed as T;
  }
}
