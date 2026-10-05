import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { rulesFromManifest, TICKS_PER_SECOND, type GameRules } from './data';
import { activateAutomaticTechnologies, addNode, applyCommand, createGame, stepGame } from './game';
import { buildingRulesFor, unitRulesFor } from './rules';
import { updateVisibility } from './visibility';
import { synchronizationHash } from '../shared/checksum';
import { replayRecord, runMatch, type Strategy } from '../headless/runner';
import type { BuildingKind, Entity, GameState, PlayerId, UnitKind } from './types';

const path = process.env.CIV_PROFILE_CONTENT ?? 'public/imported/aoe2/manifest.json';
const rules = existsSync(path) ? rulesFromManifest(JSON.parse(readFileSync(path, 'utf8'))) : undefined;
if (process.env.CIV_PROFILE_CONTENT && !rules?.civilizations?.celts) throw new Error('fixture lacks Celts');
// The cross-age movement scenario tests activation, not research/creation time.
// Shorten only its prerequisite clocks, once, without cloning the full rules or
// touching source movement, costs, gates, effects or the production-timing tests.
function movementProfile<T extends Pick<GameRules, 'technologies' | 'units'>>(profile: T): T {
  const technologies = { ...profile.technologies };
  for (const key of ['feudal-age', 'castle-age', 'imperial-age']) {
    if (technologies[key]) technologies[key] = { ...technologies[key], researchSeconds: .1 };
  }
  return { ...profile, technologies,
    units: { ...profile.units, militia: { ...profile.units.militia, trainSeconds: .1 } } };
}
const movementRules = rules ? { ...movementProfile(rules),
  civilizations: Object.fromEntries(Object.entries(rules.civilizations ?? {}).map(([key, profile]) =>
    [key, key === 'celts' || key === 'britons' ? movementProfile(profile) : profile])) } : undefined;
