/**
 * Live read-only reconstruction of an agent match (#352).
 *
 * The spectator page never receives a world dump: it receives the creation
 * recipe, the recorded command stream and tick progress, and rebuilds the
 * authoritative simulation itself from the same shared TypeScript code the
 * backend runs. Determinism is verified, not assumed:
 *
 * - a snapshot's `rulesOrigin` must equal the browser's `FALLBACK_RULES`
 *   origin, so an owned-rules match is refused loudly instead of rendered
 *   with the wrong rules;
 * - `start.initialChecksum` must match the freshly created state before any
 *   command is applied;
 * - every recorded command is applied at its own tick, in record order,
 *   including simulation rejections, exactly like the runner;
 * - on `match-ended` the rebuild is checked against every periodic checksum,
 *   complete command consumption and terminal progress of the canonical record.
 *
 * Any mismatch becomes an explicit `reconstruction` failure surfaced in the
 * UI; the view never hides it to keep drawing.
 */
import { applyCommand, createGame, stepGame } from '../../sim/game';
import { checksumState } from '../../sim/checksum';
import { FALLBACK_RULES, TICK_SECONDS } from '../../sim/data';
import { matchOver } from '../../sim/regicide';
import type { GameState } from '../../sim/types';
import type { MatchRecord, MatchResult } from '../../protocol/types';
import type { AgentFailure, AgentMatchEvent, AgentMatchSnapshot, OpenCodeModelRef } from '../protocol';

export type MatchViewErrorCode = 'rules-mismatch' | 'checksum-mismatch';

export class MatchViewError extends Error {
  constructor(readonly code: MatchViewErrorCode, message: string) {
    super(message);
    this.name = 'MatchViewError';
  }
}

export interface MatchPlayerState {
  model: string;
  usage: number;
  thinking: boolean;
  last: 'ok' | 'failed' | undefined;
  commands: number;
}

export interface MatchViewSummary {
  matchId?: string;
  status?: string;
  rulesOrigin?: string;
  initialChecksum?: string;
  /** Initial checksum was verified before any command was applied. */
  verified?: boolean;
  /** Hashes, command consumption and canonical terminal progress all match. */
  reconstructionOk?: boolean;
  reconstructionFailures?: number;
  reconstructionChecked?: number;
  tick: number;
  timeSeconds: number;
  entities: number;
  players: { 1: MatchPlayerState; 2: MatchPlayerState };
  limits?: { requestsPerPlayer: number; timeoutMs: number };
  result?: MatchResult;
  record?: MatchRecord;
  failure?: AgentFailure;
  viewError?: MatchViewErrorCode;
  viewErrorMessage?: string;
  commands: number;
}

type Listener = (summary: MatchViewSummary) => void;

interface Pending {
  commands: AgentMatchSnapshot['commands'];
  applied: number;
  checksums: Map<number, string>;
  failures: number;
  checked: number;
}

/**
 * One match's spectator model. `apply` consumes host events in strict order;
 * the current `GameState` is exposed for rendering.
 */
export class MatchView {
  private snapshot: AgentMatchSnapshot | undefined;
  private state: GameState | undefined;
  private pending: Pending = { commands: [], applied: 0, checksums: new Map(), failures: 0, checked: 0 };
  private view: MatchViewSummary = {
    tick: 0, timeSeconds: 0, entities: 0,
    players: {
      1: { model: '', usage: 0, thinking: false, last: undefined, commands: 0 },
      2: { model: '', usage: 0, thinking: false, last: undefined, commands: 0 },
    },
    commands: 0,
  };
  private readonly listeners = new Set<Listener>();

  /** Subscribe to summary changes; returns an unsubscribe function. */
  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Current authoritative rebuilt state, for rendering. Read-only. */
  get gameState(): GameState | undefined {
    return this.state;
  }

  summary(): MatchViewSummary {
    return { ...this.view, players: { 1: { ...this.view.players[1] }, 2: { ...this.view.players[2] } } };
  }

  /** Apply one event; a `snapshot` resets the whole rebuild (late join, resync). */
  apply(event: AgentMatchEvent): void {
    if (event.type === 'snapshot') { this.reset(event.snapshot); return; }
    if (!this.state || this.view.matchId === undefined) return; // nothing to add deltas to yet
    switch (event.type) {
      case 'command':
        this.pending.commands.push({ tick: event.tick, command: event.command });
        this.advanceTo(event.tick);
        this.view.commands = this.pending.commands.length;
        break;
      case 'tick':
        this.advanceTo(event.tick);
        this.view.timeSeconds = event.timeSeconds;
        break;
      case 'decision': {
        const player = this.view.players[event.player];
        if (event.phase === 'begin') { player.usage += 1; player.thinking = true; }
        if (event.phase === 'end') { player.thinking = false; player.last = 'ok'; player.commands += event.commands ?? 0; }
        if (event.phase === 'fail') { player.thinking = false; player.last = 'failed'; }
        break;
      }
      case 'match-ended':
        // Hashes arrive only with the terminal record. Rebuild the *received*
        // command stream from its recipe with those hashes now available. Do
        // not replace it with record.commands: that would conceal lost deltas.
        if (event.record && this.snapshot) {
          const players = this.view.players;
          this.reset({ ...this.snapshot, status: event.status, tick: this.view.tick,
            timeSeconds: this.view.timeSeconds, commands: this.pending.commands,
            record: event.record, result: event.result, failure: event.failure }, false);
          this.view.players = players;
        }
        this.view.status = event.status;
        if (event.result !== undefined) this.view.result = event.result;
        if (event.record !== undefined) this.view.record = event.record;
        if (event.failure !== undefined) this.view.failure = event.failure;
        break;
      default:
        break; // subscription-ended is handled by the transport
    }
    this.emit();
  }

