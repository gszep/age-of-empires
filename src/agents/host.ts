/**
 * Host controller for live OpenCode model-versus-model matches (#352).
 *
 * Owns the bounded match lifecycle end to end: an explicit typed `start` (one
 * live match at a time), the sanitized model catalogue, a read-only spectator
 * stream with late-join snapshot, and `stop` for external abort. Model calls
 * happen only through strategies that hold an explicitly armed `MatchGrant`,
 * each with a per-call timeout and a per-player request-count cap; nothing is
 * retried automatically and no built-in strategy is ever substituted.
 *
 * This is the backend dependency for `?agents=2`; HTTP/browser wiring comes
 * later and must keep the route stateless: expose only the APIs below, never
 * OpenCode session/shell/credential routes, and never a command channel.
 */
import { MATCH_FORMAT_VERSION, type MatchConfig, type MatchRecord, type MatchResult } from '../protocol/types';
import { FALLBACK_RULES } from '../sim/data';
import { validMatchSetup } from '../match-setup';
import { civilizationRules } from '../sim/civilizations';
import type { Command, PlayerId } from '../sim/types';
import { runMatch, type MatchHooks } from '../headless/runner';
import { opencodeStrategy } from '../headless/opencode-strategy';
import { callTransport, discoverOpenCodeClient, OpenCodeClient, OpenCodeError } from '../headless/opencode-client';
import {
  MatchGrant,
  type AgentEventListener,
  type AgentFailure,
  type AgentMatchEvent,
  type AgentMatchSnapshot,
  type AgentMatchStatus,
  type OpenCodeModelRef,
  type OpenCodeModelSummary,
} from './protocol';

export const DEFAULT_MATCH_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_REQUESTS_PER_PLAYER = 4_096;
export const DEFAULT_EVENT_BUFFER = 4_096;

/** A live match request. `models` entries must come from the sanitized catalogue. */
export interface AgentMatchSpec {
  seed: number;
  models: { 1: OpenCodeModelRef; 2: OpenCodeModelRef };
  civilizations?: { 1: string; 2: string };
  map?: string;
  mode?: MatchConfig['mode'];
  populationLimit?: number;
  wonderVictory?: boolean;
  maxTimeSeconds?: number;
  decideIntervalSeconds?: number;
  /** Per-call model timeout for this match. */
  timeoutMs?: number;
  /** Per-player request-count cap for this match. */
  maxRequests?: number;
}

export interface AgentMatchHostOptions {
  /** An already-built client (tests) or a factory; defaults to service discovery. */
  client?: OpenCodeClient | (() => OpenCodeClient | Promise<OpenCodeClient>);
  timeoutMs?: number;
  maxRequests?: number;
  /** Per-subscriber event buffer before the subscription ends with `overflow`. */
  bufferLimit?: number;
}

export class AgentHostError extends Error {
  constructor(readonly code: 'match-running' | 'invalid-spec', message: string) {
    super(`agent host ${code}: ${message}`);
    this.name = 'AgentHostError';
  }
}

const MAX_TIMEOUT_MS = 3_600_000;
const MAX_REQUESTS = 1_000_000;
const MAX_MATCH_SECONDS = 86_400;

/**
 * Validate a match request before anything is contacted or armed: unsafe
 * bounds, malformed model refs and malformed setup are rejected explicitly
 * so no service request or model call can happen with them.
 */
