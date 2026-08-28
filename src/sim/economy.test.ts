import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  FALLBACK_RULES, TICKS_PER_SECOND, TICK_SECONDS, isAnimal, rulesFromManifest,
  type ContentManifest, type GameRules,
} from './data';
import { checksumState } from './checksum';
import {
  TRAINING_QUEUE_LIMIT, applyCommand, buildingFootprint, carryCapacityFor, computeDamage, createGame,
  farmFoodAmountFor, isCarcass, placementLegal, notYetUpgradedInto, queuedCount, stepGame, unitRulesFor,
} from './game';
import type { BuildingKind, Entity, GameState, ResourceKind } from './types';
import { isTileVisible } from './visibility';

const MANIFEST_PATH = 'public/imported/aoe2/manifest.json';
const importedRules: GameRules | undefined = existsSync(MANIFEST_PATH)
  ? rulesFromManifest(JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as ContentManifest)
  : undefined;
const AUDIO_PATH = 'public/imported/aoe2/audio/manifest.json';
const importedAudio: { audio: Record<string, unknown> } | undefined = existsSync(AUDIO_PATH)
  ? JSON.parse(readFileSync(AUDIO_PATH, 'utf8')) as { audio: Record<string, unknown> }
  : undefined;

const run = (state: GameState, ticks: number) => {
  for (let i = 0; i < ticks; i++) stepGame(state);
};

/**
 * Skip the age-up. Markets, towers, stables and ranges are Feudal in the DAT,
 * so tests about what they do rather than about when they unlock start there;
 * `feudal age > gates` covers the gate itself.
 */
const inFeudal = (state: GameState) => {
  state.players[1].age = 1;
  state.players[2].age = 1;
};

const villagerOf = (state: GameState) =>
  state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;

/**
 * The node a player would actually work: the nearest one to whoever is asking,
 * or to their town center. Picking the leftmost on the map used to mean the
 * same thing; on a full-size board it means the other player's, fifty tiles
 * away and guarded.
 */
const nodeOf = (state: GameState, resource: ResourceKind, from?: Entity) => {
  const origin = from ?? state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
  return state.entities
    .filter(e => e.kind === 'resource' && e.resourceKind === resource)
    .sort((a, b) => distanceBetween(origin, a) - distanceBetween(origin, b) || a.id - b.id)[0];
};

/** Clear an order the way the public `stop` command does. */
const becomeIdleFor = (state: GameState, units: Entity[]) => {
  applyCommand(state, { kind: 'stop', player: 1, entityIds: units.map(u => u.id) });
};

const distanceBetween = (a: Entity, b: Entity) =>
  Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y);

/**
 * Send both players' scouts to opposite corners. The opening hands each player
 * one, and a scout fights on its own initiative — a test about what a tower
 * chooses to shoot needs the tower to be the only thing shooting.
 */
const parkScouts = (state: GameState) => {
  for (const scout of state.entities.filter(e => e.kind === 'scout-cavalry')) {
    scout.position = scout.owner === 1
      ? { x: 1, y: state.height - 1 }
      : { x: state.width - 1, y: 1 };
  }
};

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
    // Each villager works what is near it. Sending them all to one player's
    // half sends the other player's across the map into an enemy scout, and a
    // villager killed carrying four food takes the four with it — which is
    // AoE2's rule, and not what this test is measuring.
    parkScouts(state);
    const villagers = state.entities.filter(e => e.kind === 'villager');
    for (const [i, villager] of villagers.entries()) {
      const node = nodeOf(state, (['food', 'wood', 'gold'] as const)[i % 3], villager)!;
      applyCommand(state, { kind: 'order', player: villager.owner as 1 | 2, entityIds: [villager.id], target: node.position, targetId: node.id });
    }
    run(state, 20 * 300);
    // Spending only moves banked resources out; nothing was spent here.
    expect(totalOf(state, 'food')).toBe(totals.food);
    expect(totalOf(state, 'wood')).toBe(totals.wood);
    expect(totalOf(state, 'gold')).toBe(totals.gold);
  });
});

