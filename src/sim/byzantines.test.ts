import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { rulesFromManifest, TICKS_PER_SECOND } from './data';
import { activateAutomaticTechnologies, applyCommand, createGame, stepGame } from './game';
import { buildingRulesFor, unitRulesFor } from './rules';
import { researchCostFor } from './technologies';
import { updateVisibility } from './visibility';
import { synchronizationHash } from '../shared/checksum';
import { replayRecord, runMatch, type Strategy } from '../headless/runner';
import type { BuildingKind, Entity, GameState, PlayerId, UnitKind } from './types';

const path = process.env.CIV_PROFILE_CONTENT ?? 'public/imported/aoe2/manifest.json';
const rules = existsSync(path) ? rulesFromManifest(JSON.parse(readFileSync(path, 'utf8'))) : undefined;
if (rules?.civilizations?.byzantines) rules.civilizations.byzantines.civilization.enabled = true;
function arena(age = 2, water = false) {
  const s = createGame(185, rules!, { 1: 'byzantines', 2: 'britons' });
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
  expect(applyCommand(s, { kind: 'research', player: owner, buildingId: building.id, tech }), tech).toEqual({ ok: true });
  for (const r of ['food', 'wood', 'gold', 'stone'] as const) expect(before[r] - s.players[owner][r]).toBe(cost[r]);
  until(s, () => s.players[owner].researched.includes(tech));
}
function train(s: GameState, building: Entity, kind: UnitKind) {
  const owner = building.owner as PlayerId, first = s.nextId;
  expect(applyCommand(s, { kind: 'train', player: owner, buildingId: building.id, unit: kind }), kind).toEqual({ ok: true });
  until(s, () => s.entities.some(e => e.id >= first && e.owner === owner && e.kind === kind));
  return s.entities.find(e => e.id >= first && e.owner === owner && e.kind === kind)!;
}

