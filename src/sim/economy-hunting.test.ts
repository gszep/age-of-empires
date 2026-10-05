import { describe, expect, it } from 'vitest';
import { applyCommand, createGame, isCarcass, stepGame } from './game';
import type { Entity, GameState } from './types';
import { run, distanceBetween } from './test-helpers/economy';


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
