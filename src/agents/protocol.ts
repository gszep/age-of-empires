/**
 * Backend contract for live OpenCode model-versus-model matches (#352).
 *
 * This module is the typed contract between the headless runner integration
 * (`src/headless/opencode-strategy.ts`), the host controller
 * (`src/agents/host.ts`) and the future HTTP/browser wiring. Keep it
 * importable from a browser bundle: import only types from Node-only modules.
 *
 * The event surface deliberately has no spectator command channel: players are
 * driven only by strategies holding an armed `MatchGrant`, and events carry
 * only the fields below -- no observations, model prompts, model replies, or
 * OpenCode transport details. That is an implementation property kept by the
 * host tests (they assert no event ever carries observation/credential data),
 * not something the type system can enforce at runtime.
 */
import type { Command, PlayerId } from '../sim/types';
import type { MatchRecord, MatchResult } from '../protocol/types';
import type { MatchDecisionEvent, MatchStart } from '../headless/runner';
import type { OpenCodeErrorCode, OpenCodeModelRef, OpenCodeModelSummary } from '../headless/opencode-client';

export type { MatchDecisionEvent, MatchStart } from '../headless/runner';
export type { OpenCodeErrorCode, OpenCodeModelRef, OpenCodeModelSummary } from '../headless/opencode-client';

/**
 * Explicit per-match authorization for model requests. A strategy refuses to
 * call its model until the host has signalled the match live, and the same
 * signal aborts in-flight requests when the match stops, so no paid request
 * can happen outside an explicitly started match.
 */
export class MatchGrant {
  private state: 'armed' | 'ended' = 'ended';

  constructor(
    /** Opaque identifier of the explicitly started match. */
    readonly matchId: string,
    /** Aborts every in-flight model request for this match. */
    readonly signal: AbortSignal,
  ) {}

  /** True only while the host has explicitly signalled this match live. */
  get live(): boolean {
    return this.state === 'armed';
  }

  /** Host-only: mark the match live, permitting model requests. */
  arm(): void {
    this.state = 'armed';
  }

  /** Host-only: end the match authorization. */
  end(): void {
    this.state = 'ended';
  }
}

export type AgentMatchStatus = 'running' | 'finished' | 'aborted' | 'failed';

/** A sanitized failure: a typed catalogue code plus an already-sanitized message. */
export interface AgentFailure {
  code: OpenCodeErrorCode | 'unknown';
  message: string;
}

/**
 * Everything a spectator needs to rebuild the match so far: the creation
 * recipe in `start` (seed, civilizations, map, mode and cadence), the
 * recorded commands (including simulation rejections), and simulation progress.
 * Replaying
 * `start` plus `commands` up to `tick` reproduces the visible world
 * deterministically; `start.initialChecksum` verifies the rebuild before any
 * command is applied.
 *
 * `commands` is the full prefix of the match record. Its size is bounded by
 * the match's own decision budget (`maxTimeSeconds / decideIntervalSeconds`),
 * the same order as the final `MatchRecord` the runner must retain anyway;
 * there is no separate unbounded buffer. This first slice always sends the
 * full prefix: a future slice can add windowed resync if profiles show the
 * copy cost mattering.
 */
export interface AgentMatchSnapshot {
  matchId: string;
  status: AgentMatchStatus;
  start: MatchStart;
  models: { 1: OpenCodeModelRef; 2: OpenCodeModelRef };
  /** Decision attempts per player so far. */
  usage: { 1: number; 2: number };
  /** Bounds the host enforces on every model call. */
  limits: { requestsPerPlayer: number; timeoutMs: number };
  tick: number;
  timeSeconds: number;
  /** Recorded commands, including simulation rejections, in record order. */
  commands: { tick: number; command: Command }[];
  /** Present once the match has ended. */
  result?: MatchResult;
  /** Present once the match has ended; the canonical replay artifact. */
  record?: MatchRecord;
  /** Present when the match failed. */
  failure?: AgentFailure;
}

export type AgentMatchEvent =
  /** First event for every subscriber: on subscribe (late join) and on start. */
  | { type: 'snapshot'; snapshot: AgentMatchSnapshot }
  /** A command entering the match record (same instant the runner records it). */
  | { type: 'command'; tick: number; command: Command }
  /** Simulation progress; strictly increasing per match. */
  | { type: 'tick'; tick: number; timeSeconds: number }
  /** Decision lifecycle for one player's strategy. */
  | (MatchDecisionEvent & { type: 'decision' })
  /** Terminal event; `record` is the partial record for aborted matches. */
  | { type: 'match-ended'; status: 'finished' | 'aborted' | 'failed'; result?: MatchResult; record?: MatchRecord; failure?: AgentFailure }
  /** Best-effort final invocation, except for a throwing listener. */
  | { type: 'subscription-ended'; reason: 'unsubscribed' | 'overflow' | 'listener-error' };

/**
 * Delivery contract for `subscribe`: events reach a listener in strict match
 * order, and each recorded command reaches a healthy subscriber exactly once
 * (in its late-join snapshot prefix, or as a `command` event -- never both).
 * Per-subscriber queues are bounded; on overflow the subscription ends with
 * `subscription-ended` reason `overflow`, queued-but-undelivered events are
 * discarded, and the consumer resubscribes to get a fresh snapshot. A listener
 * that stalls may still have one unresolved invocation when goodbye arrives.
 * A listener that throws is detached without a goodbye event, since calling it again
 * would just throw again; other spectators are unaffected.
 */
export type AgentEventListener = (event: AgentMatchEvent) => void | Promise<void>;
