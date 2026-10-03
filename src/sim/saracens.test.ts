import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { rulesFromManifest, TICKS_PER_SECOND } from './data';
import { activateAutomaticTechnologies, applyCommand, createGame, stepGame } from './game';
import { buildingRulesFor, unitRulesFor } from './rules';
import { updateVisibility } from './visibility';
import { synchronizationHash } from '../shared/checksum';
import { replayRecord, runMatch, type Strategy } from '../headless/runner';
import type { BuildingKind, Entity, GameState, PlayerId, UnitKind } from './types';

const path = process.env.CIV_PROFILE_CONTENT ?? 'public/imported/aoe2/manifest.json';
const rules = existsSync(path) ? rulesFromManifest(JSON.parse(readFileSync(path, 'utf8'))) : undefined;
if (rules?.civilizations?.saracens) rules.civilizations.saracens.civilization.enabled = true;
function arena(age = 2, water = false, rival = 'britons') {
  const s = createGame(187, rules!, { 1: 'saracens', 2: rival });
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

describe.skipIf(!rules?.civilizations?.saracens)('owned Saracen gameplay', () => {
  it('builds a 75-wood market and exchanges at the five-percent fee without leaking it', () => {
    const s = arena(1), worker = unit(s, 'villager', 1, 40, 40), before = s.players[1].wood;
    home(s, 'mill', 1, 30, 30);
    expect(applyCommand(s, { kind: 'build', player: 1, builderIds: [worker.id], building: 'market', target: { x: 43, y: 40 } }).ok).toBe(true);
    expect(before - s.players[1].wood).toBe(75);
    const market = s.entities.find(e => e.kind === 'market')!;
    until(s, () => market.buildProgress === undefined);
    const gold = s.players[1].gold, food = s.players[1].food;
    expect(applyCommand(s, { kind: 'exchange', player: 1, marketId: market.id, resource: 'food', side: 'sell', amount: 100 }).ok).toBe(true);
    expect(s.players[1].gold - gold).toBe(95); expect(food - s.players[1].food).toBe(100);
    const other = home(s, 'market', 2, 80, 80), bank = s.players[2].gold;
    expect(applyCommand(s, { kind: 'exchange', player: 2, marketId: other.id, resource: 'wood', side: 'buy', amount: 100 }).ok).toBe(true);
    expect(bank - s.players[2].gold).toBe(130);
  });

  it('the DAT team attack bonus damages buildings with archers and skirmishers', () => {
    for (const kind of ['archer', 'skirmisher'] as const) {
      const s = arena(1), a = unit(s, kind, 1, 40, 40), b = unit(s, kind, 2, 80, 80);
      const t = home(s, 'house', 2, 43.5, 40.5), u = home(s, 'house', 1, 83.5, 80.5);
      const thp = t.hp, uhp = u.hp; order(s, a, t); order(s, b, u);
      until(s, () => t.hp < thp && u.hp < uhp, 100);
      expect(thp - t.hp).toBeGreaterThan(uhp - u.hp);
    }
  });

  it('trains and promotes wounded and garrisoned Mamelukes, with owner-local camel HP', () => {
    const s = arena(3), castle = home(s, 'castle'), stable = home(s, 'stable', 1, 30, 20);
    const a = train(s, castle, 'dat-unit-282'); expect(a.maxHp).toBe(100); a.hp -= 11;
    const b = unit(s, 'dat-unit-282', 1, 20, 23); order(s, b, castle); until(s, () => !!castle.garrison?.length);
    research(s, castle, 'elite-mameluke');
    expect(a.kind).toBe('dat-unit-556'); expect(a.maxHp - a.hp).toBe(11);
    expect(castle.garrison?.[0].kind).toBe('dat-unit-556');
    expect(train(s, castle, 'dat-unit-556').maxHp).toBe(100);
    expect(train(s, stable, 'dat-unit-329').maxHp).toBe(125);
    research(s, stable, 'bloodlines'); expect(a.maxHp).toBe(120);
    const foreign = home(s, 'castle', 2, 80, 80);
    expect(applyCommand(s, { kind: 'train', player: 2, buildingId: foreign.id, unit: 'dat-unit-282' }).ok).toBe(false);
    expect(s.players[1].researched).not.toContain('zealotry');
  });

  it('Bimaristan passively heals multiple eligible nearby units, excludes self/enemy/siege/outside, and does not stack', () => {
    const s = arena(), castle = home(s, 'castle'); research(s, castle, 'bimaristan');
    const monk = unit(s, 'monk', 1, 40, 40); monk.hp = 1;
    const patients = [unit(s, 'militia', 1, 43, 40), unit(s, 'villager', 1, 40, 43)];
    const excluded = [unit(s, 'militia', 2, 43, 43), unit(s, 'battering-ram', 1, 42, 42), unit(s, 'villager', 1, 46, 40)];
    for (const e of [...patients, ...excluded]) { e.hp = 1; e.attackCooldown = 100000; }
    for (let i = 0; i < 4 * TICKS_PER_SECOND; i++) stepGame(s);
    for (const e of patients) expect(e.hp).toBeCloseTo(6);
    for (const e of excluded) expect(e.hp).toBe(1);
    expect(monk.hp).toBe(1);
    unit(s, 'monk', 1, 40, 41);
    const before = patients[0].hp;
    for (let i = 0; i < 4 * TICKS_PER_SECOND; i++) stepGame(s);
    expect(patients[0].hp - before).toBeCloseTo(5);
    expect(monk.hp).toBeCloseTo(6);
    const saved = JSON.parse(JSON.stringify(s));
    for (let i = 0; i < 40; i++) { stepGame(s); stepGame(saved); }
    expect(synchronizationHash(s)).toBe(synchronizationHash(saved));
  });

  it('garrison removes an aura source and ungarrison restores it', () => {
    const s = arena(), castle = home(s, 'castle'); research(s, castle, 'bimaristan');
    const monk = unit(s, 'monk', 1, 20, 23), patient = unit(s, 'villager', 1, 23, 23); patient.hp = 1;
    order(s, monk, castle); until(s, () => !!castle.garrison?.length);
    const before = patient.hp;
    for (let i = 0; i < 40; i++) stepGame(s);
    expect(patient.hp).toBe(before);
    expect(applyCommand(s, { kind: 'ungarrison', player: 1, buildingId: castle.id }).ok).toBe(true);
    until(s, () => patient.hp > before, 100);
  });

  it('research reaches existing relic carriers and captured aura monks keep their researched rules', () => {
    const s = arena(2, false, 'teutons'), castle = home(s, 'castle');
    const monk = unit(s, 'monk', 1, 50, 50), patient = unit(s, 'villager', 1, 53, 50); patient.hp = 1;
    // A carried relic is already part of this saved scenario; passive healing
    // must not depend on eligibility for the explicit heal command.
    monk.relics = [{ id: s.nextId++, kind: 'relic', owner: 0, position: { ...monk.position },
      hp: 1, maxHp: 1, radius: .25, activity: 'idle', order: { kind: 'idle' } }];
    for (let i = 0; i < 20; i++) stepGame(s);
    expect(patient.hp).toBe(1);
    research(s, castle, 'bimaristan');
    until(s, () => patient.hp > 2, 60);
    monk.relics = undefined;
    const temple = home(s, 'monastery', 2, 80, 80); research(s, temple, 'atonement');
    const converter = unit(s, 'monk', 2, 57, 50); converter.hp = converter.maxHp = 10000;
    order(s, converter, monk); until(s, () => monk.owner === 2, 600);
    expect(monk.convertedRules?.healingAura?.range).toBe(5);
    const enemyPatient = unit(s, 'villager', 2, 50, 53); enemyPatient.hp = 1;
    const before = patient.hp;
    for (let i = 0; i < 40; i++) stepGame(s);
    expect(enemyPatient.hp).toBeCloseTo(3.5); expect(patient.hp).toBe(before);
  });

  it('Counterweights increases real mangonel damage and keeps opponent damage unchanged', () => {
    const s = arena(3), castle = home(s, 'castle');
    const shoot = () => {
      const attacker = unit(s, 'mangonel', 1, 50, 50), target = home(s, 'house', 2, 55.5, 50.5);
      order(s, attacker, target); const before = target.hp;
      until(s, () => target.hp < before, 300); const damage = before - target.hp;
      expect(applyCommand(s, { kind: 'delete', player: 1, entityIds: [attacker.id] }).ok).toBe(true);
      expect(applyCommand(s, { kind: 'delete', player: 2, entityIds: [target.id] }).ok).toBe(true);
      return damage;
    };
    const before = shoot(); research(s, castle, 'counterweights'); expect(shoot()).toBeGreaterThan(before);
    expect(unitRulesFor(s, 2, 'mangonel').attacks).toEqual(rules!.units.mangonel.attacks);
  });

  it('Mameluke ranged melee damage lands, and captured units retain stats through save/load', () => {
    const s = arena(), castle = home(s, 'castle'), a = train(s, castle, 'dat-unit-282');
    a.position = { x: 50, y: 50 };
    const target = unit(s, 'knight', 2, 52, 50); target.attackCooldown = 100000;
    order(s, a, target); until(s, () => target.hp < target.maxHp, 100);
    expect(a.position).toEqual({ x: 50, y: 50 });
    expect(applyCommand(s, { kind: 'stop', player: 1, entityIds: [a.id] }).ok).toBe(true);
    const monk = unit(s, 'monk', 2, 57, 50); monk.hp = monk.maxHp = 10000;
    order(s, monk, a); until(s, () => a.owner === 2, 400);
    expect(a.convertedRules?.hp).toBe(100);
    const saved = JSON.parse(JSON.stringify(s));
    for (let i = 0; i < 60; i++) { stepGame(s); stepGame(saved); }
    expect(synchronizationHash(s)).toBe(synchronizationHash(saved));
  });

  it('galley attacks use the faster owner-local clock and transports gain HP and capacity', () => {
    const s = arena(1, true), dock = home(s, 'dock'), transport = train(s, dock, 'transport-ship');
    expect(transport.maxHp).toBe(140); expect(unitRulesFor(s, 1, 'transport-ship').transportCapacity).toBe(40);
    expect(unitRulesFor(s, 2, 'transport-ship').transportCapacity).toBe(20);
    const a = unit(s, 'galley', 1, 40, 40), b = unit(s, 'galley', 2, 80, 80);
    const t = unit(s, 'transport-ship', 2, 44, 40), u = unit(s, 'transport-ship', 1, 84, 80);
    t.hp = t.maxHp = u.hp = u.maxHp = 10000; order(s, a, t); order(s, b, u);
    const shots: number[][] = [[], []]; let next = s.nextId;
    for (let i = 0; i < 200 && shots.some(t => t.length < 2); i++) {
      stepGame(s);
      for (const [index, e] of [a, b].entries()) if (s.projectiles.some(p => p.id >= next && p.shooterId === e.id)) shots[index].push(s.tick);
      next = s.nextId;
    }
    expect(shots[0].length).toBeGreaterThanOrEqual(2); expect(shots[1].length).toBeGreaterThanOrEqual(2);
    expect(shots[0][1] - shots[0][0]).toBeLessThan(shots[1][1] - shots[1][0]);
  });

  it('mixed opening replays deterministically', async () => {
    const player: Strategy = { decide({ observation: o }) {
      if (o.time !== 0) return [];
      const tc = o.entities.find(e => e.owner === o.player && e.kind === 'town-center')!;
      return [{ kind: 'train', player: o.player, buildingId: tc.id, unit: 'villager' }];
    } };
    const { record, result } = await runMatch({ version: 1, seed: 187, civilizations: { 1: 'saracens', 2: 'britons' },
      maxTimeSeconds: 10, decideIntervalSeconds: 1 }, { 1: player, 2: player }, rules!);
    expect(result.rejectedCommands).toEqual([]); expect(replayRecord(JSON.parse(JSON.stringify(record)), rules!).ok).toBe(true);
  });
});