function invalidSpec(spec: AgentMatchSpec): string | undefined {
  if (!spec || typeof spec !== 'object') return 'match spec must be an object';
  if (!validMatchSetup({ ...spec, map: spec.map ?? 'arabia' })) return 'invalid match setup';
  if (!Number.isSafeInteger(spec.seed)) return 'seed must be a safe integer';
  for (const player of [1, 2] as PlayerId[]) {
    const model = spec.models?.[player];
    if (typeof model?.id !== 'string' || !model.id || typeof model?.providerID !== 'string' || !model.providerID) {
      return `player ${player} needs a model with a non-empty id and providerID`;
    }
    if (model.variant !== undefined && (typeof model.variant !== 'string' || !model.variant)) {
      return `player ${player} model variant must be a non-empty string when present`;
    }
  }
  if (spec.timeoutMs !== undefined && (!Number.isInteger(spec.timeoutMs) || spec.timeoutMs < 1 || spec.timeoutMs > MAX_TIMEOUT_MS)) {
    return `timeoutMs must be an integer between 1 and ${MAX_TIMEOUT_MS}`;
  }
  if (spec.maxRequests !== undefined && (!Number.isInteger(spec.maxRequests) || spec.maxRequests < 1 || spec.maxRequests > MAX_REQUESTS)) {
    return `maxRequests must be an integer between 1 and ${MAX_REQUESTS}`;
  }
  if (spec.maxTimeSeconds !== undefined && (!Number.isFinite(spec.maxTimeSeconds) || !(spec.maxTimeSeconds > 0) || spec.maxTimeSeconds > MAX_MATCH_SECONDS)) {
    return `maxTimeSeconds must be a positive number up to ${MAX_MATCH_SECONDS}`;
  }
  if (spec.decideIntervalSeconds !== undefined && (!Number.isFinite(spec.decideIntervalSeconds) || !(spec.decideIntervalSeconds > 0) || spec.decideIntervalSeconds > MAX_MATCH_SECONDS)) {
    return 'decideIntervalSeconds must be a positive number';
  }
  for (const [field, value] of [['map', spec.map], ['mode', spec.mode]] as const) {
    if (value !== undefined && (typeof value !== 'string' || !value)) return `${field} must be a non-empty string when present`;
  }
  if (spec.civilizations !== undefined) {
    for (const player of [1, 2] as PlayerId[]) {
      const civilization = spec.civilizations[player];
      if (typeof civilization !== 'string' || !civilization) return `civilizations.${player} must be a non-empty string`;
      if (!civilizationRules(FALLBACK_RULES, civilization)) return `civilizations.${player} is not loaded`;
    }
  }
  if (spec.populationLimit !== undefined && (!Number.isInteger(spec.populationLimit) || spec.populationLimit < 1)) {
    return 'populationLimit must be a positive integer';
  }
  if (spec.wonderVictory !== undefined && typeof spec.wonderVictory !== 'boolean') {
    return 'wonderVictory must be a boolean when present';
  }
  return undefined;
}

/** One subscriber: a bounded, strictly ordered event queue draining sequentially. */
interface Subscriber {
  readonly listener: AgentEventListener;
  queue: AgentMatchEvent[];
  closed: boolean;
  draining?: Promise<void>;
  cancelled: Promise<void>;
  cancel(): void;
}

interface CurrentMatch {
  matchId: string;
  status: AgentMatchStatus;
  start: AgentMatchSnapshot['start'] | undefined;
  models: { 1: OpenCodeModelRef; 2: OpenCodeModelRef };
  usage: { 1: number; 2: number };
  limits: { requestsPerPlayer: number; timeoutMs: number };
  tick: number;
  timeSeconds: number;
  commands: { tick: number; command: Command }[];
  result?: MatchResult;
  record?: MatchRecord;
  failure?: AgentFailure;
  controller: AbortController;
  grant: MatchGrant;
  run: Promise<void>;
}

export class AgentMatchHost {
  private readonly options: AgentMatchHostOptions;
  private readonly subscribers = new Set<Subscriber>();
  private clientInstance: OpenCodeClient | undefined;
  private current: CurrentMatch | undefined;
  private counter = 0;
  private starting?: { controller: AbortController; run: Promise<string> };

  constructor(options: AgentMatchHostOptions = {}) {
    if (options.bufferLimit !== undefined && (!Number.isInteger(options.bufferLimit) || options.bufferLimit < 1 || options.bufferLimit > DEFAULT_EVENT_BUFFER)) {
      throw new AgentHostError('invalid-spec', 'bufferLimit must be an integer from 1 to 4096');
    }
    this.options = { ...options };
  }

