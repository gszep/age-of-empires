import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { exampleAiCommands } from './ai';
import { fishingWater, fishingDockSite, fishingOrders, FISHING_LIMIT } from './ai-fishing';
import { FALLBACK_RULES, isFishKind, rulesFromManifest } from './data';
import { applyCommand, createGame, placementLegal, stepGame } from './game';
import { isOpenWater } from './mapgen';
import { observe } from './observe';
import type { Entity, GameState, Point } from './types';

function fishingFixture(rules = FALLBACK_RULES, seed = 2): { state: GameState; worker: Entity } {
  const state = createGame(seed, rules, undefined, 'islands');
  const home = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
  const worker = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
  const fish = state.entities.filter(e => isFishKind(e.node));
  const sites: Point[] = [];
  for (let y = 2; y < state.height - 2; y++) for (let x = 2; x < state.width - 2; x++) {
    const at = { x: x + 0.5, y: y + 0.5 };
    if (Math.hypot(at.x - home.position.x, at.y - home.position.y) > 35) continue;
    if (placementLegal(state, 'dock', at, 'x', 1).ok && fish.some(f => Math.hypot(f.position.x - at.x, f.position.y - at.y) < 6)) sites.push(at);
  }
  expect(sites.length).toBeGreaterThan(0);
  const site = sites.sort((a, b) => Math.hypot(a.x - home.position.x, a.y - home.position.y) - Math.hypot(b.x - home.position.x, b.y - home.position.y))[0];
  const shores: Point[] = [];
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const at = { x: site.x + dx, y: site.y + dy };
    const terrain = state.terrain[Math.floor(at.y) * state.width + Math.floor(at.x)];
    if (!isOpenWater(terrain) && (Math.abs(dx) === 2 || Math.abs(dy) === 2)) shores.push(at);
  }
  const shore = shores.sort((a, b) => Math.min(...fish.map(f => Math.hypot(a.x - f.position.x, a.y - f.position.y)))
    - Math.min(...fish.map(f => Math.hypot(b.x - f.position.x, b.y - f.position.y))))[0];
  expect(shore).toBeDefined(); worker.position = shore!;
  const scout = state.entities.find(e => e.owner === 1 && e.kind === 'scout-cavalry')!;
  scout.position = { ...shore! };
  const camp = rules.buildings['lumber-camp'];
  state.entities.push({ id: state.nextId++, kind: 'lumber-camp', owner: 1,
    position: { x: home.position.x + 5, y: home.position.y + 5 },
    hp: camp.hp, maxHp: camp.hp, radius: camp.radius, activity: 'idle', order: { kind: 'idle' } });
  state.players[1].wood = 700; state.players[1].food = 0; state.players[1].populationCap = 30;
  // A surveyed-map fixture must retain the static resources that survey saw;
  // explored terrain with no corresponding memories invents hidden blockers.
  state.visibility[1].explored.fill(1);
  for (const node of state.entities.filter(e => e.kind === 'resource')) {
    state.visibility[1].memory[node.id] = { id: node.id, kind: node.kind, owner: node.owner,
      x: node.position.x, y: node.position.y, hp: node.hp, maxHp: node.maxHp,
      node: node.node, resource: node.resourceKind, amount: node.amount, lastSeenAt: state.tick };
  }
  stepGame(state);
  return { state, worker };
}

