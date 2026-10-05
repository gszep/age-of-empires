import { describe, expect, it } from 'vitest';
import { FALLBACK_RULES } from './data';
import { checksumState } from './checksum';
import { applyCommand, carryCapacityFor, createGame, placementLegal, stepGame } from './game';
import type { GameState } from './types';
import { importedRules, run, inFeudal, villagerOf, nodeOf, becomeIdleFor, distanceBetween, parkScouts, totalOf, freeSpot } from './test-helpers/economy';


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

  it('takes the next tree after a walk back longer than the stump lasts', () => {
    // Issue #32. Issue #19 gave "another of the same first" a memory of the
    // *kind* it was working, so it survived the node itself being gone -- but
    // which resource to ask for was still read off the load or off that same
    // vanished node. A spent tree is killed the tick it empties and swept out
    // of `state.entities` three seconds later, and a walk back to the drop
    // site is longer than that: the lumberjack banked its load, found neither
    // a load nor a tree to name what it wanted, and went idle at the camp.
    const state = createGame(91);
    parkScouts(state);
    const tc = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
    for (const wood of state.entities.filter(e => e.kind === 'resource' && e.resourceKind === 'wood')) {
      wood.amount = 0;
    }
    // Two trees side by side on ground that is actually clear, a walk away
    // from the only thing that takes wood. Hunting for the spot rather than
    // assuming one keeps this a test about the walk back and not about which
    // board the seed happened to deal.
    const [tree, neighbour] = state.entities
      .filter(e => e.kind === 'resource' && e.resourceKind === 'wood');
    // Near enough that the player can still see the neighbour when the
    // villager banks its load -- the continuation only considers what its
    // owner presently sees, so a tree beyond the town center's eight tiles
    // makes idle the *correct* answer and tests nothing. Far enough that the
    // walk back outlasts the three-second window a spent tree lingers for.
    let spot: { x: number; y: number } | undefined;
    for (let dx = 6; dx <= 8 && !spot; dx++) {
      for (const dy of [0, 2, -2, 4, -4]) {
        const at = { x: tc.position.x + dx, y: tc.position.y + dy };
        if (placementLegal(state, 'farm', at).ok
          && placementLegal(state, 'farm', { x: at.x + 1, y: at.y }).ok) { spot = at; break; }
      }
    }
    expect(spot, 'no clear ground for the two trees').toBeDefined();
    tree.position = { ...spot! };
    neighbour.position = { x: spot!.x + 1, y: spot!.y };
    neighbour.amount = 200;
    // Exactly one load in it, so it runs out in the same breath as the
    // villager fills up and the walk home starts with the tree already dead.
    tree.amount = carryCapacityFor(state, 1);
    const villager = villagerNear(state, { x: tc.position.x + 8, y: tc.position.y });

    applyCommand(state, {
      kind: 'order', player: 1, entityIds: [villager.id], target: tree.position, targetId: tree.id,
    });
    const banked = state.players[1].wood;
    for (let i = 0; i < 4000 && state.players[1].wood === banked; i++) stepGame(state);
    expect(state.players[1].wood).toBeGreaterThan(banked);
    expect(villager.carrying).toBeUndefined();
    // The tree is not merely empty by now: it is gone.
    expect(state.entities.some(e => e.id === tree.id)).toBe(false);

    stepGame(state);
    expect(villager.order).toEqual({ kind: 'gather', targetId: neighbour.id });
  });

  it('carries the same memory down two runs of the same match', () => {
    // The memory rides on the entity, so it is in the checksum: two runs of
    // the same opening must still agree tick for tick across the point where
    // the continuation fires.
    const play = () => {
      const state = createGame(91);
      parkScouts(state);
      const tc = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
      for (const wood of state.entities.filter(e => e.kind === 'resource' && e.resourceKind === 'wood')) {
        wood.amount = 0;
      }
      const [tree, neighbour] = state.entities
        .filter(e => e.kind === 'resource' && e.resourceKind === 'wood');
      tree.position = { x: tc.position.x + 9, y: tc.position.y };
      neighbour.position = { x: tc.position.x + 10, y: tc.position.y };
      // (The determinism twin does not need clear ground: it compares two
      // runs of whatever this is, not what the villager manages to do.)
      neighbour.amount = 200;
      tree.amount = carryCapacityFor(state, 1);
      const villager = villagerNear(state, { x: tc.position.x + 8, y: tc.position.y });
      applyCommand(state, {
        kind: 'order', player: 1, entityIds: [villager.id], target: tree.position, targetId: tree.id,
      });
      run(state, 3000);
      return checksumState(state);
    };
    expect(play()).toBe(play());
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