  /** Sanitized model catalogue; explicit typed unavailable/auth states. */
  async listModels(): Promise<OpenCodeModelSummary[]> {
    return (await callTransport(() => this.client(), 10_000, undefined)).listModels();
  }

  /** The latest (or running) match snapshot, for status displays and tests. */
  snapshot(): AgentMatchSnapshot | undefined {
    return this.current?.start ? snapshotOf(this.current) : undefined;
  }

  status(): AgentMatchStatus | 'idle' | 'starting' {
    return this.starting ? 'starting' : this.current?.status ?? 'idle';
  }

  /**
   * Start one live match and resolve with its id; the match then runs in the
   * background and settles through a `match-ended` event. Rejects with typed
   * `OpenCodeError`s for unavailable services, auth failures and models
   * absent from the catalogue -- a match never starts silently.
   */
  async start(spec: AgentMatchSpec): Promise<string> {
    if (this.starting || this.current?.status === 'running') {
      throw new AgentHostError('match-running', 'a match is starting or running; stop it first');
    }
    if (!spec || typeof spec !== 'object') throw new AgentHostError('invalid-spec', 'match spec must be an object');
    spec = { ...structuredClone(spec), timeoutMs: spec.timeoutMs ?? this.options.timeoutMs ?? DEFAULT_MATCH_TIMEOUT_MS,
      maxRequests: spec.maxRequests ?? this.options.maxRequests ?? DEFAULT_MAX_REQUESTS_PER_PLAYER };
    const invalid = invalidSpec(spec);
    if (invalid) throw new AgentHostError('invalid-spec', invalid);
    // Reserve synchronously, before discovery/catalogue awaits. stop() owns
    // this reservation too, including a factory that ignores cancellation.
    const controller = new AbortController();
    const run = Promise.resolve().then(() => this.launch(spec, controller));
    const starting = { controller, run };
    this.starting = starting;
    try { return await run; }
    finally { if (this.starting === starting) this.starting = undefined; }
  }