function arena(age = 2, source = rules) {
  const s = createGame(191, source!, { 1: 'celts', 2: 'britons' });
  s.entities = s.entities.filter(e => e.kind === 'town-center');
  s.entities.forEach((e, i) => e.position = { x: 10 + i * 80, y: 10 });
  s.terrain.fill(0); s.elevation.fill(0);
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
// Rounded DAT command operands, not rounded help-text percentages.
const speedFactors = [1.05, 1.05 * 1.04762, 1.05 * 1.04762 * 1.04545,
  1.05 * 1.04762 * 1.04545 * 1.04348];
function walk(s: GameState, e: Entity, expectedSpeed: number) {
  // Tile-centred straight lanes avoid the pathfinder's initial diagonal to
  // a tile centre; measure travelled distance on every tick, not a rules lookup.
  e.position = { x: Math.floor(e.position.x) + .5, y: Math.floor(e.position.y) + .5 };
  const start = { ...e.position };
  expect(applyCommand(s, { kind: 'order', player: e.owner as PlayerId, entityIds: [e.id],
    target: { x: start.x + 12, y: start.y } }).ok).toBe(true);
  for (let i = 0; i < TICKS_PER_SECOND; i++) {
    const before = { ...e.position }; stepGame(s);
    expect(Math.hypot(e.position.x - before.x, e.position.y - before.y)).toBeCloseTo(expectedSpeed / TICKS_PER_SECOND, 6);
  }
  expect(e.position.x - start.x).toBeCloseTo(expectedSpeed, 6);
  expect(e.position.y).toBeCloseTo(start.y, 6);
  expect(applyCommand(s, { kind: 'stop', player: e.owner as PlayerId, entityIds: [e.id] }).ok).toBe(true);
}
function continuation(s: GameState, ticks: number) {
  const saved: GameState = JSON.parse(JSON.stringify(s));
  for (let i = 0; i < ticks; i++) { stepGame(s); stepGame(saved); }
  expect(synchronizationHash(s)).toBe(synchronizationHash(saved));
}
function volleys(s: GameState, shooters: Entity[], ticks: number) {
  const shots: number[][] = shooters.map(() => []);
  for (let i = 0; i < ticks; i++) {
    const first = s.nextId; stepGame(s);
    shooters.forEach((e, j) => {
      if (s.projectiles.some(p => p.id >= first && p.shooterId === e.id)) shots[j].push(s.tick);
    });
  }
  return shots;
}

describe.skipIf(!rules?.civilizations?.celts)('owned Celts gameplay', () => {
  it.each([0, 3])('banks wood sooner at age %i with source work rate, not opponent', age => {
    const s = arena(age), workers: Entity[] = [], trees: Entity[] = [];
    for (const owner of [1, 2] as const) {
      const x = owner === 1 ? 40 : 80;
      home(s, 'lumber-camp', owner, x - 4, 40);
      const worker = unit(s, 'villager', owner, x, 40), tree = addNode(s, 'tree', { x: x + 1, y: 40 });
      workers.push(worker); trees.push(tree); order(s, worker, tree);
    }
    until(s, () => workers.every(w => w.activity === 'gathering'), 100);
    const extracted = (i: number) => -trees[i].amount! + (workers[i].gatherProgress ?? 0);
    const before = workers.map((_, i) => extracted(i));
    for (let i = 0; i < 10 * TICKS_PER_SECOND; i++) stepGame(s);
    expect(extracted(0) - before[0]).toBeCloseTo(.39 * 1.15 * 10, 5);
    expect(extracted(1) - before[1]).toBeCloseTo(.39 * 10, 5);
    const banks = [s.players[1].wood, s.players[2].wood];
    until(s, () => s.players[1].wood > banks[0] || s.players[2].wood > banks[1], 1600);
    expect(s.players[1].wood - banks[0]).toBe(10); expect(s.players[2].wood - banks[1]).toBe(0);
    until(s, () => s.players[2].wood > banks[1], 400); expect(s.players[2].wood - banks[1]).toBe(10);
    continuation(s, 100);
  });

  it('moves existing, new and ungarrisoned infantry at each age, with equal-age opponents unchanged', () => {
    const s = arena(0, movementRules);
    const sides = ([1, 2] as const).map(owner => {
      const x = owner === 1 ? 20 : 80;
      const tc = s.entities.find(e => e.kind === 'town-center' && e.owner === owner)!;
      const barracks = home(s, 'barracks', owner, x, 20);
      home(s, 'mill', owner, x, 30); home(s, 'lumber-camp', owner, x, 40);
      home(s, 'market', owner, x, 50); home(s, 'blacksmith', owner, x, 60); home(s, 'castle', owner, x, 70);
      const old = train(s, barracks, 'militia'), inside = unit(s, 'militia', owner, tc.position.x, 13);
      order(s, inside, tc); until(s, () => !!tc.garrison?.length);
      return { owner, tc, barracks, old, inside };
    });
    for (let age = 0; age <= 3; age++) {
      if (age) for (const side of sides) research(s, side.tc, ['feudal-age', 'castle-age', 'imperial-age'][age - 1]);
      expect([s.players[1].age, s.players[2].age]).toEqual([age, age]);
      for (const { owner, tc, barracks, old, inside } of sides) {
        expect(applyCommand(s, { kind: 'ungarrison', player: owner, buildingId: tc.id }).ok).toBe(true);
        const fresh = train(s, barracks, 'militia');
        for (const [i, e] of [old, inside, fresh].entries()) {
          e.position = { x: owner === 1 ? 40 : 70, y: 80 + i * 5 };
          walk(s, e, .9 * (owner === 1 ? speedFactors[age] : 1));
        }
        expect(applyCommand(s, { kind: 'delete', player: owner, entityIds: [fresh.id] }).ok).toBe(true);
        inside.position = { x: tc.position.x, y: 13 };
        order(s, inside, tc); until(s, () => !!tc.garrison?.length);
      }
    }
    continuation(s, 40);
  });

  it.each([['mangonel', 6, 6], ['scorpion', 3.6, 1]] as const)('%s fires on the source siege clock without leaking', (kind, reload, count) => {
    const s = arena(), shooters: Entity[] = [];
    for (const owner of [1, 2] as const) {
      const x = owner === 1 ? 40 : 80;
      const shooter = unit(s, kind, owner, x, 40), target = home(s, 'house', owner === 1 ? 2 : 1, x + 5.5, 40.5);
      target.hp = target.maxHp = 10000; order(s, shooter, target); shooters.push(shooter);
    }
    const shots = volleys(s, shooters, 400);
    shots.forEach((times, i) => {
      // Mangonel's DAT volley has six shots, secondary spacing 1/6 second.
      // Separate intra-volley spacing from attack reload instead of mistaking
      // each small stone for a new attack.
      const attacks = times.filter((_, j) => j % count === 0);
      expect(attacks.length).toBeGreaterThanOrEqual(3);
      const interval = Math.round(reload * (i === 0 ? .8 : 1) * TICKS_PER_SECOND);
      expect(attacks.slice(1).map((t, j) => t - attacks[j])).toEqual(Array(attacks.length - 1).fill(interval));
      if (count > 1) for (let j = 1; j < times.length; j++) {
        if (j % count !== 0) expect(times[j] - times[j - 1]).toBe(Math.round(TICKS_PER_SECOND / 6));
      }
    });
    expect(shots[0].length).toBeGreaterThan(shots[1].length); continuation(s, 100);
  });

  it('team401 accelerates workshop production only, with exact payments/refunds and JSON continuation', () => {
    const s = arena(), shops = [home(s, 'siege-workshop'), home(s, 'siege-workshop', 2, 80, 20)];
    const first = s.nextId, start = s.tick;
    for (const b of shops) {
      const owner = b.owner as PlayerId, bank = { ...s.players[owner] };
      const cmd = { kind: 'train' as const, player: owner, buildingId: b.id, unit: 'mangonel' as const };
      expect(applyCommand(s, cmd).ok).toBe(true);
      expect(bank.wood - s.players[owner].wood).toBe(160); expect(bank.gold - s.players[owner].gold).toBe(135);
      expect(applyCommand(s, { kind: 'cancel-train', player: owner, buildingId: b.id }).ok).toBe(true);
      expect(s.players[owner].wood).toBe(bank.wood); expect(s.players[owner].gold).toBe(bank.gold);
      expect(applyCommand(s, cmd).ok).toBe(true);
    }
    continuation(s, 100);
    const completed = [0, 0];
    until(s, () => {
      for (let i = 0; i < 2; i++) if (!completed[i] && s.entities.some(e => e.id >= first && e.owner === i + 1 && e.kind === 'mangonel')) completed[i] = s.tick - start;
      return completed.every(Boolean);
    });
    expect(completed).toEqual([Math.ceil(46 * TICKS_PER_SECOND / 1.2), 46 * TICKS_PER_SECOND]);
    for (const owner of [1, 2] as const) {
      const barracks = home(s, 'barracks', owner, owner === 1 ? 30 : 90, 20), tick = s.tick;
      train(s, barracks, 'militia'); expect(s.tick - tick).toBe(21 * TICKS_PER_SECOND);
    }
  });

  it('trains, promotes wounded/garrisoned Woad Raiders and preserves captured speed across JSON', () => {
    const s = arena(2), castle = home(s, 'castle'), bank = { ...s.players[1] }, start = s.tick;
    const a = train(s, castle, 'dat-unit-232');
    expect(s.tick - start).toBe(10 * TICKS_PER_SECOND);
    expect(bank.food - s.players[1].food).toBe(70); expect(bank.gold - s.players[1].gold).toBe(25);
    expect(a.hp).toBe(70); a.position = { x: 40, y: 40 }; walk(s, a, 1.17 * speedFactors[2]); a.hp -= 9;
    const inside = unit(s, 'dat-unit-232', 1, 20, 23); order(s, inside, castle); until(s, () => !!castle.garrison?.length);
    expect(applyCommand(s, { kind: 'research', player: 1, buildingId: castle.id, tech: 'elite-woad-raider' }).ok).toBe(false);
    research(s, s.entities.find(e => e.owner === 1 && e.kind === 'town-center')!, 'imperial-age');
    const before = { ...s.players[1] }; research(s, castle, 'elite-woad-raider');
    expect(before.food - s.players[1].food).toBe(1000); expect(before.gold - s.players[1].gold).toBe(800);
    expect(a.kind).toBe('dat-unit-534'); expect(a.maxHp).toBe(85); expect(a.hp).toBe(76);
    expect(castle.garrison![0].kind).toBe('dat-unit-534'); expect(castle.garrison![0].hp).toBe(85);
    expect(train(s, castle, 'dat-unit-534').hp).toBe(85);
    a.position = { x: 50, y: 50 }; walk(s, a, 1.17 * speedFactors[3]);
    const foreign = home(s, 'castle', 2, 80, 80);
    expect(applyCommand(s, { kind: 'train', player: 2, buildingId: foreign.id, unit: 'dat-unit-232' }).ok).toBe(false);
    expect(applyCommand(s, { kind: 'train', player: 1, buildingId: castle.id, unit: 'dat-unit-46' }).ok).toBe(false);
    const monk = unit(s, 'monk', 2, 57, 50); monk.hp = monk.maxHp = 10000;
    order(s, monk, a); until(s, () => a.owner === 2, 600); expect(a.convertedRules?.hp).toBe(85);
    a.position = { x: 40, y: 60 }; walk(s, a, 1.17 * speedFactors[3]); continuation(s, 60);
  });

  it.each(['castle', 'watch-tower', 'guard-tower', 'keep'] as const)('Stronghold changes actual %s volleys, not opponent reloads', kind => {
    const s = arena(3), castle = home(s, 'castle'), shooters: Entity[] = [];
    // Both existing and newly-created buildings consume the same paid effect.
    if (kind === 'castle' || kind === 'watch-tower') {
      shooters.push(home(s, kind, 1, 40, 40), home(s, kind, 2, 80, 40));
    }
    const before = { ...s.players[1] }; research(s, castle, 'stronghold');
    expect(before.food - s.players[1].food).toBe(250); expect(before.gold - s.players[1].gold).toBe(200);
    for (const owner of [1, 2] as const) {
      const x = owner === 1 ? 40 : 80;
      const b = shooters[owner - 1] ?? home(s, kind, owner, x, 40);
      const target = home(s, 'house', owner === 1 ? 2 : 1, x + 5.5, 40.5);
      target.hp = target.maxHp = 10000; order(s, b, target); shooters[owner - 1] = b;
    }
    const shots = volleys(s, shooters, 200);
    shots.forEach((times, i) => {
      const interval = (i === 0 ? 1.5 : 2) * TICKS_PER_SECOND;
      expect(times.length).toBeGreaterThanOrEqual(4);
      expect(times.slice(1).map((t, j) => t - times[j])).toEqual(Array(times.length - 1).fill(interval));
    });
    expect(shots[0].length).toBeGreaterThan(shots[1].length);
  });

  it('Stronghold heals only nearby living infantry, clamps, does not stack, and continues through JSON', () => {
    const s = arena(), castle = home(s, 'castle', 1, 40, 40);
    const second = home(s, 'castle', 1, 40, 44); home(s, 'castle', 2, 80, 40);
    const infantry = unit(s, 'militia', 1, 46, 40), outside = unit(s, 'militia', 1, 47.01, 40);
    const boundary = unit(s, 'militia', 1, 40, 33), overlap = unit(s, 'militia', 1, 44, 42);
    const cavalry = unit(s, 'knight', 1, 44, 40);
    const dead = unit(s, 'militia', 1, 44, 38); dead.hp = 0;
    for (const e of [infantry, boundary, overlap, outside, cavalry]) e.hp = 1;
    continuation(s, 40); expect(infantry.hp).toBe(1); research(s, castle, 'stronghold');
    for (const e of [infantry, boundary, overlap]) e.hp = 1;
    continuation(s, 4 * TICKS_PER_SECOND);
    expect(infantry.hp).toBeCloseTo(3); expect(outside.hp).toBe(1); expect(cavalry.hp).toBe(1); expect(dead.hp).toBe(0);
    expect(boundary.hp).toBeCloseTo(3); expect(overlap.hp).toBeCloseTo(3);
    expect(outside.position).toEqual({ x: 47.01, y: 40 });
    expect(boundary.position).toEqual({ x: 40, y: 33 });
    expect(Math.hypot(overlap.position.x - second.position.x, overlap.position.y - second.position.y)).toBeLessThan(7);
    infantry.hp = infantry.maxHp - .2; continuation(s, 20); expect(infantry.hp).toBe(infantry.maxHp);
    expect(applyCommand(s, { kind: 'order', player: 1, entityIds: [infantry.id], target: { x: 55, y: 40 } }).ok).toBe(true);
    until(s, () => infantry.position.x > 48, 200); infantry.hp = 1; continuation(s, 20); expect(infantry.hp).toBe(1);
  });

  it('Stronghold does not heal opponent infantry inside a researched castle aura', () => {
    const s = arena(), castle = home(s, 'castle', 1, 40, 40); research(s, castle, 'stronghold');
    const rival = unit(s, 'militia', 2, 46, 40); rival.hp = 1;
    // Keep this control separate from friendly patients: otherwise automatic
    // combat (not healing) kills it during the research fixture. Only shooting
    // is suppressed; owner, target identity and aura radius remain source rules.
    castle.attackCooldown = rival.attackCooldown = 100000;
    continuation(s, 4 * TICKS_PER_SECOND); expect(rival.hp).toBe(1);
    expect(Math.hypot(rival.position.x - 40, rival.position.y - 40)).toBeLessThanOrEqual(7);
  });

  it.each(['foundation', 'zero-hp', 'destroyed'] as const)('Stronghold does not emanate from a %s castle', condition => {
    const s = arena(), researcher = home(s, 'castle'); research(s, researcher, 'stronghold');
    const source = home(s, 'castle', 1, 40, 40), patient = unit(s, 'militia', 1, 46, 40); patient.hp = 1;
    if (condition === 'foundation') source.buildProgress = .25;
    else if (condition === 'zero-hp') source.hp = 0;
    else {
      expect(applyCommand(s, { kind: 'delete', player: 1, entityIds: [source.id] }).ok).toBe(true);
      expect(source.dead).toBe(true);
    }
    continuation(s, 4 * TICKS_PER_SECOND); expect(patient.hp).toBe(1);
    if (condition === 'foundation') expect(source.buildProgress).toBe(.25);
  });

  it('Stronghold target mask includes source unit1831 independently of infantry class6', () => {
    const s = arena(), castle = home(s, 'castle', 1, 40, 40); research(s, castle, 'stronghold');
    // 1831 (relic-carrying Warrior Priest, DAT class43) is not in the playable
    // roster. A synthetic captured-rule identity isolates the shared ID mask;
    // this is not a claim that the absent unit can be trained or rendered.
    const priest = unit(s, 'monk', 1, 46, 40), other = unit(s, 'monk', 1, 40, 46);
    priest.convertedRules = { ...structuredClone(unitRulesFor(s, 1, 'monk')), datId: 1831, datClass: 43 };
    other.convertedRules = { ...structuredClone(unitRulesFor(s, 1, 'monk')), datId: 125, datClass: 43 };
    priest.hp = other.hp = 1;
    continuation(s, 4 * TICKS_PER_SECOND);
    expect(priest.hp).toBeCloseTo(3); expect(other.hp).toBe(1);
  });

  it('garrisoned infantry receives ordinary castle healing only; ungarrison restores the aura', () => {
    const s = arena(), castle = home(s, 'castle', 1, 40, 40); research(s, castle, 'stronghold');
    const patient = unit(s, 'militia', 1, 40, 43); order(s, patient, castle);
    until(s, () => !!castle.garrison?.some(e => e.id === patient.id));
    patient.hp = 1; patient.gatherProgress = 0;
    // DAT castle garrison rate .2 HP/s is banked as whole HP, not aura .5/s.
    continuation(s, 6 * TICKS_PER_SECOND);
    expect(patient.hp).toBe(2); expect(patient.gatherProgress).toBeCloseTo(.2);
    expect(applyCommand(s, { kind: 'ungarrison', player: 1, buildingId: castle.id }).ok).toBe(true);
    patient.hp = 1; continuation(s, 4 * TICKS_PER_SECOND); expect(patient.hp).toBeCloseTo(3);
  });

  it('a captured building source retains its donor aura but heals only the new owner through JSON', () => {
    const s = arena(), castle = home(s, 'castle', 1, 40, 40); research(s, castle, 'stronghold');
    // A saved-scenario capture snapshot, not a claim that conversion-immune
    // castles can be converted by monks. Snapshot donor rules before ownership,
    // exactly as documented by inheritConvertedUnit's building branch.
    expect(buildingRulesFor(s, 1, 'castle').conversionImmune).toBe(true);
    castle.convertedBuildingRules = structuredClone(buildingRulesFor(s, 1, 'castle'));
    castle.owner = 2;
    expect(s.players[2].researched).not.toContain('stronghold');
    expect(buildingRulesFor(s, 2, 'castle').healingAura).toBeUndefined();
    expect(castle.convertedBuildingRules.healingAura?.hitPointsPerSecond).toBe(.5);
    const former = unit(s, 'militia', 1, 34, 40), current = unit(s, 'militia', 2, 46, 40);
    former.hp = current.hp = 1;
    castle.attackCooldown = former.attackCooldown = current.attackCooldown = 100000;
    continuation(s, 4 * TICKS_PER_SECOND);
    expect(current.hp).toBeCloseTo(3); expect(former.hp).toBe(1);
    for (const e of [former, current]) expect(Math.hypot(e.position.x - 40, e.position.y - 40)).toBeLessThanOrEqual(7);
  });

  it('Furor Celtica raises existing and new siege HP by 40%, preserves wounds, and excludes opponent/infantry', () => {
    const s = arena(), castle = home(s, 'castle'), shop = home(s, 'siege-workshop', 1, 30, 20);
    expect(applyCommand(s, { kind: 'research', player: 1, buildingId: castle.id, tech: 'furor-celtica' }).ok).toBe(false);
    research(s, s.entities.find(e => e.owner === 1 && e.kind === 'town-center')!, 'imperial-age');
    const kinds = [['battering-ram', 175], ['mangonel', 50], ['scorpion', 40], ['trebuchet', 150]] as const;
    const pairs = kinds.map(([kind, hp], i) => {
      const own = unit(s, kind, 1, 40, 40 + i * 5), rival = unit(s, kind, 2, 80, 40 + i * 5);
      expect(own.hp).toBe(hp); own.hp -= 7; return { own, rival, hp };
    });
    const infantry = unit(s, 'militia', 1, 50, 80), before = { ...s.players[1] }; research(s, castle, 'furor-celtica');
    expect(before.food - s.players[1].food).toBe(750); expect(before.gold - s.players[1].gold).toBe(450);
    for (const { own, rival, hp } of pairs) { expect(own.maxHp).toBe(hp * 1.4); expect(own.hp).toBe(hp * 1.4 - 7); expect(rival.maxHp).toBe(hp); }
    expect(infantry.maxHp).toBe(40); expect(train(s, shop, 'mangonel').maxHp).toBe(70);
    expect(train(s, castle, 'trebuchet').maxHp).toBe(210); continuation(s, 40);
  });

  it('enabled mixed selection and public opening replay deterministically', async () => {
    expect(rules!.civilizations!.celts.civilization.enabled).toBe(true);
    const player: Strategy = { decide({ observation: o }) {
      if (o.time !== 0) return [];
      const tc = o.entities.find(e => e.owner === o.player && e.kind === 'town-center')!;
      return [{ kind: 'train', player: o.player, buildingId: tc.id, unit: 'villager' }];
    } };
    const { record, result } = await runMatch({ version: 1, seed: 191, civilizations: { 1: 'celts', 2: 'britons' },
      maxTimeSeconds: 10, decideIntervalSeconds: 1 }, { 1: player, 2: player }, rules!);
    expect(result.rejectedCommands).toEqual([]); expect(replayRecord(JSON.parse(JSON.stringify(record)), rules!).ok).toBe(true);
  });
});
