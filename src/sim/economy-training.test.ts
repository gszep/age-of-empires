import { describe, expect, it } from 'vitest';
import { FALLBACK_RULES, TICKS_PER_SECOND } from './data';
import { checksumState } from './checksum';
import { TRAINING_QUEUE_LIMIT, applyCommand, createGame, placementLegal, queuedCount, stepGame } from './game';
import type { BuildingKind, Entity, GameState } from './types';
import { run, villagerOf, nodeOf, freeSpot } from './test-helpers/economy';


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

describe('a building\'s training queue', () => {
  // Issue #7: up to fifteen units may wait at one building, each paid for when
  // it is asked for, as AoE2 does -- and each refundable, which is what makes
  // a queue safe to fill.
  const centre = (state: GameState) =>
    state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;

  /**
   * Room to train into. The houses are what keeps the cap high once the game
   * recomputes it -- which it does whenever a unit spawns or a building
   * finishes, not on a bare tick -- and the direct set makes the fixture's
   * extra housing visible before any of that.
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

  it('cancels a chosen middle entry and restarts the next unit after cancelling the active one', () => {
    const state = createGame(142);
    const tc = centre(state);
    // A mixed producer fixture makes removing the wrong index observable.
    tc.training = { kind: 'militia', remainingTicks: 17 };
    tc.trainingQueue = ['archer', 'villager', 'spearman'];
    const before = { ...state.players[1] };
    expect(applyCommand(state, { kind: 'cancel-train', player: 1, buildingId: tc.id, index: 2 }).ok).toBe(true);
    expect(tc.training).toEqual({ kind: 'militia', remainingTicks: 17 });
    expect(tc.trainingQueue).toEqual(['archer', 'spearman']);
    expect(state.players[1].food).toBe(before.food + FALLBACK_RULES.units.villager.cost.food);
    expect(applyCommand(state, { kind: 'cancel-train', player: 1, buildingId: tc.id, index: 0 }).ok).toBe(true);
    expect(tc.training).toEqual({ kind: 'archer', remainingTicks: Math.round(FALLBACK_RULES.units.archer.trainSeconds * TICKS_PER_SECOND) });
    expect(tc.trainingQueue).toEqual(['spearman']);
    expect(state.players[1].gold).toBe(before.gold + FALLBACK_RULES.units.militia.cost.gold);
    for (const index of [-1, 0.5, 2, NaN]) {
      expect(applyCommand(state, { kind: 'cancel-train', player: 1, buildingId: tc.id, index }).ok).toBe(false);
    }
    expect(applyCommand(state, { kind: 'cancel-train', player: 2, buildingId: tc.id, index: 0 }).ok).toBe(false);
    expect(tc.trainingQueue).toEqual(['spearman']);
  });

  it('lets the queue outgrow the population cap', () => {
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
      .toEqual({ ok: true });
    expect(queuedCount(tc)).toBe(room + 1);
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