  private async launch(spec: AgentMatchSpec, controller: AbortController): Promise<string> {
    const client = await callTransport(() => this.client(), 10_000, controller.signal);
    const catalogue = await client.listModels({ signal: controller.signal });
    if (controller.signal.aborted) throw new OpenCodeError('aborted', 'start cancelled');
    for (const player of [1, 2] as PlayerId[]) {
      const model = spec.models[player];
      const entry = catalogue.find(entry => entry.id === model.id && entry.providerID === model.providerID);
      if (!entry) {
        throw new OpenCodeError('model-not-found', 'selected model is not in the OpenCode catalogue');
      }
      if (entry.enabled === false || (entry.type !== undefined && entry.type !== 'chat')) {
        throw new OpenCodeError('unsupported-model', 'selected model is not enabled for text generation');
      }
      spec.models[player] = { id: model.id, providerID: model.providerID, ...(model.variant ? { variant: model.variant } : {}) };
    }

    const matchId = `match-${++this.counter}`;
    const grant = new MatchGrant(matchId, controller.signal);
    const limits = {
      requestsPerPlayer: spec.maxRequests ?? this.options.maxRequests ?? DEFAULT_MAX_REQUESTS_PER_PLAYER,
      timeoutMs: spec.timeoutMs ?? this.options.timeoutMs ?? DEFAULT_MATCH_TIMEOUT_MS,
    };
    const strategies = {
      1: opencodeStrategy({
        player: 1, match: grant, model: spec.models[1], client,
        timeoutMs: limits.timeoutMs, maxRequests: limits.requestsPerPlayer,
      }),
      2: opencodeStrategy({
        player: 2, match: grant, model: spec.models[2], client,
        timeoutMs: limits.timeoutMs, maxRequests: limits.requestsPerPlayer,
      }),
    };
    const config: MatchConfig = {
      version: MATCH_FORMAT_VERSION,
      seed: spec.seed,
      maxTimeSeconds: spec.maxTimeSeconds,
      decideIntervalSeconds: spec.decideIntervalSeconds,
      ...(spec.civilizations ? { civilizations: spec.civilizations } : {}),
      ...(spec.map ? { map: spec.map } : {}),
      ...(spec.mode !== undefined ? { mode: spec.mode } : {}),
      ...(spec.populationLimit !== undefined ? { populationLimit: spec.populationLimit } : {}),
      ...(spec.wonderVictory !== undefined ? { wonderVictory: spec.wonderVictory } : {}),
    };

    const current: CurrentMatch = {
      matchId,
      status: 'running',
      start: undefined,
      models: spec.models,
      usage: { 1: 0, 2: 0 },
      limits,
      tick: 0,
      timeSeconds: 0,
      commands: [],
      controller,
      grant,
      run: Promise.resolve(),
    };
    const hooks: MatchHooks = {
      signal: controller.signal,
      onInit: start => {
        current.start = start;
        // The initial snapshot is emitted once the creation recipe exists,
        // so every spectator that sees any event first sees a complete one.
        this.emit({ type: 'snapshot', snapshot: snapshotOf(current) });
      },
      onCommand: entry => {
        current.commands.push(entry);
        this.emit({ type: 'command', tick: entry.tick, command: entry.command });
      },
      onTick: progress => {
        current.tick = progress.tick;
        current.timeSeconds = progress.timeSeconds;
        this.emit({ type: 'tick', tick: progress.tick, timeSeconds: progress.timeSeconds });
      },
      onDecision: event => {
        if (event.phase === 'begin') current.usage[event.player] += 1;
        this.emit({
          type: 'decision',
          player: event.player,
          phase: event.phase,
          tick: event.tick,
          time: event.time,
          ...(event.commands !== undefined ? { commands: event.commands } : {}),
          ...(event.error !== undefined ? { error: 'strategy decision failed or was cancelled' } : {}),
        });
      },
    };

    grant.arm();
    this.current = current;
    current.run = (async () => {
      let endStatus: 'finished' | 'aborted' | 'failed' = controller.signal.aborted ? 'aborted' : 'failed';
      try {
        const outcome = await runMatch(config, strategies, FALLBACK_RULES, hooks);
        current.result = outcome.result;
        current.record = outcome.record;
        endStatus = controller.signal.aborted ? 'aborted' : 'finished';
      } catch (error) {
        current.failure = error instanceof OpenCodeError
          ? { code: error.code, message: `OpenCode decision failed: ${error.code}` }
          : { code: 'unknown', message: 'match failed' };
        endStatus = controller.signal.aborted ? 'aborted' : 'failed';
      } finally {
        current.status = endStatus;
        grant.end();
        this.emit({
          type: 'match-ended',
          status: endStatus,
          ...(current.result ? { result: current.result } : {}),
          ...(current.record ? { record: current.record } : {}),
          ...(current.failure ? { failure: current.failure } : {}),
        });
      }
    })();
    return matchId;
  }

  /**
   * Subscribe to match events. A subscriber attached before a match starts
   * receives that match's `snapshot` at start; a late joiner receives the
   * current snapshot immediately. Events are then strictly ordered deltas,
   * and detached subscriptions get a best-effort `subscription-ended`. A
   * subscriber whose buffer overflows is detached explicitly with `overflow`
   * instead of silently dropping events.
   */
  subscribe(listener: AgentEventListener): () => void {
    let cancel!: () => void;
    const cancelled = new Promise<void>(resolve => { cancel = resolve; });
    const subscriber: Subscriber = { listener, queue: [], closed: false, cancelled, cancel };
    this.subscribers.add(subscriber);
    if (this.current?.start) {
      this.deliver(subscriber, { type: 'snapshot', snapshot: snapshotOf(this.current) });
    }
    return () => this.endSubscription(subscriber, 'unsubscribed');
  }

