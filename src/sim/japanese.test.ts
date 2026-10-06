import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { rulesFromManifest, TICKS_PER_SECOND } from './data';
import { activateAutomaticTechnologies, applyCommand, createGame, stepGame } from './game';
import { buildingRulesFor, unitRulesFor, unitRulesForEntity } from './rules';
import { rulesForPlayer } from './civilizations';
import { useLegacyPacking } from './packing';
import { updateVisibility } from './visibility';
import { synchronizationHash } from '../shared/checksum';
import { replayRecord, runMatch, type Strategy } from '../headless/runner';
import type { BuildingKind, Entity, GameState, PlayerId, UnitKind } from './types';

const path = process.env.CIV_PROFILE_CONTENT ?? 'public/imported/aoe2/manifest.json';
const imported = existsSync(path) ? rulesFromManifest(JSON.parse(readFileSync(path, 'utf8'))) : undefined;
if (imported?.civilizations?.japanese) imported.civilizations.japanese.civilization.enabled = true;
function arena(age = 2, water = false) {
  const s = createGame(183, imported!, { 1: 'japanese', 2: 'britons' });
  s.entities = s.entities.filter(e => e.kind === 'town-center');
  s.entities.forEach((e, i) => e.position = { x: 10 + i * 80, y: 10 });
  s.terrain.fill(water ? 23 : 0); s.elevation.fill(0);
  for (const owner of [1, 2] as const) Object.assign(s.players[owner], { age, food: 20000, wood: 20000, gold: 20000, stone: 20000 });
  activateAutomaticTechnologies(s);
  return s;
}
function building(s: GameState, kind: BuildingKind, owner: PlayerId, x = 20, y = 20): Entity {
  const r = buildingRulesFor(s, owner, kind), e: Entity = { id: s.nextId++, kind, owner,
    position: { x, y }, hp: r.hp, maxHp: r.hp, radius: r.radius, activity: 'idle', order: { kind: 'idle' } };
  s.entities.push(e); activateAutomaticTechnologies(s); return e;
}
function unit(s: GameState, kind: UnitKind, owner: PlayerId, x = 50, y = 50): Entity {
  const r = unitRulesFor(s, owner, kind), e: Entity = { id: s.nextId++, kind, owner,
    position: { x, y }, hp: r.hp, maxHp: r.hp, radius: r.radius, activity: 'idle', order: { kind: 'idle' } };
  s.entities.push(e); return e;
}
function until(s: GameState, done: () => boolean, ticks = 6000) {
  for (let i = 0; i < ticks && !done(); i++) stepGame(s);
  expect(done()).toBe(true);
}
function order(s: GameState, actor: Entity, target: Entity) {
  updateVisibility(s);
  expect(applyCommand(s, { kind: 'order', player: actor.owner as PlayerId, entityIds: [actor.id], targetId: target.id, target: target.position }).ok).toBe(true);
}
function research(s: GameState, home: Entity, tech: string) {
  const owner = home.owner as PlayerId, before = { ...s.players[owner] };
  expect(applyCommand(s, { kind: 'research', player: owner, buildingId: home.id, tech }).ok).toBe(true);
  const cost = rulesForPlayer(s, owner).technologies[tech].cost;
  for (const r of ['food', 'wood', 'gold', 'stone'] as const) expect(before[r] - s.players[owner][r]).toBe(cost[r]);
  until(s, () => s.players[owner].researched.includes(tech));
}
function train(s: GameState, home: Entity, kind: UnitKind) {
  const owner = home.owner as PlayerId, next = s.nextId;
  expect(applyCommand(s, { kind: 'train', player: owner, buildingId: home.id, unit: kind }).ok).toBe(true);
  until(s, () => s.entities.some(e => e.owner === owner && e.id >= next && e.kind === kind));
  return s.entities.find(e => e.owner === owner && e.id >= next && e.kind === kind)!;
}