describe('carrying on after the work runs out', () => {
  const villagerNear = (state: GameState, at: { x: number; y: number }) => {
    const villager = villagerOf(state);
    villager.position = { ...at };
    return villager;
  };

  it('turns to the next sheep rather than to a bush across the field', () => {
    const state = createGame(81);
    parkScouts(state);
    const tc = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
    // Two claimed sheep side by side, and the nearest bush further off.
    const sheep = state.entities.filter(e => e.kind === 'sheep').slice(0, 2);
    for (const [index, animal] of sheep.entries()) {
      animal.owner = 1;
      animal.position = { x: tc.position.x + 3 + index, y: tc.position.y + 3 };
    }
    const villager = villagerNear(state, { x: tc.position.x + 3, y: tc.position.y + 2.5 });
    applyCommand(state, {
      kind: 'order', player: 1, entityIds: [villager.id],
      target: sheep[0].position, targetId: sheep[0].id,
    });
    sheep[0].amount = 8; // nearly eaten

    for (let i = 0; i < 4000; i++) {
      stepGame(state);
      if (villager.order.kind !== 'gather') break;
      if (villager.order.targetId !== sheep[0].id) break;
    }
    expect(sheep[0].amount).toBe(0);
    expect(villager.order).toEqual({ kind: 'gather', targetId: sheep[1].id });
  });

  it('stops rather than walking to food nobody can see', () => {
    const state = createGame(82);
    parkScouts(state);
    const tc = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
    const villager = villagerNear(state, { x: tc.position.x + 3, y: tc.position.y + 3 });
    // One bush beside the villager and one on the far side of the map, and
    // nothing else edible anywhere.
    for (const food of state.entities.filter(e => e.resourceKind === 'food' && e.id !== tc.id)) {
      food.amount = 0;
    }
    const near = state.entities.find(e => e.kind === 'resource' && e.resourceKind === 'food')!;
    near.position = { x: villager.position.x + 1, y: villager.position.y };
    near.amount = 8;
    const far = state.entities.filter(e => e.kind === 'resource' && e.resourceKind === 'food')[1]!;
    far.position = { x: state.width - 5, y: state.height - 5 };
    far.amount = 100;

    applyCommand(state, {
      kind: 'order', player: 1, entityIds: [villager.id], target: near.position, targetId: near.id,
    });
    for (let i = 0; i < 4000 && (near.amount ?? 0) > 0; i++) stepGame(state);
    expect(near.amount).toBe(0);
    // It banks what it has and stops, rather than setting off across the map.
    for (let i = 0; i < 2000 && villager.order.kind !== 'idle'; i++) stepGame(state);
    expect(villager.order.kind).toBe('idle');
    expect(villager.position.x).toBeLessThan(state.width / 2);
  });

  it('takes the next pile after banking a load, not only while carrying one', () => {
    // Issue #19. What to look for next was read from what the villager
    // happened to be carrying, and a villager that has just emptied its hands
    // at the mill is carrying nothing -- so if its bush ran out while it was
    // away, it had nothing to ask for and went idle with the rest of the
    // cluster a tile in front of it.
    const state = createGame(86);
    parkScouts(state);
    const tc = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
    for (const food of state.entities.filter(e => e.kind === 'resource' && e.resourceKind === 'food')) {
      food.amount = 0;
    }
    const bushes = state.entities.filter(e => e.kind === 'resource' && e.resourceKind === 'food');
    const [near, beside] = bushes;
    near.position = { x: tc.position.x + 4, y: tc.position.y };
    beside.position = { x: tc.position.x + 5, y: tc.position.y };
    near.amount = 200;
    beside.amount = 200;
    const villager = villagerNear(state, { x: tc.position.x + 3.5, y: tc.position.y });
    applyCommand(state, {
      kind: 'order', player: 1, entityIds: [villager.id], target: near.position, targetId: near.id,
    });

    // Work until it has banked a load, so its hands are empty.
    const banked = state.players[1].food;
    for (let i = 0; i < 4000 && state.players[1].food === banked; i++) stepGame(state);
    expect(villager.carrying).toBeUndefined();

    // Somebody else finishes the bush while this one is at the town center.
    near.amount = 0;
    for (let i = 0; i < 600; i++) {
      stepGame(state);
      if (villager.order.kind !== 'gather') break;
      if (villager.order.targetId !== near.id) break;
    }
    expect(villager.order).toEqual({ kind: 'gather', targetId: beside.id });
  });

  it('does not spend the herd when the bushes run out', () => {
    // Issue #21. A claimed sheep is an asset the player walked home, not a
    // pile anybody may wander onto. Continuing from a bush onto the flock
    // eats it without being asked; idle is the honest answer, and sheep to
    // sheep (above) is a continuation of the same job and stays.
    const state = createGame(87);
    parkScouts(state);
    const tc = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
    for (const food of state.entities.filter(e => e.kind === 'resource' && e.resourceKind === 'food')) {
      food.amount = 0;
    }
    const bush = state.entities.find(e => e.kind === 'resource' && e.resourceKind === 'food')!;
    const villager = villagerNear(state, { x: tc.position.x + 3, y: tc.position.y });
    bush.position = { x: villager.position.x + 1, y: villager.position.y };
    bush.amount = 8;
    // A claimed sheep right beside the bush -- well inside the range the
    // continuation searches.
    const sheep = state.entities.find(e => e.kind === 'sheep')!;
    sheep.owner = 1;
    sheep.position = { x: villager.position.x + 2, y: villager.position.y };
    const flock = sheep.amount;

    applyCommand(state, {
      kind: 'order', player: 1, entityIds: [villager.id], target: bush.position, targetId: bush.id,
    });
    for (let i = 0; i < 4000 && (bush.amount ?? 0) > 0; i++) stepGame(state);
    expect(bush.amount).toBe(0);
    for (let i = 0; i < 2000 && villager.order.kind !== 'idle'; i++) stepGame(state);
    expect(villager.order.kind).toBe('idle');
    expect(sheep.amount).toBe(flock);
    expect(sheep.dead).toBeFalsy();
  });

  it('builds on down a dragged line but not to a foundation out of sight', () => {
    const state = createGame(83);
    parkScouts(state);
    state.players[1].wood = 500;
    const builders = state.entities.filter(e => e.owner === 1 && e.kind === 'villager').map(e => e.id);

    // A run of wall, and one more segment joined to its far end — far enough
    // from where the builders start that they should never set off for it.
    let row: number | undefined;
    let startX: number | undefined;
    for (let y = 4.5; y < state.height - 4 && row === undefined; y++) {
      for (let x = 4.5; x < state.width - 40; x++) {
        const tiles = [...Array(4).keys()].map(i => x + i);
        if (!tiles.every(at => placementLegal(state, 'palisade-wall', { x: at, y }).ok)) continue;
        row = y; startX = x; break;
      }
    }
    expect(row, 'a clear row to wall').toBeDefined();

    for (const at of [startX!, startX! + 1, startX! + 2, startX! + 3]) {
      expect(applyCommand(state, {
        kind: 'build', player: 1, builderIds: builders, building: 'palisade-wall', target: { x: at, y: row! },
      }).ok, `${at}`).toBe(true);
    }
    const line = () => state.entities.filter(e => !e.dead && e.kind === 'palisade-wall');
    for (let i = 0; i < 8000 && line().some(e => e.buildProgress !== undefined); i++) stepGame(state);
    // The whole drag goes up: each next piece is a tile from the last.
    expect(line().filter(e => e.buildProgress === undefined)).toHaveLength(4);

    // Now a segment joined to nothing the builders can see. Reachable through
    // the wall they just built, but a long walk they were never asked for.
    const strays = state.entities.filter(e => e.owner === 1 && e.kind === 'villager');
    for (const [index, villager] of strays.entries()) {
      villager.position = { x: startX! + index * 0.4, y: row! + 2 };
    }
    const remote = { x: startX! + 30, y: row! };
    expect(placementLegal(state, 'palisade-wall', remote).ok).toBe(true);
    expect(applyCommand(state, {
      kind: 'build', player: 1, builderIds: [strays[0].id], building: 'palisade-wall', target: remote,
    }).ok).toBe(true);
    const remoteSite = state.entities.find(e => e.kind === 'palisade-wall'
      && Math.abs(e.position.x - remote.x) < 0.6 && e.buildProgress !== undefined)!;
    // The one villager asked for it goes; the other two were never tasked and
    // stay where they are.
    becomeIdleFor(state, strays.slice(1));
    run(state, 400);
    for (const villager of strays.slice(1)) {
      expect(distanceBetween(villager, remoteSite)).toBeGreaterThan(20);
    }
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

describe('spawn placement', () => {
  const trainedFrom = (state: GameState, building: Entity, kind: 'villager' | 'archer') => {
    const before = new Set(state.entities.map(e => e.id));
    building.training = { kind, remainingTicks: 1 };
    stepGame(state);
    return state.entities.find(e => !before.has(e.id) && e.kind === kind)!;
  };

  it('leaves by the corner nearest the viewer when no rally point is set', () => {
    const state = createGame();
    const tc = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
    const unit = trainedFrom(state, tc, 'villager');
    // Screen depth grows with x+y, so the default exit is past that corner.
    expect(unit.position.x).toBeGreaterThan(tc.position.x);
    expect(unit.position.y).toBeGreaterThan(tc.position.y);
  });

  it('leaves by the side facing the rally point', () => {
    const state = createGame();
    const tc = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
    // Rally to the far side, opposite the default corner.
    const rally = { x: tc.position.x - 6, y: tc.position.y - 6 };
    expect(applyCommand(state, { kind: 'rally', player: 1, buildingId: tc.id, target: rally }))
      .toEqual({ ok: true });
    const unit = trainedFrom(state, tc, 'villager');
    expect(unit.position.x).toBeLessThan(tc.position.x);
    expect(unit.position.y).toBeLessThan(tc.position.y);
  });

  it('keeps units on the map when the building sits against the edge', () => {
    const state = createGame();
    const tc = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
    // Corner of the map: the old fixed offset put the unit outside it.
    const half = state.rules.buildings['town-center'].radius;
    tc.position = { x: state.width - half, y: state.height - half };
    const unit = trainedFrom(state, tc, 'villager');
    expect(unit.position.x).toBeGreaterThanOrEqual(0);
    expect(unit.position.x).toBeLessThanOrEqual(state.width);
    expect(unit.position.y).toBeGreaterThanOrEqual(0);
    expect(unit.position.y).toBeLessThanOrEqual(state.height);
  });

  it('never spawns a unit inside another building', () => {
    const state = createGame();
    const tc = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
    const villager = villagerOf(state);
    state.players[1].wood = 500;
    // Wall off the default exit corner with a house.
    const spot = freeSpot(state, 'house', { x: tc.position.x + 2.5, y: tc.position.y + 2.5 });
    applyCommand(state, { kind: 'build', player: 1, builderIds: [villager.id], building: 'house', target: spot });
    const house = state.entities.find(e => e.kind === 'house')!;
    house.buildProgress = undefined;

    const unit = trainedFrom(state, tc, 'villager');
    for (const building of state.entities.filter(e => e.kind === 'house' || e.kind === 'town-center')) {
      const overlaps = Math.abs(unit.position.x - building.position.x) < building.radius + unit.radius
        && Math.abs(unit.position.y - building.position.y) < building.radius + unit.radius;
      expect(overlaps, `spawned inside ${building.kind}`).toBe(false);
    }
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
    // Whatever the opening hands out — three villagers and a scout, as the map
    // script says — the cap is filled to exactly that.
    const opening = state.players[1].population;
    applyCommand(state, { kind: 'train', player: 1, buildingId: tc.id, unit: 'villager' });
    state.players[1].populationCap = opening; // fill the cap while training
    run(state, Math.round(state.rules.units.villager.trainSeconds * 20) + 50);
    expect(state.players[1].population).toBe(opening);
    expect(tc.training).toBeDefined();
    state.players[1].populationCap = opening + 2;
    run(state, 2);
    expect(state.players[1].population).toBe(opening + 1);
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

describe('the mill technologies', () => {
  // Issue #23. Horse Collar and Heavy Plow were recorded as reaching nothing,
  // because the importer only read effect commands that change a *unit*
  // attribute. Both are really made of effect command type 1, the resource
  // modifier, which changes a player attribute: how much food a farm is built
  // with. The DAT keeps that as resource 36 and civ 1 starts it at 175 --
  // exactly the number the open fallback had hand-written.
  it.skipIf(!importedRules)('reads the farm\'s food out of the DAT rather than a constant', () => {
    expect(importedRules!.buildings.farm.farmAmount).toBe(175);
  });

  it.skipIf(!importedRules)('is researched at the mill, in the DAT\'s own order', () => {
    const collar = importedRules!.technologies['horse-collar'];
    const plow = importedRules!.technologies['heavy-plow'];
    expect(collar.researchedAt).toBe('mill');
    expect(plow.researchedAt).toBe('mill');
    expect(collar.cost).toMatchObject({ food: 75, wood: 75 });
    expect(plow.cost).toMatchObject({ food: 125, wood: 125 });
    // The DAT's own chain: the plough needs the collar, and the Castle Age.
    expect(plow.requires).toContain('horse-collar');
    expect(collar.requiresAge).toBe(1);
    expect(plow.requiresAge).toBe(2);
    // And each says what it could not deliver rather than looking whole: the
    // +1 carry Heavy Plow gives the farmer villagers (DAT units 214 and 259)
    // has no farmer variant here to land on.
    expect(plow.unmodelled).toContain('attribute 14 on unit 214');
  });

  it.skipIf(!importedRules)('adds the DAT\'s food to every farm sown after it', () => {
    const state = createGame(88, importedRules);
    expect(farmFoodAmountFor(state, 1)).toBe(175);
    state.players[1].researched.push('horse-collar');
    expect(farmFoodAmountFor(state, 1)).toBe(250);
    state.players[1].researched.push('heavy-plow');
    expect(farmFoodAmountFor(state, 1)).toBe(375);
    // The other player has researched nothing and gets nothing.
    expect(farmFoodAmountFor(state, 2)).toBe(175);
  });

  it.skipIf(!importedRules)('sows a richer farm once the mill has paid for it', () => {
    const state = createGame(89, importedRules);
    const villager = villagerOf(state);
    state.players[1].wood = 500;
    state.players[1].researched.push('horse-collar');
    expect(applyCommand(state, {
      kind: 'build', player: 1, builderIds: [villager.id], building: 'farm',
      target: freeSpot(state, 'farm', villager.position),
    })).toEqual({ ok: true });
    const farm = state.entities.find(e => e.kind === 'farm')!;
    for (let i = 0; i < 4000 && farm.buildProgress !== undefined; i++) stepGame(state);
    expect(farm.buildProgress).toBeUndefined();
    expect(farm.amount).toBe(250);
  });

  it.skipIf(!importedRules)('replays identically across the research', () => {
    const play = () => {
      const state = createGame(90, importedRules);
      state.players[1].researched.push('horse-collar');
      for (let i = 0; i < 400; i++) stepGame(state);
      return checksumState(state);
    };
    expect(play()).toBe(play());
  });
});

describe('sowing a fallow farm again', () => {
  // Issue #24. AoE2's own words for a farm are that it "goes fallow and must
  // be rebuilt", and the DAT gives it exactly one build location -- the
  // villager. Re-sowing at the mill is the engine's convenience rather than
  // anything in the data, so it is offered as an option and is off until it is
  // asked for. What it removes is the clicking, not the sixty wood.
  const millFor = (state: GameState): Entity => {
    const villager = villagerOf(state);
    state.players[1].wood = 1000;
    const at = freeSpot(state, 'mill', villager.position);
    expect(applyCommand(state, {
      kind: 'build', player: 1, builderIds: [villager.id], building: 'mill', target: at,
    })).toEqual({ ok: true });
    const mill = state.entities.find(e => e.kind === 'mill')!;
    mill.buildProgress = undefined;
    return mill;
  };

  /** A finished farm with one unit of food left, and its villager on it. */
  const nearlySpentFarm = (state: GameState): { farm: Entity; villager: Entity } => {
    const villager = villagerOf(state);
    state.players[1].wood = 1000;
    expect(applyCommand(state, {
      kind: 'build', player: 1, builderIds: [villager.id], building: 'farm',
      target: freeSpot(state, 'farm', villager.position),
    })).toEqual({ ok: true });
    const farm = state.entities.find(e => e.kind === 'farm')!;
    for (let i = 0; i < 4000 && farm.buildProgress !== undefined; i++) stepGame(state);
    expect(farm.buildProgress).toBeUndefined();
    farm.amount = 1;
    applyCommand(state, {
      kind: 'order', player: 1, entityIds: [villager.id], target: farm.position, targetId: farm.id,
    });
    return { farm, villager };
  };

  it('is off until a mill is asked for it', () => {
    const state = createGame(92);
    const mill = millFor(state);
    expect(state.players[1].autoReseedFarms).toBeFalsy();
    expect(applyCommand(state, { kind: 'reseed', player: 1, buildingId: mill.id, enabled: true }))
      .toEqual({ ok: true });
    expect(state.players[1].autoReseedFarms).toBe(true);
    expect(applyCommand(state, { kind: 'reseed', player: 1, buildingId: mill.id, enabled: false }))
      .toEqual({ ok: true });
    expect(state.players[1].autoReseedFarms).toBe(false);
    // Only at a mill, and only at one of your own.
    const tc = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
    expect(applyCommand(state, { kind: 'reseed', player: 1, buildingId: tc.id, enabled: true }).ok)
      .toBe(false);
    expect(applyCommand(state, { kind: 'reseed', player: 2, buildingId: mill.id, enabled: true }).ok)
      .toBe(false);
  });

  it('leaves a worked-out farm alone while the option is off', () => {
    const state = createGame(93);
    const { farm, villager } = nearlySpentFarm(state);
    const where = { ...farm.position };
    for (let i = 0; i < 600 && !farm.dead; i++) stepGame(state);
    expect(farm.dead).toBe(true);
    run(state, 40);
    const sown = state.entities.find(
      e => e.kind === 'farm' && !e.dead && Math.abs(e.position.x - where.x) < 0.01);
    expect(sown).toBeUndefined();
    expect(villager.order.kind).not.toBe('build');
  });

  it('sows it again where it stood, and pays for it', () => {
    const state = createGame(93);
    const mill = millFor(state);
    applyCommand(state, { kind: 'reseed', player: 1, buildingId: mill.id, enabled: true });
    const { farm, villager } = nearlySpentFarm(state);
    const where = { ...farm.position };
    const wood = state.players[1].wood;
    for (let i = 0; i < 600 && !farm.dead; i++) stepGame(state);
    expect(farm.dead).toBe(true);
    run(state, 5);
    const sown = state.entities.find(
      e => e.kind === 'farm' && !e.dead && Math.abs(e.position.x - where.x) < 0.01);
    expect(sown, 'a new farm where the old one stood').toBeDefined();
    expect(state.players[1].wood).toBe(wood - FALLBACK_RULES.buildings.farm.cost.wood);
    // And the villager who emptied it is the one putting it back.
    expect(villager.order).toEqual({ kind: 'build', targetId: sown!.id });
  });

  it('does not sow one it cannot pay for', () => {
    const state = createGame(93);
    const mill = millFor(state);
    applyCommand(state, { kind: 'reseed', player: 1, buildingId: mill.id, enabled: true });
    const { farm } = nearlySpentFarm(state);
    const where = { ...farm.position };
    state.players[1].wood = FALLBACK_RULES.buildings.farm.cost.wood - 1;
    for (let i = 0; i < 600 && !farm.dead; i++) stepGame(state);
    run(state, 40);
    expect(state.entities.some(
      e => e.kind === 'farm' && !e.dead && Math.abs(e.position.x - where.x) < 0.01)).toBe(false);
    expect(state.players[1].wood).toBe(FALLBACK_RULES.buildings.farm.cost.wood - 1);
  });

  it('replays identically with the option on', () => {
    const play = () => {
      const state = createGame(94);
      const mill = millFor(state);
      applyCommand(state, { kind: 'reseed', player: 1, buildingId: mill.id, enabled: true });
      nearlySpentFarm(state);
      run(state, 800);
      return checksumState(state);
    };
    expect(play()).toBe(play());
  });
});

describe('a building\'s training queue', () => {
  // Issue #7: up to fifteen units may wait at one building, each paid for when
  // it is asked for, as AoE2 does -- and each refundable, which is what makes
  // a queue safe to fill.
  const centre = (state: GameState) =>
    state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;

  /**
   * Room to train into. The houses are what keeps the cap high once the game
   * recomputes it -- which it does whenever a unit spawns or a building
   * finishes, not on a bare tick -- and the direct set covers the queue-time
   * checks that happen before any of that.
   */
  const roomFor = (state: GameState, houses: number) => {
    const rules = state.rules.buildings.house;
    const home = centre(state);
    for (let i = 0; i < houses; i++) {
      state.entities.push({
        id: state.nextId++, kind: 'house', owner: 1,
        position: { x: home.position.x + 6 + i * 2, y: home.position.y + 8 },
        hp: rules.hp, maxHp: rules.hp, radius: rules.radius,
        activity: 'idle', order: { kind: 'idle' },
      });
    }
    stepGame(state);
    state.players[1].populationCap = state.rules.startingPopulationCap + houses * state.rules.buildings.house.popSupport;
  };

  it('takes fifteen and refuses the sixteenth', () => {
    const state = createGame(140);
    const tc = centre(state);
    state.players[1].food = 10_000;
    roomFor(state, 6);
    for (let i = 0; i < TRAINING_QUEUE_LIMIT; i++) {
      expect(applyCommand(state, { kind: 'train', player: 1, buildingId: tc.id, unit: 'villager' }).ok,
        `queueing ${i + 1}`).toBe(true);
    }
    expect(queuedCount(tc)).toBe(TRAINING_QUEUE_LIMIT);
    expect(applyCommand(state, { kind: 'train', player: 1, buildingId: tc.id, unit: 'villager' }))
      .toEqual({ ok: false, reason: 'training queue is full' });
  });

  it('pays as each is asked for, and works through them in order', () => {
    const state = createGame(141);
    const tc = centre(state);
    state.players[1].food = 10_000;
    roomFor(state, 6);
    const cost = FALLBACK_RULES.units.villager.cost.food;
    const before = state.players[1].food;
    for (let i = 0; i < 3; i++) {
      applyCommand(state, { kind: 'train', player: 1, buildingId: tc.id, unit: 'villager' });
    }
    // Three paid for up front, not one.
    expect(state.players[1].food).toBe(before - 3 * cost);
    const opening = state.players[1].population;
    const perUnit = Math.round(FALLBACK_RULES.units.villager.trainSeconds * TICKS_PER_SECOND);
    run(state, perUnit);
    expect(state.players[1].population).toBe(opening + 1);
    expect(queuedCount(tc)).toBe(2);
    run(state, perUnit);
    expect(state.players[1].population).toBe(opening + 2);
    run(state, perUnit);
    expect(state.players[1].population).toBe(opening + 3);
    expect(queuedCount(tc)).toBe(0);
    // And nothing was charged twice.
    expect(state.players[1].food).toBe(before - 3 * cost);
  });

  it('gives the last one back, and then the one on the anvil', () => {
    const state = createGame(142);
    const tc = centre(state);
    state.players[1].food = 10_000;
    roomFor(state, 6);
    const cost = FALLBACK_RULES.units.villager.cost.food;
    const before = state.players[1].food;
    for (let i = 0; i < 3; i++) {
      applyCommand(state, { kind: 'train', player: 1, buildingId: tc.id, unit: 'villager' });
    }
    expect(applyCommand(state, { kind: 'cancel-train', player: 1, buildingId: tc.id }))
      .toEqual({ ok: true });
    expect(queuedCount(tc)).toBe(2);
    expect(state.players[1].food).toBe(before - 2 * cost);
    applyCommand(state, { kind: 'cancel-train', player: 1, buildingId: tc.id });
    applyCommand(state, { kind: 'cancel-train', player: 1, buildingId: tc.id });
    // Everything back, including the one that had started.
    expect(queuedCount(tc)).toBe(0);
    expect(state.players[1].food).toBe(before);
    expect(applyCommand(state, { kind: 'cancel-train', player: 1, buildingId: tc.id }))
      .toEqual({ ok: false, reason: 'nothing is being trained' });
  });

  it('counts what is queued against the population cap', () => {
    // Otherwise fifteen villagers could be ordered into five places.
    const state = createGame(143);
    const tc = centre(state);
    state.players[1].food = 10_000;
    // No houses: the opening cap is all the room there is.
    const room = state.players[1].populationCap - state.players[1].population;
    expect(room).toBeGreaterThan(0);
    for (let i = 0; i < room; i++) {
      expect(applyCommand(state, { kind: 'train', player: 1, buildingId: tc.id, unit: 'villager' }).ok,
        `villager ${i + 1} of ${room}`).toBe(true);
    }
    expect(applyCommand(state, { kind: 'train', player: 1, buildingId: tc.id, unit: 'villager' }))
      .toEqual({ ok: false, reason: 'population cap reached' });
  });

  it('replays identically through a queue', () => {
    const play = () => {
      const state = createGame(144);
      const tc = centre(state);
      state.players[1].food = 10_000;
      state.players[1].populationCap = 200;
      for (let i = 0; i < 4; i++) {
        applyCommand(state, { kind: 'train', player: 1, buildingId: tc.id, unit: 'villager' });
      }
      run(state, 1200);
      return checksumState(state);
    };
    expect(play()).toBe(play());
  });
});

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
    inFeudal(state);
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
    inFeudal(state);
    state.players[1].stone = 500;
    state.players[1].wood = 500;
    const builder = villagerOf(state);
    applyCommand(state, {
      kind: 'build', player: 1, builderIds: [builder.id], building: 'watch-tower',
      target: freeSpot(state, 'watch-tower', builder.position),
    });
    const tower = state.entities.find(e => e.kind === 'watch-tower')!;
    tower.buildProgress = undefined;
    parkScouts(state);
    const victim = state.entities.find(e => e.owner === 2 && e.kind === 'villager')!;
    victim.position = { x: tower.position.x + 1, y: tower.position.y };
    const before = victim.hp;
    run(state, 60);
    expect(victim.hp).toBeLessThan(before);
  });

  it('lands damage when the arrow arrives, not when it is loosed', () => {
    const state = createGame();
    inFeudal(state);
    state.players[1].stone = 500;
    state.players[1].wood = 500;
    const builder = villagerOf(state);
    applyCommand(state, {
      kind: 'build', player: 1, builderIds: [builder.id], building: 'watch-tower',
      target: freeSpot(state, 'watch-tower', builder.position),
    });
    const tower = state.entities.find(e => e.kind === 'watch-tower')!;
    tower.buildProgress = undefined;
    parkScouts(state);
    const victim = state.entities.find(e => e.owner === 2 && e.kind === 'villager')!;
    // Far enough that the arrow needs several ticks to cross.
    const range = FALLBACK_RULES.buildings['watch-tower'].attack!.range;
    victim.position = { x: tower.position.x + range - 0.5, y: tower.position.y };
    const before = victim.hp;

    // Step to the tick the tower looses its first arrow.
    let fired = 0;
    while (fired < 400 && state.projectiles.length === 0) { stepGame(state); fired++; }
    expect(state.projectiles.length).toBe(1);
    expect(victim.hp).toBe(before); // still in flight, nothing landed yet

    const arrow = state.projectiles[0];
    expect(arrow.owner).toBe(1);
    expect(arrow.targetId).toBe(victim.id);
    stepGame(state);
    // It moved toward the target rather than teleporting.
    expect(arrow.position.x).toBeGreaterThan(tower.position.x);
    expect(arrow.position.x).toBeLessThan(victim.position.x);

    while (state.projectiles.length > 0) stepGame(state);
    expect(victim.hp).toBeLessThan(before);
  });

  it('shoots enemy buildings, but takes a unit over a building', () => {
    const state = createGame();
    inFeudal(state);
    state.players[1].stone = 500;
    state.players[1].wood = 500;
    const builder = villagerOf(state);
    applyCommand(state, {
      kind: 'build', player: 1, builderIds: [builder.id], building: 'watch-tower',
      target: freeSpot(state, 'watch-tower', builder.position),
    });
    const tower = state.entities.find(e => e.kind === 'watch-tower')!;
    tower.buildProgress = undefined;
    parkScouts(state);
    // Park an enemy town center in range and keep every enemy unit away.
    const enemyTc = state.entities.find(e => e.owner === 2 && e.kind === 'town-center')!;
    enemyTc.position = { x: tower.position.x + 3, y: tower.position.y };
    for (const unit of state.entities.filter(e => e.owner === 2 && e.kind === 'villager')) {
      unit.position = { x: state.width - 1, y: 1 };
    }
    const beforeBuilding = enemyTc.hp;
    run(state, 200);
    expect(enemyTc.hp).toBeLessThan(beforeBuilding);

    // Now bring a unit into range: it is the live threat and takes priority.
    const victim = state.entities.find(e => e.owner === 2 && e.kind === 'villager')!;
    victim.position = { x: tower.position.x + 2, y: tower.position.y };
    const buildingHp = enemyTc.hp;
    const unitHp = victim.hp;
    run(state, 200);
    expect(victim.hp).toBeLessThan(unitHp);
    expect(enemyTc.hp).toBe(buildingHp);
  });

  it('takes an ordered target over the one it would pick itself', () => {
    const state = createGame();
    inFeudal(state);
    state.players[1].stone = 500;
    state.players[1].wood = 500;
    const builder = villagerOf(state);
    applyCommand(state, {
      kind: 'build', player: 1, builderIds: [builder.id], building: 'watch-tower',
      target: freeSpot(state, 'watch-tower', builder.position),
    });
    const tower = state.entities.find(e => e.kind === 'watch-tower')!;
    tower.buildProgress = undefined;
    parkScouts(state);
    const enemies = state.entities.filter(e => e.owner === 2 && e.kind === 'villager');
    const near = enemies[0];
    const far = enemies[1];
    near.position = { x: tower.position.x + 1, y: tower.position.y };
    far.position = { x: tower.position.x + 4, y: tower.position.y };

    expect(applyCommand(state, {
      kind: 'order', player: 1, entityIds: [tower.id], target: far.position, targetId: far.id,
    })).toEqual({ ok: true });
    const nearHp = near.hp;
    const farHp = far.hp;
    run(state, 200);
    // The nearer villager is the automatic choice; the order beats it.
    expect(far.hp).toBeLessThan(farHp);
    expect(near.hp).toBe(nearHp);
  });

  it('returns to picking its own target when the order is cleared', () => {
    const state = createGame();
    inFeudal(state);
    state.players[1].stone = 500;
    state.players[1].wood = 500;
    const builder = villagerOf(state);
    applyCommand(state, {
      kind: 'build', player: 1, builderIds: [builder.id], building: 'watch-tower',
      target: freeSpot(state, 'watch-tower', builder.position),
    });
    const tower = state.entities.find(e => e.kind === 'watch-tower')!;
    tower.buildProgress = undefined;
    parkScouts(state);
    const enemies = state.entities.filter(e => e.owner === 2 && e.kind === 'villager');
    const near = enemies[0];
    const far = enemies[1];
    near.position = { x: tower.position.x + 1, y: tower.position.y };
    far.position = { x: tower.position.x + 4, y: tower.position.y };
    applyCommand(state, {
      kind: 'order', player: 1, entityIds: [tower.id], target: far.position, targetId: far.id,
    });
    run(state, 60);

    // Right-clicking bare ground releases the tower back to its own judgement.
    applyCommand(state, { kind: 'order', player: 1, entityIds: [tower.id], target: { x: 1, y: 1 } });
    expect(tower.order.kind).toBe('idle');
    const nearHp = near.hp;
    run(state, 200);
    expect(near.hp).toBeLessThan(nearHp);
  });

  it('drops an ordered target that dies and defends itself again', () => {
    const state = createGame();
    inFeudal(state);
    state.players[1].stone = 500;
    state.players[1].wood = 500;
    const builder = villagerOf(state);
    applyCommand(state, {
      kind: 'build', player: 1, builderIds: [builder.id], building: 'watch-tower',
      target: freeSpot(state, 'watch-tower', builder.position),
    });
    const tower = state.entities.find(e => e.kind === 'watch-tower')!;
    tower.buildProgress = undefined;
    parkScouts(state);
    const enemies = state.entities.filter(e => e.owner === 2 && e.kind === 'villager');
    const ordered = enemies[0];
    const other = enemies[1];
    ordered.position = { x: tower.position.x + 3, y: tower.position.y };
    other.position = { x: tower.position.x + 2, y: tower.position.y };
    applyCommand(state, {
      kind: 'order', player: 1, entityIds: [tower.id], target: ordered.position, targetId: ordered.id,
    });
    run(state, 20);

    ordered.hp = 0;
    ordered.dead = true;
    const otherHp = other.hp;
    run(state, 200);
    expect(tower.order.kind).toBe('idle');
    expect(other.hp).toBeLessThan(otherHp);
  });

  it('lets an arrow whose target dies mid-flight fly on and land on nothing', () => {
    const state = createGame();
    inFeudal(state);
    state.players[1].stone = 500;
    state.players[1].wood = 500;
    const builder = villagerOf(state);
    applyCommand(state, {
      kind: 'build', player: 1, builderIds: [builder.id], building: 'watch-tower',
      target: freeSpot(state, 'watch-tower', builder.position),
    });
    const tower = state.entities.find(e => e.kind === 'watch-tower')!;
    tower.buildProgress = undefined;
    parkScouts(state);
    const victim = state.entities.find(e => e.owner === 2 && e.kind === 'villager')!;
    const range = FALLBACK_RULES.buildings['watch-tower'].attack!.range;
    victim.position = { x: tower.position.x + range - 0.5, y: tower.position.y };
    while (state.projectiles.length === 0) stepGame(state);

    // A second enemy well off to one side: if the arrow were retargeted rather
    // than aimed once, this is who it would go for.
    const bystander = state.entities.find(
      e => e.owner === 2 && e.kind === 'villager' && e.id !== victim.id)!;
    bystander.position = { x: tower.position.x, y: tower.position.y + range - 0.5 };
    const bystanderHp = bystander.hp;

    victim.hp = 0;
    victim.dead = true;
    stepGame(state);
    // A shot is aimed once. It keeps flying to the spot it was aimed at
    // rather than turning to chase somebody else...
    expect(state.projectiles.length).toBeGreaterThan(0);
    for (let i = 0; i < 200 && state.projectiles.length; i++) stepGame(state);
    // ...and lands there on nothing at all, hurting no one.
    expect(state.projectiles.length).toBe(0);
    expect(bystander.hp).toBe(bystanderHp);
  });
});

describe('technologies', () => {
  const townCenter = (state: GameState) =>
    state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;

  it('reads its technologies from the manifest rather than the fallback table', () => {
    // The importer extracted the DAT's technologies into content.json and the
    // atlas step then dropped them on the way to the published manifest, so
    // `rulesFromManifest` found no key and every match ran on the hand-written
    // fallback rules. Nothing failed, because the fallback numbers happen to
    // match the DAT. This asserts the wire is connected rather than the
    // numbers agreeing: a manifest that says something else must win.
    const manifest = existsSync(MANIFEST_PATH)
      ? JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as ContentManifest
      : undefined;
    if (manifest) {
      expect(manifest.technologies, 'the published manifest carries no technologies').toBeDefined();
      expect(Object.keys(manifest.technologies!)).toContain('loom');
    }
    const fixture: ContentManifest = {
      entities: {},
      technologies: {
        loom: {
          techId: 22, name: 'Loom', researchSeconds: 999, researchedAt: 109,
          requiresAge: 0, cost: { gold: 7 },
        },
      },
    };
    const rules = rulesFromManifest(fixture);
    expect(rules.technologies.loom.researchSeconds).toBe(999);
    expect(rules.technologies.loom.cost.gold).toBe(7);
    expect(FALLBACK_RULES.technologies.loom.researchSeconds).not.toBe(999);
  });

  it('researches Loom at its DAT cost and heals the villagers already standing there', () => {
    const state = createGame(41);
    const loom = state.rules.technologies.loom;
    expect(loom.researchedAt).toBe('town-center');
    expect(loom.cost).toEqual({ food: 0, wood: 0, gold: 50, stone: 0 });

    const villager = villagerOf(state);
    const before = { hp: villager.hp, maxHp: villager.maxHp };
    state.players[1].gold = 100;
    const tc = townCenter(state);
    expect(applyCommand(state, { kind: 'research', player: 1, buildingId: tc.id, tech: 'loom' }).ok).toBe(true);
    expect(state.players[1].gold).toBe(50);
    // Nothing changes until it finishes.
    run(state, 10);
    expect(villager.maxHp).toBe(before.maxHp);
    expect(state.players[1].researched).toEqual([]);

    run(state, loom.researchSeconds * 20);
    expect(state.players[1].researched).toEqual(['loom']);
    expect(villager.maxHp).toBe(before.maxHp + 15);
    expect(villager.hp).toBe(before.hp + 15);
    // And the armour it grants reaches units trained afterwards.
    expect(applyCommand(state, { kind: 'train', player: 1, buildingId: tc.id, unit: 'villager' }).ok).toBe(true);
    for (let i = 0; i < 2000 && state.entities.filter(e => e.kind === 'villager' && e.owner === 1).length < 4; i++) {
      stepGame(state);
    }
    const fresh = state.entities.filter(e => e.owner === 1 && e.kind === 'villager').at(-1)!;
    expect(fresh.maxHp).toBe(before.maxHp + 15);

    // One research per player, and one at a time.
    expect(applyCommand(state, { kind: 'research', player: 1, buildingId: tc.id, tech: 'loom' }).ok).toBe(false);
  });

  it('gates the Feudal age behind its own research, and everything behind the age', () => {
    const state = createGame(42);
    expect(state.players[1].age).toBe(0);
    const builders = state.entities.filter(e => e.owner === 1 && e.kind === 'villager').map(e => e.id);
    state.players[1].wood = 1000;
    state.players[1].food = 1000;

    // Feudal buildings and units are refused in the Dark Age, by name.
    for (const building of ['market', 'blacksmith', 'archery-range', 'stable', 'watch-tower'] as const) {
      const result = applyCommand(state, {
        kind: 'build', player: 1, builderIds: builders, building, target: { x: 12, y: 12 },
      });
      expect(result.ok, building).toBe(false);
      if (!result.ok) expect(result.reason).toContain('later age');
    }
    // What is Dark Age in the DAT still goes up.
    expect(applyCommand(state, {
      kind: 'build', player: 1, builderIds: builders, building: 'house', target: freeSpot(state, 'house', { x: 8, y: 12 }),
    }).ok).toBe(true);

    const tc = townCenter(state);
    const feudal = state.rules.technologies['feudal-age'];
    expect(feudal.cost.food).toBe(500);
    expect(applyCommand(state, { kind: 'research', player: 1, buildingId: tc.id, tech: 'feudal-age' }).ok).toBe(true);
    run(state, feudal.researchSeconds * 20);
    expect(state.players[1].age).toBe(1);

    // And now the same building goes up, for this player only.
    expect(applyCommand(state, {
      kind: 'build', player: 1, builderIds: builders, building: 'market',
      target: freeSpot(state, 'market', { x: 12, y: 12 }),
    }).ok).toBe(true);
    const theirs = applyCommand(state, {
      kind: 'build', player: 2,
      builderIds: state.entities.filter(e => e.owner === 2 && e.kind === 'villager').map(e => e.id),
      building: 'market', target: freeSpot(state, 'market', { x: 22, y: 12 }),
    });
    expect(theirs.ok).toBe(false);
    if (!theirs.ok) expect(theirs.reason).toContain('later age');
  });

  it('replays identically across a research', () => {
    const play = () => {
      const state = createGame(43);
      state.players[1].gold = 200;
      const tc = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
      applyCommand(state, { kind: 'research', player: 1, buildingId: tc.id, tech: 'loom' });
      run(state, 900);
      return checksumState(state);
    };
    expect(play()).toBe(play());
  });
});

describe('herding and hunting', () => {
  const animalOf = (state: GameState, kind: string) =>
    state.entities.find(e => e.kind === kind && !e.dead)!;

  it('gives a sheep to whoever came closest, and not while both are near', () => {
    const state = createGame(31);
    const sheep = animalOf(state, 'sheep');
    expect(sheep.owner).toBe(0);
    const mine = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
    const theirs = state.entities.find(e => e.owner === 2 && e.kind === 'villager')!;

    // Two players in range: nobody's sheep.
    mine.position = { x: sheep.position.x + 1, y: sheep.position.y };
    theirs.position = { x: sheep.position.x - 1, y: sheep.position.y };
    run(state, 20);
    expect(sheep.owner).toBe(0);

    // Alone with it, it changes hands.
    theirs.position = { x: 25, y: 9 };
    run(state, 20);
    expect(sheep.owner).toBe(1);
  });

  it('leaves a claimed sheep where it stands, and lets its owner move it', () => {
    const state = createGame(32);
    const sheep = animalOf(state, 'sheep');
    const mine = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
    mine.position = { x: sheep.position.x + 1, y: sheep.position.y };
    run(state, 20);
    expect(sheep.owner).toBe(1);

    // The villager wanders off; the sheep does not trail after it.
    const stood = { ...sheep.position };
    mine.position = { x: sheep.position.x + 12, y: sheep.position.y + 8 };
    run(state, 20 * 20);
    expect(sheep.position).toEqual(stood);
    expect(sheep.order.kind).toBe('idle');

    // And an order given to it is an order it keeps: driving it about after it
    // joined would overwrite this a quarter of a second later.
    const target = { x: stood.x + 6, y: stood.y };
    expect(applyCommand(state, {
      kind: 'order', player: 1, entityIds: [sheep.id], target,
    }).ok).toBe(true);
    expect(sheep.order).toEqual({ kind: 'move', target });
    run(state, 20 * 20);
    expect(distanceBetween(sheep, { position: target } as Entity)).toBeLessThan(0.5);
  });

  it('turns a claimed sheep into food a villager banks', () => {
    const state = createGame(32);
    const sheep = animalOf(state, 'sheep');
    const villager = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
    villager.position = { x: sheep.position.x + 0.8, y: sheep.position.y };
    run(state, 20);
    expect(sheep.owner).toBe(1);
    const food = state.rules.units.sheep.foodAmount!;
    expect(sheep.amount).toBe(food);

    const banked = state.players[1].food;
    applyCommand(state, {
      kind: 'order', player: 1, entityIds: [villager.id], target: sheep.position, targetId: sheep.id,
    });
    expect(villager.order.kind).toBe('gather');
    // Long enough to fill a carry and walk it to the town center.
    run(state, 1500);
    // Working it kills it, as in AoE2, and the carcass outlives the corpse
    // window for as long as there is food on it.
    expect(sheep.dead).toBe(true);
    expect(sheep.amount).toBeLessThan(food);
    expect(state.players[1].food).toBeGreaterThan(banked);
  });

  it('leaves a carcass a player may still inspect, and a corpse they may not', () => {
    const state = createGame(34);
    const boar = animalOf(state, 'boar');
    // Alive, it is not a carcass however much food it carries.
    expect(isCarcass(boar)).toBe(false);
    boar.hp = 0;
    boar.dead = true;
    expect(isCarcass(boar)).toBe(true);
    expect(boar.amount).toBeGreaterThan(0);
    // Eaten out, it stops being something to click and goes away.
    boar.amount = 0;
    expect(isCarcass(boar)).toBe(false);

    // A soldier's corpse never was: it carries nothing to read off it.
    const militia = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
    militia.dead = true;
    expect(isCarcass(militia)).toBe(false);
  });

  it('takes an order onto a carcass from a villager that did not make the kill', () => {
    const state = createGame(40);
    const sheep = animalOf(state, 'sheep');
    // A kill nobody is standing over: the carcass is just food lying there.
    sheep.hp = 0;
    sheep.dead = true;
    sheep.decayTicks = 0;
    const food = sheep.amount!;
    expect(food).toBeGreaterThan(0);

    const villager = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
    villager.position = { x: sheep.position.x + 3, y: sheep.position.y };
    const result = applyCommand(state, {
      kind: 'order', player: 1, entityIds: [villager.id],
      target: sheep.position, targetId: sheep.id,
    });
    // The command layer used to answer "target does not exist" here, so a
    // second villager could never be put on a carcass at all.
    expect(result.ok).toBe(true);
    expect(villager.order.kind).toBe('gather');

    run(state, 600);
    expect(sheep.amount!).toBeLessThan(food);
  });

  it('refuses an order onto a corpse with nothing left on it', () => {
    const state = createGame(41);
    const sheep = animalOf(state, 'sheep');
    sheep.hp = 0;
    sheep.dead = true;
    sheep.amount = 0;
    const villager = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
    const result = applyCommand(state, {
      kind: 'order', player: 1, entityIds: [villager.id],
      target: sheep.position, targetId: sheep.id,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('does not exist');
  });

  it('keeps a hunted carcass selectable for as long as its food lasts', () => {
    const state = createGame(35);
    const boar = animalOf(state, 'boar');
    boar.position = { x: 40, y: 40 };
    boar.hp = 1;
    const hunter = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
    hunter.position = { x: 40.8, y: 40 };
    applyCommand(state, {
      kind: 'order', player: 1, entityIds: [hunter.id], target: boar.position, targetId: boar.id,
    });
    for (let i = 0; i < 400 && !boar.dead; i++) stepGame(state);
    expect(boar.dead).toBe(true);

    // Well past the corpse decay window a soldier's body would have gone in,
    // the carcass is still in the world and still worth clicking.
    run(state, 20 * 20);
    expect(state.entities.some(e => e.id === boar.id)).toBe(true);
    expect(isCarcass(state.entities.find(e => e.id === boar.id)!)).toBe(true);
  });

  it('startles a deer only from close by, and then only a hop', () => {
    const state = createGame(33);
    const deer = animalOf(state, 'deer');
    const startle = state.rules.units.deer.startle!;
    // The DAT's own search radius for a deer, which is the reference's one tile.
    expect(startle.range).toBe(1);
    const villager = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;

    // Two tiles away is close enough to see and too far to matter.
    villager.position = { x: deer.position.x + 2, y: deer.position.y };
    const stood = { ...deer.position };
    run(state, 60);
    expect(deer.position).toEqual(stood);

    // Inside a tile it moves — and moves about a tile and a half, not five.
    villager.position = { x: deer.position.x + 0.8, y: deer.position.y };
    const from = { ...deer.position };
    run(state, 200);
    const hop = Math.hypot(deer.position.x - from.x, deer.position.y - from.y);
    expect(hop).toBeGreaterThan(0.5);
    expect(hop).toBeLessThan(startle.distance + 0.6);
    expect(deer.owner).toBe(0);
  });

  it('lets a startled deer settle rather than running for as long as it is followed', () => {
    const state = createGame(36);
    const deer = animalOf(state, 'deer');
    const villager = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
    // A villager parked right on it: under the old rule this walked the deer
    // away indefinitely, which is why a hunt only ever ended at an obstacle.
    villager.position = { x: deer.position.x + 0.5, y: deer.position.y };
    run(state, 20);
    expect(deer.fleeCooldown).toBeGreaterThan(0);
    const restSeconds = state.rules.units.deer.startle!.restSeconds;
    expect(deer.fleeCooldown!).toBeLessThanOrEqual(restSeconds[1] * 20);
    expect(deer.fleeCooldown!).toBeGreaterThanOrEqual((restSeconds[0] - 1) * 20);

    // Let the hop it already started finish, then hold the villager on it: for
    // the rest of the cooldown it grazes instead of being walked away.
    for (let i = 0; i < 100; i++) {
      villager.position = { x: deer.position.x + 0.5, y: deer.position.y };
      stepGame(state);
    }
    const settled = { ...deer.position };
    for (let i = 0; i < 120; i++) {
      villager.position = { x: deer.position.x + 0.5, y: deer.position.y };
      stepGame(state);
    }
    expect(Math.hypot(deer.position.x - settled.x, deer.position.y - settled.y)).toBeLessThan(0.05);
  });

  it('brings a deer down on open ground instead of following it forever', () => {
    const state = createGame(37);
    const deer = animalOf(state, 'deer');
    // Open ground well clear of the trees, so nothing but the chase decides it.
    deer.position = { x: 60, y: 60 };
    const hunters = state.entities.filter(e => e.owner === 1 && e.kind === 'villager').slice(0, 2);
    hunters.forEach((h, i) => { h.position = { x: 58 + i * 0.5, y: 60 }; });
    applyCommand(state, {
      kind: 'order', player: 1, entityIds: hunters.map(h => h.id), target: deer.position, targetId: deer.id,
    });
    // Two minutes of game time is generous for two hunters and a five hit
    // point deer; the point is that it ends at all.
    for (let i = 0; i < 2400 && !deer.dead; i++) stepGame(state);
    expect(deer.dead).toBe(true);
  });

  it('looses an arrow at game and swings at anything that can hit back', () => {
    const state = createGame(38);
    const hunt = state.rules.units.villager.hunt!;
    // The hunter unit's own reach and arrow, which the plain villager lacks.
    expect(hunt.range).toBe(3);
    expect(state.rules.units.villager.range ?? 0).toBe(0);

    const deer = animalOf(state, 'deer');
    deer.position = { x: 70, y: 70 };
    const villager = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
    // Standing off at two tiles: too far to touch, inside the bow's three.
    villager.position = { x: 68, y: 70 };
    applyCommand(state, {
      kind: 'order', player: 1, entityIds: [villager.id], target: deer.position, targetId: deer.id,
    });
    let sawArrow = false;
    for (let i = 0; i < 200 && !sawArrow; i++) {
      stepGame(state);
      if (state.projectiles.length) sawArrow = true;
    }
    expect(sawArrow).toBe(true);

    // The same villager against a soldier throws no arrow: it has no bow for
    // anything but game.
    const other = createGame(39);
    const worker = other.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
    const enemy = other.entities.find(e => e.owner === 2 && e.kind === 'villager')!;
    worker.position = { x: enemy.position.x + 2, y: enemy.position.y };
    applyCommand(other, {
      kind: 'order', player: 1, entityIds: [worker.id], target: enemy.position, targetId: enemy.id,
    });
    for (let i = 0; i < 200; i++) {
      stepGame(other);
      expect(other.projectiles).toHaveLength(0);
    }
  });

  it('makes a boar fight back, then feeds the hunters that killed it', () => {
    const state = createGame(34);
    const boar = animalOf(state, 'boar');
    // A boar is not a one-villager job in AoE2 either.
    const hunters = state.entities.filter(e => e.owner === 1 && e.kind === 'villager');
    for (const [index, hunter] of hunters.entries()) {
      hunter.position = { x: boar.position.x + 1 + index * 0.4, y: boar.position.y };
    }
    const before = hunters.map(h => h.hp);
    applyCommand(state, {
      kind: 'order', player: 1, entityIds: hunters.map(h => h.id),
      target: boar.position, targetId: boar.id,
    });
    // Hunting is what an order onto a live boar means.
    expect(hunters[0].order.kind).toBe('attack');

    for (let i = 0; i < 600 && hunters.every((h, n) => h.hp === before[n]); i++) stepGame(state);
    // It answers the first wound rather than standing there being eaten.
    expect(hunters.some((h, n) => h.hp < before[n])).toBe(true);
    expect(boar.order.kind).toBe('attack');

    // A boar out-fights three villagers in AoE2 too — this is about the chain
    // from wound to carcass to food, not about who wins the brawl, so finish
    // it off rather than staging a rescue.
    for (const [index, hunter] of hunters.entries()) hunter.hp = before[index];
    boar.hp = 1;
    for (let i = 0; i < 2000 && boar.hp > 0; i++) stepGame(state);
    expect(boar.hp).toBeLessThanOrEqual(0);
    expect(boar.dead).toBe(true);
    // Its carcass is still there, and it is worth what the DAT says.
    expect(boar.amount).toBe(state.rules.units.boar.foodAmount);

    const banked = state.players[1].food;
    for (let i = 0; i < 4000 && state.players[1].food === banked; i++) stepGame(state);
    expect(state.players[1].food).toBeGreaterThan(banked);
  });
});

describe('palisade walls', () => {
  it('builds the whole dragged line, not only the segment tasked last', () => {
    // A wall is placed a tile at a time but dragged as one line, so the
    // builders have to carry on down it. Left to the raw command each new
    // foundation would steal them from the last and nine would never rise.
    const state = createGame(71);
    state.players[1].wood = 200;
    const builders = state.entities.filter(e => e.owner === 1 && e.kind === 'villager').map(e => e.id);
    const half = state.rules.buildings['palisade-wall'].radius;

    let line: { x: number; y: number }[] = [];
    for (let y = 4.5; y < 20 && line.length < 6; y++) {
      for (let x = 4.5; x < 22 && line.length < 6; x++) {
        const run: { x: number; y: number }[] = [];
        for (let i = 0; i < 6; i++) {
          const tile = { x: x + i, y };
          if (!placementLegal(state, 'palisade-wall', tile).ok) break;
          run.push(tile);
        }
        if (run.length === 6) line = run;
      }
    }
    expect(line, 'a clear six-tile run to wall').toHaveLength(6);
    expect(half).toBe(0.5);

    for (const target of line) {
      expect(applyCommand(state, {
        kind: 'build', player: 1, builderIds: builders, building: 'palisade-wall', target,
      }).ok, `${target.x},${target.y}`).toBe(true);
    }
    const segments = () => state.entities.filter(e => e.kind === 'palisade-wall' && !e.dead);
    expect(segments()).toHaveLength(6);

    for (let i = 0; i < 6000 && segments().some(e => e.buildProgress !== undefined); i++) {
      stepGame(state);
    }
    expect(segments().filter(e => e.buildProgress === undefined)).toHaveLength(6);
    // And once the line is up the builders stop rather than wandering off to
    // somebody else's foundations.
    expect(state.entities.filter(e => builders.includes(e.id)).every(e => e.order.kind === 'idle')).toBe(true);
  });

  it('turns a gate to the axis it was placed on, and charges the DAT price', () => {
    const state = createGame(72);
    state.players[1].wood = 200;
    const builders = state.entities.filter(e => e.owner === 1 && e.kind === 'villager').map(e => e.id);

    // Two tiles by one, so a legal spot has to be searched for either way round.
    let placed: { target: { x: number; y: number }; along: 'x' | 'y' } | undefined;
    for (let y = 4; y < 20 && !placed; y++) {
      for (let x = 4; x < 22 && !placed; x++) {
        if (placementLegal(state, 'palisade-gate', { x, y: y + 0.5 }, 'x').ok) {
          placed = { target: { x, y: y + 0.5 }, along: 'x' };
        }
      }
    }
    expect(placed, 'somewhere to put a gate').toBeDefined();

    const before = state.players[1].wood;
    expect(applyCommand(state, {
      kind: 'build', player: 1, builderIds: builders, building: 'palisade-gate',
      target: placed!.target, orientation: 'x',
    }).ok).toBe(true);
    expect(before - state.players[1].wood).toBe(state.rules.buildings['palisade-gate'].cost.wood);

    const gate = state.entities.find(e => e.kind === 'palisade-gate')!;
    expect(gate.footprint).toEqual({ x: 1, y: 0.5 });
    // The other way round is the same box turned, which is what the DAT's two
    // gate units are: identical numbers, one long in x and one long in y.
    expect(buildingFootprint(state, 'palisade-gate', 'y')).toEqual({ x: 0.5, y: 1 });

    // And the same spot is no longer free for a gate lying the other way.
    expect(placementLegal(state, 'palisade-gate', placed!.target, 'y').ok).toBe(false);
  });

  it('carries the builders across the gate in the line rather than stopping at it', () => {
    // The gate is a different kind from the wall either side of it, but one
    // drag placed the lot, so it is the same line to whoever is building it.
    const state = createGame(73);
    state.players[1].wood = 300;
    const builders = state.entities.filter(e => e.owner === 1 && e.kind === 'villager').map(e => e.id);

    // A wall centre sits on a tile, a gate centre on the corner between the two
    // it covers: with walls on x0 and x0+1 the gate goes on x0+2.5, filling the
    // two tiles between them and the walls on x0+4 and x0+5.
    let row: number | undefined;
    let startX: number | undefined;
    for (let y = 4.5; y < 20 && row === undefined; y++) {
      for (let x = 4.5; x < 18; x++) {
        const tiles = [x, x + 1, x + 4, x + 5];
        if (!tiles.every(at => placementLegal(state, 'palisade-wall', { x: at, y }).ok)) continue;
        if (!placementLegal(state, 'palisade-gate', { x: x + 2.5, y }, 'x').ok) continue;
        row = y; startX = x; break;
      }
    }
    expect(row, 'a clear row for a wall with a gate in it').toBeDefined();

    for (const at of [startX!, startX! + 1, startX! + 4, startX! + 5]) {
      expect(applyCommand(state, {
        kind: 'build', player: 1, builderIds: builders, building: 'palisade-wall',
        target: { x: at, y: row! },
      }).ok).toBe(true);
    }
    // Tasked last, so it is the one the builders start on and the walls are
    // only reached by carrying on down the line.
    expect(applyCommand(state, {
      kind: 'build', player: 1, builderIds: builders, building: 'palisade-gate',
      target: { x: startX! + 2.5, y: row! }, orientation: 'x',
    }).ok).toBe(true);

    const line = () => state.entities.filter(
      e => !e.dead && (e.kind === 'palisade-wall' || e.kind === 'palisade-gate'));
    for (let i = 0; i < 8000 && line().some(e => e.buildProgress !== undefined); i++) stepGame(state);
    expect(line().filter(e => e.buildProgress === undefined)).toHaveLength(5);
  });
});

describe('the archery range', () => {
  it('trains the skirmisher as well as the archer', () => {
    const state = createGame(23);
    inFeudal(state);
    const trainedHere = (Object.keys(state.rules.units) as (keyof typeof state.rules.units)[])
      .filter(kind => state.rules.units[kind].trainedAt === 'archery-range')
      .sort();
    // Asserting the exact roster here breaks every time a unit is added, and
    // says nothing useful when it does. What matters is the rule: the range
    // is where the archer line lives, and everything on it that exists only
    // as the far end of an upgrade is offered only once that is researched.
    expect(trainedHere).toEqual(expect.arrayContaining(['archer', 'skirmisher', 'cavalry-archer']));
    // Only imported content has the upgrade technologies; the open fallback
    // has no upgrades at all, so there is nothing to be gated behind.
    if (importedRules) {
      const upgraded = createGame(23, importedRules);
      const here = (Object.keys(upgraded.rules.units) as (keyof typeof upgraded.rules.units)[])
        .filter(kind => upgraded.rules.units[kind].trainedAt === 'archery-range');
      expect(here).toEqual(expect.arrayContaining(['crossbowman', 'arbalester', 'elite-skirmisher']));
      for (const kind of here) {
        const gated = notYetUpgradedInto(upgraded, 1, kind);
        const isBase = ['archer', 'skirmisher', 'cavalry-archer'].includes(kind);
        expect(gated, `${kind} should ${isBase ? 'not ' : ''}need an upgrade first`).toBe(!isBase);
      }
    }
    expect(state.rules.units.skirmisher.cost).toEqual({ food: 25, wood: 35, gold: 0, stone: 0 });
  });

  it("leaves a skirmisher standing when its target is inside its minimum range", () => {
    const state = createGame(24);
    const rules = state.rules.units.skirmisher;
    expect(rules.minRange).toBeGreaterThan(0);
    const villager = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
    const enemy = state.entities.find(e => e.owner === 2 && e.kind === 'villager')!;
    // Stand a skirmisher on top of an enemy.
    villager.kind = 'skirmisher';
    villager.hp = villager.maxHp = rules.hp;
    villager.radius = rules.radius;
    enemy.position = { x: villager.position.x + 0.3, y: villager.position.y };
    const before = enemy.hp;
    applyCommand(state, {
      kind: 'order', player: 1, entityIds: [villager.id], target: enemy.position, targetId: enemy.id,
    });
    run(state, 200);
    expect(enemy.hp).toBe(before);
    // It holds where it stands rather than shoving its way closer.
    expect(villager.activity).toBe('idle');

    // Backed off past the minimum, the same shot lands.
    enemy.position = { x: villager.position.x + 2.5, y: villager.position.y };
    run(state, 200);
    expect(enemy.hp).toBeLessThan(before);
  });
});

describe('the stable', () => {
  it('builds and trains the scout it is for', () => {
    const state = createGame(21);
    inFeudal(state);
    state.players[1].wood = 1000;
    state.players[1].food = 1000;
    const builders = state.entities.filter(e => e.owner === 1 && e.kind === 'villager').map(e => e.id);
    let target: { x: number; y: number } | undefined;
    for (let step = 0; step < 12 && !target; step += 0.5) {
      for (const y of [9, 10, 8, 11]) {
        if (placementLegal(state, 'stable', { x: 8.5 + step, y }).ok) { target = { x: 8.5 + step, y }; break; }
      }
    }
    expect(target).toBeDefined();
    expect(applyCommand(state, { kind: 'build', player: 1, builderIds: builders, building: 'stable', target: target! }).ok).toBe(true);
    const stable = () => state.entities.find(e => e.kind === 'stable' && e.buildProgress === undefined);
    for (let i = 0; i < 4000 && !stable(); i++) stepGame(state);
    expect(stable()).toBeDefined();

    expect(applyCommand(state, { kind: 'train', player: 1, buildingId: stable()!.id, unit: 'scout-cavalry' }).ok).toBe(true);
    const scout = () => state.entities.find(e => e.kind === 'scout-cavalry' && !e.dead);
    for (let i = 0; i < 2000 && !scout(); i++) stepGame(state);
    expect(scout()).toBeDefined();
    // A scout is cavalry, not a worker: it defends itself.
    expect(state.rules.units['scout-cavalry'].attacks.some(a => a.amount > 0)).toBe(true);
    // Nothing else trains there, and the scout is trained nowhere else.
    expect(applyCommand(state, { kind: 'train', player: 1, buildingId: stable()!.id, unit: 'militia' }).ok).toBe(false);
  });
});

describe('trade', () => {
  /** Both sides get a finished market; a route needs two ends. */
  function markets(state: GameState): { home: Entity; away: Entity } {
    inFeudal(state);
    for (const player of [1, 2] as const) {
      state.players[player].wood = 1000;
      state.players[player].gold = 1000;
      const builders = state.entities
        .filter(e => e.owner === player && e.kind === 'villager')
        .map(e => e.id);
      // Where the map allows it, out from the town center towards the middle;
      // the resource clusters move with the seed, so the spot cannot be fixed.
      let target: { x: number; y: number } | undefined;
      for (let step = 0; step < 12 && !target; step += 0.5) {
        for (const y of [9, 10, 8, 11]) {
          const x = player === 1 ? 8.5 + step : 23.5 - step;
          if (placementLegal(state, 'market', { x, y }).ok) { target = { x, y }; break; }
        }
      }
      expect(target).toBeDefined();
      const result = applyCommand(state, { kind: 'build', player, builderIds: builders, building: 'market', target: target! });
      expect(result.ok).toBe(true);
    }
    const finished = () => state.entities.filter(e => e.kind === 'market' && e.buildProgress === undefined);
    for (let i = 0; i < 6000 && finished().length < 2; i++) stepGame(state);
    const built = finished();
    expect(built).toHaveLength(2);
    return { home: built.find(e => e.owner === 1)!, away: built.find(e => e.owner === 2)! };
  }

  it('pays gold for a run between two markets, and only between two', () => {
    const state = createGame(11);
    const { home, away } = markets(state);
    expect(applyCommand(state, { kind: 'train', player: 1, buildingId: home.id, unit: 'trade-cart' }).ok).toBe(true);
    const cart = () => state.entities.find(e => e.kind === 'trade-cart' && !e.dead);
    for (let i = 0; i < 2000 && !cart(); i++) stepGame(state);
    expect(cart()).toBeDefined();

    // Its own market is no trade route: AoE2 pays for reaching somebody else's.
    applyCommand(state, {
      kind: 'order', player: 1, entityIds: [cart()!.id], target: home.position, targetId: home.id,
    });
    expect(cart()!.order.kind).not.toBe('trade');

    applyCommand(state, {
      kind: 'order', player: 1, entityIds: [cart()!.id], target: away.position, targetId: away.id,
    });
    expect(cart()!.order.kind).toBe('trade');

    const before = state.players[1].gold;
    // Out to the far market: loaded, but nothing banked yet.
    for (let i = 0; i < 2000 && !cart()!.carrying; i++) stepGame(state);
    expect(cart()!.carrying?.kind).toBe('gold');
    expect(state.players[1].gold).toBe(before);

    // And back again, which is when the run pays.
    for (let i = 0; i < 2000 && state.players[1].gold === before; i++) stepGame(state);
    expect(state.players[1].gold).toBeGreaterThan(before);
    expect(cart()!.carrying).toBeUndefined();
    // The road pays by the second travelled, so a run is worth what it costs
    // in time, never more than the cart holds.
    const rules = state.rules.units['trade-cart'];
    expect(state.players[1].gold - before).toBeLessThanOrEqual(rules.tradeCapacity!);
    expect(cart()!.order.kind).toBe('trade');
  });

  it('gives up rather than walking on the spot when the route is walled off', () => {
    // A market can be sealed in by trees; `moveAlong` reports arrived and
    // unreachable the same way, so a cart that ignored it walked forever.
    const state = createGame(13);
    const { home, away } = markets(state);
    applyCommand(state, { kind: 'train', player: 1, buildingId: home.id, unit: 'trade-cart' });
    const cart = () => state.entities.find(e => e.kind === 'trade-cart' && !e.dead)!;
    for (let i = 0; i < 2000 && !state.entities.some(e => e.kind === 'trade-cart'); i++) stepGame(state);
    // Wall the far market off completely by blocking the cart's own grid: the
    // simplest stand-in is to put it where nothing can reach.
    away.position = { x: 0.5, y: 0.5 };
    const trees = state.entities.filter(e => e.kind === 'resource' && e.resourceKind === 'wood');
    for (const [index, tree] of trees.slice(0, 6).entries()) {
      tree.position = { x: index < 3 ? 2.5 : 0.5 + index - 3, y: index < 3 ? index - 0 + 0.5 : 2.5 };
    }
    applyCommand(state, {
      kind: 'order', player: 1, entityIds: [cart().id], target: away.position, targetId: away.id,
    });
    expect(cart().order.kind).toBe('trade');
    run(state, 200);
    const resting = { ...cart().position };
    run(state, 200);
    // Either it found a way in, or it stopped: what it must not do is claim to
    // be moving while standing still.
    if (cart().order.kind === 'trade') {
      expect(cart().position).not.toEqual(resting);
    } else {
      expect(cart().activity).toBe('idle');
    }
  });

  it('sends the cart home again rather than stranding it when the far market falls', () => {
    const state = createGame(12);
    const { home, away } = markets(state);
    applyCommand(state, { kind: 'train', player: 1, buildingId: home.id, unit: 'trade-cart' });
    const cart = () => state.entities.find(e => e.kind === 'trade-cart' && !e.dead)!;
    for (let i = 0; i < 2000 && !state.entities.some(e => e.kind === 'trade-cart'); i++) stepGame(state);
    applyCommand(state, {
      kind: 'order', player: 1, entityIds: [cart().id], target: away.position, targetId: away.id,
    });
    run(state, 40);
    away.hp = 0;
    run(state, 40);
    expect(cart().order.kind).toBe('idle');
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
    // The trade cart's rate and capacity are its own DAT fields, not a
    // hand-picked gold-per-tile constant.
    const skirmisher = importedRules!.units.skirmisher;
    expect(skirmisher.trainedAt).toBe('archery-range');
    expect(skirmisher.cost).toEqual({ food: 25, wood: 35, gold: 0, stone: 0 });
    expect(skirmisher.range).toBe(4);
    expect(skirmisher.minRange).toBe(1);
    const scout = importedRules!.units['scout-cavalry'];
    expect(scout.trainedAt).toBe('stable');
    expect(scout.trainSeconds).toBe(30);
    expect(scout.cost).toEqual({ food: 80, wood: 0, gold: 0, stone: 0 });
    expect(importedRules!.buildings.stable.cost).toEqual({ food: 0, wood: 175, gold: 0, stone: 0 });
    const cart = importedRules!.units['trade-cart'];
    expect(cart.trainedAt).toBe('market');
    expect(cart.trainSeconds).toBe(51);
    expect(cart.cost).toEqual({ food: 0, wood: 100, gold: 50, stone: 0 });
    expect(cart.tradeRatePerSecond).toBe(0.2875);
    expect(cart.tradeCapacity).toBe(100);
    expect(cart.attacks).toEqual([]);
  });

  it.skipIf(!importedAudio)('gives every trainable unit a voice the view can name', () => {
    // The view asks for `<kind>-select`; a renamed alias would go quiet with
    // nothing to say so.
    for (const kind of Object.keys(FALLBACK_RULES.units)) {
      if (isAnimal(kind as never)) continue;
      expect(Object.keys(importedAudio!.audio), kind).toContain(`${kind}-select`);
    }
  });

  it.skipIf(!importedRules)('replays identically under imported rules', () => {
    const a = createGame(77, importedRules);
    const b = createGame(77, importedRules);
    for (let i = 0; i < 400; i++) { stepGame(a); stepGame(b); }
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('what a blow does to a building', () => {
  // Issue #26. Every building that does not shoot came out of the importer
  // with no armours at all, because a `combat` block was asked for only when
  // the unit had an attack. Damage is scored class by class and a class the
  // target has no entry for scores nothing, so a house took exactly the
  // minimum -- one point a hit, from a sword or an arrow alike -- and no
  // blacksmith upgrade could move it.
  it.skipIf(!importedRules)('gives a building that never fights the DAT\'s own armour', () => {
    for (const [kind, rules] of Object.entries(importedRules!.buildings)) {
      expect(rules.armors.length, kind).toBeGreaterThan(0);
    }
    const house = importedRules!.buildings.house.armors;
    expect(house.find(a => a.class === 4)?.amount).toBe(-2);
    expect(house.find(a => a.class === 3)?.amount).toBe(7);
  });

  it.skipIf(!importedRules)('lets a blade through a house where an arrow scratches it', () => {
    const house = importedRules!.buildings.house.armors;
    // -2 melee armour makes a house soft to a sword; 7 pierce against an
    // archer's 4 is why archers do not raze towns in the original either.
    expect(computeDamage(importedRules!.units.militia.attacks, house)).toBeGreaterThan(1);
    expect(computeDamage(importedRules!.units.archer.attacks, house)).toBe(1);
  });

  it.skipIf(!importedRules)('lands that damage in a real match, not just in the rules', () => {
    const state = createGame(83, importedRules);
    const rules = state.rules.buildings.house;
    const home = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
    const house: Entity = {
      id: state.nextId++, kind: 'house', owner: 1,
      position: { x: home.position.x + 4, y: home.position.y + 4 },
      hp: rules.hp, maxHp: rules.hp, radius: rules.radius,
      activity: 'idle', order: { kind: 'idle' },
    };
    state.entities.push(house);
    const soldier = state.entities.find(e => e.owner === 2 && e.kind === 'villager')!;
    soldier.position = { x: house.position.x + house.radius + soldier.radius, y: house.position.y };
    applyCommand(state, {
      kind: 'order', player: 2, entityIds: [soldier.id],
      target: house.position, targetId: house.id,
    });
    const expected = computeDamage(
      unitRulesFor(state, 2, 'villager').attacks, state.rules.buildings.house.armors);
    expect(expected).toBeGreaterThan(1);
    const start = house.hp;
    for (let i = 0; i < 400 && house.hp === start; i++) stepGame(state);
    expect(start - house.hp).toBe(expected);
  });

  it.skipIf(!importedRules)('lands the upgrade on the target, not only in the rules', () => {
    // The half of #26 that the first fix missed, and that asserting on
    // `unitRulesFor` could never catch: the attacker loop read the *base*
    // rules, so Fletching moved the archer's attack from 4 to 5 and a villager
    // went on taking 4. Measure what the target actually loses.
    const dealt = (researched: string[]): number => {
      const state = createGame(101, importedRules);
      state.players[1].researched.push(...researched);
      const rules = importedRules!.units.archer;
      const archer: Entity = {
        id: state.nextId++, kind: 'archer', owner: 1, position: { x: 60, y: 60 },
        hp: rules.hp, maxHp: rules.hp, radius: rules.radius,
        activity: 'idle', order: { kind: 'idle' },
      };
      state.entities.push(archer);
      const prey = state.entities.find(e => e.owner === 2 && e.kind === 'villager')!;
      prey.position = { x: 62, y: 60 };
      applyCommand(state, { kind: 'stop', player: 2, entityIds: [prey.id] });
      applyCommand(state, {
        kind: 'order', player: 1, entityIds: [archer.id],
        target: prey.position, targetId: prey.id,
      });
      const start = prey.hp;
      for (let i = 0; i < 400 && prey.hp === start; i++) stepGame(state);
      return start - prey.hp;
    };
    const base = dealt([]);
    expect(base).toBeGreaterThan(1);
    expect(dealt(['fletching'])).toBe(base + 1);
  });

  it.skipIf(!importedRules)('carries the blacksmith upgrade into what the arrow hits', () => {
    // The other half of #26: the effect does reach the shot. It cannot show on
    // a house, and that is the DAT's answer rather than a defect -- 7 pierce
    // armour against 4 + 1 still leaves the minimum.
    const state = createGame(84, importedRules);
    const before = unitRulesFor(state, 1, 'archer').attacks;
    const soft = importedRules!.units.villager.armors;
    state.players[1].researched.push('fletching');
    const after = unitRulesFor(state, 1, 'archer').attacks;
    expect(computeDamage(after, soft)).toBe(computeDamage(before, soft) + 1);
    expect(computeDamage(after, importedRules!.buildings.house.armors)).toBe(1);
  });

  it.skipIf(!importedRules)('replays identically now that buildings have armour', () => {
    const a = createGame(85, importedRules);
    const b = createGame(85, importedRules);
    for (let i = 0; i < 600; i++) { stepGame(a); stepGame(b); }
    expect(checksumState(a)).toBe(checksumState(b));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('gather points', () => {
  /** A finished building of `kind`, dropped on the first spot that will take it. */
  const plant = (state: GameState, kind: BuildingKind): Entity => {
    const rules = state.rules.buildings[kind];
    const tc = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
    for (let ring = 4; ring < 20; ring += 1) {
      for (const [dx, dy] of [[ring, 0], [0, ring], [-ring, 0], [0, -ring], [ring, ring], [-ring, -ring]]) {
        const target = { x: Math.round(tc.position.x + dx) + 0.5, y: Math.round(tc.position.y + dy) + 0.5 };
        if (!placementLegal(state, kind, target).ok) continue;
        const entity: Entity = {
          id: state.nextId++, kind, owner: 1, position: target,
          hp: rules.hp, maxHp: rules.hp, radius: rules.radius,
          activity: 'idle', order: { kind: 'idle' },
        };
        state.entities.push(entity);
        return entity;
      }
    }
    throw new Error(`nowhere to put a ${kind}`);
  };

  it('takes a gather point at every building that trains something', () => {
    // Issue #8: the flag used to be the town center's alone. Anything that
    // trains takes one, and the unit it trains walks to it.
    const state = createGame(11);
    state.players[1].age = 2;
    Object.assign(state.players[1], { food: 5000, wood: 5000, gold: 5000, stone: 5000, populationCap: 200 });
    // The cap is recomputed from what is standing, so it takes houses.
    for (let i = 0; i < 6; i++) plant(state, 'house');
    stepGame(state);
    const producers: [BuildingKind, string][] = [
      ['town-center', 'villager'], ['barracks', 'militia'], ['archery-range', 'archer'],
      ['stable', 'scout-cavalry'], ['siege-workshop', 'battering-ram'],
      ['monastery', 'monk'], ['castle', 'longbowman'],
    ];
    for (const [kind, trains] of producers) {
      const building = kind === 'town-center'
        ? state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!
        : plant(state, kind);
      const flag = { x: building.position.x + 3, y: building.position.y + 3 };
      const rally = applyCommand(state, { kind: 'rally', player: 1, buildingId: building.id, target: flag });
      expect(rally.ok, `${kind} refused a gather point: ${rally.ok ? '' : rally.reason}`).toBe(true);
      expect(building.rally?.target).toEqual(flag);

      const before = new Set(state.entities.map(e => e.id));
      const train = applyCommand(state, { kind: 'train', player: 1, buildingId: building.id, unit: trains as never });
      expect(train.ok, `${kind} refused to train a ${trains}: ${train.ok ? '' : train.reason}`).toBe(true);
      let trained: Entity | undefined;
      for (let i = 0; i < 4000 && !trained; i++) {
        stepGame(state);
        trained = state.entities.find(e => !before.has(e.id) && e.kind === trains && !e.dead);
      }
      expect(trained, `${kind} never produced a ${trains}`).toBeDefined();
      // It leaves for the flag rather than standing at the door.
      const order = trained!.order;
      expect(order.kind, `${trains} from the ${kind} ignored the flag`).toBe('move');
      const walking = order as Extract<typeof order, { kind: 'move' }>;
      expect(Math.hypot(walking.target.x - flag.x, walking.target.y - flag.y)).toBeLessThan(1.5);
    }
  });
});

describe('what a shot is aimed at', () => {
  /**
   * An archer of player 1 and a lone villager of player 2, set up somewhere
   * empty so nothing else wanders into the shot. Returns both plus a helper
   * that runs until the archer has loosed and the arrow has landed.
   */
  function duel(seed: number, range = 3.5) {
    const state = createGame(seed);
    inFeudal(state);
    parkScouts(state);
    const archerRules = state.rules.units.archer;
    const spot = { x: 60.5, y: 60.5 };
    const archer: Entity = {
      id: state.nextId++, kind: 'archer', owner: 1, position: { ...spot },
      hp: archerRules.hp, maxHp: archerRules.hp, radius: archerRules.radius,
      activity: 'idle', order: { kind: 'idle' },
    };
    state.entities.push(archer);
    const victim = state.entities.find(e => e.owner === 2 && e.kind === 'villager')!;
    victim.position = { x: spot.x + range, y: spot.y };
    return { state, archer, victim };
  }

  it('takes each shooter\'s own accuracy from the imported content', () => {
    // The field existed on the rules before this was checked and nothing ever
    // read it out of the manifest, so every shooter silently fell back to a
    // perfect 100 and the miss could not happen. Assert the numbers arrive.
    if (!importedRules) return; // open-content checkout
    expect(importedRules.units.archer.accuracyPercent).toBe(80);
    expect(importedRules.units.skirmisher.accuracyPercent).toBe(90);
    expect(importedRules.units.longbowman.accuracyPercent).toBe(70);
    expect(importedRules.units['cavalry-archer'].accuracyPercent).toBe(50);
    expect(importedRules.buildings['watch-tower'].attack?.accuracyPercent).toBe(100);
  });

  it('hits a target that stands still', () => {
    // The archer's own accuracy is 80, so a few of these go wide; over a run
    // of shots a standing target is hit again and again.
    const { state, archer, victim } = duel(81);
    victim.hp = 100_000;
    victim.maxHp = 100_000;
    applyCommand(state, {
      kind: 'order', player: 1, entityIds: [archer.id], target: victim.position, targetId: victim.id,
    });
    const before = victim.hp;
    for (let i = 0; i < 600; i++) {
      stepGame(state);
      victim.position = { x: archer.position.x + 3.5, y: archer.position.y }; // pinned
    }
    expect(victim.hp).toBeLessThan(before);
  });

  it('misses a target that keeps walking across the shot', () => {
    // The reference: without Ballistics a shot goes to where the target stood
    // when it was loosed, so anything not walking along the line of fire is
    // missed. This is the whole reason that technology exists.
    const { state, archer, victim } = duel(82);
    victim.hp = 100_000;
    victim.maxHp = 100_000;
    const speed = state.rules.units.villager.speed;
    applyCommand(state, {
      kind: 'order', player: 1, entityIds: [archer.id], target: victim.position, targetId: victim.id,
    });
    const before = victim.hp;
    let shots = 0;
    for (let i = 0; i < 600; i++) {
      shots = Math.max(shots, state.projectiles.length);
      stepGame(state);
      // Walked steadily across the line of fire, at its own pace.
      victim.position = {
        x: archer.position.x + 3.5,
        y: victim.position.y + speed * TICK_SECONDS,
      };
      victim.activity = 'moving';
    }
    expect(shots, 'the archer never loosed at all').toBeGreaterThan(0);
    expect(victim.hp, 'a walking target was hit anyway').toBe(before);
  });

  it('hits a walking target once Ballistics is researched, and not before', () => {
    // The whole of what that technology is. A watch tower, whose own accuracy
    // is 100 so nothing else can explain a miss, shoots at a villager walking
    // straight past it four tiles out. Same seed, same walk, same fifteen
    // shots; the only difference is the research.
    if (!importedRules) return;
    const walkPast = (ballistics: boolean): { damage: number; shots: number } => {
      const state = createGame(84, importedRules);
      state.players[1].age = 2;
      if (ballistics) state.players[1].researched.push('ballistics');
      const towerRules = state.rules.buildings['watch-tower'];
      const tower: Entity = {
        id: state.nextId++, kind: 'watch-tower', owner: 1, position: { x: 60.5, y: 60.5 },
        hp: towerRules.hp, maxHp: towerRules.hp, radius: towerRules.radius,
        activity: 'idle', order: { kind: 'idle' },
      };
      state.entities.push(tower);
      const victim = state.entities.find(e => e.owner === 2 && e.kind === 'villager')!;
      victim.position = { x: 64.5, y: 54.5 };
      victim.hp = 1_000_000;
      victim.maxHp = 1_000_000;
      applyCommand(state, {
        kind: 'order', player: 2, entityIds: [victim.id], target: { x: 64.5, y: 70.5 },
      });
      const before = victim.hp;
      const seen = new Set<number>();
      for (let i = 0; i < 1200; i++) {
        stepGame(state);
        for (const shot of state.projectiles) seen.add(shot.id);
      }
      return { damage: before - victim.hp, shots: seen.size };
    };
    const without = walkPast(false);
    const with_ = walkPast(true);
    expect(without.shots, 'the tower never shot').toBeGreaterThan(5);
    expect(with_.shots, 'a different number of shots is not a fair comparison')
      .toBe(without.shots);
    expect(without.damage, 'a walking target was hit without Ballistics').toBe(0);
    expect(with_.damage, 'Ballistics did not help').toBeGreaterThan(0);
  });

  it('hits a target walking straight at the shooter', () => {
    // Also the reference: a unit closing on the archer stays on the line the
    // arrow travels, so it runs onto the shot rather than out of it.
    const { state, archer, victim } = duel(83, 3.5);
    victim.hp = 100_000;
    victim.maxHp = 100_000;
    const speed = state.rules.units.villager.speed;
    applyCommand(state, {
      kind: 'order', player: 1, entityIds: [archer.id], target: victim.position, targetId: victim.id,
    });
    const before = victim.hp;
    for (let i = 0; i < 600; i++) {
      stepGame(state);
      const gap = victim.position.x - archer.position.x;
      victim.position = {
        x: archer.position.x + (gap > 1 ? gap - speed * TICK_SECONDS : 3.5),
        y: archer.position.y,
      };
      victim.activity = 'moving';
    }
    expect(victim.hp).toBeLessThan(before);
  });
});

describe('civilisations', () => {
  it('starts both players on the civilisation the content was imported for', () => {
    const state = createGame(91, importedRules ?? FALLBACK_RULES);
    expect(state.players[1].civilization).toBe(state.rules.civilization.key);
    expect(state.players[2].civilization).toBe(state.rules.civilization.key);
    if (importedRules) {
      // The DAT calls them the British; everything else calls them the Britons.
      expect(importedRules.civilization.key).toBe('britons');
      expect(importedRules.civilization.name).toBe('British');
    }
  });

  it('offers nothing the civilisation does not actually have', () => {
    // The depot's own tech tree marks what a civilisation is missing. Anything
    // researchable or trainable here must not be on that list, or a player
    // would be offered something and then refused it.
    if (!importedRules) return;
    const missing = importedRules.civilization.unavailable;
    for (const [key, tech] of Object.entries(importedRules.technologies)) {
      expect(missing.technologies, `${key} is not in the Britons' tree`).not.toContain(tech.techId);
    }
    for (const [kind, rules] of Object.entries(importedRules.units)) {
      if (rules.datId === undefined) continue;
      expect(missing.units, `${kind} is not in the Britons' tree`).not.toContain(rules.datId);
    }
    for (const [kind, rules] of Object.entries(importedRules.buildings)) {
      if (rules.datId === undefined || !rules.buildable) continue;
      expect(missing.buildings, `${kind} is not in the Britons' tree`).not.toContain(rules.datId);
    }
  });

  it('refuses a unit its civilisation was never given', () => {
    // Driven through applyCommand rather than the predicate, because that is
    // the layer a player meets. The Britons do have the militia; withhold it
    // and the barracks must say so.
    if (!importedRules) return;
    const withheld: GameRules = {
      ...importedRules,
      civilization: {
        ...importedRules.civilization,
        unavailable: {
          ...importedRules.civilization.unavailable,
          units: [...importedRules.civilization.unavailable.units, importedRules.units.militia.datId!],
        },
      },
    };
    const state = createGame(92, withheld);
    const barracks: Entity = {
      id: state.nextId++, kind: 'barracks', owner: 1, position: { x: 60.5, y: 60.5 },
      hp: 1200, maxHp: 1200, radius: withheld.buildings.barracks.radius,
      activity: 'idle', order: { kind: 'idle' },
    };
    state.entities.push(barracks);
    Object.assign(state.players[1], { food: 5000, wood: 5000, populationCap: 100 });
    const refused = applyCommand(state, {
      kind: 'train', player: 1, buildingId: barracks.id, unit: 'militia',
    });
    expect(refused.ok).toBe(false);
    expect(refused.ok ? '' : refused.reason).toContain('British');

    // ...and the same barracks under the real tree trains it.
    const normal = createGame(92, importedRules);
    const ok: Entity = { ...barracks, id: normal.nextId++ };
    normal.entities.push(ok);
    Object.assign(normal.players[1], { food: 5000, wood: 5000, populationCap: 100 });
    expect(applyCommand(normal, {
      kind: 'train', player: 1, buildingId: ok.id, unit: 'militia',
    }).ok).toBe(true);
  });
});

describe('a match record carries who was playing', () => {
  it('round-trips the civilisations through the schema and a replay', async () => {
    // A replay rebuilds the match from the record alone, and a civilisation
    // decides what may be researched — so a record that omits it would replay
    // a different game the moment two sides differ.
    const { runMatch, replayRecord } = await import('../headless/runner');
    const { builtinStrategy } = await import('../headless/strategies');
    const { validateMatchRecord, explain } = await import('../protocol/validate');
    const rules = importedRules ?? FALLBACK_RULES;
    const config = {
      version: 1 as const, seed: 5, maxTimeSeconds: 30, decideIntervalSeconds: 1,
      civilizations: { 1: rules.civilization.key, 2: rules.civilization.key },
    };
    const { record } = await runMatch(config, { 1: builtinStrategy(), 2: { decide: () => [] } }, rules);
    expect(validateMatchRecord(record), explain(validateMatchRecord)).toBe(true);
    expect(record.civilizations).toEqual(config.civilizations);
    const outcome = replayRecord(record, rules);
    expect(outcome.ok, `replay diverged at tick ${outcome.mismatchTick}`).toBe(true);
    expect(outcome.checked).toBeGreaterThan(0);
  });
});

describe('the technology tree', () => {
  const plantBuilding = (state: GameState, kind: BuildingKind): Entity => {
    const rules = state.rules.buildings[kind];
    const entity: Entity = {
      id: state.nextId++, kind, owner: 1, position: { x: 55.5 + state.nextId % 7, y: 55.5 },
      hp: rules.hp, maxHp: rules.hp, radius: rules.radius,
      activity: 'idle', order: { kind: 'idle' },
    };
    state.entities.push(entity);
    return entity;
  };

  /** Research `key` to completion, returning the command's own verdict. */
  const research = (state: GameState, key: string) => {
    const tech = state.rules.technologies[key];
    const building = plantBuilding(state, tech.researchedAt);
    Object.assign(state.players[1], { food: 9000, wood: 9000, gold: 9000, stone: 9000 });
    const started = applyCommand(state, {
      kind: 'research', player: 1, buildingId: building.id, tech: key,
    });
    if (!started.ok) return started;
    for (let i = 0; i < 20_000 && !state.players[1].researched.includes(key); i++) stepGame(state);
    return started;
  };

  it('takes its whole list from the civilisation tree, not from a table here', () => {
    if (!importedRules) return;
    const keys = Object.keys(importedRules.technologies);
    // Three were hand-written before; the tree carries the blacksmith lines,
    // the economy technologies and the ages.
    expect(keys.length).toBeGreaterThan(30);
    for (const expected of ['loom', 'feudal-age', 'castle-age', 'forging', 'fletching',
      'scale-mail-armor', 'padded-archer-armor', 'wheelbarrow', 'double-bit-axe']) {
      expect(keys, `${expected} is missing`).toContain(expected);
    }
  });

  it('refuses a technology before its age and applies it after', () => {
    if (!importedRules) return;
    for (const key of ['forging', 'fletching', 'wheelbarrow']) {
      const early = createGame(51, importedRules);
      const tech = early.rules.technologies[key];
      expect(tech.requiresAge, `${key} should not be a Dark Age technology`).toBeGreaterThan(0);
      const refused = research(early, key);
      expect(refused.ok, `${key} was allowed in the Dark Age`).toBe(false);
      expect(refused.ok ? '' : refused.reason).toContain('later age');

      const state = createGame(51, importedRules);
      state.players[1].age = tech.requiresAge;
      expect(research(state, key).ok, `${key} was refused in its own age`).toBe(true);
      expect(state.players[1].researched).toContain(key);
    }
  });

  it.skipIf(!importedRules)('town watch makes a building see further (issue #29)', () => {
    // Measured at the outcome -- the tile the player can see -- not at the
    // rules table, because #26 proved a lookup can be right while nothing
    // reads it. On seed 51 the town center stands at (30,60) with 8 tiles of
    // sight and its villagers to the east; tile (20,60) is ~9.5 tiles west,
    // beyond base sight, inside the +4 Town Watch grants, and away from
    // anything that wanders.
    const state = createGame(51, importedRules!);
    state.players[1].age = state.rules.technologies['town-watch'].requiresAge;
    const tc = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
    stepGame(state);
    expect(isTileVisible(state, 1, 20, 60)).toBe(false);
    Object.assign(state.players[1], { food: 9000, wood: 9000, gold: 9000, stone: 9000 });
    expect(applyCommand(state, {
      kind: 'research', player: 1, buildingId: tc.id, tech: 'town-watch',
    }).ok).toBe(true);
    for (let i = 0; i < 20_000 && !state.players[1].researched.includes('town-watch'); i++) {
      stepGame(state);
    }
    expect(state.players[1].researched).toContain('town-watch');
    stepGame(state);
    expect(isTileVisible(state, 1, 20, 60)).toBe(true);
  });

  it.skipIf(!importedRules)('replays identically across town watch', () => {
    const play = () => {
      const state = createGame(51, importedRules);
      state.players[1].age = 1;
      state.players[1].researched.push('town-watch');
      for (let i = 0; i < 400; i++) stepGame(state);
      return checksumState(state);
    };
    expect(play()).toBe(play());
  });

  it('opens the university, and the university opens Ballistics', () => {
    // The building was left out because it trains nothing; the technologies
    // are the reason to build it. Ballistics is 300 wood and 175 gold at the
    // university in the Castle Age, which is what the DAT says.
    if (!importedRules) return;
    const ballistics = importedRules.technologies.ballistics;
    expect(ballistics, 'Ballistics is not researchable').toBeDefined();
    expect(ballistics.researchedAt).toBe('university');
    expect(ballistics.requiresAge).toBe(2);
    expect(ballistics.cost).toMatchObject({ wood: 300, gold: 175 });
    expect(ballistics.effects).toEqual([
      { unit: 'arrow', attribute: 'leadsTarget', operation: 'set', amount: 1 },
    ]);
    expect(importedRules.buildings.university.buildable).toBe(true);
    expect(importedRules.buildings.university.age).toBe(2);
  });

  it('will not take a technology before the one it follows', () => {
    // The DAT states each technology's own requirements, and without them a
    // player could research Blast Furnace without ever taking Forging and
    // collect the same bonus for a third of the clicks.
    if (!importedRules) return;
    const state = createGame(57, importedRules);
    state.players[1].age = 3;
    const early = research(state, 'iron-casting');
    expect(early.ok).toBe(false);
    expect(early.ok ? '' : early.reason).toContain('forging');

    expect(research(state, 'forging').ok).toBe(true);
    expect(research(state, 'iron-casting').ok).toBe(true);
    expect(state.players[1].researched).toEqual(expect.arrayContaining(['forging', 'iron-casting']));
  });

  it('gives Forging the melee attack the DAT says it gives', () => {
    if (!importedRules) return;
    const state = createGame(52, importedRules);
    state.players[1].age = 1;
    const meleeBefore = unitRulesFor(state, 1, 'militia').attacks.find(a => a.class === 4)!.amount;
    expect(research(state, 'forging').ok).toBe(true);
    const meleeAfter = unitRulesFor(state, 1, 'militia').attacks.find(a => a.class === 4)!.amount;
    expect(meleeAfter).toBe(meleeBefore + 1);
    // The other side never researched it.
    expect(unitRulesFor(state, 2, 'militia').attacks.find(a => a.class === 4)!.amount)
      .toBe(meleeBefore);
  });

  it('gives Fletching the range and pierce attack the DAT says it gives', () => {
    if (!importedRules) return;
    const state = createGame(53, importedRules);
    state.players[1].age = 1;
    const before = unitRulesFor(state, 1, 'archer');
    const pierceBefore = before.attacks.find(a => a.class === 3)!.amount;
    const rangeBefore = before.range!;
    expect(research(state, 'fletching').ok).toBe(true);
    const after = unitRulesFor(state, 1, 'archer');
    expect(after.attacks.find(a => a.class === 3)!.amount).toBe(pierceBefore + 1);
    expect(after.range).toBe(rangeBefore + 1);
    expect(after.lineOfSight).toBe(before.lineOfSight + 1);
  });

  it('makes Wheelbarrow move and carry more', () => {
    if (!importedRules) return;
    const state = createGame(54, importedRules);
    state.players[1].age = 1;
    const speedBefore = unitRulesFor(state, 1, 'villager').speed;
    const carryBefore = carryCapacityFor(state, 1);
    expect(research(state, 'wheelbarrow').ok).toBe(true);
    expect(unitRulesFor(state, 1, 'villager').speed).toBeCloseTo(speedBefore * 1.1, 6);
    expect(carryCapacityFor(state, 1)).toBeGreaterThan(carryBefore);
  });

  it('raises the hit points of what is already standing, and of what comes next', () => {
    if (!importedRules) return;
    const state = createGame(55, importedRules);
    const standing = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
    const before = standing.maxHp;
    expect(research(state, 'loom').ok).toBe(true);
    expect(standing.maxHp).toBe(before + 15);
    expect(standing.hp).toBe(before + 15);
    expect(unitRulesFor(state, 1, 'villager').hp).toBe(before + 15);
  });

  it('replays identically across a research it never had before', () => {
    if (!importedRules) return;
    const play = (): string => {
      const state = createGame(56, importedRules);
      state.players[1].age = 1;
      research(state, 'fletching');
      for (let i = 0; i < 400; i++) stepGame(state);
      return checksumState(state);
    };
    expect(play()).toBe(play());
  });
});

describe('what a razing leaves behind', () => {
  it('keeps a corpse for as long as the DAT says, never less than its death', () => {
    // A building's collapse runs 8.3 seconds and a castle's 12.5, against the
    // flat 3-second window everything used to get — so a razed barracks
    // vanished a third of the way through falling down and never reached the
    // rubble the DAT names for it. The lifetime is stated on the corpse unit:
    // a type-12 resource storage draining at its own rate, 300 seconds for
    // every unit in the file and 60 for every building's rubble.
    if (!importedRules) return;
    expect(importedRules.buildings.barracks.deathSeconds).toBeGreaterThan(8);
    expect(importedRules.buildings.barracks.corpseSeconds).toBe(60);
    expect(importedRules.units.militia.corpseSeconds).toBe(300);

    const state = createGame(61, importedRules);
    const rules = state.rules.buildings.barracks;
    const barracks: Entity = {
      id: state.nextId++, kind: 'barracks', owner: 1, position: { x: 58.5, y: 58.5 },
      hp: 1, maxHp: rules.hp, radius: rules.radius,
      activity: 'idle', order: { kind: 'idle' },
    };
    state.entities.push(barracks);
    // Killed the way anything is killed, by being hit until it falls.
    const enemy = state.entities.find(e => e.owner === 2 && e.kind === 'militia')
      ?? state.entities.find(e => e.owner === 2 && e.kind === 'villager')!;
    enemy.position = { x: 57, y: 58.5 };
    applyCommand(state, {
      kind: 'order', player: 2, entityIds: [enemy.id],
      target: barracks.position, targetId: barracks.id,
    });
    for (let i = 0; i < 4000 && !barracks.dead; i++) stepGame(state);
    expect(barracks.dead, 'the barracks never fell').toBe(true);

    // Long enough to finish falling down, and then to lie there.
    // Read a tick or two into the collapse, so allow for what has ticked off.
    const window = barracks.decayTicks! / TICKS_PER_SECOND;
    expect(window).toBeGreaterThanOrEqual(rules.deathSeconds!);
    expect(window).toBeCloseTo(rules.corpseSeconds!, 0);

    // Still there once the collapse has played out, which is what the old
    // three-second window could not manage.
    for (let i = 0; i < Math.ceil(rules.deathSeconds! * TICKS_PER_SECOND) + 1; i++) stepGame(state);
    expect(state.entities.some(e => e.id === barracks.id), 'gone mid-collapse').toBe(true);
  });

  it('gives every building rubble of its own to leave', () => {
    if (!importedRules) return;
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as ContentManifest;
    for (const [key, rules] of Object.entries(importedRules.buildings)) {
      if (!rules.datId) continue;
      const entity = manifest.entities[key];
      if (!entity) continue;
      expect(Object.keys(entity.animations ?? {}), `${key} leaves nothing`).toContain('decay');
    }
  });
});

describe('a tower has a minimum range, and Murder Holes takes it away', () => {
  const towerAndVictim = (murderHoles: boolean) => {
    const state = createGame(93, importedRules!);
    state.players[1].age = 2;
    if (murderHoles) state.players[1].researched.push('murder-holes');
    const rules = state.rules.buildings['watch-tower'];
    const tower: Entity = {
      id: state.nextId++, kind: 'watch-tower', owner: 1, position: { x: 62.5, y: 62.5 },
      hp: rules.hp, maxHp: rules.hp, radius: rules.radius,
      activity: 'idle', order: { kind: 'idle' },
    };
    state.entities.push(tower);
    const victim = state.entities.find(e => e.owner === 2 && e.kind === 'villager')!;
    // Stood against the wall, inside the DAT's one-tile minimum.
    victim.position = { x: 63.2, y: 62.5 };
    victim.hp = 100_000;
    victim.maxHp = 100_000;
    const before = victim.hp;
    for (let i = 0; i < 600; i++) {
      stepGame(state);
      victim.position = { x: 63.2, y: 62.5 };
    }
    return before - victim.hp;
  };

  it('will not shoot somebody stood against its wall', () => {
    if (!importedRules) return;
    // The DAT gives a watch tower and a castle a tile of minimum range, and
    // nothing read it: `tooClose` answered false for every building.
    expect(importedRules.buildings['watch-tower'].attack?.minRange).toBe(1);
    expect(towerAndVictim(false)).toBe(0);
  });

  it('shoots them once Murder Holes is researched', () => {
    if (!importedRules) return;
    const holes = importedRules.technologies['murder-holes'];
    expect(holes, 'Murder Holes is not researchable').toBeDefined();
    expect(holes.effects.some(e => e.unit === 'watch-tower' && e.attribute === 'minRange'
      && e.operation === 'set' && e.amount === 0)).toBe(true);
    expect(towerAndVictim(true)).toBeGreaterThan(0);
  });
});

describe('the built-in strategy', () => {
  /** Run the example AI for one side for `seconds`, deciding once a second. */
  const play = async (state: GameState, seconds: number) => {
    const { exampleAiCommands } = await import('./ai');
    const { observe } = await import('./observe');
    for (let tick = 0; tick < seconds * TICKS_PER_SECOND; tick++) {
      if (tick % TICKS_PER_SECOND === 0) {
        for (const command of exampleAiCommands(observe(state, 1))) applyCommand(state, command);
      }
      stepGame(state);
    }
  };

  it('claims and works a sheep', async () => {
    // It used to pick gather targets by `kind === 'resource'`, and an animal
    // is not one — so the whole Dark Age food opening was invisible to it.
    const state = createGame(1, importedRules ?? FALLBACK_RULES);
    const sheep = state.entities.filter(e => e.kind === 'sheep').length;
    expect(sheep, 'the map put no sheep out').toBeGreaterThan(0);
    await play(state, 8 * 60);
    const claimed = state.entities.filter(e => e.kind === 'sheep' && e.owner === 1);
    expect(claimed.length, 'no sheep was ever claimed').toBeGreaterThan(0);
    const eaten = state.entities.filter(
      e => e.kind === 'sheep' && (e.amount ?? Infinity) < (importedRules?.units.sheep.foodAmount ?? 100),
    );
    expect(eaten.length, 'a sheep was claimed but never eaten').toBeGreaterThan(0);
  }, 30_000);

  it('researches its way out of the Dark Age when it can afford to', async () => {
    // The whole of N1: the strategy had no notion of research at all, so the
    // market, the archery range, the stable, the blacksmith, the monastery,
    // the siege workshop and the castle were out of its reach for ever. How
    // long its economy takes to find five hundred food is a separate question
    // and a batch measures that; this asks whether it spends it.
    const state = createGame(1, importedRules ?? FALLBACK_RULES);
    state.players[1].food = 600;
    await play(state, 3 * 60);
    expect(state.players[1].researched, 'never left the Dark Age').toContain('feudal-age');
    expect(state.players[1].age).toBeGreaterThanOrEqual(1);
  }, 30_000);

  it('builds what the new age opened rather than fighting on with militia', async () => {
    // An age nothing uses is a number. Reaching the Feudal Age and then
    // fielding Dark Age militia for the rest of the match is most of it wasted.
    const state = createGame(1, importedRules ?? FALLBACK_RULES);
    Object.assign(state.players[1], { food: 900, wood: 900, gold: 400 });
    // The range needs a barracks, in AoE2 and here: its tree node links to
    // one. Stand it up rather than waiting out the economy that buys it.
    const barracksRules = state.rules.buildings.barracks;
    const tc = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
    state.entities.push({
      id: state.nextId++, kind: 'barracks', owner: 1,
      position: { x: tc.position.x + 6, y: tc.position.y + 6 },
      hp: barracksRules.hp, maxHp: barracksRules.hp, radius: barracksRules.radius,
      activity: 'idle', order: { kind: 'idle' },
    });
    await play(state, 6 * 60);
    expect(state.players[1].age).toBeGreaterThanOrEqual(1);
    expect(state.entities.some(e => e.owner === 1 && e.kind === 'archery-range'),
      'never built an archery range').toBe(true);
  }, 40_000);
});

describe('unit upgrades', () => {
  it('turns every militia into a man-at-arms, wounds and all', () => {
    // An upgrade is not a modifier. AoE2 replaces the unit, so a militia
    // standing on the map becomes a man-at-arms where it stands — and being
    // promoted is not a heal: it keeps the damage it had taken.
    if (!importedRules) return;
    const state = createGame(64, importedRules);
    state.players[1].age = 1;
    Object.assign(state.players[1], { food: 9000, gold: 9000, wood: 9000 });
    const rules = state.rules.buildings.barracks;
    const barracks: Entity = {
      id: state.nextId++, kind: 'barracks', owner: 1, position: { x: 56.5, y: 56.5 },
      hp: rules.hp, maxHp: rules.hp, radius: rules.radius,
      activity: 'idle', order: { kind: 'idle' },
    };
    state.entities.push(barracks);
    const militiaRules = state.rules.units.militia;
    const hurt: Entity = {
      id: state.nextId++, kind: 'militia', owner: 1, position: { x: 54.5, y: 56.5 },
      hp: militiaRules.hp - 12, maxHp: militiaRules.hp, radius: militiaRules.radius,
      activity: 'idle', order: { kind: 'idle' },
    };
    state.entities.push(hurt);

    expect(applyCommand(state, {
      kind: 'research', player: 1, buildingId: barracks.id, tech: 'man-at-arms',
    }).ok).toBe(true);
    for (let i = 0; i < 4000 && !state.players[1].researched.includes('man-at-arms'); i++) {
      stepGame(state);
    }
    expect(state.players[1].researched).toContain('man-at-arms');

    const promoted = state.entities.find(e => e.id === hurt.id)!;
    expect(promoted.kind).toBe('man-at-arms');
    const upgraded = state.rules.units['man-at-arms'];
    expect(promoted.maxHp).toBe(upgraded.hp);
    expect(upgraded.hp - promoted.hp, 'promotion healed it').toBe(12);
    // ...and it hits harder, which is the point of the upgrade.
    const before = militiaRules.attacks.find(a => a.class === 4)!.amount;
    expect(upgraded.attacks.find(a => a.class === 4)!.amount).toBeGreaterThan(before);
  });

  it('stops the barracks offering what it has upgraded past', () => {
    if (!importedRules) return;
    const state = createGame(65, importedRules);
    state.players[1].age = 1;
    Object.assign(state.players[1], { food: 9000, gold: 9000, populationCap: 50 });
    const rules = state.rules.buildings.barracks;
    const barracks: Entity = {
      id: state.nextId++, kind: 'barracks', owner: 1, position: { x: 56.5, y: 56.5 },
      hp: rules.hp, maxHp: rules.hp, radius: rules.radius,
      activity: 'idle', order: { kind: 'idle' },
    };
    state.entities.push(barracks);
    // Before: the militia is what it trains, and the man-at-arms does not
    // exist yet however much you can afford it.
    expect(applyCommand(state, {
      kind: 'train', player: 1, buildingId: barracks.id, unit: 'militia',
    }).ok).toBe(true);
    barracks.training = undefined;
    const early = applyCommand(state, {
      kind: 'train', player: 1, buildingId: barracks.id, unit: 'man-at-arms',
    });
    expect(early.ok).toBe(false);
    expect(early.ok ? '' : early.reason).toContain('upgrade');

    state.players[1].researched.push('man-at-arms');
    barracks.training = undefined;
    const late = applyCommand(state, {
      kind: 'train', player: 1, buildingId: barracks.id, unit: 'militia',
    });
    expect(late.ok, 'the militia was still on offer after the upgrade').toBe(false);
    barracks.training = undefined;
    expect(applyCommand(state, {
      kind: 'train', player: 1, buildingId: barracks.id, unit: 'man-at-arms',
    }).ok).toBe(true);
  });
});
