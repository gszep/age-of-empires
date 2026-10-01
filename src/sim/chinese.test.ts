import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { rulesFromManifest, TICKS_PER_SECOND } from './data';
import { activateAutomaticTechnologies, applyCommand, createGame, farmFoodAmountFor, stepGame } from './game';
import { buildingRulesFor, unitRulesFor } from './rules';
import { researchCostFor } from './technologies';
import { observe } from './observe';
import { updateVisibility } from './visibility';
import { synchronizationHash } from '../shared/checksum';
import { replayRecord, runMatch, type Strategy } from '../headless/runner';
import { chooseAnimation } from '../view/sprites';
import { validateCommand, validateObservation } from '../protocol/validate';
import type { BuildingKind, Entity, GameState, PlayerId, UnitKind } from './types';

const path = process.env.CIV_PROFILE_CONTENT ?? 'public/imported/aoe2/manifest.json';
const rules = existsSync(path) ? rulesFromManifest(JSON.parse(readFileSync(path, 'utf8'))) : undefined;
if (rules?.civilizations?.chinese) rules.civilizations.chinese.civilization.enabled = true;
function arena(age = 2, water = false) {
  const s = createGame(184, rules!, { 1: 'chinese', 2: 'britons' });
  s.entities = s.entities.filter(e => e.kind === 'town-center');
  s.entities.forEach((e, i) => e.position = { x: 10 + i * 80, y: 10 });
  s.terrain.fill(water ? 23 : 0); s.elevation.fill(0);
  for (const owner of [1, 2] as const) Object.assign(s.players[owner], { age, food: 30000, wood: 30000, gold: 30000, stone: 30000 });
  activateAutomaticTechnologies(s); return s;
}
function home(s: GameState, kind: BuildingKind, owner: PlayerId = 1, x = 20, y = 20): Entity {
  const r = buildingRulesFor(s, owner, kind), e: Entity = { id: s.nextId++, kind, owner, position: { x, y },
    hp: r.hp, maxHp: r.hp, radius: r.radius, activity: 'idle', order: { kind: 'idle' } };
  s.entities.push(e); activateAutomaticTechnologies(s); return e;
}
function unit(s: GameState, kind: UnitKind, owner: PlayerId = 1, x = 50, y = 50): Entity {
  const r = unitRulesFor(s, owner, kind), e: Entity = { id: s.nextId++, kind, owner, position: { x, y },
    hp: r.hp, maxHp: r.hp, radius: r.radius, activity: 'idle', order: { kind: 'idle' } };
  s.entities.push(e); return e;
}
function until(s: GameState, done: () => boolean, ticks = 8000) {
  for (let i = 0; i < ticks && !done(); i++) stepGame(s);
  expect(done()).toBe(true);
}
function order(s: GameState, actor: Entity, target: Entity) {
  updateVisibility(s);
  expect(applyCommand(s, { kind: 'order', player: actor.owner as PlayerId, entityIds: [actor.id], targetId: target.id, target: target.position })).toEqual({ ok: true });
}
function research(s: GameState, building: Entity, tech: string) {
  const owner = building.owner as PlayerId, before = { ...s.players[owner] }, cost = researchCostFor(s, owner, tech);
  const result = applyCommand(s, { kind: 'research', player: owner, buildingId: building.id, tech });
  expect(result, tech).toEqual({ ok: true });
  for (const r of ['food', 'wood', 'gold', 'stone'] as const) expect(before[r] - s.players[owner][r]).toBe(cost[r]);
  until(s, () => s.players[owner].researched.includes(tech));
}
function train(s: GameState, building: Entity, kind: UnitKind) {
  const owner = building.owner as PlayerId, first = s.nextId;
  expect(applyCommand(s, { kind: 'train', player: owner, buildingId: building.id, unit: kind }), kind).toEqual({ ok: true });
  until(s, () => s.entities.some(e => e.id >= first && e.owner === owner && e.kind === kind));
  return s.entities.find(e => e.id >= first && e.owner === owner && e.kind === kind)!;
}
function remove(s: GameState, e: Entity) {
  expect(applyCommand(s, { kind: 'delete', player: e.owner as PlayerId, entityIds: [e.id] }).ok).toBe(true);
}

