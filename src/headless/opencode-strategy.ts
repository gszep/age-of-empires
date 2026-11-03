/**
 * OpenCode model strategy for live agent matches (#352).
 *
 * One `decide` sends the player's canonical observation JSON and summary to the
 * selected OpenCode model and returns the commands it replies with. The
 * strategy is deliberately strict and never substitutes a built-in policy:
 * a model that replies with malformed JSON, another player's commands, a
 * stale observation time, or that hits its request cap fails the match with
 * a typed `OpenCodeError` so the failure surfaces instead of being papered
 * over.
 *
 * Paid-request bounds: no call happens without an explicitly armed
 * `MatchGrant`, every call has a per-call timeout, each player has a
 * request-count cap (a count, not a money budget), and there are no automatic
 * retries -- a failed decision fails the match.
 */
import { readFileSync } from 'node:fs';
import { parseStrategyLine } from '../protocol/validate';
import type { Command, PlayerId } from '../sim/types';
import type { StrategyInputMessage } from '../protocol/types';
import { MatchGrant, type OpenCodeModelRef } from '../agents/protocol';
import { OpenCodeClient, OpenCodeError } from './opencode-client';
import type { Strategy } from './runner';

export const DEFAULT_OPENCODE_TIMEOUT_MS = 30_000;
export const DEFAULT_OPENCODE_MAX_REQUESTS = 4_096;
/** Local byte bound, not a provider token/context guarantee. Never truncate. */
export const MAX_OPENCODE_PROMPT_BYTES = 1024 * 1024;
const commandSchema = readFileSync(new URL('../../schemas/command.schema.json', import.meta.url), 'utf8');

export interface OpenCodeStrategyOptions {
  /** Which player this strategy issues commands for. */
  player: PlayerId;
  /** Explicit live-match authorization; model requests require it to be armed. */
  match: MatchGrant;
  /** Selected model, from the sanitized catalogue. */
  model: OpenCodeModelRef;
  client: OpenCodeClient;
  /** Per-call timeout in milliseconds. */
  timeoutMs?: number;
  /** Per-player request-count cap across the whole match. */
  maxRequests?: number;
}

export function opencodeStrategy(options: OpenCodeStrategyOptions): Strategy {
  const { player, match, model, client } = options;
  const timeoutMs = options.timeoutMs ?? DEFAULT_OPENCODE_TIMEOUT_MS;
  const maxRequests = options.maxRequests ?? DEFAULT_OPENCODE_MAX_REQUESTS;
  if (!Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > 1_000_000
    || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3_600_000) {
    throw new OpenCodeError('invalid-request', 'invalid request cap or timeout');
  }
  let requests = 0;
  let stopped = false;
  const inFlight = new Set<AbortController>();

  return {
    async decide(input: StrategyInputMessage): Promise<Command[]> {
      if (stopped) throw new OpenCodeError('aborted', 'strategy stopped');
      if (!match.live) {
        throw new OpenCodeError('no-live-match', `match ${match.matchId} is not live; refusing to call the model`);
      }
      if (requests >= maxRequests) {
        throw new OpenCodeError('request-cap', `player ${player} reached its ${maxRequests}-request cap`);
      }
      if (match.signal.aborted) throw new OpenCodeError('aborted', `match ${match.matchId} was aborted`);
      const prompt = buildPrompt(player, input);
      requests++;
      const call = new AbortController();
      inFlight.add(call);
      const onMatchAbort = () => call.abort();
      match.signal.addEventListener('abort', onMatchAbort, { once: true });
      try {
        const text = await client.generateText(prompt, { model, timeoutMs, signal: call.signal });
        return validateReply(text, input, player);
      } finally {
        match.signal.removeEventListener('abort', onMatchAbort);
        inFlight.delete(call);
      }
    },

    stop() {
      stopped = true;
      for (const call of inFlight) call.abort();
      inFlight.clear();
    },
  };
}

/**
 * The prompt is the player's own runner-provided observation (already
 * player-filtered by `observe`) plus that player's rejected-command feedback.
 * No full GameState or other player's private observation is sent. Visible
 * opponents, remembered facts and public announcements remain as observe emits them.
 */
function buildPrompt(player: PlayerId, input: StrategyInputMessage): string {
  const lines = [
    `You are the player ${player} strategy in a deterministic RTS match.`,
    'Reply with one JSON object and no other text, shaped exactly:',
    `{"type":"commands","time":${input.observation.time},"commands":[]}`,
    `Fill "commands" with zero or more game commands; every command must have "player":${player}.`,
    `Use exactly "time":${input.observation.time}.`,
    `Each command must satisfy this JSON Schema: ${commandSchema}`,
  ];
  if (input.rejected.length) {
    lines.push(`Your previously rejected commands, do not repeat them: ${JSON.stringify(input.rejected)}`);
  }
  lines.push(`Observation summary: ${input.text}`);
  // The summary omits IDs, positions and terrain: commands require the full
  // sanctioned player observation, never the authoritative GameState.
  lines.push(`Observation JSON: ${JSON.stringify(input.observation)}`);
  lines.push(`Decision time: ${input.observation.time}`);
  const prompt = lines.join('\n');
  if (Buffer.byteLength(prompt, 'utf8') > MAX_OPENCODE_PROMPT_BYTES) {
    throw new OpenCodeError('invalid-request', `complete decision prompt exceeds ${MAX_OPENCODE_PROMPT_BYTES} bytes; refusing to truncate or call the model`);
  }
  return prompt;
}

/** Validate the model reply against the same public command schema as every other strategy. */
function validateReply(text: string, input: StrategyInputMessage, player: PlayerId): Command[] {
  let message: ReturnType<typeof parseStrategyLine>;
  try {
    message = parseStrategyLine(text);
  } catch {
    // The shared parser includes raw model text in diagnostics. Never expose it.
    throw new OpenCodeError('malformed-reply', 'model reply was not a valid commands message');
  }
  if (message.time !== input.observation.time) {
    throw new OpenCodeError('stale-reply', `model replied for time ${message.time}, expected ${input.observation.time}`);
  }
  for (const command of message.commands) {
    const typed = command as Command;
    if (typed.player !== player) {
      throw new OpenCodeError('wrong-player', `model replied with a command for player ${typed.player}`);
    }
  }
  return message.commands as Command[];
}
