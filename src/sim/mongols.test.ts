import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { rulesFromManifest, TICKS_PER_SECOND } from './data';
import { activateAutomaticTechnologies, addNode, applyCommand, createGame, stepGame } from './game';
import { buildingRulesFor, unitRulesFor } from './rules';
import { observe } from './observe';
import { isTileVisible, updateVisibility } from './visibility';
import { synchronizationHash } from '../shared/checksum';
import { replayRecord, runMatch, type Strategy } from '../headless/runner';
import type { BuildingKind, Entity, GameState, PlayerId, UnitKind } from './types';

const path = process.env.CIV_PROFILE_CONTENT ?? 'public/imported/aoe2/manifest.json';
const rules = existsSync(path) ? rulesFromManifest(JSON.parse(readFileSync(path, 'utf8'))) : undefined;
if (process.env.CIV_PROFILE_CONTENT && !rules?.civilizations?.mongols) throw new Error('fixture lacks Mongols');
// Outcome fixtures do not measure research/training duration. Prepare their
// two-tick clocks once, not a full rules clone per match. Keep zero-time grants,
// costs, prerequisites, bonuses and all combat/gather/movement clocks intact.
// Opening replay below still uses the untouched source rules.
const fixtureRules = rules ? structuredClone(rules) : undefined;
if (fixtureRules) for (const profile of [fixtureRules, ...Object.values(fixtureRules.civilizations ?? {})]) {
  for (const tech of Object.values(profile.technologies)) if (tech.researchSeconds > 0) tech.researchSeconds = .1;
  for (const unit of Object.values(profile.units)) {
    if (unit.trainSeconds > 0) unit.trainSeconds = .1;
    for (const location of unit.trainLocations ?? []) if (location.seconds > 0) location.seconds = .1;
  }
}
function arena(age = 2, rival = 'britons') {
  const s = createGame(190, fixtureRules!, { 1: 'mongols', 2: rival });
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
  expect(applyCommand(s, { kind: 'order', player: actor.owner as PlayerId, entityIds: [actor.id], targetId: target.id, target: target.position })).toEqual({ ok: true });
}
function research(s: GameState, building: Entity, tech: string) {
  expect(applyCommand(s, { kind: 'research', player: building.owner as PlayerId, buildingId: building.id, tech }), tech).toEqual({ ok: true });
  until(s, () => s.players[building.owner as PlayerId].researched.includes(tech));
}
function researchPendingJSON(s: GameState, building: Entity, tech: string) {
  const owner = building.owner as PlayerId;
  expect(applyCommand(s, { kind: 'research', player: owner, buildingId: building.id, tech }), tech).toEqual({ ok: true });
  // The shortened clock still crosses a real pending-research completion boundary.
  until(s, () => building.researching?.remainingTicks === 1);
  expect(s.players[owner].researched).not.toContain(tech);
  const saved: GameState = JSON.parse(JSON.stringify(s));
  expect(saved.entities.find(e => e.id === building.id)!.researching?.remainingTicks).toBe(1);
  for (let i = 0; i < 40; i++) { stepGame(s); stepGame(saved); }
  expect(saved.players[owner].researched).toContain(tech);
  expect(synchronizationHash(saved)).toBe(synchronizationHash(s));
  return saved;
}
function train(s: GameState, building: Entity, kind: UnitKind) {
  const first = s.nextId;
  expect(applyCommand(s, { kind: 'train', player: building.owner as PlayerId, buildingId: building.id, unit: kind }), kind).toEqual({ ok: true });
  until(s, () => s.entities.some(e => e.id >= first && e.owner === building.owner && e.kind === kind));
  return s.entities.find(e => e.id >= first && e.owner === building.owner && e.kind === kind)!;
}
function continueJSON(s: GameState, ticks = 40) {
  const saved: GameState = JSON.parse(JSON.stringify(s));
  for (let i = 0; i < ticks; i++) { stepGame(s); stepGame(saved); }
  expect(synchronizationHash(saved)).toBe(synchronizationHash(s));
}
function ageHomes(s: GameState, owner: PlayerId) {
  const x = owner === 1 ? 20 : 90;
  for (const [i, kind] of (['mill', 'lumber-camp', 'market', 'blacksmith', 'castle'] as const).entries()) home(s, kind, owner, x, 30 + 10 * i);
  return s.entities.find(e => e.owner === owner && e.kind === 'town-center')!;
}

