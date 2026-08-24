import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FALLBACK_RULES, rulesFromManifest, type ContentManifest, type GameRules } from './data';
import { applyCommand, createGame, placementLegal, stepGame } from './game';
import type { BuildingKind, Entity, GameState, ResourceKind } from './types';

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

/** Nearest legal spot to `near`, so tests do not hardcode map coordinates. */
function freeSpot(state: GameState, kind: BuildingKind, near: { x: number; y: number }) {
  for (let radius = 1; radius <= 12; radius += 0.5) {
    for (let step = 0; step < 16; step++) {
      const angle = step * Math.PI / 8;
      const spot = { x: near.x + Math.cos(angle) * radius, y: near.y + Math.sin(angle) * radius };
      if (placementLegal(state, kind, spot).ok) return spot;
    }
  }
  throw new Error(`no legal ${kind} placement near ${near.x},${near.y}`);
}

describe('drop sites', () => {
  const buildFor = (state: GameState, kind: 'mill' | 'lumber-camp' | 'mining-camp', near: { x: number; y: number }) => {
    const villager = villagerOf(state);
    const at = freeSpot(state, kind, near);
    expect(applyCommand(state, { kind: 'build', player: 1, builderIds: [villager.id], building: kind, target: at }))
      .toEqual({ ok: true });
    const site = state.entities.find(e => e.kind === kind)!;
    site.buildProgress = undefined; // finish instantly; construction timing is covered elsewhere
    return site;
  };

  it('banks wood at a lumber camp instead of walking back to the town center', () => {
    const state = createGame();
    const tree = nodeOf(state, 'wood');
    const camp = buildFor(state, 'lumber-camp', tree.position);
    const villager = villagerOf(state);
    applyCommand(state, {
      kind: 'order', player: 1, entityIds: [villager.id],
      target: tree.position, targetId: tree.id,
    });
    const before = state.players[1].wood;
    // Long enough to fill a load and deliver it.
    run(state, 3000);
    expect(state.players[1].wood).toBeGreaterThan(before);
    // The camp is nearer than the town center, so the villager stayed by the trees.
    const tc = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
    expect(Math.hypot(villager.position.x - camp.position.x, villager.position.y - camp.position.y))
      .toBeLessThan(Math.hypot(villager.position.x - tc.position.x, villager.position.y - tc.position.y));
  });

  it('refuses a resource the building does not accept', () => {
    const state = createGame();
    const gold = nodeOf(state, 'gold');
    buildFor(state, 'mill', gold.position);
    const villager = villagerOf(state);
    applyCommand(state, {
      kind: 'order', player: 1, entityIds: [villager.id], target: gold.position, targetId: gold.id,
    });
    run(state, 4000);
    // A mill takes only food, so the gold went to the town center and still banked.
    expect(state.players[1].gold).toBeGreaterThan(FALLBACK_RULES.startingResources.gold);
  });
});

describe('stone', () => {
  it('is gathered, banked, and spent on a tower', () => {
    const state = createGame();
    const stone = nodeOf(state, 'stone');
    expect(stone).toBeDefined();
    expect(stone.resourceKind).toBe('stone');
    const villager = villagerOf(state);
    applyCommand(state, {
      kind: 'order', player: 1, entityIds: [villager.id], target: stone.position, targetId: stone.id,
    });
    run(state, 6000);
    expect(state.players[1].stone).toBeGreaterThan(0);

    state.players[1].stone = 500;
    state.players[1].wood = 500;
    const before = state.players[1].stone;
    expect(applyCommand(state, {
      kind: 'build', player: 1, builderIds: [villager.id], building: 'watch-tower',
      target: freeSpot(state, 'watch-tower', villager.position),
    })).toEqual({ ok: true });
    expect(state.players[1].stone).toBe(before - FALLBACK_RULES.buildings['watch-tower'].cost.stone);
  });
});

describe('farms', () => {
  it('become a food source when finished and vanish once worked out', () => {
    const state = createGame();
    const villager = villagerOf(state);
    state.players[1].wood = 500;
    expect(applyCommand(state, {
      kind: 'build', player: 1, builderIds: [villager.id], building: 'farm', target: freeSpot(state, 'farm', villager.position),
    })).toEqual({ ok: true });
    const farm = state.entities.find(e => e.kind === 'farm')!;
    expect(farm.buildProgress).toBeDefined();
    // Stop the moment it completes: the builder switches straight to farming
    // it, so waiting longer would already have eaten into the store.
    for (let i = 0; i < 4000 && farm.buildProgress !== undefined; i++) stepGame(state);
    expect(farm.buildProgress).toBeUndefined();
    expect(farm.resourceKind).toBe('food');
    expect(farm.amount).toBe(FALLBACK_RULES.buildings.farm.farmAmount);

    // Drain it: the farm is consumed rather than lingering at zero.
    farm.amount = 2;
    applyCommand(state, {
      kind: 'order', player: 1, entityIds: [villager.id], target: farm.position, targetId: farm.id,
    });
    run(state, 2000);
    expect(farm.dead).toBe(true);
  });
});

describe('towers', () => {
  it('shoot an enemy in range without being ordered', () => {
    const state = createGame();
    state.players[1].stone = 500;
    state.players[1].wood = 500;
    const builder = villagerOf(state);
    applyCommand(state, {
      kind: 'build', player: 1, builderIds: [builder.id], building: 'watch-tower',
      target: freeSpot(state, 'watch-tower', builder.position),
    });
    const tower = state.entities.find(e => e.kind === 'watch-tower')!;
    tower.buildProgress = undefined;
    const victim = state.entities.find(e => e.owner === 2 && e.kind === 'villager')!;
    victim.position = { x: tower.position.x + 1, y: tower.position.y };
    const before = victim.hp;
    run(state, 60);
    expect(victim.hp).toBeLessThan(before);
  });
});

describe('imported rules', () => {
  it.skipIf(!importedRules)('carry DAT-backed timings and costs', () => {
    expect(importedRules!.origin).toBe('imported');
    expect(importedRules!.units.villager.trainSeconds).toBe(25);
    expect(importedRules!.units.militia.trainSeconds).toBe(21);
    expect(importedRules!.units.militia.cost).toEqual({ food: 50, wood: 0, gold: 20, stone: 0 });
    expect(importedRules!.gatherRatePerSecond).toEqual({ food: 0.31, wood: 0.39, gold: 0.38, stone: 0.36 });
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