  private emit(): void {
    const summary = this.summary();
    for (const listener of [...this.listeners]) listener(summary);
  }

  /** Rebuild from a snapshot: the authoritative reset point for every gap. */
  private reset(snapshot: AgentMatchSnapshot, emit = true): void {
    this.snapshot = snapshot;
    this.view = {
      matchId: snapshot.matchId,
      status: snapshot.status,
      rulesOrigin: snapshot.start.rulesOrigin,
      initialChecksum: snapshot.start.initialChecksum,
      tick: snapshot.tick,
      timeSeconds: snapshot.timeSeconds,
      entities: 0,
      players: {
        1: { model: modelLabel(snapshot.models[1]), usage: snapshot.usage[1], thinking: false, last: undefined, commands: 0 },
        2: { model: modelLabel(snapshot.models[2]), usage: snapshot.usage[2], thinking: false, last: undefined, commands: 0 },
      },
      limits: snapshot.limits,
      commands: snapshot.commands.length,
      ...(snapshot.result !== undefined ? { result: snapshot.result } : {}),
      ...(snapshot.record !== undefined ? { record: snapshot.record } : {}),
      ...(snapshot.failure !== undefined ? { failure: snapshot.failure } : {}),
    };
    this.state = undefined;
    this.pending = { commands: [], applied: 0, checksums: new Map(), failures: 0, checked: 0 };
    if (snapshot.start.rulesOrigin !== FALLBACK_RULES.origin) {
      this.view.viewError = 'rules-mismatch';
      this.view.viewErrorMessage = `match uses '${snapshot.start.rulesOrigin}' rules; this page only renders '${FALLBACK_RULES.origin}' matches`;
      this.emit();
      return;
    }
    const state = createGame(
      snapshot.start.seed, FALLBACK_RULES, snapshot.start.civilizations, snapshot.start.map,
      snapshot.start.mode, snapshot.start.populationLimit, snapshot.start.wonderVictory,
    );
    const initial = checksumState(state);
    if (initial !== snapshot.start.initialChecksum) {
      this.view.viewError = 'checksum-mismatch';
      this.view.viewErrorMessage = `initial checksum mismatch: rebuilt ${initial}, expected ${snapshot.start.initialChecksum}`;
      this.emit();
      return; // never apply commands on an unverifiable rebuild
    }
    this.view.verified = true;
    this.state = state;
    // Late join: the prefix is already recorded; replay it exactly.
    this.pending.commands = snapshot.commands.map(entry => ({ tick: entry.tick, command: entry.command }));
    if (snapshot.record !== undefined) {
      for (const entry of snapshot.record.checksums) this.pending.checksums.set(entry.tick, entry.hash);
    }
    this.advanceTo(snapshot.tick);
    this.view.tick = state.tick;
    this.view.timeSeconds = snapshot.timeSeconds;
    this.view.entities = state.entities.length;
    if (snapshot.status !== 'running' && snapshot.record) {
      // Ended before we joined: verify against the record we were handed.
      if (JSON.stringify(snapshot.commands) !== JSON.stringify(snapshot.record.commands)) this.pending.failures += 1;
      this.pending.failures += snapshot.record.checksums.length - this.pending.checked;
      // The last periodic hash need not be at the terminal tick. Never infer
      // missing progress from that hash or silently advance to the record's
      // time: the received prefix/stream must already reach the actual end.
      const endTime = snapshot.record.result.timeSeconds;
      const endTick = Math.round(endTime / TICK_SECONDS);
      const roundedTime = Math.round(endTick * TICK_SECONDS * 100) / 100;
      if (!Number.isSafeInteger(endTick) || endTick < 0 || roundedTime !== endTime
        || snapshot.tick !== endTick || state.tick !== endTick
        || snapshot.timeSeconds !== state.tick * TICK_SECONDS
        || (snapshot.result !== undefined && snapshot.result.timeSeconds !== endTime)) this.pending.failures += 1;
      if (this.pending.applied !== this.pending.commands.length) this.pending.failures += 1;
      this.view.reconstructionOk = this.pending.failures === 0;
      this.view.reconstructionFailures = this.pending.failures;
      this.view.reconstructionChecked = this.pending.checked;
    }
    if (emit) this.emit();
  }

  /**
   * Advance the rebuild to `target`, applying due commands at their own tick
   * before each step, and verifying any periodic checksums along the way.
   */
  private advanceTo(target: number): void {
    const state = this.state;
    if (!state) return;
    while (state.tick < target && !matchOver(state)) {
      this.applyDue(state);
      stepGame(state);
      const expected = this.pending.checksums.get(state.tick);
      if (expected !== undefined) {
        this.pending.checked += 1;
        if (checksumState(state) !== expected) this.pending.failures += 1;
      }
    }
    // A snapshot can carry commands at its current tick; they apply now.
    this.applyDue(state);
    this.view.tick = state.tick;
    this.view.entities = state.entities.length;
  }

  private applyDue(state: GameState): void {
    while (this.pending.applied < this.pending.commands.length && this.pending.commands[this.pending.applied].tick === state.tick) {
      const entry = this.pending.commands[this.pending.applied];
      this.pending.applied += 1;
      // Rejections are part of the record; the runner applies every command
      // and merely notes the rejection, so the rebuild must do the same.
      applyCommand(state, entry.command as never);
    }
  }
}

function modelLabel(model: OpenCodeModelRef): string {
  return `${model.providerID}/${model.id}`;
}