describe.skipIf(!imported?.civilizations?.japanese)('owned Japanese gameplay', () => {
  it.each([0, 1, 2, 3])('age %s pays half for completed mills and camps, without discounting the opponent', age => {
    const s = arena(age);
    for (const [i, kind] of (['mill', 'lumber-camp', 'mining-camp'] as const).entries()) {
      const worker = unit(s, 'villager', 1, 39, 40 + i * 10), wood = s.players[1].wood;
      expect(applyCommand(s, { kind: 'build', player: 1, builderIds: [worker.id], building: kind, target: { x: 40, y: 40 + i * 10 } }).ok).toBe(true);
      expect(wood - s.players[1].wood).toBe(50);
      until(s, () => s.entities.some(e => e.kind === kind && e.buildProgress === undefined));
      expect(buildingRulesFor(s, 2, kind).cost.wood).toBe(100);
    }
  });

  it('activates faster infantry attacks at Feudal, including existing, garrisoned and newly trained soldiers', () => {
    const s = arena(0), tc = s.entities.find(e => e.owner === 1)!;
    const barracks = building(s, 'barracks', 1), mill = building(s, 'mill', 1, 28, 20);
    const veteran = unit(s, 'militia', 1, 50, 50), passenger = unit(s, 'militia', 1, 10, 10);
    order(s, passenger, tc); until(s, () => !!tc.garrison?.length);
    const interval = (attacker: Entity, x: number, y: number) => {
      attacker.position = { x, y }; attacker.attackCooldown = 0;
      const victim = unit(s, 'villager', 2, x + .6, y); victim.hp = victim.maxHp = 10000;
      order(s, attacker, victim); until(s, () => victim.hp < 10000);
      const first = s.tick, hp = victim.hp;
      until(s, () => victim.hp < hp);
      const result = s.tick - first;
      expect(applyCommand(s, { kind: 'stop', player: 1, entityIds: [attacker.id] }).ok).toBe(true);
      expect(applyCommand(s, { kind: 'delete', player: 2, entityIds: [victim.id] }).ok).toBe(true);
      return result;
    };
    const dark = interval(veteran, 50, 50);
    research(s, tc, 'feudal-age');
    expect(interval(veteran, 50, 50)).toBe(Math.round(dark * .75));
    expect(applyCommand(s, { kind: 'ungarrison', player: 1, buildingId: tc.id }).ok).toBe(true);
    expect(interval(passenger, 50, 60)).toBe(Math.round(dark * .75));
    expect(interval(train(s, barracks, 'militia'), 50, 70)).toBe(Math.round(dark * .75));
    expect(s.players[1].researched.filter(k => k === 'automatic-341')).toHaveLength(1);
    expect(s.players[2].researched).not.toContain('automatic-341');
    expect(mill.hp).toBeGreaterThan(0);
  });

  it.each([0, 1, 2, 3])('age %s fishing ships survive with double HP and bank food sooner', age => {
    const s = arena(age, true);
    const bankTicks: number[] = [];
    for (const owner of [1, 2] as const) {
      const x = owner === 1 ? 30 : 70;
      building(s, 'dock', owner, x, 40);
      const ship = unit(s, 'fishing-ship', owner, x + 3, 40);
      expect(ship.maxHp).toBe(owner === 1 ? 100 : 50);
      const fish: Entity = { id: s.nextId++, kind: 'resource', owner: 0, node: 'fish', resourceKind: 'food', amount: 10,
        position: { x: x + 4, y: 40 }, hp: 1, maxHp: 1, radius: .5, activity: 'idle', order: { kind: 'idle' } };
      s.entities.push(fish);
      const before = s.players[owner].food, start = s.tick;
      order(s, ship, fish); until(s, () => s.players[owner].food > before);
      expect(s.players[owner].food - before).toBe(10);
      bankTicks.push(s.tick - start);
    }
    expect(bankTicks[0]).toBeLessThan(bankTicks[1]);
  });

  it('galley-line sight actually reveals four more tiles, with no enemy bonus leakage', () => {
    const s = arena(3, true); s.entities = [];
    for (const kind of ['galley', 'war-galley', 'galleon'] as const) {
      s.entities = []; unit(s, kind, 1, 30.5, 30.5); unit(s, kind, 2, 70.5, 30.5);
      updateVisibility(s);
      const normal = unitRulesFor(s, 2, kind).lineOfSight;
      expect(s.visibility[1].visible[30 * s.width + 30 + normal + 3]).toBe(1);
      expect(s.visibility[2].visible[30 * s.width + 70 + normal + 3]).toBe(0);
    }
  });

  it('successive fishing-age grants increase actual collection, including a saved existing ship', () => {
    const s = arena(0, true), ship = unit(s, 'fishing-ship', 1, 40, 40);
    const fish: Entity = { id: s.nextId++, kind: 'resource', owner: 0, node: 'fish', resourceKind: 'food', amount: 10000,
      position: { x: 40.5, y: 40 }, hp: 1, maxHp: 1, radius: .5, activity: 'idle', order: { kind: 'idle' } };
    s.entities.push(fish);
    const collected: number[] = [];
    for (const age of [0, 1, 2, 3]) {
      s.players[1].age = age; activateAutomaticTechnologies(s);
      ship.carrying = undefined; ship.gatherProgress = 0;
      order(s, ship, fish);
      const before = fish.amount!;
      for (let i = 0; i < 200; i++) stepGame(s);
      collected.push(before - fish.amount! + (ship.gatherProgress ?? 0));
    }
    for (let i = 1; i < collected.length; i++) expect(collected[i]).toBeGreaterThan(collected[i - 1]);
    expect(collected[3] / collected[0]).toBeCloseTo(1.2 / 1.05, 3);
    const copy = JSON.parse(JSON.stringify(s));
    for (let i = 0; i < 100; i++) { stepGame(s); stepGame(copy); }
    expect(synchronizationHash(copy)).toBe(synchronizationHash(s));
  });

  it('cavalry archers deal the extra two damage to archers but not skirmishers', () => {
    const damage = (owner: PlayerId, kind: UnitKind) => {
      const s = arena(), attacker = unit(s, 'cavalry-archer', owner, 50, 50);
      const target = unit(s, kind, owner === 1 ? 2 : 1, 53, 50), hp = target.hp;
      target.attackCooldown = 10000;
      order(s, attacker, target); until(s, () => target.hp < hp);
      return hp - target.hp;
    };
    expect(damage(1, 'archer') - damage(2, 'archer')).toBe(2);
    expect(damage(1, 'skirmisher')).toBe(damage(2, 'skirmisher'));
  });

  it('pays and refunds Samurai training, upgrades existing and garrisoned Samurai, and rejects foreign training', () => {
    const s = arena(3), castle = building(s, 'castle', 1), other = building(s, 'castle', 2, 80, 80);
    const before = { ...s.players[1] };
    expect(applyCommand(s, { kind: 'train', player: 1, buildingId: castle.id, unit: 'dat-unit-291' }).ok).toBe(true);
    expect(before.food - s.players[1].food).toBe(45); expect(before.gold - s.players[1].gold).toBe(30);
    expect(applyCommand(s, { kind: 'cancel-train', player: 1, buildingId: castle.id }).ok).toBe(true);
    expect(s.players[1].food).toBe(before.food); expect(s.players[1].gold).toBe(before.gold);
    const a = train(s, castle, 'dat-unit-291'), b = train(s, castle, 'dat-unit-291');
    order(s, b, castle); until(s, () => !!castle.garrison?.length);
    research(s, castle, 'elite-samurai');
    expect(a).toMatchObject({ kind: 'dat-unit-560', maxHp: 80 });
    expect(castle.garrison![0]).toMatchObject({ kind: 'dat-unit-560', maxHp: 80 });
    expect(train(s, castle, 'dat-unit-560').maxHp).toBe(80);
    expect(applyCommand(s, { kind: 'train', player: 2, buildingId: other.id, unit: 'dat-unit-291' }).ok).toBe(false);
  });

  it('Samurai rush only on attack approach and keep unique-unit bonus damage', () => {
    const s = arena(), samurai = unit(s, 'dat-unit-291', 1, 50, 50), target = unit(s, 'longbowman', 2, 55, 50);
    target.attackCooldown = 10000;
    order(s, samurai, target); stepGame(s);
    expect(Math.hypot(samurai.position.x - 50, samurai.position.y - 50)).toBeCloseTo(1.25 / TICKS_PER_SECOND, 5);
    const copy = JSON.parse(JSON.stringify(s));
    for (let i = 0; i < 10; i++) { stepGame(s); stepGame(copy); }
    expect(synchronizationHash(copy)).toBe(synchronizationHash(s));
    const hp = target.hp; until(s, () => target.hp < hp);
    expect(hp - target.hp).toBe(20); // 10 melee + 10 unique class19
    expect(applyCommand(s, { kind: 'order', player: 1, entityIds: [samurai.id], target: { x: 60, y: 50 } }).ok).toBe(true);
    const start = { ...samurai.position }; stepGame(s);
    expect(Math.hypot(samurai.position.x - start.x, samurai.position.y - start.y)).toBeCloseTo(1 / TICKS_PER_SECOND, 5);
    expect(samurai.attackApproachTarget).toBeUndefined();
  });

  it.each([
    ['dat-unit-291', 1.5, 1], ['dat-unit-291', 3, 1.25], ['dat-unit-291', 6.5, 1],
    ['dat-unit-560', 6.5, 1.25], ['dat-unit-560', 7.5, 1],
  ] as const)('%s starts a %.1f-tile approach at speed multiplier%s', (kind, gap, multiplier) => {
    const s = arena(3), samurai = unit(s, kind, 1, 50, 50), target = unit(s, 'villager', 2, 50 + gap, 50);
    unit(s, 'villager', 1, 50 + gap, 54); // visible target without changing its distance
    order(s, samurai, target); stepGame(s);
    expect(Math.hypot(samurai.position.x - 50, samurai.position.y - 50)).toBeCloseTo(multiplier / TICKS_PER_SECOND, 5);
  });

  it('Yasama fires three actual arrows from empty existing/new/upgraded towers, preserving JSON continuation', () => {
    const s = arena(3), castle = building(s, 'castle', 1), university = building(s, 'university', 1, 28, 20);
    const tower = building(s, 'watch-tower', 1, 40.5, 50.5);
    research(s, castle, 'yasama');
    const volley = (home: Entity) => {
      const target = unit(s, 'villager', 2, home.position.x + 6, home.position.y); target.hp = target.maxHp = 10000;
      home.attackCooldown = 0; const next = s.nextId;
      until(s, () => s.projectiles.some(p => p.shooterId === home.id && p.id >= next));
      expect(s.projectiles.filter(p => p.shooterId === home.id && p.id >= next)).toHaveLength(3);
      until(s, () => target.hp < 10000);
      expect(applyCommand(s, { kind: 'delete', player: 2, entityIds: [target.id] }).ok).toBe(true);
    };
    volley(tower);
    research(s, university, 'guard-tower'); expect(tower.kind).toBe('guard-tower'); volley(tower);
    research(s, university, 'keep'); expect(tower.kind).toBe('keep'); volley(tower);
    volley(building(s, 'keep', 1, 40.5, 70.5));
    const copy = JSON.parse(JSON.stringify(s));
    for (let i = 0; i < 50; i++) { stepGame(s); stepGame(copy); }
    expect(synchronizationHash(copy)).toBe(synchronizationHash(s));
    expect(buildingRulesFor(s, 2, 'watch-tower').garrison?.volley?.base).toBe(1);
  });

  it.each([false, true])('Kataparuto quarters real pack/unpack time and reduces live shot intervals (legacy=%s)', legacy => {
    const s = arena(3);
    if (legacy) useLegacyPacking(s);
    const castle = building(s, 'castle', 1), treb = train(s, castle, 'trebuchet');
    const normalTicks = legacy ? 90 : 222, researchedTicks = legacy ? 23 : 56;
    treb.position = { x: 50, y: 50 };
    const pack = (unpacked: boolean) => {
      expect(applyCommand(s, { kind: 'pack', player: 1, entityIds: [treb.id], unpacked }).ok).toBe(true);
      const start = s.tick; until(s, () => treb.packingTicks === undefined); return s.tick - start;
    };
    const normal = pack(true); expect(normal).toBe(normalTicks); expect(pack(false)).toBe(normal);
    for (let cycle = 0; cycle < 2; cycle++) {
      expect(pack(true)).toBe(normalTicks); expect(pack(false)).toBe(normalTicks);
    }
    research(s, castle, 'kataparuto');
    for (let cycle = 0; cycle < 3; cycle++) {
      expect(pack(true)).toBe(researchedTicks); expect(pack(false)).toBe(researchedTicks);
    }
    pack(true);
    const target = building(s, 'house', 2, 62, 50); target.hp = target.maxHp = 10000;
    order(s, treb, target);
    const releases: number[] = []; let last = 0;
    until(s, () => {
      const shot = s.projectiles.find(p => p.shooterId === treb.id && p.id > last);
      if (shot) { releases.push(s.tick); last = shot.id; }
      return releases.length === 2;
    });
    expect(releases[1] - releases[0]).toBe(Math.round(7.5 * TICKS_PER_SECOND));
    const fresh = train(s, castle, 'trebuchet');
    expect(unitRulesForEntity(s, fresh).unpacked!.seconds).toBeCloseTo(legacy ? 1.125 : 50 / 18);
    expect(unitRulesFor(s, 2, 'trebuchet').unpacked!.seconds).toBeCloseTo(legacy ? 4.5 : 50 / 4.5);
  });

  it('captures a Samurai with its charge and wounds and does not retroactively give it the donor Elite upgrade', () => {
    const s = arena(3), castle = building(s, 'castle', 1), samurai = unit(s, 'dat-unit-291', 1, 54, 50);
    const monk = unit(s, 'monk', 2, 46, 50); samurai.hp -= 7;
    order(s, monk, samurai); until(s, () => samurai.owner === 2);
    research(s, castle, 'elite-samurai');
    expect(samurai).toMatchObject({ kind: 'dat-unit-291', owner: 2, hp: 63, maxHp: 70 });
    expect(unitRulesForEntity(s, samurai).attackApproach?.maximumDistance).toBe(6);
  });

  it('upgrades Cannon Galleons through paid dock research and launches the elite cannon projectile', () => {
    const s = arena(3, true), dock = building(s, 'dock', 1, 30, 40), university = building(s, 'university', 1);
    research(s, university, 'chemistry');
    const ship = train(s, dock, 'cannon-galleon');
    research(s, dock, 'elite-cannon-galleon'); expect(ship.kind).toBe('dat-unit-691');
    ship.position = { x: 50, y: 50 };
    const target = building(s, 'house', 2, 60, 50); target.hp = target.maxHp = 10000;
    order(s, ship, target); until(s, () => target.hp < 10000);
    expect(10000 - target.hp).toBeGreaterThan(250);
  });

  it('replays mixed Japanese/Briton opening commands across the JSON wire', async () => {
    const player: Strategy = { decide({ observation: o }) {
      if (o.time !== 0) return [];
      const tc = o.entities.find(e => e.owner === o.player && e.kind === 'town-center')!;
      return [{ kind: 'research', player: o.player, buildingId: tc.id, tech: 'loom' },
        { kind: 'train', player: o.player, buildingId: tc.id, unit: 'villager' }];
    } };
    const { record, result } = await runMatch({ version: 1, seed: 183, civilizations: { 1: 'japanese', 2: 'britons' },
      maxTimeSeconds: 30, decideIntervalSeconds: 1 }, { 1: player, 2: player }, imported!);
    expect(result.rejectedCommands).toEqual([]);
    expect(replayRecord(JSON.parse(JSON.stringify(record)), imported!).ok).toBe(true);
  });
});