describe('example AI fishing', () => {
  it.each([2, 3, 7])('proposes a legal coast on the worker island using only the observation, seed %i', seed => {
    const { state, worker } = fishingFixture(FALLBACK_RULES, seed);
    const observation = JSON.parse(JSON.stringify(observe(state, 1)));
    const before = JSON.stringify(observation);
    const water = fishingWater(observation)!;
    expect(water).toBeDefined();
    const site = fishingDockSite(water, worker.position, state.entities.find(e => e.kind === 'town-center' && e.owner === 1)!.position);
    expect(site).toBeDefined();
    expect(placementLegal(state, 'dock', site!, 'x', 1)).toEqual({ ok: true });
    expect(JSON.stringify(observation)).toBe(before);
  });

  it.for(['fallback', 'imported'] as const)('builds, completes, trains and actually banks fish food (%s)', (mode, context) => {
    if (mode === 'imported' && !existsSync('public/imported/aoe2/manifest.json')) context.skip();
    const rules = mode === 'fallback' ? FALLBACK_RULES : rulesFromManifest(JSON.parse(readFileSync('public/imported/aoe2/manifest.json', 'utf8')));
    const { state } = fishingFixture(rules);
    let gathered = false, banked = false;
    const refused: string[] = [];
    for (let tick = 0; tick < 6000 && !banked; tick++) {
      const observation = state.tick % 10 === 0 ? JSON.parse(JSON.stringify(observe(state, 1))) : undefined;
      if (observation) for (const command of exampleAiCommands(observation)) {
        const result = applyCommand(state, command);
        if (!result.ok && ((command.kind === 'build' && command.building === 'dock')
          || (command.kind === 'train' && command.unit === 'fishing-ship'))) {
          const id = Number(result.reason.split(' ').at(-1));
          const blocked = state.entities.find(e => e.id === id);
          refused.push(JSON.stringify({ reason: result.reason, command,
            blocker: blocked && { id, node: blocked.node, position: blocked.position, radius: blocked.radius, footprint: blocked.footprint },
            known: [...observation.entities, ...observation.memory].find((e: { id: number }) => e.id === id) }));
        }
      }
      const cargo = state.entities.filter(e => e.owner === 1 && e.kind === 'fishing-ship' && e.carrying?.amount)
        .map(e => ({ id: e.id, amount: e.carrying!.amount }));
      gathered ||= cargo.length > 0;
      const food = state.players[1].food;
      stepGame(state);
      banked ||= cargo.some(load => state.entities.some(e => e.id === load.id && !e.dead && !e.carrying)
        && state.players[1].food >= food + load.amount);
    }
    expect(refused).toEqual([]);
    expect(state.entities.some(e => e.kind === 'dock' && e.owner === 1 && e.buildProgress === undefined)).toBe(true);
    expect(gathered).toBe(true); expect(banked).toBe(true);
    expect(state.entities.filter(e => e.owner === 1 && e.kind === 'fishing-ship').length).toBeLessThanOrEqual(FISHING_LIMIT);
  });

  it('does not send a ship into a disconnected known pond', () => {
    const state = createGame(1);
    state.terrain.fill(0); state.visibility[1].explored.fill(1); state.visibility[1].visible.fill(1);
    for (const x of [10, 11, 20, 21]) for (const y of [10, 11]) state.terrain[y * state.width + x] = 1;
    const observation = observe(state, 1);
    observation.entities.push({ id: 9001, kind: 'fishing-ship', owner: 1, x: 10.5, y: 10.5, hp: 60, maxHp: 60, order: 'idle' },
      { id: 9002, kind: 'resource', owner: 0, x: 20.5, y: 10.5, hp: 1, maxHp: 1, resource: 'food', node: 'fish', amount: 1000 });
    const water = fishingWater(observation)!;
    expect(fishingOrders(water)).toEqual([]);
  });

  it('stops buying boats at the fleet cap even with abundant wood and an idle dock', () => {
    const { state } = fishingFixture(); state.players[1].wood = 10000;
    let cappedAt: number | undefined;
    let extraTrains = 0;
    for (let i = 0; i < 10000 && (cappedAt === undefined || state.tick - cappedAt < 1000); i++) {
      if (state.tick % 10 === 0) for (const command of exampleAiCommands(observe(state, 1))) {
        if (cappedAt !== undefined && command.kind === 'train' && command.unit === 'fishing-ship') extraTrains++;
        applyCommand(state, command);
      }
      stepGame(state);
      if (state.entities.filter(e => e.owner === 1 && e.kind === 'fishing-ship').length === FISHING_LIMIT) cappedAt ??= state.tick;
    }
    expect(cappedAt).toBeDefined(); expect(extraTrains).toBe(0);
    expect(state.entities.filter(e => e.owner === 1 && e.kind === 'fishing-ship')).toHaveLength(FISHING_LIMIT);
  });

  it.each([1, 2, 3])('keeps land opening commands unchanged when no fish are known, seed %i', seed => {
    const state = createGame(seed);
    for (let i = 0; i < 300; i++) {
      if (state.tick % 10 === 0) {
        const observation = observe(state, 1);
        const commands = exampleAiCommands(observation);
        expect(commands).toEqual(exampleAiCommands(observation, { fishing: false }));
        for (const command of commands) applyCommand(state, command);
      }
      stepGame(state);
    }
  });
});