describe.skipIf(!rules?.civilizations?.mongols)('owned Mongols gameplay', () => {
  it('hunters extract at the source 1.4 rate and bank more food at the same clock, owner-locally', () => {
    const s = arena(0), workers: Entity[] = [], foragers: Entity[] = [];
    for (const owner of [1, 2] as const) {
      const x = owner === 1 ? 30 : 75;
      home(s, 'mill', owner, x - 4, 50);
      const animal = unit(s, 'boar', owner, x + 1, 50);
      Object.assign(animal, { dead: true, amount: 1000, resourceKind: 'food', decayTicks: 100000 });
      const worker = unit(s, 'villager', owner, x, 50);
      workers.push(worker); order(s, worker, animal);
      home(s, 'mill', owner, x - 4, 75);
      const forager = unit(s, 'villager', owner, x, 75);
      foragers.push(forager); order(s, forager, addNode(s, 'berries', { x: x + 1, y: 75 }));
    }
    until(s, () => [...workers, ...foragers].every(w => w.activity === 'gathering'), 100);
    const gathered = (i: number) => (workers[i].carrying?.amount ?? 0) + (workers[i].gatherProgress ?? 0);
    const foraged = (i: number) => (foragers[i].carrying?.amount ?? 0) + (foragers[i].gatherProgress ?? 0);
    const before = workers.map((_, i) => gathered(i));
    const control = foragers.map((_, i) => foraged(i));
    for (let i = 0; i < 10 * TICKS_PER_SECOND; i++) stepGame(s);
    expect(gathered(0) - before[0]).toBeCloseTo(.41 * 1.4 * 10, 5);
    expect(gathered(1) - before[1]).toBeCloseTo(.41 * 10, 5);
    for (const [i, worker] of foragers.entries()) {
      expect(foraged(i) - control[i]).toBeCloseTo(.31 * 10, 5);
      expect(applyCommand(s, { kind: 'stop', player: worker.owner as PlayerId, entityIds: [worker.id] }).ok).toBe(true);
    }
    const bank = [s.players[1].food, s.players[2].food];
    until(s, () => s.players[1].food > bank[0] || s.players[2].food > bank[1], 2400);
    expect(s.players[1].food - bank[0]).toBe(35); expect(s.players[2].food - bank[1]).toBe(0);
    continueJSON(s);
    for (let i = 0; i < 180 * TICKS_PER_SECOND; i++) stepGame(s);
    expect(s.players[1].food - bank[0]).toBeGreaterThan(s.players[2].food - bank[1]);
    for (const owner of [1, 2] as const) expect((s.players[owner].food - bank[owner - 1]) % 35).toBe(0);
  });

  it.each([1, 2, 3])('paid age and cavalry upgrades through age %i give source HP to existing/new troops at equal ages, never to the rival', age => {
    const s = arena(0, 'byzantines');
    const sides = ([1, 2] as const).map(owner => ({ owner, tc: ageHomes(s, owner),
      stable: home(s, 'stable', owner, owner === 1 ? 30 : 80, 20),
      scout: unit(s, 'scout-cavalry', owner, owner === 1 ? 40 : 80, 45) }));
    for (const side of sides) { expect(side.scout.maxHp).toBe(45); side.scout.hp -= 7; }
    for (const [index, tech] of ['feudal-age', 'castle-age', 'imperial-age'].slice(0, age).entries()) {
      for (const side of sides) research(s, side.tc, tech);
      expect(s.players[1].age).toBe(index + 1); expect(s.players[2].age).toBe(index + 1);
      const factor = index === 0 ? 1 : index === 1 ? 1.2 : 1.2 * 1.084;
      for (const { owner, scout, stable } of sides) {
        if (index > 0) research(s, stable, index === 1 ? 'light-cavalry' : 'hussar');
        const base = [45, 60, 75][index], hp = base * (owner === 1 ? factor : 1);
        expect(scout.maxHp).toBeCloseTo(hp, 5); expect(scout.maxHp - scout.hp).toBeCloseTo(7, 5);
        expect(train(s, stable, scout.kind as UnitKind).maxHp).toBeCloseTo(hp, 5);
      }
      continueJSON(s, 1);
    }
    expect(s.players[1].researched.includes('automatic-288')).toBe(age >= 2);
    expect(s.players[1].researched.includes('automatic-388')).toBe(age >= 3);
    expect(s.players[1].researched).not.toContain('automatic-286');
    expect(s.players[1].researched).not.toContain('automatic-287');
  });

  it.each(['before-castle', 'after-castle', 'after-imperial'] as const)('Bloodlines %s selects only one HP branch and preserves JSON completion history', when => {
    const s = arena(1, 'saracens'), tc = ageHomes(s, 1), rivalTc = ageHomes(s, 2);
    const stable = home(s, 'stable'), other = home(s, 'stable', 2, 80, 20);
    const a = train(s, stable, 'scout-cavalry'), b = train(s, other, 'scout-cavalry');
    a.hp -= 7;
    let resumed: GameState;
    const bloodlines = () => { resumed = researchPendingJSON(s, stable, 'bloodlines'); research(s, other, 'bloodlines'); };
    if (when === 'before-castle') bloodlines();
    research(s, tc, 'castle-age'); research(s, rivalTc, 'castle-age');
    research(s, stable, 'light-cavalry'); research(s, other, 'light-cavalry');
    if (when === 'after-castle') bloodlines();
    expect(a.maxHp).toBeCloseTo(72 + (when === 'after-imperial' ? 0 : 20), 5);
    expect(b.maxHp).toBe(60 + (when === 'after-imperial' ? 0 : 20));
    resumed = researchPendingJSON(s, tc, 'imperial-age'); research(s, rivalTc, 'imperial-age');
    if (when === 'after-imperial') bloodlines();
    const hp = 72 * (when === 'after-imperial' ? 1.084 : 1.08333) + 20;
    expect(a.maxHp).toBeCloseTo(hp, 5); expect(a.maxHp - a.hp).toBeCloseTo(7, 5);
    expect(resumed.entities.find(e => e.id === a.id)!.maxHp).toBeCloseTo(hp, 5);
    expect(resumed.players[1].researched).toContain(when === 'after-imperial' ? 'automatic-388' : 'automatic-287');
    expect(resumed.players[1].researched).not.toContain(when === 'after-imperial' ? 'automatic-287' : 'automatic-388');
    expect(b.maxHp).toBe(80); expect(train(s, stable, 'light-cavalry').maxHp).toBeCloseTo(hp, 5);
    for (const pair of [[286, 288], [287, 388]]) expect(pair.filter(id => s.players[1].researched.includes(`automatic-${id}`))).toHaveLength(1);
    continueJSON(s);
  });

  it('Steppe Lancers train in Castle, gain Imperial HP and promote through paid elite research', () => {
    const s = arena(2), stable = home(s, 'stable'), tc = ageHomes(s, 1), rivalTc = ageHomes(s, 2);
    const lancer = train(s, stable, 'dat-unit-1370'), rival = unit(s, 'dat-unit-1370', 2, 80, 80);
    expect(lancer.maxHp).toBe(72); expect(rival.maxHp).toBe(60); lancer.hp -= 9;
    const other = home(s, 'stable', 2, 80, 20);
    expect(applyCommand(s, { kind: 'train', player: 2, buildingId: other.id, unit: 'dat-unit-1370' }).ok).toBe(false);
    research(s, tc, 'imperial-age'); research(s, rivalTc, 'imperial-age');
    expect(lancer.maxHp).toBeCloseTo(78.048); expect(rival.maxHp).toBe(60);
    const bank = { ...s.players[1] }; research(s, stable, 'elite-steppe-lancer');
    expect(bank.food - s.players[1].food).toBe(600); expect(bank.gold - s.players[1].gold).toBe(550);
    expect(lancer.kind).toBe('dat-unit-1372'); expect(lancer.maxHp).toBeCloseTo(104.064);
    expect(lancer.maxHp - lancer.hp).toBeCloseTo(9);
    expect(train(s, stable, 'dat-unit-1372').maxHp).toBeCloseTo(104.064);
    continueJSON(s);
  });

  it('Mangudai train at the Castle, promote wounded/garrisoned troops, land shots and retain captured rules', () => {
    const s = arena(3), castle = home(s, 'castle'), a = train(s, castle, 'dat-unit-11');
    expect(a.maxHp).toBe(60); a.hp -= 8;
    const b = unit(s, 'dat-unit-11', 1, 20, 23); order(s, b, castle); until(s, () => castle.garrison?.length === 1);
    const bank = { ...s.players[1] }; research(s, castle, 'elite-mangudai');
    expect(bank.food - s.players[1].food).toBe(1100); expect(bank.gold - s.players[1].gold).toBe(675);
    expect(a.kind).toBe('dat-unit-561'); expect(a.hp).toBe(52);
    expect(castle.garrison![0].kind).toBe('dat-unit-561'); expect(train(s, castle, 'dat-unit-561').maxHp).toBe(60);
    const foreign = home(s, 'castle', 2, 80, 20);
    expect(applyCommand(s, { kind: 'train', player: 2, buildingId: foreign.id, unit: 'dat-unit-11' }).ok).toBe(false);
    a.position = { x: 50, y: 50 };
    const target = unit(s, 'battering-ram', 2, 53, 50); target.attackCooldown = 100000;
    order(s, a, target); until(s, () => target.hp < target.maxHp, 200);
    expect(a.position).toEqual({ x: 50, y: 50 });
    expect(target.maxHp - target.hp).toBe(5); // DAT class-20 +5; 8 pierce cannot penetrate the ram's 180.
    applyCommand(s, { kind: 'stop', player: 1, entityIds: [a.id] });
    applyCommand(s, { kind: 'delete', player: 2, entityIds: [target.id] });
    const monk = unit(s, 'monk', 2, 57, 50); monk.hp = monk.maxHp = 10000;
    order(s, monk, a); until(s, () => a.owner === 2, 600);
    const capturedTarget = home(s, 'house', 1, 54, 50); capturedTarget.hp = capturedTarget.maxHp = 10000;
    order(s, a, capturedTarget);
    const seen = new Set<number>(), shots: number[] = [];
    until(s, () => {
      for (const p of s.projectiles) if (p.shooterId === a.id && !seen.has(p.id)) {
        seen.add(p.id); shots.push(s.tick);
      }
      return shots.length === 4;
    }, 300);
    for (let i = 1; i < shots.length; i++) expect(shots[i] - shots[i - 1]).toBe(Math.round(2.1 * .8 * TICKS_PER_SECOND));
    expect(capturedTarget.hp).toBeLessThan(capturedTarget.maxHp);
    continueJSON(s);
  });

  it.each(['cavalry-archer', 'heavy-cavalry-archer', 'dat-unit-11', 'dat-unit-561'] as const)('%s emits real shots with the source .8 reload multiplier', kind => {
    const s = arena(3), shooters = [unit(s, kind, 1, 40, 50), unit(s, kind, 2, 80, 50)];
    for (const [i, a] of shooters.entries()) {
      const target = home(s, 'house', i === 0 ? 2 : 1, a.position.x + 4, 50); target.hp = target.maxHp = 10000;
      order(s, a, target);
    }
    const seen = new Set<number>(), shots: number[][] = [[], []];
    for (let i = 0; i < 12 * TICKS_PER_SECOND; i++) {
      stepGame(s);
      for (const p of s.projectiles) if (!seen.has(p.id)) {
        seen.add(p.id); const who = shooters.findIndex(a => a.id === p.shooterId);
        if (who >= 0) shots[who].push(s.tick);
      }
    }
    const base = kind.startsWith('dat-') ? 2.1 : 2;
    for (const [i, times] of shots.entries()) {
      expect(times.length).toBeGreaterThanOrEqual(5);
      for (let j = 1; j < times.length; j++) expect(times[j] - times[j - 1]).toBe(Math.round(base * (i === 0 ? .8 : 1) * TICKS_PER_SECOND));
    }
    expect(shots[0].length).toBeGreaterThan(shots[1].length);
    continueJSON(s, 60);
  });

  it('Drill is paid at the Castle and increases actual siege travel by 50%, not the opponent or trebuchets', () => {
    const s = arena(3), castle = home(s, 'castle');
    const ram = train(s, home(s, 'siege-workshop', 1, 30, 20), 'battering-ram');
    const other = train(s, home(s, 'siege-workshop', 2, 80, 20), 'battering-ram');
    const treb = unit(s, 'trebuchet', 1, 40, 80);
    const travel = () => {
      // Cell centres isolate straight-line travel from pathfinder cornering.
      ram.position = { x: 40.5, y: 50.5 }; other.position = { x: 80.5, y: 50.5 }; treb.position = { x: 40.5, y: 80.5 };
      for (const e of [ram, other, treb]) expect(applyCommand(s, { kind: 'order', player: e.owner as PlayerId, entityIds: [e.id], target: { x: e.position.x + 15, y: e.position.y } }).ok).toBe(true);
      for (let i = 0; i < TICKS_PER_SECOND; i++) stepGame(s);
      const distances = [ram.position.x - 40.5, other.position.x - 80.5, treb.position.x - 40.5];
      for (const e of [ram, other, treb]) applyCommand(s, { kind: 'stop', player: e.owner as PlayerId, entityIds: [e.id] });
      return distances;
    };
    const before = travel(), bank = { ...s.players[1] }; research(s, castle, 'drill');
    expect(bank.wood - s.players[1].wood).toBe(500); expect(bank.gold - s.players[1].gold).toBe(450);
    const after = travel(); expect(before[0]).toBeCloseTo(.6); expect(before[1]).toBeCloseTo(.6);
    expect(after[0]).toBeCloseTo(.9); expect(after[1]).toBeCloseTo(.6); expect(after[2]).toBeCloseTo(before[2]);
    continueJSON(s);
  });

  it.each(['scout-cavalry', 'light-cavalry', 'dat-unit-441'] as const)('team effect 407 reveals two extra tiles for %s, not rival scouts or Steppe Lancers', kind => {
    const s = arena(0), a = unit(s, kind, 1, 40.5, 50.5), b = unit(s, kind, 2, 80.5, 50.5);
    unit(s, 'dat-unit-1370', 1, 40.5, 80.5);
    for (const e of [a, b]) expect(applyCommand(s, { kind: 'order', player: e.owner as PlayerId, entityIds: [e.id], target: { x: e.position.x + 1, y: e.position.y } }).ok).toBe(true);
    until(s, () => a.position.x === 41.5 && b.position.x === 81.5, 100);
    updateVisibility(s);
    expect(isTileVisible(s, 1, 45, 50)).toBe(true); expect(isTileVisible(s, 2, 85, 50)).toBe(true);
    expect(isTileVisible(s, 1, 47, 50)).toBe(true); expect(isTileVisible(s, 2, 87, 50)).toBe(false);
    expect(isTileVisible(s, 1, 48, 50)).toBe(false); expect(isTileVisible(s, 1, 46, 80)).toBe(false);
    const extra = addNode(s, 'gold', { x: 47, y: 50 }), rivalExtra = addNode(s, 'gold', { x: 87, y: 50 });
    updateVisibility(s);
    const mine = observe(s, 1), theirs = observe(s, 2);
    expect(mine.entities.some(e => e.id === extra.id)).toBe(true);
    expect(theirs.entities.some(e => e.id === extra.id || e.id === rivalExtra.id)).toBe(false);
    expect(mine.explored[50][47]).toBe('1');
    expect(theirs.explored[50][47]).toBe('0'); expect(theirs.explored[50][87]).toBe('0');
    // Both idle scouts receive equivalent targets six tiles away. Only the
    // Mongol scout acquires; a target inside four proves the rival's AI works.
    const distant = unit(s, 'villager', 2, 47.5, 50.5);
    const rivalDistant = unit(s, 'villager', 1, 87.5, 50.5);
    for (const e of [a, b]) expect(applyCommand(s, { kind: 'stop', player: e.owner as PlayerId, entityIds: [e.id] }).ok).toBe(true);
    until(s, () => a.order.kind === 'attack', 20);
    expect(a.order).toEqual({ kind: 'attack', targetId: distant.id });
    expect(b.order.kind).toBe('idle'); expect(b.position).toEqual({ x: 81.5, y: 50.5 });
    expect(applyCommand(s, { kind: 'delete', player: 1, entityIds: [rivalDistant.id] }).ok).toBe(true);
    const near = unit(s, 'villager', 1, 85.5, 50.5);
    until(s, () => b.order.kind === 'attack', 20);
    expect(b.order).toEqual({ kind: 'attack', targetId: near.id });
  });

  it('Nomads fails closed until house storage flag-8 persistence has a consumer', () => {
    const s = arena(), castle = home(s, 'castle');
    expect(applyCommand(s, { kind: 'research', player: 1, buildingId: castle.id, tech: 'nomads' }).ok).toBe(false);
    expect(s.players[1].researched).not.toContain('automatic-641');
  });

  it('enabled mixed opening replays with accepted public commands', async () => {
    expect(rules!.civilizations!.mongols.civilization.enabled).toBe(true);
    const player: Strategy = { decide({ observation: o }) {
      if (o.time !== 0) return [];
      const tc = o.entities.find(e => e.owner === o.player && e.kind === 'town-center')!;
      return [{ kind: 'train', player: o.player, buildingId: tc.id, unit: 'villager' }];
    } };
    const { record, result } = await runMatch({ version: 1, seed: 190, civilizations: { 1: 'mongols', 2: 'britons' },
      maxTimeSeconds: 10, decideIntervalSeconds: 1 }, { 1: player, 2: player }, rules!);
    expect(result.rejectedCommands).toEqual([]); expect(replayRecord(JSON.parse(JSON.stringify(record)), rules!).ok).toBe(true);
  });
});
