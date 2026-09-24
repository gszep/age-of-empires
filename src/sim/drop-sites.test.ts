import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FALLBACK_RULES, rulesFromManifest, type ContentManifest, type GameRules, type VillagerGatherTask } from './data';
import { addNode, applyCommand, carryCapacityFor, createGame, stepGame } from './game';
import { checksumState } from './checksum';
import type { BuildingKind, Entity, GameState, ResourceKind } from './types';

const manifest: ContentManifest | undefined = existsSync('public/imported/aoe2/manifest.json')
  ? JSON.parse(readFileSync('public/imported/aoe2/manifest.json', 'utf8')) : undefined;
const imported = manifest && rulesFromManifest(manifest);
function arena(rules: GameRules): GameState {
  const state = createGame(52, rules);
  state.entities = state.entities.filter(e => e.owner !== 0);
  state.terrain.fill(0); state.elevation.fill(0);
  return state;
}
function building(state: GameState, kind: BuildingKind, x: number, owner: 1 | 2 = 1): Entity {
  const rules = state.rules.buildings[kind];
  const e: Entity = { id: state.nextId++, kind, owner, position: { x, y: 60 }, hp: rules.hp, maxHp: rules.hp,
    radius: rules.radius, activity: 'idle', order: { kind: 'idle' } };
  state.entities.push(e); return e;
}
function loaded(state: GameState, task: VillagerGatherTask, resource: ResourceKind): Entity {
  const worker = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
  worker.position = { x: 42, y: 60 };
  worker.carrying = { kind: resource, amount: carryCapacityFor(state, 1, task), task,
    node: task === 'fisher' ? 'shore-fish' : resource === 'food' ? 'berries' : resource === 'wood' ? 'tree' : resource };
  const source = addNode(state, worker.carrying.node!, { x: 50.5, y: 60.5 });
  expect(applyCommand(state, { kind: 'order', player: 1, entityIds: [worker.id], target: source.position, targetId: source.id }).ok).toBe(true);
  // Returning after the source disappeared must use the load's remembered task.
  state.entities = state.entities.filter(e => e.id !== source.id);
  return worker;
}
function bank(state: GameState, worker: Entity, resource: ResourceKind): number {
  const before = state.players[1][resource];
  for (let tick = 0; tick < 600 && state.players[1][resource] === before; tick++) stepGame(state);
  expect(worker.carrying).toBeUndefined();
  return state.players[1][resource] - before;
}

for (const [mode, rules] of [['fallback', FALLBACK_RULES], ['owned', imported]] as const) {
  describe.skipIf(!rules)(`${mode} drop-site routing`, () => {
    it.each([
      ['forager', 'food', 'mill'], ['farmer', 'food', 'mill'], ['hunter', 'food', 'mill'], ['shepherd', 'food', 'mill'],
      ['lumberjack', 'wood', 'lumber-camp'], ['goldminer', 'gold', 'mining-camp'], ['stonemason', 'stone', 'mining-camp'],
    ] as const)('banks %s loads at %s-compatible sites rather than the nearer dock', (task, resource, kind) => {
      const state = arena(rules!);
      building(state, 'dock', 40);
      const site = building(state, kind, 46);
      const worker = loaded(state, task, resource);
      const amount = worker.carrying!.amount, before = state.players[1][resource];
      stepGame(state);
      expect(state.players[1][resource]).toBe(before);
      expect(bank(state, worker, resource)).toBe(amount);
      expect(Math.hypot(worker.position.x - site.position.x, worker.position.y - site.position.y))
        .toBeLessThanOrEqual(worker.radius + site.radius + 0.3);
    });

    it('lets the fisherman bank fish at the dock and replays the deposit across JSON', () => {
      const state = arena(rules!);
      building(state, 'dock', 40);
      const worker = loaded(state, 'fisher', 'food');
      const amount = worker.carrying!.amount, before = state.players[1].food;
      const resumed = JSON.parse(JSON.stringify(state)) as GameState;
      stepGame(state); stepGame(resumed);
      expect(state.players[1].food - before).toBe(amount);
      expect(worker.carrying).toBeUndefined();
      expect(checksumState(resumed)).toBe(checksumState(state));
    });

    it('does not deposit at an enemy site or an unfinished one', () => {
      const state = arena(rules!);
      building(state, 'mill', 40, 2);
      building(state, 'mill', 44).buildProgress = 0.5;
      const worker = loaded(state, 'forager', 'food');
      const amount = worker.carrying!.amount;
      expect(bank(state, worker, 'food')).toBe(amount);
      const tc = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
      expect(Math.hypot(worker.position.x - tc.position.x, worker.position.y - tc.position.y))
        .toBeLessThanOrEqual(worker.radius + tc.radius + 0.3);
    });
  });
}

it.skipIf(!manifest)('honours imported empty acceptance and empty worker sites instead of open defaults', () => {
  const data = structuredClone(manifest!);
  data.entities.mill.accepts = [];
  const state = arena(rulesFromManifest(data));
  building(state, 'mill', 40);
  const worker = loaded(state, 'forager', 'food');
  const before = state.players[1].food;
  stepGame(state);
  expect(state.players[1].food).toBe(before);
  expect(bank(state, worker, 'food')).toBe(10);
  data.entities['villager-forager'].gather!.dropSites = [];
  const blocked = arena(rulesFromManifest(data));
  building(blocked, 'mill', 40);
  const waiting = loaded(blocked, 'forager', 'food');
  const initial = blocked.players[1].food;
  for (let tick = 0; tick < 10; tick++) stepGame(blocked);
  expect(blocked.players[1].food).toBe(initial);
  expect(waiting.carrying?.amount).toBe(10);
  expect(waiting.order.kind).toBe('idle');
});

it.skipIf(!imported)('matches the open acceptance sets for shared buildings and gathering tasks', () => {
  for (const [kind, rule] of Object.entries(FALLBACK_RULES.buildings)) {
    expect([...imported!.buildings[kind as BuildingKind].accepts].sort(), kind).toEqual([...rule.accepts].sort());
  }
  for (const [task, rule] of Object.entries(FALLBACK_RULES.villagerGather)) {
    expect([...(imported!.villagerGather[task as VillagerGatherTask].dropSites ?? [])].sort(), task)
      .toEqual([...(rule.dropSites ?? [])].sort());
  }
});
