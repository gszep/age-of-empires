import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { rulesFromManifest, TICKS_PER_SECOND } from './data';
import { activateAutomaticTechnologies, addNode, applyCommand, canGarrison, createGame, stepGame, volleyArrows } from './game';
import { buildingRulesFor, unitRulesFor } from './rules';
import { updateVisibility } from './visibility';
import { synchronizationHash } from '../shared/checksum';
import { replayRecord, runMatch, type Strategy } from '../headless/runner';
import type { BuildingKind, Entity, GameState, PlayerId, UnitKind } from './types';

const path = process.env.CIV_PROFILE_CONTENT ?? 'public/imported/aoe2/manifest.json';
const rules = existsSync(path) ? rulesFromManifest(JSON.parse(readFileSync(path, 'utf8'))) : undefined;
if (process.env.CIV_PROFILE_CONTENT && !rules?.civilizations?.turks) throw new Error('Requested fixture has no Turks profile');
function arena(age = 2, rival = 'britons', water = false) {
  const s = createGame(188, rules!, { 1: 'turks', 2: rival });
  s.entities = s.entities.filter(e => e.kind === 'town-center');
  s.entities.forEach((e, i) => e.position = { x: 10 + i * 80, y: 10 });
  s.terrain.fill(water ? 23 : 0); s.elevation.fill(0);
  for (const owner of [1, 2] as const) Object.assign(s.players[owner], { age, food: 30000, wood: 30000, gold: 30000, stone: 30000 });
  activateAutomaticTechnologies(s); return s;
}
function home(s: GameState, kind: BuildingKind, owner: PlayerId = 1, x = 20, y = 20) {
  const r = buildingRulesFor(s, owner, kind), e: Entity = { id: s.nextId++, kind, owner, position: { x, y },
    hp: r.hp, maxHp: r.hp, radius: r.radius, activity: 'idle', order: { kind: 'idle' } };
  s.entities.push(e); activateAutomaticTechnologies(s); return e;
}
function unit(s: GameState, kind: UnitKind, owner: PlayerId = 1, x = 50, y = 50) {
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
  expect(applyCommand(s, { kind: 'order', player: actor.owner as PlayerId, entityIds: [actor.id], targetId: target.id, target: target.position }).ok).toBe(true);
}
function research(s: GameState, building: Entity, tech: string) {
  expect(applyCommand(s, { kind: 'research', player: building.owner as PlayerId, buildingId: building.id, tech }), tech).toEqual({ ok: true });
  until(s, () => s.players[building.owner as PlayerId].researched.includes(tech));
}
function train(s: GameState, building: Entity, kind: UnitKind) {
  const first = s.nextId;
  expect(applyCommand(s, { kind: 'train', player: building.owner as PlayerId, buildingId: building.id, unit: kind }), kind).toEqual({ ok: true });
  until(s, () => s.entities.some(e => e.id >= first && e.owner === building.owner && e.kind === kind));
  return s.entities.find(e => e.id >= first && e.owner === building.owner && e.kind === kind)!;
}

