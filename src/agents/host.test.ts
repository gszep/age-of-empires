import { describe, expect, it } from 'vitest';
import { applyCommand, createGame, stepGame } from '../sim/game';
import { checksumState } from '../sim/checksum';
import { createReplayGame } from '../sim/replay';
import { observe } from '../sim/observe';
import { replayRecord, runMatch } from '../headless/runner';
import { OpenCodeClient, OpenCodeError } from '../headless/opencode-client';
import {
  catalogueWire,
  declaredError,
  fakeOpenCodeTransport,
  hangingUntilAbort,
  promptObservation,
  stopCommandReply,
  textWire,
  type RecordedCall,
} from '../headless/opencode-fake';
import { AgentMatchHost, AgentHostError, type AgentMatchSpec } from './host';
import type { AgentMatchEvent } from './protocol';

const seed = 12;
const base = createGame(seed);
// Entity ids the scripted model may stop, one real own unit per player.
const entityId = {
  1: observe(base, 1).entities.find(e => e.owner === 1 && e.kind === 'villager')!.id,
  2: observe(base, 2).entities.find(e => e.owner === 2 && e.kind === 'villager')!.id,
};

function hostWith(generate: (call: RecordedCall) => unknown | Promise<unknown>, options: { bufferLimit?: number } = {}) {
  const transport = fakeOpenCodeTransport({ generate });
  const host = new AgentMatchHost({
    client: () => new OpenCodeClient(transport),
    timeoutMs: 5_000,
    bufferLimit: options.bufferLimit,
  });
  return { host, transport };
}

function spec(overrides: Partial<AgentMatchSpec> = {}): AgentMatchSpec {
  return {
    seed,
    models: { 1: { id: 'model-a', providerID: 'provider-a' }, 2: { id: 'model-b', providerID: 'provider-b' } },
    maxTimeSeconds: 6,
    decideIntervalSeconds: 0.5,
    ...overrides,
  };
}

function collector(): { events: AgentMatchEvent[]; listener: (event: AgentMatchEvent) => void } {
  const events: AgentMatchEvent[] = [];
  return { events, listener: event => { events.push(JSON.parse(JSON.stringify(event))); } };
}