describe.skipIf(!rules?.civilizations?.chinese)('owned Chinese gameplay', () => {
  it.each(['arabia', 'islands', 'black-forest'])('%s starts with six villagers, reduced resources and fifteen TC housing exactly once', map => {
    const s = createGame(184, rules!, { 1: 'chinese', 2: 'britons' }, map);
    expect(s.entities.filter(e => e.owner === 1 && e.kind === 'villager')).toHaveLength(6);
    expect(s.entities.filter(e => e.owner === 2 && e.kind === 'villager')).toHaveLength(3);
    expect(s.players[1]).toMatchObject({ food: 0, wood: 150, gold: 100, stone: 200, population: 7, populationCap: 15 });
    const saved = JSON.parse(JSON.stringify(s)); activateAutomaticTechnologies(saved);
    expect(synchronizationHash(saved)).toBe(synchronizationHash(s));
    expect(s.players[2]).toMatchObject({ food: 200, wood: 200, populationCap: 5 });
  });

  it('a newly built TC gains the housing/sight bonus without repeating the initial spawn or deductions', () => {
    const s = arena(), worker = unit(s, 'villager', 1, 39, 40), before = { ...s.players[1] };
    expect(applyCommand(s, { kind: 'build', player: 1, builderIds: [worker.id], building: 'town-center', target: { x: 42, y: 40 } }).ok).toBe(true);
    until(s, () => s.entities.filter(e => e.kind === 'town-center' && e.owner === 1 && e.buildProgress === undefined).length === 2);
    expect(s.entities.filter(e => e.owner === 1 && e.kind === 'villager')).toHaveLength(1);
    expect(s.players[1].wood).toBe(before.wood - 275); expect(s.players[1].food).toBe(before.food);
    expect(s.players[1].populationCap).toBe(30);
    updateVisibility(s);
    expect(s.visibility[1].visible[40 * s.width + 55]).toBe(1);
  });

  it.each([0, 1, 2, 3])('age%s pays the current source research discount and exposes the same price to agents', age => {
    const s = arena(age), tc = s.entities.find(e => e.owner === 1)!;
    const expected = [50, 48, 45, 43][age], gold = s.players[1].gold;
    expect(observe(s, 1).researchCosts?.loom.gold).toBe(expected);
    research(s, tc, 'loom'); expect(gold - s.players[1].gold).toBe(expected);
    expect(researchCostFor(s, 2, 'loom').gold).toBe(50);
  });

  it('paid age progression uses the old age price and activates the next discount only on completion', () => {
    const s = arena(0), tc = s.entities.find(e => e.owner === 1)!;
    home(s, 'barracks'); home(s, 'mill', 1, 28, 20); home(s, 'blacksmith', 1, 36, 20);
    home(s, 'market', 1, 44, 20); home(s, 'castle', 1, 20, 35);
    for (const [tech, food] of [['feudal-age', 500], ['castle-age', 760], ['imperial-age', 900]] as const) {
      const before = s.players[1].food; research(s, tc, tech); expect(before - s.players[1].food).toBe(food);
    }
    expect(researchCostFor(s, 1, 'loom').gold).toBe(43);
  });

  it('the farm team bonus reapplies to new crops after Horse Collar and Heavy Plow without changing old food', () => {
    const s = arena(), mill = home(s, 'mill'), worker = unit(s, 'villager', 1, 39, 40);
    const farm = (y: number) => {
      expect(applyCommand(s, { kind: 'build', player: 1, builderIds: [worker.id], building: 'farm', target: { x: 40.5, y } }).ok).toBe(true);
      const site = s.entities.find(e => e.kind === 'farm' && e.position.y === y)!;
      until(s, () => site.buildProgress === undefined);
      expect(applyCommand(s, { kind: 'stop', player: 1, entityIds: [worker.id] }).ok).toBe(true); return site;
    };
    const first = farm(40.5); expect(first.amount).toBe(193);
    research(s, mill, 'horse-collar'); expect(farm(50.5).amount).toBe(275);
    research(s, mill, 'heavy-plow'); expect(farm(60.5).amount).toBe(413);
    expect(first.amount).toBe(193); expect(farmFoodAmountFor(s, 2)).toBe(175);
    const saved = JSON.parse(JSON.stringify(s)); activateAutomaticTechnologies(saved);
    expect(farmFoodAmountFor(saved, 1)).toBe(413);
  });

  it('Great Wall reaches wounded existing towers, occupied towers, foundations and later construction', () => {
    const s = arena(), castle = home(s, 'castle'), tower = home(s, 'watch-tower', 1, 40.5, 40.5);
    const wall = home(s, 'stone-wall', 1, 50.5, 40.5), gate = home(s, 'stone-gate', 1, 60, 40.5);
    const towerHp = tower.maxHp, wallHp = wall.hp, gateHp = gate.hp;
    const passenger = unit(s, 'villager', 1, 40.5, 40.5); order(s, passenger, tower); until(s, () => !!tower.garrison?.length);
    tower.hp -= 17;
    const foundation = home(s, 'watch-tower', 1, 70.5, 40.5);
    foundation.buildProgress = .25; foundation.hp = foundation.maxHp * .25;
    research(s, castle, 'great-wall');
    expect(tower.maxHp).toBeCloseTo(towerHp * 1.3); expect(tower.maxHp - tower.hp).toBe(17);
    expect(wall.hp).toBeCloseTo(wallHp * 1.3); expect(gate.hp).toBeCloseTo(gateHp * 1.3);
    expect(foundation.maxHp).toBe(tower.maxHp); expect(foundation.hp).toBeCloseTo(tower.maxHp * .25);
    const worker = unit(s, 'villager', 1, 39, 60);
    expect(applyCommand(s, { kind: 'build', player: 1, builderIds: [worker.id], building: 'watch-tower', target: { x: 40.5, y: 60.5 } }).ok).toBe(true);
    const site = s.entities.find(e => e.kind === 'watch-tower' && e.position.y === 60.5)!;
    until(s, () => site.buildProgress === undefined); expect(site.maxHp).toBe(tower.maxHp);
    expect(buildingRulesFor(s, 2, 'watch-tower').hp).toBe(towerHp);
  });

  it.each([['dat-unit-73', 3, 14], ['dat-unit-559', 5, 22]] as const)('%s emits %s distinct arrows with primary/secondary damage', (kind, count, damage) => {
    const s = arena(3), shooter = unit(s, kind), target = unit(s, 'villager', 2, 54, 50);
    target.hp = target.maxHp = 10000; target.radius = 1;
    const first = s.nextId, hp = target.hp;
    order(s, shooter, target); until(s, () => s.nextId >= first + count);
    expect(applyCommand(s, { kind: 'stop', player: 1, entityIds: [shooter.id] }).ok).toBe(true);
    until(s, () => s.projectiles.length === 0); expect(hp - target.hp).toBe(damage);
    expect(s.nextId - first).toBe(count);
  });

  it('Chu Ko Nu training refunds and elite upgrade reach garrisons and retain a captured old tier', () => {
    const s = arena(3), castle = home(s, 'castle'), before = { ...s.players[1] };
    expect(applyCommand(s, { kind: 'train', player: 1, buildingId: castle.id, unit: 'dat-unit-73' }).ok).toBe(true);
    expect(before.wood - s.players[1].wood).toBe(40); expect(before.gold - s.players[1].gold).toBe(35);
    expect(applyCommand(s, { kind: 'cancel-train', player: 1, buildingId: castle.id }).ok).toBe(true);
    expect(s.players[1].wood).toBe(before.wood); expect(s.players[1].gold).toBe(before.gold);
    const captive = train(s, castle, 'dat-unit-73'), passenger = train(s, castle, 'dat-unit-73');
    captive.position = { x: 54, y: 50 }; captive.hp -= 7; captive.attackCooldown = 100000;
    const monk = unit(s, 'monk', 2, 46, 50); order(s, monk, captive); until(s, () => captive.owner === 2);
    order(s, passenger, castle); until(s, () => !!castle.garrison?.length);
    research(s, castle, 'elite-chu-ko-nu');
    expect(captive).toMatchObject({ kind: 'dat-unit-73', maxHp: 45, hp: 38 });
    expect(castle.garrison![0]).toMatchObject({ kind: 'dat-unit-559', maxHp: 50 });
    expect(train(s, castle, 'dat-unit-559').maxHp).toBe(50);
  });

  it('a Fire Lancer uses the firearm animation and three bullets, then fights in melee while recharging', () => {
    const s = arena(), lancer = unit(s, 'dat-unit-1901'), target = unit(s, 'knight', 2, 53.5, 50);
    target.hp = target.maxHp = 10000; target.attackCooldown = 100000;
    order(s, lancer, target); stepGame(s);
    expect(chooseAnimation(s, lancer).name).toBe('attack-special');
    until(s, () => s.projectiles.length === 3);
    expect(observe(s, 1).entities.find(e => e.id === lancer.id)?.charge?.current).toBe(0);
    expect(s.projectiles.every(p => p.art === 'dat-projectile-1925')).toBe(true);
    const saved = JSON.parse(JSON.stringify(s));
    for (let i = 0; i < 60; i++) { stepGame(s); stepGame(saved); }
    expect(synchronizationHash(saved)).toBe(synchronizationHash(s));
    expect(10000 - target.hp).toBeGreaterThanOrEqual(9);
    until(s, () => lancer.activity === 'attacking' && lancer.attackWeapon !== 'alternate');
    expect(chooseAnimation(s, lancer).name).toBe('attack');
    expect(lancer.charge).toBeLessThan(1);
    remove(s, target);
    until(s, () => lancer.charge === 1);
  });

  it('paid Elite Fire Lancer upgrades real bullet damage and both ages increase movement', () => {
    const s = arena(3), barracks = home(s, 'barracks'), lancer = train(s, barracks, 'dat-unit-1901');
    research(s, barracks, 'elite-fire-lancer'); expect(lancer.kind).toBe('dat-unit-1903');
    lancer.position = { x: 50, y: 50 }; const target = unit(s, 'knight', 2, 54, 50); target.attackCooldown = 10000;
    const hp = target.hp; order(s, lancer, target); until(s, () => s.projectiles.length === 3);
    expect(s.projectiles.every(p => p.attacks.find(a => a.class === 3)?.amount === 4)).toBe(true);
    expect(applyCommand(s, { kind: 'stop', player: 1, entityIds: [lancer.id] }).ok).toBe(true);
    until(s, () => s.projectiles.length === 0); expect(hp - target.hp).toBe(12);
    expect(unitRulesFor(s, 1, 'dat-unit-1903').speed).toBeCloseTo(.96 * 1.1, 4);
  });

  it('bullets stop at the first intervening enemy instead of piercing multiple units', () => {
    const s = arena(), lancer = unit(s, 'dat-unit-1901'), target = unit(s, 'villager', 2, 54, 50);
    const blocker = unit(s, 'villager', 2, 52, 50); blocker.hp = blocker.maxHp = 1000;
    order(s, lancer, target); until(s, () => s.projectiles.length === 3);
    expect(applyCommand(s, { kind: 'stop', player: 1, entityIds: [lancer.id] }).ok).toBe(true);
    until(s, () => s.projectiles.length === 0);
    expect(blocker.hp).toBe(991); expect(target.hp).toBe(target.maxHp);
  });

  it('Rocket Carts burst eight rockets, hit a nearby enemy, and can attack ground through the wire schema', () => {
    const s = arena(), cart = unit(s, 'dat-unit-1904'), target = unit(s, 'knight', 2, 56, 50);
    const bystander = unit(s, 'knight', 2, 56, 50.7); target.attackCooldown = bystander.attackCooldown = 100000;
    target.hp = target.maxHp = bystander.hp = bystander.maxHp = 10000;
    const command = { kind: 'attack-ground' as const, player: 1 as const, entityIds: [cart.id], target: { x: 56, y: 50 } };
    expect(validateCommand(command)).toBe(true); expect(applyCommand(s, command).ok).toBe(true);
    const first = s.nextId; until(s, () => s.nextId >= first + 8);
    expect(applyCommand(s, { kind: 'stop', player: 1, entityIds: [cart.id] }).ok).toBe(true);
    until(s, () => s.projectiles.length === 0);
    expect(10000 - target.hp).toBe(40); expect(10000 - bystander.hp).toBe(40);
    expect(validateObservation(observe(s, 1))).toBe(true);
    expect(applyCommand(s, { ...command, entityIds: [unit(s, 'villager').id] }).ok).toBe(false);
    s.players[1].civilization = 'unloaded';
    expect(applyCommand(s, command)).toEqual({ ok: false, reason: 'civilisation is not loaded for player 1' });
  });

  it('Heavy Rocket Cart and Rocketry affect live projectiles and research is owner-isolated', () => {
    const s = arena(3), workshop = home(s, 'siege-workshop'), castle = home(s, 'castle', 1, 30, 20);
    const cart = train(s, workshop, 'dat-unit-1904'); research(s, workshop, 'heavy-rocket-cart');
    expect(cart.kind).toBe('dat-unit-1907'); research(s, castle, 'rocketry');
    cart.position = { x: 50, y: 50 }; const target = unit(s, 'villager', 2, 56, 50); target.hp = target.maxHp = 10000;
    order(s, cart, target); until(s, () => !!s.projectiles.length);
    expect(s.projectiles[0].attacks.find(a => a.class === 4)?.amount).toBe(6.25);
    expect(unitRulesFor(s, 2, 'dat-unit-1907').attacks.find(a => a.class === 4)?.amount).toBe(5);
  });

  it('Lou Chuan selects arrows for units and siege shots for buildings; Rocketry swaps the arrow art and damage', () => {
    const s = arena(3, true), ship = unit(s, 'dat-unit-1948'), castle = home(s, 'castle');
    const volley = (kind: UnitKind | 'house', x: number, count: number, art: string) => {
      const target = kind === 'house' ? home(s, kind, 2, x, 50) : unit(s, kind, 2, x, 50);
      target.hp = target.maxHp = 10000; target.attackCooldown = 100000;
      const first = s.nextId; ship.attackCooldown = 0; order(s, ship, target);
      until(s, () => s.nextId >= first + count);
      expect(s.projectiles.filter(p => p.shooterId === ship.id).every(p => p.art === art)).toBe(true);
      expect(applyCommand(s, { kind: 'stop', player: 1, entityIds: [ship.id] }).ok).toBe(true);
      until(s, () => s.projectiles.length === 0); const damage = 10000 - target.hp; remove(s, target); return damage;
    };
    expect(volley('galley', 56, 10, 'dat-projectile-1936')).toBeGreaterThan(0);
    expect(volley('house', 62, 1, 'dat-projectile-1938')).toBeGreaterThan(200);
    research(s, castle, 'rocketry');
    expect(volley('galley', 56, 10, 'dat-projectile-1879')).toBeGreaterThan(0);
  });

  it('Siege Ram promotion keeps passengers and its melee splash reaches another building without self damage', () => {
    const s = arena(3), workshop = home(s, 'siege-workshop'), ram = train(s, workshop, 'battering-ram');
    const passenger = unit(s, 'militia', 1, ram.position.x, ram.position.y);
    order(s, passenger, ram); until(s, () => !!ram.garrison?.length);
    research(s, workshop, 'capped-ram'); research(s, workshop, 'siege-ram');
    expect(ram.kind).toBe('dat-unit-548'); expect(ram.garrison).toHaveLength(1);
    ram.position = { x: 50, y: 50 }; const a = home(s, 'house', 2, 52, 50), b = home(s, 'house', 2, 53, 51);
    const hp = ram.hp, aHp = a.hp, bHp = b.hp;
    order(s, ram, a); until(s, () => a.hp < aHp);
    expect(b.hp).toBeLessThan(bHp); expect(ram.hp).toBe(hp);
  });

  it('replays mixed Chinese opening commands across JSON', async () => {
    const player: Strategy = { decide({ observation: o }) {
      if (o.time !== 0) return [];
      const worker = o.entities.find(e => e.owner === o.player && e.kind === 'villager')!;
      return [{ kind: 'order', player: o.player, entityIds: [worker.id], target: { x: worker.x + 2, y: worker.y + 2 } }];
    } };
    const { record, result } = await runMatch({ version: 1, seed: 184, civilizations: { 1: 'chinese', 2: 'britons' },
      maxTimeSeconds: 20, decideIntervalSeconds: 1 }, { 1: player, 2: player }, rules!);
    expect(result.rejectedCommands).toEqual([]); expect(replayRecord(JSON.parse(JSON.stringify(record)), rules!).ok).toBe(true);
  });

  it('Dragon Ship is the free Heavy Warships descendant and carries Siphons through the upgrade', () => {
    const s = arena(3, true), dock = home(s, 'dock', 1, 30, 40), ship = train(s, dock, 'fire-galley');
    research(s, dock, 'warships'); expect(ship.kind).toBe('fire-ship');
    research(s, home(s, 'university'), 'siphons'); research(s, dock, 'heavy-warships');
    expect(ship.kind).toBe('dat-unit-1302'); expect(s.players[1].researched).toContain('dragon-ship');
    expect(train(s, dock, 'dat-unit-1302').maxHp).toBe(135);
    ship.position = { x: 50, y: 50 }; const target = unit(s, 'galley', 2, 52.5, 50); target.hp = target.maxHp = 10000;
    target.attackCooldown = 100000; order(s, ship, target);
    until(s, () => s.projectiles.some(p => p.art === 'fire-charge'));
    until(s, () => target.hp < 10000);
    expect(unitRulesFor(s, 1, 'dat-unit-1302').speed).toBeCloseTo(1.56 * 1.1, 4);
  });

  it('keeps a partially emitted rocket volley identical after JSON reload and cancels the remaining missiles on Stop', () => {
    const s = arena(), cart = unit(s, 'dat-unit-1904');
    expect(applyCommand(s, { kind: 'attack-ground', player: 1, entityIds: [cart.id], target: { x: 56, y: 50 } }).ok).toBe(true);
    until(s, () => !!cart.attackVolley && cart.attackVolley.remaining < 7);
    expect(validateObservation(observe(s, 1))).toBe(true);
    const saved = JSON.parse(JSON.stringify(s));
    for (let i = 0; i < 12; i++) { stepGame(s); stepGame(saved); }
    expect(synchronizationHash(saved)).toBe(synchronizationHash(s));
    expect(applyCommand(s, { kind: 'stop', player: 1, entityIds: [cart.id] }).ok).toBe(true);
    const next = s.nextId;
    for (let i = 0; i < 100; i++) stepGame(s);
    expect(s.nextId).toBe(next); expect(cart.attackVolley).toBeUndefined();
  });

  it('Fletching extends the Lou Chuan arrow reach, and Chemistry followed by Rocketry changes future ammunition', () => {
    const s = arena(3, true), ship = unit(s, 'dat-unit-1948'), smith = home(s, 'blacksmith');
    const university = home(s, 'university', 1, 28, 20), castle = home(s, 'castle', 1, 36, 20);
    research(s, smith, 'fletching'); research(s, smith, 'bodkin-arrow'); research(s, smith, 'bracer');
    research(s, university, 'chemistry');
    const target = unit(s, 'galley', 2, 62, 50); target.hp = target.maxHp = 10000; target.attackCooldown = 100000;
    order(s, ship, target); until(s, () => !!s.projectiles.length);
    expect(ship.position).toEqual({ x: 50, y: 50 });
    expect(s.projectiles[0].art).toBe('dat-projectile-1937');
    expect(s.projectiles[0].attacks.find(a => a.class === 3)?.amount).toBe(9);
    remove(s, target); until(s, () => s.projectiles.length === 0);
    research(s, castle, 'rocketry');
    const rival = unit(s, 'galley', 2, 62, 50); rival.hp = rival.maxHp = 10000; rival.attackCooldown = 100000;
    ship.attackCooldown = 0; order(s, ship, rival); until(s, () => !!s.projectiles.length);
    expect(s.projectiles[0].art).toBe('dat-projectile-1879');
    expect(s.projectiles[0].attacks.find(a => a.class === 3)?.amount).toBe(11);
  });

  it('Rocketry increases actual Scorpion primary damage by the owned factor', () => {
    const s = arena(3), scorpion = unit(s, 'scorpion'), castle = home(s, 'castle');
    const hit = () => {
      const target = unit(s, 'villager', 2, 56, 50), hp = target.hp;
      scorpion.attackCooldown = 0; order(s, scorpion, target); until(s, () => target.hp < hp);
      const damage = hp - target.hp;
      expect(applyCommand(s, { kind: 'stop', player: 1, entityIds: [scorpion.id] }).ok).toBe(true);
      remove(s, target); until(s, () => s.projectiles.length === 0); return damage;
    };
    const before = hit(); research(s, castle, 'rocketry'); expect(hit()).toBeCloseTo(before * 1.25);
  });

  it('switches a firearm windup to the melee animation/clock when a moving target closes inside firearm range', () => {
    const s = arena(), lancer = unit(s, 'dat-unit-1901'), target = unit(s, 'villager', 2, 51.8, 50);
    target.hp = target.maxHp = 10000;
    order(s, lancer, target);
    expect(applyCommand(s, { kind: 'order', player: 2, entityIds: [target.id], target: { x: 50.7, y: 50 } }).ok).toBe(true);
    stepGame(s); expect(lancer.attackWeapon).toBe('alternate');
    until(s, () => target.hp < 10000);
    expect(lancer.attackWeapon).toBeUndefined();
    expect(chooseAnimation(s, lancer).name).toBe('attack');
    expect(s.projectiles).toHaveLength(0);
    expect(lancer.charge).toBeUndefined(); // cancelled firearm did not spend charge
  });
});