describe.skipIf(!rules?.civilizations?.byzantines)('owned Byzantine gameplay', () => {
  it('paid ages strengthen existing occupied buildings and foundations; free sight research and Imperial discount are owner-local', () => {
    const s = arena(0), tc = s.entities.find(e => e.owner === 1)!;
    const house = home(s, 'house', 1, 30.5, 20.5), base = rules!.civilizations!.byzantines.buildings.house;
    const foundation = home(s, 'house', 1, 40.5, 20.5); foundation.buildProgress = .25; foundation.hp *= .25;
    const passenger = unit(s, 'villager', 1, 10, 12); order(s, passenger, tc); until(s, () => !!tc.garrison?.length);
    home(s, 'barracks'); home(s, 'mill', 1, 28, 30); home(s, 'blacksmith', 1, 36, 30);
    home(s, 'market', 1, 44, 30); home(s, 'castle', 1, 20, 40);
    house.hp -= 17;
    for (const [tech, food, gold, multiplier] of [
      ['feudal-age', 500, 0, 1.1 * 1.0909], ['castle-age', 800, 200, 1.1 * 1.0909 * 1.0833],
      ['imperial-age', 670, 536, 1.1 * 1.0909 * 1.0833 * 1.0769],
    ] as const) {
      const before = { ...s.players[1] }; research(s, tc, tech);
      expect(before.food - s.players[1].food).toBe(food); expect(before.gold - s.players[1].gold).toBe(gold);
      const ageName = ['dark', 'feudal', 'castle', 'imperial'][s.players[1].age];
      const hp = base.ageStats?.[ageName]?.hp ?? base.hp;
      expect(house.maxHp).toBeCloseTo(hp * multiplier, 2);
      expect(house.maxHp - house.hp).toBeCloseTo(17);
      expect(foundation.hp).toBeCloseTo(foundation.maxHp * .25);
      expect(tc.garrison?.[0].id).toBe(passenger.id);
      expect(s.players[1].researched).toContain('town-watch');
    }
    expect(s.players[1].researched).toContain('town-patrol');
    expect(s.players[2].researched).not.toContain('town-watch');
    updateVisibility(s); expect(s.visibility[1].visible[10 * s.width + 24]).toBe(1);
    const worker = unit(s, 'villager', 1, 59, 40);
    expect(applyCommand(s, { kind: 'build', player: 1, builderIds: [worker.id], building: 'house', target: { x: 60.5, y: 40.5 } }).ok).toBe(true);
    const site = s.entities.find(e => e.kind === 'house' && e.position.x === 60.5)!;
    until(s, () => site.buildProgress === undefined); expect(site.maxHp).toBe(house.maxHp);
  });

  it.each([
    ['spearman', 'barracks', 1, 26, 19, 0], ['skirmisher', 'archery-range', 1, 19, 26, 0],
    ['dat-unit-329', 'stable', 2, 41, 0, 45], ['dat-unit-330', 'stable', 3, 41, 0, 45],
  ] as const)('%s trains at its discounted source price and refunds the paid receipt', (kind, venue, age, food, wood, gold) => {
    const s = arena(age), building = home(s, venue), before = { ...s.players[1] };
    if (kind === 'dat-unit-330') research(s, building, 'heavy-camel-rider');
    const bank = { ...s.players[1] };
    expect(applyCommand(s, { kind: 'train', player: 1, buildingId: building.id, unit: kind }).ok).toBe(true);
    expect(bank.food - s.players[1].food).toBe(food); expect(bank.wood - s.players[1].wood).toBe(wood); expect(bank.gold - s.players[1].gold).toBe(gold);
    expect(applyCommand(s, { kind: 'cancel-train', player: 1, buildingId: building.id }).ok).toBe(true);
    expect(s.players[1].food).toBe(bank.food); expect(s.players[1].wood).toBe(bank.wood); expect(s.players[1].gold).toBe(bank.gold);
    const made = train(s, building, kind); expect(made.hp).toBe(made.maxHp);
    expect(s.players[2].food).toBe(before.food);
  });

  it('monks actually restore twice as much health without spending faith or leaking the bonus to an opponent', () => {
    const s = arena(), monk = unit(s, 'monk', 1, 40, 40), target = unit(s, 'knight', 1, 42, 40);
    const rival = unit(s, 'monk', 2, 80, 40), patient = unit(s, 'knight', 2, 82, 40);
    target.hp = patient.hp = 1; order(s, monk, target); order(s, rival, patient);
    for (let i = 0; i < 4 * TICKS_PER_SECOND + 1; i++) stepGame(s);
    expect(target.hp - 1).toBe(20); expect(patient.hp - 1).toBe(10);
    expect(monk.faith ?? 100).toBe(100);
  });

  it('paid Logistica adds infantry damage and fixed five-HP collateral, excludes allies and preserves the outer boundary', () => {
    const s = arena(3), castle = home(s, 'castle'), cat = train(s, castle, 'dat-unit-40');
    cat.position = { x: 50, y: 50 };
    const hit = (upgraded: boolean) => {
      cat.position = { x: 50, y: 50 }; cat.attackCooldown = 0;
      const target = unit(s, 'militia', 2, 50.7, 50), nearby = unit(s, 'dat-unit-25', 2, 50.7, 50.6);
      const ally = unit(s, 'militia', 1, 50.7, 49.5), far = unit(s, 'militia', 2, 50.7, 52);
      // Isolate one attack from retaliation and allied auto-attacks.
      for (const e of [target, nearby, ally, far]) e.attackCooldown = 10000;
      order(s, cat, target); until(s, () => target.hp < target.maxHp, 100);
      expect(target.maxHp - target.hp).toBe(upgraded ? 24 : 18);
      expect(nearby.maxHp - nearby.hp).toBe(upgraded ? 5 : 0);
      expect(ally.hp).toBe(ally.maxHp); expect(far.hp).toBe(far.maxHp);
      for (const e of [target, nearby, ally, far]) expect(applyCommand(s, { kind: 'delete', player: e.owner as PlayerId, entityIds: [e.id] }).ok).toBe(true);
      expect(applyCommand(s, { kind: 'stop', player: 1, entityIds: [cat.id] }).ok).toBe(true);
    };
    hit(false); research(s, castle, 'logistica'); hit(true);
  });

  it('elite promotion reaches existing, new and garrisoned Cataphracts and retains wounds', () => {
    const s = arena(3), castle = home(s, 'castle'), a = train(s, castle, 'dat-unit-40');
    a.hp -= 11;
    const b = unit(s, 'dat-unit-40', 1, 20, 22); order(s, b, castle); until(s, () => !!castle.garrison?.length);
    research(s, castle, 'elite-cataphract'); expect(a.kind).toBe('dat-unit-553');
    expect(castle.garrison?.[0].kind).toBe('dat-unit-553');
    expect(a.maxHp - a.hp).toBe(11);
    expect(train(s, castle, 'dat-unit-553').maxHp).toBe(a.maxHp);
  });

  it('Greek Fire changes actual Fire Ship reach and leaves ordinary enemy reach unchanged', () => {
    const s = arena(2, true), castle = home(s, 'castle'), ship = unit(s, 'fire-ship', 1, 40, 40);
    research(s, castle, 'greek-fire');
    const target = unit(s, 'transport-ship', 2, 44.5, 40), start = { ...ship.position };
    order(s, ship, target); until(s, () => target.hp < target.maxHp, 150);
    expect(ship.position).toEqual(start); expect(unitRulesFor(s, 2, 'fire-ship').range).toBe(2.5);
  });

  it.each(['fire-ship', 'dat-unit-1795'] as const)('%s launches successive primary shots on the faster Byzantine reload clock', kind => {
    const s = arena(3, true), shooter = unit(s, kind, 1, 40, 40), target = unit(s, 'transport-ship', 2, kind === 'fire-ship' ? 42 : 47, 40);
    const rival = unit(s, kind, 2, 80, 80), otherTarget = unit(s, 'transport-ship', 1, kind === 'fire-ship' ? 82 : 87, 80);
    target.hp = target.maxHp = otherTarget.hp = otherTarget.maxHp = 10000;
    order(s, shooter, target); order(s, rival, otherTarget);
    const ticks: number[] = [], otherTicks: number[] = []; let before = s.nextId;
    for (let i = 0; i < 250 && (ticks.length < 2 || otherTicks.length < 2); i++) {
      stepGame(s);
      for (const [actor, times] of [[shooter, ticks], [rival, otherTicks]] as const) {
        if (s.projectiles.some(p => p.id >= before && p.shooterId === actor.id)
          && actor.attackWindup === undefined && !actor.attackVolley) times.push(s.tick);
      }
      before = s.nextId;
    }
    expect(ticks.length).toBeGreaterThanOrEqual(2); expect(otherTicks.length).toBeGreaterThanOrEqual(2);
    expect(ticks[1] - ticks[0]).toBeLessThan(otherTicks[1] - otherTicks[0]);
    expect(ticks[1] - ticks[0]).toBeLessThanOrEqual(Math.round(unitRulesFor(s, 2, kind).attackReloadSeconds * TICKS_PER_SECOND * .8) + 1);
  });

  it('paid Greek Fire changes Bombard Tower projectile art and deals collateral outside its old radius', () => {
    const s = arena(3), castle = home(s, 'castle'), tower = home(s, 'bombard-tower', 1, 40.5, 40.5);
    research(s, castle, 'greek-fire');
    const target = home(s, 'house', 2, 47.5, 40.5), nearby = unit(s, 'archer', 2, 47.5, 41.1);
    const hp = nearby.hp; order(s, tower, target);
    until(s, () => s.projectiles.some(p => p.owner === 1), 200);
    expect(s.projectiles.find(p => p.owner === 1)?.art).toBe('dat-projectile-537');
    until(s, () => nearby.hp < hp, 250);
  });

  it('conversion retains Cataphract stats and Logistica through JSON continuation; enemy cannot train it', () => {
    const s = arena(3), castle = home(s, 'castle'); research(s, castle, 'logistica');
    const cat = train(s, castle, 'dat-unit-40'), monk = unit(s, 'monk', 2, 60, 50);
    monk.hp = monk.maxHp = 10000;
    cat.position = { x: 64, y: 50 }; order(s, monk, cat); until(s, () => cat.owner === 2, 400);
    expect(cat.convertedRules?.blastDamage).toBe(-5); expect(cat.convertedRules?.blastRadius).toBe(.5);
    const foreignCastle = home(s, 'castle', 2, 80, 70), bank = s.players[2].gold;
    expect(applyCommand(s, { kind: 'train', player: 2, buildingId: foreignCastle.id, unit: 'dat-unit-40' }).ok).toBe(false);
    expect(s.players[2].gold).toBe(bank);
    const saved = JSON.parse(JSON.stringify(s));
    for (let i = 0; i < 100; i++) { stepGame(s); stepGame(saved); }
    expect(synchronizationHash(saved)).toBe(synchronizationHash(s));
  });

  it('mixed opening records replay with identical checksums', async () => {
    const player: Strategy = { decide({ observation: o }) {
      if (o.time !== 0) return [];
      const tc = o.entities.find(e => e.owner === o.player && e.kind === 'town-center')!;
      return [{ kind: 'research', player: o.player, buildingId: tc.id, tech: 'loom' },
        { kind: 'train', player: o.player, buildingId: tc.id, unit: 'villager' }];
    } };
    const { record, result } = await runMatch({ version: 1, seed: 185, civilizations: { 1: 'byzantines', 2: 'britons' },
      maxTimeSeconds: 30, decideIntervalSeconds: 1 }, { 1: player, 2: player }, rules!);
    expect(result.rejectedCommands).toEqual([]);
    expect(replayRecord(JSON.parse(JSON.stringify(record)), rules!).ok).toBe(true);
  });
});
