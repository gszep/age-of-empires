import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FALLBACK_RULES, isAnimal, rulesFromManifest, type ContentManifest, type GameRules } from './data';
import { checksumState } from './checksum';
import { applyCommand, buildingFootprint, createGame, placementLegal, stepGame } from './game';
import type { BuildingKind, Entity, GameState, ResourceKind } from './types';

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

  it('spends an arrow whose target dies mid-flight', () => {
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

    victim.hp = 0;
    victim.dead = true;
    stepGame(state);
    // No target left to hit, so the arrow is dropped rather than retargeted.
    expect(state.projectiles.length).toBe(0);
  });
});

describe('technologies', () => {
  const townCenter = (state: GameState) =>
    state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;

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

  it('sends a deer running from anything that is not gaia', () => {
    const state = createGame(33);
    const deer = animalOf(state, 'deer');
    const villager = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
    villager.position = { x: deer.position.x + 1.5, y: deer.position.y };
    const gap = () => Math.hypot(deer.position.x - villager.position.x, deer.position.y - villager.position.y);
    const before = gap();
    run(state, 60);
    expect(gap()).toBeGreaterThan(before);
    expect(deer.owner).toBe(0);
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
    expect(trainedHere).toEqual(['archer', 'cavalry-archer', 'skirmisher']);
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
