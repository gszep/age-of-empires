import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FALLBACK_RULES, rulesFromManifest, type ContentManifest, type GameRules, type VillagerGatherTask } from './data';
import { addNode, applyCommand, createGame, stepGame } from './game';
import { checksumState } from './checksum';
import { observe } from './observe';
import { validateObservation } from '../protocol/validate';
import type { Entity, GameState } from './types';

const manifestPath = 'public/imported/aoe2/manifest.json';
const imported = existsSync(manifestPath) ? rulesFromManifest(JSON.parse(readFileSync(manifestPath, 'utf8'))) : undefined;
const modes: [string, GameRules][] = [['fallback', FALLBACK_RULES], ...(imported ? [['imported', imported] as [string, GameRules]] : [])];
// Owned DAT work_rate/resource_capacity, not expectations read from the rules
// under test: units 120, 259, 122, 592, 56, 123, 579 and 124 respectively.
const tasks: [VillagerGatherTask, number, number][] = [
  ['forager', 0.31, 10], ['farmer', 0.53, 10], ['hunter', 0.41, 35], ['shepherd', 0.33, 10],
  ['fisher', 0.43, 10], ['lumberjack', 0.39, 10], ['goldminer', 0.38, 10], ['stonemason', 0.36, 10],
];

function fixture(rules: GameRules, task: VillagerGatherTask) {
  const state = createGame(132, rules);
  state.entities = state.entities.filter(e => e.owner !== 0);
  state.terrain = state.terrain.map(() => 0);
  const worker = state.entities.find(e => e.kind === 'villager' && e.owner === 1)!;
  const home = state.entities.find(e => e.kind === 'town-center' && e.owner === 1)!;
  const position = { x: home.position.x + 7, y: home.position.y };
  let node: Entity;
  if (task === 'farmer' || task === 'hunter' || task === 'shepherd') {
    const kind = task === 'farmer' ? 'farm' : task === 'hunter' ? 'deer' : 'sheep';
    const base = kind === 'farm' ? rules.buildings.farm : rules.units[kind];
    node = { id: state.nextId++, kind, owner: kind === 'deer' ? 0 : 1, position,
      hp: base.hp, maxHp: base.hp, radius: base.radius, amount: 200, resourceKind: 'food',
      activity: 'idle', order: { kind: 'idle' }, dead: kind === 'deer', decayTicks: 60 };
    state.entities.push(node);
  } else {
    node = addNode(state, ({ forager: 'berries', fisher: 'shore-fish', lumberjack: 'tree', goldminer: 'gold', stonemason: 'stone' } as const)[task], position);
  }
  // At work immediately, so the rate measurement contains no travel time.
  worker.position = { x: position.x - node.radius - worker.radius, y: position.y };
  stepGame(state);
  expect(applyCommand(state, { kind: 'order', player: 1, entityIds: [worker.id], target: node.position, targetId: node.id }).ok).toBe(true);
  return { state, worker, node, home };
}

function until(state: GameState, condition: () => boolean, ticks = 6000) {
  for (let i = 0; i < ticks && !condition(); i++) stepGame(state);
  expect(condition(), `condition within ${ticks} ticks`).toBe(true);
}

describe.each(modes)('%s villager tasks (#132)', (_mode, rules) => {
  it.each(tasks)('%s gathers at %s/s and banks loads of %s', (task, rate, capacity) => {
    const { state, worker, node } = fixture(rules, task);
    const resource = node.resourceKind!;
    const amount = node.amount!;
    const before = state.players[1][resource];
    // Just past the fifth resource, still below every task's capacity.
    const ticks = Math.ceil(5.1 / rate / 0.05);
    for (let i = 0; i < ticks; i++) stepGame(state);
    expect(amount - node.amount!).toBe(5);
    expect(worker.carrying?.amount).toBe(5);
    expect(validateObservation(observe(state, 1))).toBe(true);
    until(state, () => state.players[1][resource] > before);
    expect(state.players[1][resource] - before).toBe(capacity);
    expect(amount - node.amount!).toBe(capacity);
  });

  it('banks a full hunter load even after the carcass is removed, across JSON reload', () => {
    const { state, worker, node } = fixture(rules, 'hunter');
    node.amount = 35;
    const before = state.players[1].food;
    until(state, () => !state.entities.some(e => e.id === node.id));
    expect(worker.carrying?.amount).toBe(35);
    const replay = JSON.parse(JSON.stringify(state)) as GameState;
    for (let i = 0; i < 400; i++) { stepGame(state); stepGame(replay); }
    expect(state.players[1].food - before).toBe(35);
    expect(checksumState(replay)).toBe(checksumState(state));
  });

  it.each(['order', 'depletion'] as const)('switches from a hunt to berries after %s without retaining the hunter capacity', change => {
    const { state, worker, node } = fixture(rules, 'hunter');
    if (change === 'depletion') node.amount = 20;
    const berries = addNode(state, 'berries', { x: node.position.x, y: node.position.y + 3 });
    until(state, () => worker.carrying?.amount === 20);
    const before = state.players[1].food;
    if (change === 'order') {
      applyCommand(state, { kind: 'order', player: 1, entityIds: [worker.id], target: berries.position, targetId: berries.id });
    }
    until(state, () => state.players[1].food > before);
    expect(state.players[1].food - before).toBe(20);
    until(state, () => state.players[1].food > before + 20);
    expect(state.players[1].food - before).toBe(30);
  });
});

describe.skipIf(!imported)('imported task-specific technology effects', () => {
  it('consumes the manifest task values rather than accidentally agreeing with fallback', () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as ContentManifest;
    manifest.entities['villager-hunter'].gather!.ratePerSecond = 0.6;
    manifest.entities['villager-hunter'].gather!.capacity = 17;
    const { state, worker, node } = fixture(rulesFromManifest(manifest), 'hunter');
    const before = state.players[1].food;
    const amount = node.amount!;
    for (let i = 0; i < 210; i++) stepGame(state);
    expect(worker.carrying?.amount).toBe(6);
    until(state, () => state.players[1].food > before);
    expect(state.players[1].food - before).toBe(17);
    expect(amount - node.amount!).toBe(17);
  });

  it('applies lumberjack work-rate research while leaving farmers at their own rate', () => {
    for (const task of ['lumberjack', 'farmer'] as const) {
      const { state, node } = fixture(imported!, task);
      expect(state.rules.technologies['double-bit-axe']).toBeDefined();
      state.players[1].researched = ['double-bit-axe'];
      const amount = node.amount!;
      for (let i = 0; i < 220; i++) stepGame(state);
      expect(amount - node.amount!).toBe(5); // floor(11×0.39×1.2), floor(11×0.53)
    }
  });

  it.each([
    ['farmer', ['heavy-plow'], 11],
    ['forager', ['heavy-plow'], 10],
    // This patch's Wheel Barrow effect 213 multiplies by 1.2695, not 1.25.
    ['hunter', ['wheelbarrow'], 45],
    ['farmer', ['wheelbarrow'], 13],
    ['hunter', ['wheelbarrow', 'hand-cart'], 67],
  ] as [VillagerGatherTask, string[], number][])('%s with %s banks %s', (task, techs, expected) => {
    const { state, node } = fixture(imported!, task);
    for (const tech of techs) expect(state.rules.technologies[tech], tech).toBeDefined();
    state.players[1].researched = techs;
    const before = state.players[1].food;
    const amount = node.amount!;
    until(state, () => state.players[1].food > before);
    expect(state.players[1].food - before).toBe(expected);
    expect(amount - node.amount!).toBe(expected);
  });
});