describe('agent match host', () => {
  it('trains a new villager for each player using prompt-only observations', async () => {
    // This provider receives only the prompt. It never reads base, entityId,
    // createGame, or call.player/time when choosing a command.
    const { host, transport } = hostWith(({ prompt }) => {
      const seen = promptObservation(prompt);
      const tc = seen.entities.find(e => e.owner === seen.player && e.kind === 'town-center');
      if (!tc) throw new Error('cannot find own town center in prompt');
      return textWire(JSON.stringify({ type: 'commands', time: seen.time,
        commands: [{ kind: 'train', player: seen.player, buildingId: tc.id, unit: 'villager' }] }));
    });
    await host.start(spec({ seed: 73, maxTimeSeconds: 30, decideIntervalSeconds: 30 }));
    await host.waitForMatch();
    expect(host.status()).toBe('finished');
    const record = host.snapshot()!.record!;
    expect(transport.calls).toHaveLength(2);
    expect(record.commands).toHaveLength(2);
    expect(record.result.rejectedCommands).toEqual([]);
    for (const call of transport.calls) {
      const initial = promptObservation(call.prompt);
      expect(record.result.players[initial.player].population).toBe(initial.population + 1);
      expect(record.result.players[initial.player].food).toBeLessThan(initial.food);
    }
    expect(replayRecord(record)).toMatchObject({ ok: true, checked: record.checksums.length });
  });

  it('never invokes queued events after unsubscribe, even between drain microtasks', async () => {
    const { host } = hostWith(stopCommandReply(entityId));
    await host.start(spec({ maxTimeSeconds: 0.1 })); await host.waitForMatch();
    const events = collector();
    const unsubscribe = host.subscribe(events.listener);
    await Promise.resolve(); // drain has dequeued the snapshot, invocation not run
    unsubscribe();
    await host.settled();
    await Promise.resolve();
    expect(events.events).toEqual([{ type: 'subscription-ended', reason: 'unsubscribed' }]);
  });

  it('rejects disabled or non-chat models without generation', async () => {
    for (const fields of [{ enabled: false }, { type: 'image' }]) {
      const transport = fakeOpenCodeTransport({
        catalogue: catalogueWire([{ id: 'model-a', providerID: 'provider-a', ...fields }]),
        generate: () => textWire('must not call'),
      });
      const host = new AgentMatchHost({ client: new OpenCodeClient(transport) });
      await expect(host.start(spec())).rejects.toMatchObject({ code: 'unsupported-model' });
      expect(transport.calls).toHaveLength(0);
    }
  });

  it('enforces entity ownership in the simulation, not only the player field', async () => {
    const { host } = hostWith(call => textWire(JSON.stringify({ type: 'commands', time: call.time,
      commands: [{ kind: 'delete', player: call.player, entityIds: [entityId[call.player === 1 ? 2 : 1]] }] })));
    await host.start(spec({ maxTimeSeconds: 0.1 })); await host.waitForMatch();
    const record = host.snapshot()!.record!;
    expect(record.result.rejectedCommands).toHaveLength(2);
    // Initial ticks legitimately claim nearby sheep, so compare with an
    // untouched simulation at the same tick rather than the initial census.
    const idle = await runMatch({ version: 1, seed, maxTimeSeconds: 0.1 }, { 1: { decide: () => [] }, 2: { decide: () => [] } });
    expect(record.result.players).toEqual(idle.result.players);
  });

  it('reserves startup before discovery; stop cancels it even when discovery ignores abort', async () => {
    let release!: (client: OpenCodeClient) => void;
    const transport = fakeOpenCodeTransport({ generate: stopCommandReply(entityId) });
    const host = new AgentMatchHost({ client: () => new Promise(resolve => { release = resolve; }) });
    const pending = host.start(spec());
    const rejected = expect(pending).rejects.toMatchObject({ code: 'aborted' });
    await expect(host.start(spec())).rejects.toMatchObject({ code: 'match-running' });
    expect(host.status()).toBe('starting');
    await host.stop();
    await rejected;
    release(new OpenCodeClient(transport));
    await Promise.resolve();
    expect(transport.calls).toHaveLength(0);
    expect(host.status()).toBe('idle');
    await host.start(spec({ maxTimeSeconds: 0.1 }));
    await host.waitForMatch();
    expect(host.status()).toBe('finished');
  });

  it('cancels startup in a noncooperative catalogue without generating', async () => {
    let entered!: () => void;
    const gate = new Promise<void>(resolve => { entered = resolve; });
    let generated = 0;
    const host = new AgentMatchHost({ client: new OpenCodeClient({
      listModels: () => { entered(); return new Promise(() => {}); },
      generateText: async () => { generated++; return textWire('unused'); },
    }) });
    const pending = host.start(spec());
    const rejected = expect(pending).rejects.toMatchObject({ code: 'aborted' });
    await gate;
    await host.stop();
    await rejected;
    expect(generated).toBe(0);
  });

  it('rejects invalid runtime configuration and defaults before contacting a service', async () => {
    let contacted = 0;
    const host = new AgentMatchHost({ client: () => { contacted++; throw new Error('must not contact'); } });
    for (const invalid of [null, spec({ mode: 'bad' as never }), spec({ map: 'bad' }), spec({ populationLimit: 1 }),
      spec({ civilizations: { 1: 'missing', 2: 'missing' } }), spec({ maxTimeSeconds: '2' as never }), spec({ maxTimeSeconds: NaN })]) {
      await expect(host.start(invalid as AgentMatchSpec)).rejects.toMatchObject({ code: 'invalid-spec' });
    }
    expect(contacted).toBe(0);
    await expect(new AgentMatchHost({ maxRequests: NaN }).start(spec())).rejects.toMatchObject({ code: 'invalid-spec' });
    expect(() => new AgentMatchHost({ bufferLimit: Infinity })).toThrow(AgentHostError);
  });

  it('isolates mutable specs, snapshots and subscriber events from the authoritative replay', async () => {
    const { host, transport } = hostWith(stopCommandReply(entityId));
    host.subscribe(event => {
      if (event.type === 'command') event.command.player = 2;
      if (event.type === 'snapshot') { event.snapshot.start.seed = 999; event.snapshot.models[1].id = 'tampered'; }
    });
    const healthy = collector(); host.subscribe(healthy.listener);
    const request = spec();
    const run = host.start(request);
    request.models[1].id = 'tampered';
    await run;
    const snapshot = host.snapshot()!;
    snapshot.start.seed = 888; snapshot.models[1].id = 'tampered'; snapshot.limits.requestsPerPlayer = 0;
    await host.waitForMatch(); await host.settled();
    const record = host.snapshot()!.record!;
    expect(record.seed).toBe(seed);
    expect(transport.calls[0].model.id).toBe('model-a');
    expect(replayRecord(record).ok).toBe(true);
    expect(healthy.events.flatMap(e => e.type === 'command' ? [e.command] : [])).toEqual(record.commands.map(e => e.command));
  });

  it('does not publish model text or arbitrary provider payloads on failure', async () => {
    for (const generate of [() => textWire('api_key=PRIVATE raw observation'), () => { throw declaredError('ProviderRequestError', 'api_key=PRIVATE', { reason: 'provider' }); }]) {
      const { host } = hostWith(generate); const events = collector(); host.subscribe(events.listener);
      await host.start(spec()); await host.waitForMatch(); await host.settled();
      expect(host.status()).toBe('failed');
      expect(JSON.stringify(events.events)).not.toContain('PRIVATE');
      expect(JSON.stringify(host.snapshot())).not.toContain('PRIVATE');
    }
  });

  it('detaches stalled subscriptions immediately, catches async goodbye failures, and can restart', async () => {
    const { host } = hostWith(() => new Promise(() => {}), { bufferLimit: 2 });
    let calls = 0;
    const unsubscribe = host.subscribe(async event => {
      calls++;
      if (event.type === 'subscription-ended') throw new Error('async goodbye');
      await new Promise(() => {});
    });
    await host.start(spec());
    unsubscribe(); unsubscribe();
    await host.stop(); await host.settled();
    const afterStop = calls;
    await host.start(spec()); await host.stop(); await host.settled();
    expect(calls).toBe(afterStop);
    expect(host.status()).toBe('aborted');
  });

  it('runs both players end to end and the replay checksums agree', async () => {
    const { host, transport } = hostWith(stopCommandReply(entityId));
    await host.start(spec());
    await host.waitForMatch();
    const snapshot = host.snapshot();
    expect(snapshot?.status).toBe('finished');
    // Both players produced accepted commands.
    const players = new Set(snapshot!.record!.commands.map(entry => entry.command.player));
    expect(players).toEqual(new Set([1, 2]));
    // The match record replays with matching checksums.
    const outcome = replayRecord(snapshot!.record!);
    expect(outcome).toMatchObject({ ok: true, checked: snapshot!.record!.checksums.length });
    expect(outcome.checked).toBeGreaterThan(0);
    // Each player's model was used for its own decisions.
    expect(transport.calls.filter(call => call.player === 1).every(call => call.model.id === 'model-a')).toBe(true);
    expect(transport.calls.filter(call => call.player === 2).every(call => call.model.id === 'model-b')).toBe(true);
  });

  it('streams snapshot-first, strictly sequenced events with no command gaps or duplicates', async () => {
    const { host } = hostWith(stopCommandReply(entityId));
    const first = collector();
    const unsubscribe = host.subscribe(first.listener);
    await host.start(spec());
    await host.waitForMatch();
    await host.settled();

    const events = first.events;
    expect(events[0]?.type).toBe('snapshot');
    const ended = events.filter(event => event.type === 'match-ended');
    expect(ended).toHaveLength(1);
    expect(ended[0].status).toBe('finished');
    // Commands arrive in record order, each exactly once.
    const streamed = events.flatMap(event => event.type === 'command' ? [event.command] : []);
    const record = (ended[0] as { record: { commands: { command: unknown }[] } }).record;
    expect(streamed).toEqual(record.commands.map(entry => entry.command));
    // Ticks strictly increase, and commands never reference future ticks.
    let lastTick = 0;
    for (const event of events) {
      if (event.type === 'tick') {
        expect(event.tick).toBeGreaterThan(lastTick);
        lastTick = event.tick;
      }
      if (event.type === 'command') expect(event.tick).toBeLessThanOrEqual(lastTick + 1);
    }
    expect(lastTick).toBeGreaterThan(0);
    // No event leaks observation or transport internals.
    for (const event of events) {
      const serialized = JSON.stringify(event);
      expect(serialized).not.toContain('authorization');
      expect(serialized).not.toContain('Bearer');
      expect(serialized).not.toContain('observation');
    }
    unsubscribe();
    await host.settled();
    expect(events.at(-1)).toMatchObject({ type: 'subscription-ended', reason: 'unsubscribed' });
  });

  it('hands a late joiner a consistent snapshot and continues without duplicates', async () => {
    const { host } = hostWith(stopCommandReply(entityId));
    const early = collector();
    host.subscribe(early.listener);
    const late = collector();
    let joined = false;
    const unsubscribeEarly = host.subscribe(event => {
      if (joined || event.type !== 'tick' || event.tick < 30) return;
      joined = true;
      host.subscribe(late.listener);
    });
    await host.start(spec());
    await host.waitForMatch();
    await host.settled();

    expect(joined).toBe(true);
    expect(late.events[0]?.type).toBe('snapshot');
    const lateSnapshot = late.events[0] as Extract<AgentMatchEvent, { type: 'snapshot' }>;
    expect(lateSnapshot.snapshot.start.seed).toBe(seed);
    expect(lateSnapshot.snapshot.commands.length).toBeGreaterThan(0);
    // Every command the late joiner has seen (snapshot prefix + later events)
    // is exactly the final record, with no duplicates.
    const record = host.snapshot()!.record!;
    const lateCommands = [
      ...lateSnapshot.snapshot.commands,
      ...late.events.flatMap(event => event.type === 'command' ? [{ tick: event.tick, command: event.command }] : []),
    ];
    expect(lateCommands).toEqual(record.commands);
    expect(new Set(lateCommands.map(command => JSON.stringify(command))).size).toBe(lateCommands.length);
    // The early subscriber saw the same full record.
    const earlyCommands = early.events.flatMap(event => event.type === 'command' ? [event.command] : []);
    expect(earlyCommands).toEqual(record.commands.map(entry => entry.command));
    // Rebuild a live viewer through the JSON wire, including commands at the
    // snapshot's current tick, then consume only subsequent deltas.
    const start = lateSnapshot.snapshot.start;
    const viewer = createGame(start.seed, undefined, start.civilizations, start.map, start.mode, start.populationLimit, start.wonderVictory);
    expect(checksumState(viewer)).toBe(start.initialChecksum);
    const advance = (tick: number) => { while (viewer.tick < tick) stepGame(viewer); };
    for (const entry of lateSnapshot.snapshot.commands) { advance(entry.tick); applyCommand(viewer, entry.command); }
    advance(lateSnapshot.snapshot.tick);
    for (const event of late.events.slice(1)) {
      if (event.type === 'command') { expect(viewer.tick).toBe(event.tick); applyCommand(viewer, event.command); }
      if (event.type === 'tick') advance(event.tick);
    }
    const expected = createReplayGame(record);
    for (const entry of record.commands) {
      while (expected.tick < entry.tick) stepGame(expected);
      applyCommand(expected, entry.command);
    }
    while (expected.tick < host.snapshot()!.tick) stepGame(expected);
    expect(checksumState(viewer)).toBe(checksumState(expected));
    unsubscribeEarly();
  });

  it('rejects invalid specs, unknown models and concurrent starts before any request', async () => {
    const { host, transport } = hostWith(() => textWire('unused'));
    await expect(host.start(spec({ timeoutMs: 0 }))).rejects.toMatchObject({ code: 'invalid-spec' });
    await expect(host.start(spec({ maxRequests: -3 }))).rejects.toMatchObject({ code: 'invalid-spec' });
    await expect(host.start(spec({ seed: Number.NaN }))).rejects.toMatchObject({ code: 'invalid-spec' });
    await expect(host.start(spec({ models: { 1: { id: '', providerID: 'provider-a' }, 2: { id: 'model-b', providerID: 'provider-b' } } })))
      .rejects.toMatchObject({ code: 'invalid-spec' });
    await expect(host.start(spec({ models: { 1: { id: 'missing', providerID: 'provider-a' }, 2: { id: 'model-b', providerID: 'provider-b' } } })))
      .rejects.toBeInstanceOf(OpenCodeError);
    expect(transport.calls).toHaveLength(0);

    const slow = hostWith(call => hangingUntilAbort(call.signal));
    const first = await slow.host.start({ ...spec(), maxTimeSeconds: 600 });
    await expect(slow.host.start(spec())).rejects.toBeInstanceOf(AgentHostError);
    await expect(slow.host.start(spec())).rejects.toMatchObject({ code: 'match-running' });
    expect(first).toBe('match-1');
    await slow.host.stop();
  });

  it('surfaces an explicit unavailable state from service discovery', async () => {
    const host = new AgentMatchHost({
      client: () => { throw new OpenCodeError('unavailable', 'no healthy registered OpenCode service found'); },
    });
    await expect(host.listModels()).rejects.toMatchObject({ code: 'unavailable' });
    await expect(host.start(spec())).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('fails the match with a sanitized typed failure on auth, malformed or capped model replies', async () => {
    const cases: { generate: (call: RecordedCall) => unknown; code: string }[] = [
      { generate: () => { throw declaredError('UnauthorizedError', 'bad credentials'); }, code: 'unauthorized' },
      { generate: () => textWire('nonsense'), code: 'malformed-reply' },
      { generate: call => textWire(JSON.stringify({ type: 'commands', time: call.time, commands: [{ kind: 'stop', player: 2, entityIds: [1] }] })), code: 'wrong-player' },
    ];
    for (const testCase of cases) {
      const { host } = hostWith(testCase.generate);
      const events = collector();
      host.subscribe(events.listener);
      await host.start({ ...spec(), maxRequests: testCase.code === 'request-cap' ? 1 : undefined });
      await host.waitForMatch();
      await host.settled();
      const ended = events.events.find(event => event.type === 'match-ended');
      expect(ended).toMatchObject({ status: 'failed', failure: { code: testCase.code } });
      expect(host.status()).toBe('failed');
    }

    const capped = hostWith(stopCommandReply(entityId));
    const events = collector();
    capped.host.subscribe(events.listener);
    await capped.host.start({ ...spec(), maxTimeSeconds: 600, maxRequests: 1 });
    await capped.host.waitForMatch();
    await capped.host.settled();
    expect(events.events.find(event => event.type === 'match-ended')).toMatchObject({
      status: 'failed',
      failure: { code: 'request-cap' },
    });
    expect(capped.transport.calls).toHaveLength(2); // one request per player
  });

  it('stop() aborts blocked model calls, settles the match and keeps a partial record', async () => {
    const { host, transport } = hostWith(call => hangingUntilAbort(call.signal));
    const events = collector();
    host.subscribe(events.listener);
    await host.start({ ...spec(), maxTimeSeconds: 600 });
    expect(host.status()).toBe('running');
    await host.stop();
    await host.settled();

    expect(host.status()).toBe('aborted');
    const ended = events.events.find(event => event.type === 'match-ended');
    expect(ended).toMatchObject({ status: 'aborted' });
    const record = (ended as { record?: object }).record;
    expect(record).toBeTruthy(); // partial but replayable
    // Every in-flight model call was really aborted.
    expect(transport.calls.length).toBeGreaterThan(0);
    expect(transport.calls.every(call => call.signal.aborted)).toBe(true);
    // The grant is ended: no further model request would be authorized.
    expect(transport.calls.filter(call => !call.signal.aborted)).toEqual([]);
  });

  it('stop() does not hang on a spectator that never settles', async () => {
    const { host } = hostWith(stopCommandReply(entityId));
    const neverSettles = () => new Promise<void>(() => {});
    const unsubscribe = host.subscribe(() => neverSettles());
    await host.start({ ...spec(), maxTimeSeconds: 2 });
    // Bounded: only the match itself is awaited, never subscriber promises.
    await host.stop();
    expect(host.status()).toBe('aborted');
    unsubscribe();
  });

  it('ends an overflowing subscription explicitly instead of dropping events silently', async () => {
    const tight = new AgentMatchHost({
      client: () => new OpenCodeClient(fakeOpenCodeTransport({ generate: stopCommandReply(entityId) })),
      bufferLimit: 4,
    });
    const tightEvents: AgentMatchEvent[] = [];
    let release: (() => void) | undefined;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const unsubscribe = tight.subscribe(async event => {
      tightEvents.push(event);
      if (event.type !== 'subscription-ended') await gate; // spectator stops consuming
    });
    await tight.start(spec());
    // stop() must not wait on the blocked spectator; the match settles anyway.
    await tight.waitForMatch();
    expect(tight.status()).toBe('finished');
    release!();
    await tight.settled();
    unsubscribe();
    await tight.settled();

    const ended = tightEvents.filter(event => event.type === 'subscription-ended');
    expect(ended).toEqual([{ type: 'subscription-ended', reason: 'overflow' }]);
    // It saw the start of the stream, nothing silently trimmed, then the end.
    expect(tightEvents[0]?.type).toBe('snapshot');
    expect(tightEvents.at(-1)).toEqual({ type: 'subscription-ended', reason: 'overflow' });
    expect(tightEvents.filter(event => event.type === 'tick')).toEqual([]);
  });

  it('ends a throwing subscription without affecting other spectators', async () => {
    const { host } = hostWith(stopCommandReply(entityId));
    const healthy = collector();
    host.subscribe(healthy.listener);
    let throws = 0;
    const unsubscribeBad = host.subscribe(() => {
      throws++;
      throw new Error('buggy spectator');
    });
    await host.start({ ...spec(), maxTimeSeconds: 2 });
    await host.waitForMatch();
    await host.settled();
    unsubscribeBad();
    expect(throws).toBe(1);
    // The healthy subscriber still received the complete stream.
    expect(healthy.events[0]?.type).toBe('snapshot');
    expect(healthy.events.some(event => event.type === 'match-ended')).toBe(true);
  });

  it('lists a sanitized catalogue for the model selectors', async () => {
    const transport = fakeOpenCodeTransport({
      catalogue: catalogueWire([{
        id: 'model-a', providerID: 'provider-a', name: 'Model A', enabled: true,
        headers: { authorization: 'Bearer secret' },
      }]),
      generate: () => textWire('unused'),
    });
    const host = new AgentMatchHost({ client: () => new OpenCodeClient(transport) });
    const models = await host.listModels();
    expect(models).toEqual([{ id: 'model-a', providerID: 'provider-a', name: 'Model A', enabled: true }]);
    expect(JSON.stringify(models)).not.toContain('secret');
  });
});
