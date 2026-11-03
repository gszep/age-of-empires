/**
 * Fake OpenCode transport for tests (#352): every test drives the client,
 * strategies and host end to end through this fixture, never a live service.
 * Replies use the documented V2 wire shapes so the sanitization boundary is
 * exercised for real, and hanging calls honor their abort signal exactly like
 * a cancelled network request.
 */
import type { PlayerId } from '../sim/types';
import type { PlayerObservation } from '../protocol/types';
import type { OpenCodeModelRef, OpenCodeTransport } from './opencode-client';

export interface RecordedCall {
  prompt: string;
  model: OpenCodeModelRef;
  signal: AbortSignal;
  /** Player parsed from the strategy prompt. */
  player: PlayerId;
  /** Decision time parsed from the strategy prompt. */
  time: number;
}

export interface FakeTransportOptions {
  /** V2 `GET /api/model` wire reply (default: two selectable models). */
  catalogue?: unknown;
  /** V2 `POST /api/experimental/generate/text` wire reply per call. */
  generate: (call: RecordedCall) => unknown | Promise<unknown>;
}

export function catalogueWire(entries: unknown[]): unknown {
  return { location: { directory: '/worktree' }, data: entries };
}

export function textWire(text: string): unknown {
  return { data: { text } };
}

/** Parse only the model-visible wire prompt, never a simulation-side oracle. */
export function promptObservation(prompt: string): PlayerObservation {
  const prefix = 'Observation JSON: ';
  const line = prompt.split('\n').find(line => line.startsWith(prefix));
  if (!line) throw new Error('prompt has no canonical observation JSON');
  return JSON.parse(line.slice(prefix.length)) as PlayerObservation;
}

/** A call that never settles until aborted, like a cancelled request in flight. */
export function hangingUntilAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) { reject(new Error('request aborted')); return; }
    signal.addEventListener('abort', () => reject(new Error('request aborted')), { once: true });
  });
}

/** A transport-level failure shaped like the official client's declared errors. */
export function declaredError(tag: string, message: string, extra: Record<string, unknown> = {}): object {
  return { _tag: tag, message, ...extra };
}

/**
 * Reply with a `stop` command for one of the caller's own units: the strategy
 * prompt identifies the player and decision time, so the scripted model
 * answers with a genuinely applicable command for that player.
 */
export function stopCommandReply(entityIdFor: Record<PlayerId, number>) {
  return (call: RecordedCall): unknown => textWire(JSON.stringify({
    type: 'commands',
    time: call.time,
    commands: [{ kind: 'stop', player: call.player, entityIds: [entityIdFor[call.player]] }],
  }));
}

export function fakeOpenCodeTransport(options: FakeTransportOptions): OpenCodeTransport & { calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const catalogue = options.catalogue ?? catalogueWire([
    { id: 'model-a', providerID: 'provider-a', name: 'Model A', type: 'chat', enabled: true },
    { id: 'model-b', providerID: 'provider-b', name: 'Model B', type: 'chat', enabled: true },
  ]);
  return {
    calls,
    async listModels() {
      return catalogue;
    },
    async generateText(request, signal) {
      const player = /player (\d) strategy/.exec(request.prompt)?.[1];
      const time = Number(/Decision time: ([\d.]+)/.exec(request.prompt)?.[1] ?? Number.NaN);
      const call: RecordedCall = {
        prompt: request.prompt,
        model: request.model,
        signal,
        player: player === '2' ? 2 : 1,
        time,
      };
      calls.push(call);
      return options.generate(call);
    },
  };
}
