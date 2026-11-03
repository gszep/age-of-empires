import { describe, expect, it } from 'vitest';
import { createGame, stepGame } from '../sim/game';
import { describeObservation, observe } from '../sim/observe';
import { MatchGrant } from '../agents/protocol';
import { MAX_OPENCODE_PROMPT_BYTES, opencodeStrategy } from './opencode-strategy';
import { OpenCodeClient, OpenCodeError } from './opencode-client';
import { fakeOpenCodeTransport, hangingUntilAbort, promptObservation, stopCommandReply, textWire } from './opencode-fake';
import { decodeObservedTerrain } from '../protocol/terrain';
import type { StrategyInputMessage } from '../protocol/types';

const state = createGame(73);
const observation = observe(state, 1);
const input: StrategyInputMessage = {
  type: 'observation',
  observation,
  text: describeObservation(observation),
  rejected: [],
};
const villagerId = observation.entities.find(e => e.owner === 1 && e.kind === 'villager')!.id;
const model = { id: 'model-a', providerID: 'provider-a' };

function armedGrant() {
  const controller = new AbortController();
  const grant = new MatchGrant('match-test', controller.signal);
  grant.arm();
  return { grant, controller };
}

describe('OpenCode strategy', () => {
  it('rejects an oversized complete observation before generation instead of truncating it', async () => {
    const transport = fakeOpenCodeTransport({ generate: ({ prompt }) => {
      const seen = promptObservation(prompt);
      return textWire(JSON.stringify({ type: 'commands', time: seen.time, commands: [] }));
    } });
    const { grant } = armedGrant();
    const strategy = opencodeStrategy({ player: 1, match: grant, model, client: new OpenCodeClient(transport), maxRequests: 1 });
    const large = { ...input, observation: { ...observation, explored: ['0'.repeat(MAX_OPENCODE_PROMPT_BYTES)] } };
    await expect(strategy.decide(large)).rejects.toMatchObject({ code: 'invalid-request', message: expect.stringContaining('refusing to truncate') });
    expect(transport.calls).toHaveLength(0);
    // Rejected local input did not consume the model-request budget.
    await expect(strategy.decide(input)).resolves.toEqual([]);
    expect(promptObservation(transport.calls[0].prompt)).toEqual(JSON.parse(JSON.stringify(observation)));
    grant.end();
  });

  it('sends canonical observation JSON with visible facts but not hidden enemy state', async () => {
    const game = createGame(11);
    const ownTc = game.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
    const visibleEnemy = game.entities.find(e => e.owner === 2 && e.kind === 'villager')!;
    const hiddenEnemy = game.entities.find(e => e.owner === 2 && e.kind === 'town-center')!;
    const visibleResource = game.entities.find(e => e.kind === 'resource')!;
    expect(visibleResource).toBeDefined();
    visibleResource.position = { x: ownTc.position.x + 3, y: ownTc.position.y + 2 };
    visibleEnemy.position = { x: ownTc.position.x + 3, y: ownTc.position.y };
    visibleEnemy.order = { kind: 'move', target: { x: 0, y: 0 } };
    visibleEnemy.carrying = { kind: 'gold', amount: 7 };
    game.players[2].gold = 987654321;
    stepGame(game);
    const own = observe(game, 1);
    expect(own.entities.some(e => e.id === visibleEnemy.id)).toBe(true);
    expect(own.entities.some(e => e.id === hiddenEnemy.id)).toBe(false);
    const hiddenResource = game.entities.find(e => e.kind === 'resource'
      && !own.entities.some(seen => seen.id === e.id) && !own.memory.some(seen => seen.id === e.id));
    expect(hiddenResource).toBeDefined();
    const transport = fakeOpenCodeTransport({ generate: ({ prompt }) => {
      const seen = promptObservation(prompt);
      return textWire(JSON.stringify({ type: 'commands', time: seen.time, commands: [] }));
    } });
    const { grant } = armedGrant();
    const strategy = opencodeStrategy({ player: 1, match: grant, model, client: new OpenCodeClient(transport) });
    await expect(strategy.decide({ type: 'observation', observation: own, text: describeObservation(own), rejected: [] })).resolves.toEqual([]);
    expect(transport.calls).toHaveLength(1);
    const prompt = transport.calls[0].prompt;
    const seen = promptObservation(prompt);
    // Exact JSON equality also covers public scores, memory and announcements:
    // do not mistakenly remove all information about the opposing player.
    expect(seen).toEqual(JSON.parse(JSON.stringify(own)));
    expect(seen.entities.find(e => e.id === visibleEnemy.id)).toMatchObject({ owner: 2, x: expect.any(Number), y: expect.any(Number), hp: expect.any(Number) });
    for (const field of ['order', 'activity', 'training', 'carrying']) {
      expect(seen.entities.find(e => e.id === visibleEnemy.id)).not.toHaveProperty(field);
    }
    expect(seen.entities.some(e => e.id === hiddenEnemy.id || e.id === hiddenResource!.id)).toBe(false);
    expect(prompt).not.toContain('987654321');
    expect(seen).not.toHaveProperty('players');
    expect(seen).not.toHaveProperty('rules');
    expect(seen.entities.find(e => e.id === visibleResource.id)).toMatchObject({
      resource: visibleResource.resourceKind, x: visibleResource.position.x, y: visibleResource.position.y,
    });
    const terrain = decodeObservedTerrain(seen)!;
    expect(terrain).toBeDefined();
    expect(terrain.tiles.some(tile => tile >= 0)).toBe(true);
    let hiddenTiles = 0;
    seen.explored.forEach((row, y) => [...row].forEach((known, x) => {
      if (known !== '0') return;
      hiddenTiles++;
      expect(terrain.tiles[y * seen.mapWidth + x]).toBe(-1);
      expect(terrain.elevation[y * seen.mapWidth + x]).toBe(-1);
    }));
    expect(hiddenTiles).toBeGreaterThan(0);
    grant.end();
  });

  it('sends only the own-player observation and returns its validated commands', async () => {
    const transport = fakeOpenCodeTransport({ generate: stopCommandReply({ 1: villagerId, 2: 1 }) });
    const { grant } = armedGrant();
    const strategy = opencodeStrategy({ player: 1, match: grant, model, client: new OpenCodeClient(transport) });
    const commands = await strategy.decide(input);
    expect(commands).toEqual([{ kind: 'stop', player: 1, entityIds: [villagerId] }]);
    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0].model).toEqual(model);
    expect(transport.calls[0].player).toBe(1);
    expect(transport.calls[0].time).toBe(input.observation.time);
    // The prompt carries this player's own observation only.
    expect(transport.calls[0].prompt).toContain(describeObservation(observation));
    expect(transport.calls[0].prompt).toContain(`Decision time: ${input.observation.time}`);
    expect(transport.calls[0].prompt).toContain('player 1 strategy');
    expect(transport.calls[0].prompt).toContain('command.schema.json');
    // Hidden enemy entities are absent from the canonical observation sent.
    const enemy = state.entities.find(e => e.owner === 2)!;
    expect(observation.entities.some(e => e.id === enemy.id)).toBe(false);
    grant.end();
  });

  it('rejects a reply commanding the other player', async () => {
    const transport = fakeOpenCodeTransport({
      generate: call => textWire(JSON.stringify({
        type: 'commands', time: call.time,
        commands: [{ kind: 'stop', player: 2, entityIds: [villagerId] }],
      })),
    });
    const { grant } = armedGrant();
    const strategy = opencodeStrategy({ player: 1, match: grant, model, client: new OpenCodeClient(transport) });
    await expect(strategy.decide(input)).rejects.toMatchObject({ code: 'wrong-player' });
    grant.end();
  });

  it('rejects stale, malformed and invalid replies without substituting a builtin', async () => {
    const stale = fakeOpenCodeTransport({
      generate: call => textWire(JSON.stringify({ type: 'commands', time: call.time + 1, commands: [] })),
    });
    const malformed = fakeOpenCodeTransport({ generate: () => textWire('not json at all') });
    const invalid = fakeOpenCodeTransport({
      generate: call => textWire(JSON.stringify({ type: 'commands', time: call.time, commands: [{ kind: 'warp', player: 1 }] })),
    });
    for (const transport of [stale, malformed, invalid]) {
      const { grant } = armedGrant();
      const strategy = opencodeStrategy({ player: 1, match: grant, model, client: new OpenCodeClient(transport) });
      const code = transport === stale ? 'stale-reply' : 'malformed-reply';
      await expect(strategy.decide(input)).rejects.toMatchObject({ code });
      grant.end();
    }
  });

  it('refuses to call the model without an explicitly live match', async () => {
    const transport = fakeOpenCodeTransport({ generate: stopCommandReply({ 1: villagerId, 2: 1 }) });
    const controller = new AbortController();
    const grant = new MatchGrant('match-test', controller.signal); // never armed
    const strategy = opencodeStrategy({ player: 1, match: grant, model, client: new OpenCodeClient(transport) });
    await expect(strategy.decide(input)).rejects.toMatchObject({ code: 'no-live-match' });
    expect(transport.calls).toHaveLength(0);
  });

  it('enforces the per-player request cap after the configured count', async () => {
    const transport = fakeOpenCodeTransport({ generate: stopCommandReply({ 1: villagerId, 2: 1 }) });
    const { grant } = armedGrant();
    const strategy = opencodeStrategy({
      player: 1, match: grant, model, client: new OpenCodeClient(transport), maxRequests: 1,
    });
    await expect(strategy.decide(input)).resolves.toBeTruthy();
    await expect(strategy.decide(input)).rejects.toMatchObject({ code: 'request-cap' });
    expect(transport.calls).toHaveLength(1);
    grant.end();
  });

  it('validates direct strategy request bounds before any model call', () => {
    const { grant } = armedGrant();
    const transport = fakeOpenCodeTransport({ generate: () => textWire('unused') });
    for (const limits of [{ maxRequests: NaN }, { maxRequests: 0 }, { timeoutMs: Infinity }]) {
      expect(() => opencodeStrategy({ player: 1, match: grant, model, client: new OpenCodeClient(transport), ...limits })).toThrow(OpenCodeError);
    }
    expect(transport.calls).toHaveLength(0);
  });

  it('settles a blocked call as aborted when the match signal aborts', async () => {
    const transport = fakeOpenCodeTransport({ generate: call => hangingUntilAbort(call.signal) });
    const { grant, controller } = armedGrant();
    const strategy = opencodeStrategy({ player: 1, match: grant, model, client: new OpenCodeClient(transport) });
    const pending = strategy.decide(input);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'aborted' });
    expect(transport.calls[0].signal.aborted).toBe(true);
  });

  it('stop() aborts an in-flight call and refuses further decisions', async () => {
    const transport = fakeOpenCodeTransport({ generate: call => hangingUntilAbort(call.signal) });
    const { grant } = armedGrant();
    const strategy = opencodeStrategy({ player: 1, match: grant, model, client: new OpenCodeClient(transport) });
    const pending = strategy.decide(input);
    strategy.stop?.();
    await expect(pending).rejects.toMatchObject({ code: 'aborted' });
    expect(transport.calls[0].signal.aborted).toBe(true);
    await expect(strategy.decide(input)).rejects.toBeInstanceOf(OpenCodeError);
    grant.end();
  });
});
