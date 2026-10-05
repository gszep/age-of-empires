import { describe, expect, it } from 'vitest';
import { FALLBACK_RULES } from './data';
import { checksumState } from './checksum';
import { applyCommand, createGame, farmFoodAmountFor, stepGame } from './game';
import type { Entity, GameState } from './types';
import { importedRules, run, villagerOf, freeSpot } from './test-helpers/economy';


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
