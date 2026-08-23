import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FALLBACK_RULES, rulesFromManifest, type ContentManifest, type GameRules } from './data';
import { applyCommand, createGame, placementLegal, stepGame } from './game';
import type { Entity, GameState, ResourceKind } from './types';

const MANIFEST_PATH = 'public/imported/aoe2/manifest.json';
const importedRules: GameRules | undefined = existsSync(MANIFEST_PATH)
  ? rulesFromManifest(JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as ContentManifest)
  : undefined;

const run = (state: GameState, ticks: number) => {
  for (let i = 0; i < ticks; i++) stepGame(state);
};

const villagerOf = (state: GameState) =>
  state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;

const nodeOf = (state: GameState, resource: ResourceKind) =>
  state.entities
    .filter(e => e.kind === 'resource' && e.resourceKind === resource)
    .sort((a, b) => a.position.x - b.position.x)[0];

function totalOf(state: GameState, resource: ResourceKind): number {
  const banked = state.players[1][resource] + state.players[2][resource];
  const inNodes = state.entities
    .filter(e => e.kind === 'resource' && e.resourceKind === resource)
    .reduce((sum, e) => sum + (e.amount ?? 0), 0);
  const carried = state.entities
    .filter(e => e.carrying?.kind === resource)
    .reduce((sum, e) => sum + e.carrying!.amount, 0);
  return banked + inNodes + carried;
}

describe('gathering', () => {
  it('walks, gathers to capacity, returns to the town center, and deposits integers', () => {
    const state = createGame(9);
    const villager = villagerOf(state);
    const node = nodeOf(state, 'wood')!;
    applyCommand(state, { kind: 'order', player: 1, entityIds: [villager.id], target: node.position, targetId: node.id });

    const rate = state.rules.gatherRatePerSecond.wood;
    const capacity = state.rules.carryCapacity;
    const initialWood = state.players[1].wood;
    const initialAmount = node.amount!;

    // Enough time for one full trip: walk + gather + return.
    run(state, Math.round((60 + capacity / rate) * 20));
    expect(state.players[1].wood).toBeGreaterThanOrEqual(initialWood + capacity);
    expect(Number.isInteger(state.players[1].wood)).toBe(true);
    expect(node.amount).toBeLessThan(initialAmount);
    expect(Number.isInteger(node.amount)).toBe(true);
  });

  it('matches the imported gather rate within one tick of tolerance', () => {
    const state = createGame(9, importedRules ?? FALLBACK_RULES);
    const villager = villagerOf(state);
    const node = nodeOf(state, 'food')!;
    // Teleport next to the node so timing measures gathering only.
    villager.position = { x: node.position.x + node.radius + villager.radius, y: node.position.y };
    applyCommand(state, { kind: 'order', player: 1, entityIds: [villager.id], target: node.position, targetId: node.id });

    const rate = state.rules.gatherRatePerSecond.food; // 0.31/s from the DAT
    const before = node.amount!;
    const ticksForFive = Math.ceil(5 / rate / 0.05);
    run(state, ticksForFive + 1);
    expect(before - node.amount!).toBe(5);
  });

  it('retargets a same-type node when the first depletes and conserves resources', () => {
    const state = createGame(13);
    const villager = villagerOf(state);
    const node = nodeOf(state, 'food')!;
    node.amount = 3;
    villager.position = { x: node.position.x + 1, y: node.position.y };
    applyCommand(state, { kind: 'order', player: 1, entityIds: [villager.id], target: node.position, targetId: node.id });

    const total = totalOf(state, 'food');
    run(state, 20 * 120);
    expect(totalOf(state, 'food')).toBe(total);
    expect(state.entities.includes(node)).toBe(false); // depleted node removed
    expect(villager.order.kind).toBe('gather'); // continued on another berry bush
  });

  it('conserves every resource across a long AI-driven period', () => {
    const state = createGame(31);
    const totals = {
      food: totalOf(state, 'food'),
      wood: totalOf(state, 'wood'),
      gold: totalOf(state, 'gold'),
    };
    const villagers = state.entities.filter(e => e.kind === 'villager');
    for (const [i, villager] of villagers.entries()) {
      const node = nodeOf(state, (['food', 'wood', 'gold'] as const)[i % 3])!;
      applyCommand(state, { kind: 'order', player: villager.owner as 1 | 2, entityIds: [villager.id], target: node.position, targetId: node.id });
    }
    run(state, 20 * 300);
    // Spending only moves banked resources out; nothing was spent here.
    expect(totalOf(state, 'food')).toBe(totals.food);
    expect(totalOf(state, 'wood')).toBe(totals.wood);
    expect(totalOf(state, 'gold')).toBe(totals.gold);
  });
});

