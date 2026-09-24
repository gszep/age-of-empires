import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checksumState } from './checksum';
import { FALLBACK_RULES, rulesFromManifest, type ContentManifest, type GameRules } from './data';
import { addNode, applyCommand, createGame, placementLegal, stepGame } from './game';
import { buildingLimitReached } from './rules';
import type { Command, GameState } from './types';

const path = process.env.TC_CONTENT ?? 'public/imported/aoe2/manifest.json';
const manifest: ContentManifest | undefined = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined;
const imported = manifest && rulesFromManifest(manifest);
const target = { x: 40, y: 40 };
function arena(rules: GameRules) {
  const state = createGame(177, rules);
  state.entities = state.entities.filter(e => e.owner !== 0);
  state.terrain.fill(0); state.elevation.fill(0);
  state.players[1].wood = state.players[1].stone = state.players[1].food = 2000;
  const worker = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
  worker.position = { x: 42.5, y: 40.5 };
  const home = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
  const command: Command = { kind: 'build', player: 1, builderIds: [worker.id], building: 'town-center', target };
  expect(placementLegal(state, 'town-center', target).ok).toBe(true);
  return { state, worker, home, command };
}
function unchangedRejection(state: GameState, command: Command, reason: string) {
  const before = checksumState(state);
  expect(applyCommand(state, command)).toEqual({ ok: false, reason });
  expect(checksumState(state)).toBe(before);
}

for (const [mode, rules] of [['fallback', FALLBACK_RULES], ['owned', imported]] as const) {
  describe.skipIf(!rules)(`${mode} town-center construction`, () => {
    it.each([0, 1])('age %i replaces a lost TC but counts the foundation immediately', age => {
      const { state, home, command } = arena(rules!);
      state.players[1].age = age;
      expect(buildingLimitReached(state, 1, 'town-center')).toBe(true);
      unchangedRejection(state, command, 'town-center limit reached for this age');
      expect(applyCommand(state, { kind: 'delete', player: 1, entityIds: [home.id] }).ok).toBe(true);
      expect(buildingLimitReached(state, 1, 'town-center')).toBe(false);
      expect(applyCommand(state, command).ok).toBe(true);
      const site = state.entities.find(e => e.owner === 1 && e.kind === 'town-center' && !e.dead)!;
      expect(site.buildProgress).toBe(0);
      expect(state.players[1].wood).toBe(1725);
      expect(state.players[1].stone).toBe(1900);
      unchangedRejection(state, { ...command, target: { x: 48, y: 40 } }, 'town-center limit reached for this age');
      // Deleting the unfinished replacement releases the slot, even while
      // both dead TCs remain in the entity list as rubble.
      expect(applyCommand(state, { kind: 'delete', player: 1, entityIds: [site.id] }).ok).toBe(true);
      expect(applyCommand(state, command).ok).toBe(true);
    });

    it.each([2, 3])('age %i permits additional concurrent foundations without another building prerequisite', age => {
      const { state, command } = arena(rules!);
      state.players[1].age = age;
      expect(applyCommand(state, command).ok).toBe(true);
      expect(applyCommand(state, { ...command, target: { x: 48, y: 40 } }).ok).toBe(true);
      expect(state.entities.filter(e => e.owner === 1 && e.kind === 'town-center' && !e.dead)).toHaveLength(3);
    });

    it('rejects sloped ground and insufficient stone without spending or retasking', () => {
      const { state, command } = arena(rules!);
      state.players[1].age = 2;
      state.elevation[39 * state.width + 39] = 1;
      unchangedRejection(state, command, 'placement is on unsuitable elevation');
      state.elevation.fill(0);
      state.players[1].stone = 99;
      unchangedRejection(state, command, 'not enough stone');
    });

    it('completes in the construction-head time, adds population, trains and banks all four resources', () => {
      const { state, home, worker, command } = arena(rules!);
      state.players[1].age = 2;
      expect(applyCommand(state, command).ok).toBe(true);
      const site = state.entities.find(e => e.kind === 'town-center' && e.owner === 1 && e.id !== home.id)!;
      const cap = state.players[1].populationCap;
      for (let i = 0; i < 2000; i++) stepGame(state);
      expect(site.buildProgress).toBeDefined(); // finished-unit 100 s is wrong
      expect(state.players[1].populationCap).toBe(cap);
      for (let i = 0; i < 1200 && site.buildProgress !== undefined; i++) stepGame(state);
      expect(site.buildProgress).toBeUndefined();
      expect(site.hp).toBe(site.maxHp);
      expect(state.players[1].populationCap).toBe(cap + 5);
      expect(applyCommand(state, { kind: 'train', player: 1, buildingId: site.id, unit: 'villager' }).ok).toBe(true);
      const villagers = state.entities.filter(e => e.owner === 1 && e.kind === 'villager').length;
      for (let i = 0; i < 550; i++) stepGame(state);
      expect(state.entities.filter(e => e.owner === 1 && e.kind === 'villager')).toHaveLength(villagers + 1);
      for (const [kind, task, node] of [
        ['food', 'forager', 'berries'], ['wood', 'lumberjack', 'tree'],
        ['gold', 'goldminer', 'gold'], ['stone', 'stonemason', 'stone'],
      ] as const) {
        worker.position = { x: 42, y: 40 };
        worker.carrying = { kind, amount: 10, task, node };
        const source = addNode(state, node, { x: 46.5, y: 40.5 });
        expect(applyCommand(state, { kind: 'order', player: 1, entityIds: [worker.id], target: source.position, targetId: source.id }).ok).toBe(true);
        state.entities = state.entities.filter(e => e.id !== source.id);
        const before = state.players[1][kind];
        for (let i = 0; i < 20 && worker.carrying; i++) stepGame(state);
        expect(state.players[1][kind]).toBe(before + 10);
        expect(worker.carrying).toBeUndefined();
      }
    });
  });
}

it.skipIf(!manifest)('preserves construction metadata through rulesFromManifest', () => {
  const tc = imported!.buildings['town-center'];
  expect(tc.cost).toEqual({ food: 0, wood: 275, gold: 0, stone: 100 });
  expect(tc.buildSeconds).toBe(150);
  expect(tc.buildButton).toBe(11);
  expect(tc.additionalAge).toBe(2);
});