  /**
   * Abort the running match and wait only until the match itself settled:
   * strategies stop, in-flight model calls abort, and the partial record is
   * kept. Subscriber queues are never awaited here -- a spectator listener
   * must not be able to hang a stop; use `settled()` to await delivery.
   */
  async stop(): Promise<void> {
    const starting = this.starting;
    starting?.controller.abort();
    const current = this.current;
    if (current?.status === 'running') current.controller.abort();
    await starting?.run.catch(() => {});
    if (current) await current.run;
  }

  /** Await natural completion without cancelling, independent of subscribers. */
  async waitForMatch(): Promise<void> {
    await this.starting?.run;
    await this.current?.run;
  }

  /** Wait until every subscriber's queue has drained. */
  async settled(): Promise<void> {
    while ([...this.subscribers].some(subscriber => subscriber.draining)) {
      await Promise.all([...this.subscribers].map(subscriber => subscriber.draining));
    }
  }

  private async client(): Promise<OpenCodeClient> {
    if (this.clientInstance) return this.clientInstance;
    const provided = this.options.client;
    const client = provided === undefined
      ? await discoverOpenCodeClient()
      : typeof provided === 'function'
        ? await provided()
        : provided;
    // Cache only a working client so an explicit unavailable state can clear.
    this.clientInstance = client;
    return client;
  }

  private emit(event: AgentMatchEvent): void {
    for (const subscriber of [...this.subscribers]) {
      this.deliver(subscriber, event);
    }
  }

  private deliver(subscriber: Subscriber, event: AgentMatchEvent): void {
    if (subscriber.closed) return;
    const bufferLimit = this.options.bufferLimit ?? DEFAULT_EVENT_BUFFER;
    if (subscriber.queue.length + (subscriber.draining ? 1 : 0) >= bufferLimit) {
      this.endSubscription(subscriber, 'overflow');
      return;
    }
    // Clone at enqueue time: listeners may mutate their copies, never the
    // authoritative record, another listener's event, or a previous snapshot.
    subscriber.queue.push(structuredClone(event));
    this.drain(subscriber);
  }

  private drain(subscriber: Subscriber): void {
    if (subscriber.draining || subscriber.closed || !subscriber.queue.length) return;
    subscriber.draining = Promise.resolve().then(async () => {
      while (!subscriber.closed && subscriber.queue.length) {
        const next = subscriber.queue.shift()!;
        try {
          await Promise.race([Promise.resolve().then(() => {
            if (!subscriber.closed) return subscriber.listener(next);
          }), subscriber.cancelled]);
        } catch {
          this.endSubscription(subscriber, 'listener-error');
        }
      }
    }).finally(() => {
      subscriber.draining = undefined;
      // An enqueue can run between the async loop returning and this finalizer.
      this.drain(subscriber);
    });
  }

  private endSubscription(subscriber: Subscriber, reason: 'unsubscribed' | 'overflow' | 'listener-error'): void {
    if (subscriber.closed) return;
    subscriber.closed = true;
    subscriber.queue.length = 0;
    subscriber.cancel();
    this.subscribers.delete(subscriber);
    if (reason === 'listener-error') return; // the listener just threw; do not call it again
    // A stalled listener cannot delay detachment or retain the queue. Goodbye
    // is best effort; observe async rejection without awaiting cooperation.
    try { Promise.resolve(subscriber.listener({ type: 'subscription-ended', reason })).catch(() => {}); }
    catch { /* A listener that throws on its goodbye cannot be told more. */ }
  }
}

function snapshotOf(current: CurrentMatch): AgentMatchSnapshot {
  if (!current.start) throw new Error('internal: snapshot requested before match start');
  return structuredClone({
    matchId: current.matchId,
    status: current.status,
    start: current.start,
    models: current.models,
    usage: { ...current.usage },
    limits: current.limits,
    tick: current.tick,
    timeSeconds: current.timeSeconds,
    commands: current.commands.map(entry => ({ tick: entry.tick, command: entry.command })),
    ...(current.result ? { result: current.result } : {}),
    ...(current.record ? { record: current.record } : {}),
    ...(current.failure ? { failure: current.failure } : {}),
  });
}