describe('construction', () => {
  const clearArea = (state: GameState, center: { x: number; y: number }, half: number) => {
    state.entities = state.entities.filter(
      e => e.kind !== 'resource' || Math.abs(e.position.x - center.x) > half + 1 || Math.abs(e.position.y - center.y) > half + 1,
    );
  };

  it('builds a house in the data-backed time with one villager', () => {
    const state = createGame(5);
    clearArea(state, { x: 16, y: 9 }, 2);
    const villager = villagerOf(state);
    villager.position = { x: 15, y: 9 };
    expect(applyCommand(state, { kind: 'build', player: 1, builderIds: [villager.id], building: 'house', target: { x: 16, y: 9 } })).toEqual({ ok: true });
    const site = state.entities.find(e => e.kind === 'house' && e.owner === 1)!;
    const buildTicks = Math.round(state.rules.buildings.house.buildSeconds * 20);

    // Walk in, then build for exactly buildSeconds (one builder). The tick
    // that flipped the activity to 'building' already contributed progress.
    let walkTicks = 0;
    while (villager.activity !== 'building' && walkTicks < 200) { stepGame(state); walkTicks++; }
    run(state, buildTicks - 2);
    expect(site.buildProgress).toBeDefined();
    run(state, 2);
    expect(site.buildProgress).toBeUndefined();
    expect(site.hp).toBe(site.maxHp);
  });

  it('accelerates with more builders following the 3T/(k+2) rule', () => {
    const state = createGame(5);
    clearArea(state, { x: 16, y: 9 }, 2);
    const villagers = state.entities.filter(e => e.owner === 1 && e.kind === 'villager');
    for (const v of villagers) v.position = { x: 15.2, y: 9 };
    applyCommand(state, { kind: 'build', player: 1, builderIds: villagers.map(v => v.id), building: 'house', target: { x: 16, y: 9 } });
    const site = state.entities.find(e => e.kind === 'house' && e.owner === 1)!;
    while (villagers[0].activity !== 'building') stepGame(state);
    // 3 builders: 3T/(3+2) = 15s for a 25s house.
    const expected = Math.round(3 * state.rules.buildings.house.buildSeconds / 5 * 20);
    run(state, expected + 2);
    expect(site.buildProgress).toBeUndefined();
  });

  it('rejects illegal placements with diagnostics', () => {
    const state = createGame(5);
    const villager = villagerOf(state);
    const tc = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
    const onTc = applyCommand(state, { kind: 'build', player: 1, builderIds: [villager.id], building: 'house', target: tc.position });
    expect(onTc.ok).toBe(false);
    if (!onTc.ok) expect(onTc.reason).toContain('overlaps');
    const offMap = placementLegal(state, 'house', { x: 0.2, y: 9 });
    expect(offMap.ok).toBe(false);
    if (!offMap.ok) expect(offMap.reason).toContain('outside');
  });

  it('houses raise the population cap only once complete', () => {
    const state = createGame(5);
    clearArea(state, { x: 16, y: 9 }, 2);
    const villager = villagerOf(state);
    villager.position = { x: 15, y: 9 };
    const capBefore = state.players[1].populationCap;
    applyCommand(state, { kind: 'build', player: 1, builderIds: [villager.id], building: 'house', target: { x: 16, y: 9 } });
    expect(state.players[1].populationCap).toBe(capBefore);
    run(state, 20 * 40);
    expect(state.players[1].populationCap).toBe(capBefore + state.rules.buildings.house.popSupport);
  });
});

describe('production and rally points', () => {
  it('sends trained villagers to a rallied resource through the public interface', () => {
    const state = createGame(5);
    const tc = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
    const node = nodeOf(state, 'food')!;
    expect(applyCommand(state, { kind: 'rally', player: 1, buildingId: tc.id, target: node.position, targetId: node.id })).toEqual({ ok: true });
    applyCommand(state, { kind: 'train', player: 1, buildingId: tc.id, unit: 'villager' });
    run(state, Math.round(state.rules.units.villager.trainSeconds * 20) + 1);
    const trained = state.entities.filter(e => e.owner === 1 && e.kind === 'villager').at(-1)!;
    expect(trained.order).toEqual({ kind: 'gather', targetId: node.id });
  });

  it('holds a finished unit at the population cap instead of losing it', () => {
    const state = createGame(5);
    const tc = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
    applyCommand(state, { kind: 'train', player: 1, buildingId: tc.id, unit: 'villager' });
    state.players[1].populationCap = 3; // fill the cap while training
    run(state, Math.round(state.rules.units.villager.trainSeconds * 20) + 50);
    expect(state.players[1].population).toBe(3);
    expect(tc.training).toBeDefined();
    state.players[1].populationCap = 5;
    run(state, 2);
    expect(state.players[1].population).toBe(4);
  });
});

describe('imported rules', () => {
  it.skipIf(!importedRules)('carry DAT-backed timings and costs', () => {
    expect(importedRules!.origin).toBe('imported');
    expect(importedRules!.units.villager.trainSeconds).toBe(25);
    expect(importedRules!.units.militia.trainSeconds).toBe(21);
    expect(importedRules!.units.militia.cost).toEqual({ food: 50, wood: 0, gold: 20 });
    expect(importedRules!.gatherRatePerSecond).toEqual({ food: 0.31, wood: 0.39, gold: 0.38 });
    expect(importedRules!.buildings.house.buildSeconds).toBe(25);
    expect(importedRules!.buildings['town-center'].hp).toBe(2400);
    expect(importedRules!.nodes.gold.amount).toBe(800);
  });

  it.skipIf(!importedRules)('replays identically under imported rules', () => {
    const a = createGame(77, importedRules);
    const b = createGame(77, importedRules);
    for (let i = 0; i < 400; i++) { stepGame(a); stepGame(b); }
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