describe.skipIf(!rules?.civilizations?.turks)('owned Turkish gameplay', () => {
  it.each(['gold', 'stone'] as const)('%s mining changes actual extraction and banking without leaking', resource => {
      const s = arena(0), workers: Entity[] = [], mines: Entity[] = [];
      for (const owner of [1, 2] as const) {
        const x = owner === 1 ? 40 : 80;
        home(s, 'mining-camp', owner, x - 4, 40);
        const w = unit(s, 'villager', owner, x, 40);
        const mine = addNode(s, resource, { x: x + 1, y: 40 });
        workers.push(w); mines.push(mine); order(s, w, mine);
      }
      until(s, () => workers.every(w => w.activity === 'gathering'), 100);
      const extracted = (i: number) => -mines[i].amount! + (workers[i].gatherProgress ?? 0);
      const before = workers.map((_, i) => extracted(i));
      for (let i = 0; i < 10 * TICKS_PER_SECOND; i++) stepGame(s);
      expect(extracted(0) - before[0]).toBeCloseTo((extracted(1) - before[1]) * (resource === 'gold' ? 1.25 : 1));
      const bank = [s.players[1][resource], s.players[2][resource]];
      until(s, () => s.players[1][resource] > bank[0] || s.players[2][resource] > bank[1], 2000);
      expect(s.players[1][resource] - bank[0]).toBe(10);
      expect(s.players[2][resource] - bank[1]).toBe(resource === 'gold' ? 0 : 10);
      until(s, () => s.players[1][resource] > bank[0] && s.players[2][resource] > bank[1], 2000);
      expect(s.players[2][resource] - bank[1]).toBe(10);
      // Compare realised income at the same clock, not just extraction or a
      // lookup rate. Every complete deposit is the owned ten-resource load.
      for (let i = 0; i < 120 * TICKS_PER_SECOND; i++) stepGame(s);
      const deposited = [s.players[1][resource] - bank[0], s.players[2][resource] - bank[1]];
      for (const amount of deposited) expect(amount % 10).toBe(0);
      if (resource === 'gold') expect(deposited[0] - deposited[1]).toBeGreaterThanOrEqual(10);
      else expect(deposited[0]).toBe(deposited[1]);
  });

  it('age commands grant free cavalry upgrades and Chemistry exactly once, without paying their ordinary prices', () => {
    const s = arena(1, 'byzantines'), tc = s.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
    const otherTc = s.entities.find(e => e.owner === 2 && e.kind === 'town-center')!;
    home(s, 'market', 1, 30, 20); home(s, 'blacksmith', 1, 40, 20);
    home(s, 'market', 2, 80, 20); home(s, 'blacksmith', 2, 90, 20);
    const scout = unit(s, 'scout-cavalry'); scout.hp -= 7;
    const otherScout = unit(s, 'scout-cavalry', 2, 80, 60);
    expect(s.players[1].researched).not.toContain('light-cavalry');
    const before = { ...s.players[1] };
    research(s, tc, 'castle-age');
    expect(before.food - s.players[1].food).toBe(800); expect(before.gold - s.players[1].gold).toBe(200);
    expect(scout.kind).toBe('light-cavalry'); expect(scout.maxHp - scout.hp).toBe(7);
    expect(s.players[1].researched).not.toContain('chemistry');
    research(s, otherTc, 'castle-age');
    expect(s.players[2].age).toBe(s.players[1].age);
    expect(otherScout.kind).toBe('scout-cavalry');
    expect(s.players[2].researched).not.toContain('light-cavalry');
    home(s, 'castle');
    home(s, 'castle', 2, 80, 30);
    const bank = { ...s.players[1] }; research(s, tc, 'imperial-age');
    expect(bank.food - s.players[1].food).toBe(1000); expect(bank.gold - s.players[1].gold).toBe(800);
    expect(scout.kind).toBe('dat-unit-441'); expect(scout.maxHp - scout.hp).toBe(7);
    research(s, otherTc, 'imperial-age');
    expect(s.players[2].age).toBe(s.players[1].age);
    expect(otherScout.kind).toBe('scout-cavalry');
    for (const key of ['light-cavalry', 'hussar', 'chemistry']) {
      expect(s.players[1].researched.filter(k => k === key)).toHaveLength(1);
      expect(s.players[2].researched).not.toContain(key);
    }
    const stable = home(s, 'stable', 1, 50, 20);
    expect(train(s, stable, 'dat-unit-441').maxHp).toBe(75);
    const university = home(s, 'university', 1, 60, 20);
    expect(applyCommand(s, { kind: 'research', player: 1, buildingId: university.id, tech: 'chemistry' }).ok).toBe(false);
  });

  it('scout pierce armour reduces real enemy arrow damage, not enemy armour', () => {
    const s = arena(1), targets = [unit(s, 'scout-cavalry', 1, 44, 40), unit(s, 'scout-cavalry', 2, 84, 40)];
    const archers = [unit(s, 'archer', 2, 40, 40), unit(s, 'archer', 1, 80, 40)];
    const hp = targets.map(t => t.hp);
    targets.forEach((t, i) => { t.attackCooldown = 10000; order(s, archers[i], t); });
    until(s, () => targets.every((t, i) => t.hp < hp[i]), 200);
    expect(hp[0] - targets[0].hp).toBe(1); expect(hp[1] - targets[1].hp).toBe(2);
  });

  it.each([
    ['town-center', 0, 3], ['watch-tower', 1, 4], ['castle', 5, 6],
  ] as const)('Frank Hand Cannoneers enter/leave %s and contribute the existing source-based volley', (kind, empty, loaded) => {
    const s = arena(3, 'franks'), building = home(s, kind, 2, 40, 40);
    expect(volleyArrows(s, building)).toBe(empty);
    const passengers = [unit(s, 'dat-unit-5', 2, 40, 43), unit(s, 'dat-unit-5', 2, 41, 43)];
    for (const p of passengers) { expect(canGarrison(s, p, building)).toBe(true); order(s, p, building); }
    until(s, () => building.garrison?.length === 2);
    // Owned HC firepower 1 × 17 pierce / 3.45s. The ledger's existing
    // inferred DPS/floor/cap adapter gives 3/4/6 arrows for two occupants;
    // class-44 admission does not introduce a different volley formula.
    expect(volleyArrows(s, building)).toBe(loaded);
    // An immobile target isolates the volley from melee retaliation/movement.
    const target = home(s, 'house', 1, 45.5, 40.5); target.hp = target.maxHp = 10000;
    order(s, building, target);
    until(s, () => s.projectiles.some(p => p.shooterId === building.id), 100);
    expect(s.projectiles.filter(p => p.shooterId === building.id)).toHaveLength(loaded);
    until(s, () => target.hp < target.maxHp, 100);
    expect(applyCommand(s, { kind: 'ungarrison', player: 2, buildingId: building.id }).ok).toBe(true);
    expect(building.garrison?.length ?? 0).toBe(0);
    expect(volleyArrows(s, building)).toBe(empty);
    for (const p of passengers) expect(s.entities.some(e => e.id === p.id && !e.dead)).toBe(true);
  });

  it('Frank Hand Cannoneers board mask-11 Siege Towers and unload', () => {
    const s = arena(3, 'franks'), tower = unit(s, 'siege-tower', 2, 40, 40);
    expect(unitRulesFor(s, 2, 'siege-tower').passengerTypes).toBe(11);
    const gunner = unit(s, 'dat-unit-5', 2, 41, 40);
    expect(canGarrison(s, gunner, tower)).toBe(true); order(s, gunner, tower);
    until(s, () => tower.garrison?.some(e => e.id === gunner.id) === true);
    expect(applyCommand(s, { kind: 'ungarrison', player: 2, buildingId: tower.id }).ok).toBe(true);
    expect(s.entities.some(e => e.id === gunner.id)).toBe(true);
    expect(tower.garrison?.length ?? 0).toBe(0);
  });

  it.each([1, 2] as const)('seat %s foot gunners board and leave rams without admitting cavalry', owner => {
    // Native build 185872, Turks and Teutons: HC + Janissary occupy 2/6.
    // See docs/turks-calibration.md; pinned-build admission is not measured.
    const s = arena(3, 'teutons'), ram = unit(s, 'battering-ram', owner, 40, 40);
    const passengers = [unit(s, 'dat-unit-5', owner, 41, 40), unit(s, 'dat-unit-46', owner, 41, 41)];
    for (const p of passengers) { expect(canGarrison(s, p, ram)).toBe(true); order(s, p, ram); }
    until(s, () => ram.garrison?.length === 2);
    expect(ram.garrison!.map(p => p.id).sort()).toEqual(passengers.map(p => p.id).sort());
    const knight = unit(s, 'knight', owner, 42, 40);
    expect(canGarrison(s, knight, ram)).toBe(false); order(s, knight, ram);
    for (let i = 0; i < 100; i++) stepGame(s);
    expect(ram.garrison).toHaveLength(2);
    expect(applyCommand(s, { kind: 'ungarrison', player: owner, buildingId: ram.id }).ok).toBe(true);
    expect(ram.garrison?.length ?? 0).toBe(0);
    for (const p of passengers) expect(s.entities.some(e => e.id === p.id && !e.dead)).toBe(true);
  });

  it('gunpowder trains in 80% time with unchanged payments/refunds and owner-local HP', () => {
    const s = arena(3, 'byzantines'), university = home(s, 'university', 2, 80, 20);
    research(s, university, 'chemistry');
    const ranges = [home(s, 'archery-range', 1, 30, 30), home(s, 'archery-range', 2, 80, 30)];
    const first = s.nextId, start = s.tick, completed: number[] = [];
    for (const [i, b] of ranges.entries()) {
      const owner = b.owner as PlayerId, bank = { ...s.players[owner] };
      expect(applyCommand(s, { kind: 'train', player: owner, buildingId: b.id, unit: 'dat-unit-5' }).ok).toBe(true);
      expect(bank.food - s.players[owner].food).toBe(45); expect(bank.gold - s.players[owner].gold).toBe(50);
      expect(applyCommand(s, { kind: 'cancel-train', player: owner, buildingId: b.id }).ok).toBe(true);
      expect(s.players[owner].food).toBe(bank.food); expect(s.players[owner].gold).toBe(bank.gold);
      expect(applyCommand(s, { kind: 'train', player: owner, buildingId: b.id, unit: 'dat-unit-5' }).ok).toBe(true);
      completed[i] = 0;
    }
    until(s, () => {
      for (let i = 0; i < 2; i++) if (!completed[i] && s.entities.some(e => e.id >= first && e.owner === i + 1 && e.kind === 'dat-unit-5')) completed[i] = s.tick - start;
      return completed.every(t => t > 0);
    });
    expect(Math.abs(completed[0] - completed[1] * .8)).toBeLessThanOrEqual(1);
    expect(s.entities.find(e => e.id >= first && e.owner === 1 && e.kind === 'dat-unit-5')!.maxHp).toBe(50);
    expect(s.entities.find(e => e.id >= first && e.owner === 2 && e.kind === 'dat-unit-5')!.maxHp).toBe(40);
  });

  it('trains Janissaries, promotes wounded and garrisoned units and rejects foreign or unavailable training', () => {
    const s = arena(3), castle = home(s, 'castle'), a = train(s, castle, 'dat-unit-46');
    expect(a.maxHp).toBe(43.75); a.hp -= 9;
    const b = unit(s, 'dat-unit-46', 1, 20, 23); order(s, b, castle); until(s, () => !!castle.garrison?.length);
    research(s, castle, 'elite-janissary');
    expect(a.kind).toBe('dat-unit-557'); expect(a.maxHp).toBe(50); expect(a.maxHp - a.hp).toBe(9);
    expect(castle.garrison?.[0].kind).toBe('dat-unit-557'); expect(castle.garrison?.[0].maxHp).toBe(50);
    expect(train(s, castle, 'dat-unit-557').maxHp).toBe(50);
    const foreign = home(s, 'castle', 2, 80, 80);
    expect(applyCommand(s, { kind: 'train', player: 2, buildingId: foreign.id, unit: 'dat-unit-46' }).ok).toBe(false);
    const range = home(s, 'archery-range', 1, 30, 20);
    expect(applyCommand(s, { kind: 'train', player: 1, buildingId: range.id, unit: 'elite-skirmisher' }).ok).toBe(false);
  });

  it('Sipahi increases existing, garrisoned and new cavalry archer HP without leaking', () => {
    const s = arena(), castle = home(s, 'castle'), range = home(s, 'archery-range', 1, 30, 20);
    const a = train(s, range, 'cavalry-archer'); a.hp -= 8;
    const b = unit(s, 'cavalry-archer', 1, 20, 23); order(s, b, castle); until(s, () => !!castle.garrison?.length);
    const other = unit(s, 'cavalry-archer', 2, 80, 80);
    research(s, castle, 'sipahi');
    expect(a.maxHp).toBe(70); expect(a.maxHp - a.hp).toBe(8); expect(other.maxHp).toBe(50);
    expect(castle.garrison?.[0].maxHp).toBe(70); expect(train(s, range, 'cavalry-archer').maxHp).toBe(70);
  });

  it('Artillery lets a Bombard Cannon hit beyond its old range without moving', () => {
    const s = arena(3), castle = home(s, 'castle'), workshop = home(s, 'siege-workshop', 1, 30, 20);
    const cannon = train(s, workshop, 'dat-unit-36'); expect(cannon.maxHp).toBe(100);
    research(s, castle, 'artillery'); cannon.position = { x: 50, y: 50 };
    const target = home(s, 'house', 2, 64.5, 50.5), hp = target.hp;
    order(s, cannon, target); until(s, () => target.hp < hp, 300);
    expect(cannon.position).toEqual({ x: 50, y: 50 });
    expect(unitRulesFor(s, 2, 'dat-unit-36').range).toBe(12);
  });

  it('discounted gunpowder research charges its source cost and enables construction/upgrades', () => {
    const s = arena(3), university = home(s, 'university'), before = { ...s.players[1] };
    research(s, university, 'bombard-tower');
    expect(before.food - s.players[1].food).toBe(400); expect(before.wood - s.players[1].wood).toBe(200);
    const worker = unit(s, 'villager', 1, 40, 40);
    expect(applyCommand(s, { kind: 'build', player: 1, builderIds: [worker.id], building: 'bombard-tower', target: { x: 43.5, y: 40.5 } }).ok).toBe(true);
    until(s, () => s.entities.some(e => e.kind === 'bombard-tower' && e.buildProgress === undefined));
    const sea = arena(3, 'britons', true), dock = home(sea, 'dock');
    const ship = train(sea, dock, 'cannon-galleon'), bank = { ...sea.players[1] };
    research(sea, dock, 'elite-cannon-galleon');
    // Native 185872: tooltip 262W/250G; 5000W -> 4738W (#302).
    expect(bank.wood - sea.players[1].wood).toBe(262); expect(bank.gold - sea.players[1].gold).toBe(250);
    expect(ship.kind).toBe('dat-unit-691'); expect(ship.maxHp).toBe(187.5);
  });

  it('accepts the native 262-wood Elite Cannon Galleon budget and refunds exactly that payment', () => {
    const s = arena(3, 'britons', true), dock = home(s, 'dock');
    train(s, dock, 'cannon-galleon');
    s.players[1].wood = 261; s.players[1].gold = 250;
    expect(applyCommand(s, { kind: 'research', player: 1, buildingId: dock.id, tech: 'elite-cannon-galleon' }).ok).toBe(false);
    expect(s.players[1].wood).toBe(261); expect(s.players[1].gold).toBe(250);
    s.players[1].wood = 262;
    expect(applyCommand(s, { kind: 'research', player: 1, buildingId: dock.id, tech: 'elite-cannon-galleon' }).ok).toBe(true);
    expect(s.players[1].wood).toBe(0); expect(s.players[1].gold).toBe(0);
    expect(applyCommand(s, { kind: 'cancel-research', player: 1, buildingId: dock.id }).ok).toBe(true);
    expect(s.players[1].wood).toBe(262); expect(s.players[1].gold).toBe(250);
  });

  it('Janissary shots land and captured gunpowder keeps its stats across JSON continuation', () => {
    const s = arena(), castle = home(s, 'castle'), a = train(s, castle, 'dat-unit-46');
    a.position = { x: 50, y: 50 };
    const target = unit(s, 'knight', 2, 55, 50); target.attackCooldown = 100000;
    order(s, a, target); until(s, () => target.hp < target.maxHp, 300);
    expect(a.position).toEqual({ x: 50, y: 50 });
    expect(applyCommand(s, { kind: 'stop', player: 1, entityIds: [a.id] }).ok).toBe(true);
    expect(applyCommand(s, { kind: 'delete', player: 2, entityIds: [target.id] }).ok).toBe(true);
    const monk = unit(s, 'monk', 2, 57, 50); monk.hp = monk.maxHp = 10000;
    order(s, monk, a); until(s, () => a.owner === 2, 600);
    expect(a.convertedRules?.hp).toBe(43.75);
    const saved = JSON.parse(JSON.stringify(s));
    for (let i = 0; i < 60; i++) { stepGame(s); stepGame(saved); }
    expect(synchronizationHash(s)).toBe(synchronizationHash(saved));
  });

  it('published-enabled mixed selection and opening commands replay deterministically', async () => {
    expect(rules!.civilizations!.turks.civilization.enabled).toBe(true);
    const player: Strategy = { decide({ observation: o }) {
      if (o.time !== 0) return [];
      const tc = o.entities.find(e => e.owner === o.player && e.kind === 'town-center')!;
      return [{ kind: 'train', player: o.player, buildingId: tc.id, unit: 'villager' }];
    } };
    const { record, result } = await runMatch({ version: 1, seed: 188, civilizations: { 1: 'turks', 2: 'britons' },
      maxTimeSeconds: 10, decideIntervalSeconds: 1 }, { 1: player, 2: player }, rules!);
    expect(result.rejectedCommands).toEqual([]); expect(replayRecord(JSON.parse(JSON.stringify(record)), rules!).ok).toBe(true);
  });
});
