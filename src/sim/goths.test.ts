import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { rulesFromManifest, TICK_SECONDS } from './data';
import { activateAutomaticTechnologies, applyCommand, createGame, stepGame, trainableUnitsAt } from './game';
import { buildingRulesFor, unitRulesFor, trainingAt } from './rules';
import { rulesForPlayer } from './civilizations';
import { synchronizationHash } from '../shared/checksum';
import { updateVisibility } from './visibility';
import { chooseAnimation } from '../view/sprites';
import { replayRecord, runMatch, type Strategy } from '../headless/runner';
import type { BuildingKind, Entity, GameState, PlayerId, UnitKind } from './types';

const path = process.env.CIV_PROFILE_CONTENT ?? 'public/imported/aoe2/manifest.json';
const source = existsSync(path) ? rulesFromManifest(JSON.parse(readFileSync(path, 'utf8'))) : undefined;
if (source?.civilizations?.goths) source.civilizations.goths.civilization.enabled = true; // pending-profile acceptance
function arena(age = 2) {
  const s = createGame(181, source!, { 1: 'goths', 2: 'franks' });
  s.entities = s.entities.filter(e => e.kind === 'town-center');
  s.terrain.fill(0); s.elevation.fill(0);
  for (const owner of [1, 2] as const) Object.assign(s.players[owner], { age, food: 20000, wood: 20000, gold: 20000, stone: 20000 });
  activateAutomaticTechnologies(s); return s;
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
function until(s: GameState, done: () => boolean, limit = 5000) {
  for (let i = 0; i < limit && !done(); i++) stepGame(s);
  expect(done()).toBe(true);
}
function research(s: GameState, home: Entity, tech: string) {
  expect(applyCommand(s, { kind: 'research', player: home.owner as PlayerId, buildingId: home.id, tech }).ok).toBe(true);
  until(s, () => s.players[home.owner as PlayerId].researched.includes(tech));
}
function train(s: GameState, home: Entity, kind: UnitKind) {
  expect(applyCommand(s, { kind: 'train', player: home.owner as PlayerId, buildingId: home.id, unit: kind }).ok).toBe(true);
}

describe.skipIf(!source?.civilizations?.goths)('owned Gothic gameplay', () => {
  it('Loom is paid and completes in its one-second bonus clock, only for Goths', () => {
    const s = arena(0), homes = [1, 2].map(p => s.entities.find(e => e.owner === p && e.kind === 'town-center')!);
    for (const home of homes) {
      const gold = s.players[home.owner as PlayerId].gold;
      expect(applyCommand(s, { kind: 'research', player: home.owner as PlayerId, buildingId: home.id, tech: 'loom' }).ok).toBe(true);
      expect(gold - s.players[home.owner as PlayerId].gold).toBe(50);
    }
    for (let i = 0; i < 19; i++) stepGame(s);
    expect(s.players[1].researched).not.toContain('loom');
    stepGame(s); expect(s.players[1].researched).toContain('loom');
    expect(s.players[2].researched).not.toContain('loom');
  });

  it.each([[0,43,17],[1,40,16],[2,38,15],[3,35,14]])('age%s infantry pays source discounts, refunds exactly, and damages buildings', (age, food, gold) => {
    const s = arena(age), home = building(s, 'barracks', 1);
    const before = { ...s.players[1] };
    train(s, home, 'militia');
    expect(before.food - s.players[1].food).toBe(food);
    expect(before.gold - s.players[1].gold).toBe(gold);
    expect(applyCommand(s, { kind: 'cancel-train', player: 1, buildingId: home.id }).ok).toBe(true);
    expect(s.players[1].food).toBe(before.food); expect(s.players[1].gold).toBe(before.gold);
    const soldier = unit(s, 'militia', 1), target = building(s, 'house', 2, 51.5, 50);
    updateVisibility(s);
    const hp = target.hp;
    expect(applyCommand(s, { kind: 'order', player: 1, entityIds: [soldier.id], targetId: target.id, target: target.position }).ok).toBe(true);
    until(s, () => target.hp < hp);
    // At the same age, compare the actual Frankish hit against an identical house.
    const other = arena(age), rival = unit(other, 'militia', 2), house = building(other, 'house', 1, 51.5, 50);
    updateVisibility(other);
    const otherHp = house.hp;
    expect(applyCommand(other, { kind: 'order', player: 2, entityIds: [rival.id], targetId: house.id, target: house.position }).ok).toBe(true);
    until(other, () => house.hp < otherHp);
    expect(hp - target.hp - (otherHp - house.hp)).toBe(age);
  });

  it('Anarchy enables the secondary barracks slot, keeps castle timing, promotes both queues, and stacks Perfusion', () => {
    const s = arena(3), castle = building(s, 'castle', 1), barracks = building(s, 'barracks', 1, 30, 20);
    expect(trainableUnitsAt(s, 1, 'castle')).toContain('dat-unit-41');
    expect(trainableUnitsAt(s, 1, 'barracks')).not.toContain('dat-unit-41');
    const before = s.players[1].food;
    expect(applyCommand(s, { kind: 'train', player: 1, buildingId: barracks.id, unit: 'dat-unit-41' }).ok).toBe(false);
    expect(s.players[1].food).toBe(before);
    research(s, castle, 'anarchy');
    expect(trainableUnitsAt(s, 1, 'barracks')).toContain('dat-unit-41');
    train(s, castle, 'dat-unit-41'); train(s, barracks, 'dat-unit-41'); train(s, barracks, 'dat-unit-41');
    expect(castle.training?.remainingTicks).toBe(13 / TICK_SECONDS);
    expect(barracks.training?.remainingTicks).toBe(16 / TICK_SECONDS);
    until(s, () => !castle.training && !barracks.training);
    expect(s.entities.filter(e => e.kind === 'dat-unit-41')).toHaveLength(3);
    research(s, castle, 'elite-huskarl');
    expect(s.entities.filter(e => e.kind === 'dat-unit-555')).toHaveLength(3);
    expect(trainableUnitsAt(s, 1, 'barracks')).not.toContain('dat-unit-41');
    expect(trainableUnitsAt(s, 1, 'barracks')).toContain('dat-unit-555');
    research(s, castle, 'perfusion');
    const start = s.tick;
    train(s, barracks, 'dat-unit-555'); train(s, barracks, 'dat-unit-555');
    const saved = JSON.parse(JSON.stringify(s)) as GameState;
    until(s, () => !barracks.training);
    expect(s.tick - start).toBe(2 * Math.ceil(16 / TICK_SECONDS / 2.4));
    while (saved.tick < s.tick) stepGame(saved);
    expect(synchronizationHash(saved)).toBe(synchronizationHash(s));
    expect(trainingAt(unitRulesFor(s, 2, 'dat-unit-41'), 'barracks')).toBeUndefined();
  });

  it('Imperial raises the population ceiling without providing houses or reapplying after JSON reload', () => {
    const s = arena(2), castle = building(s, 'castle', 1), tc = s.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
    // A small scenario ceiling exercises actual production without 200 actors.
    const limit = 25;
    s.rules = { ...s.rules, civilizations: { ...s.rules.civilizations,
      goths: { ...rulesForPlayer(s, 1), populationLimit: limit } } };
    building(s, 'house', 1, 30, 25); building(s, 'house', 1, 35, 25);
    for (let i = 0; i < limit; i++) unit(s, 'villager', 1, 45 + i % 10, 60 + Math.floor(i / 10));
    const dummy = unit(s, 'villager', 1, 80, 20);
    applyCommand(s, { kind: 'delete', player: 1, entityIds: [dummy.id] });
    train(s, castle, 'dat-unit-41');
    until(s, () => castle.training?.remainingTicks === 0);
    expect(s.entities.filter(e => e.kind === 'dat-unit-41')).toHaveLength(0);
    const cap = s.players[1].populationCap;
    research(s, tc, 'imperial-age');
    until(s, () => !castle.training);
    expect(s.players[1].populationCap).toBe(cap + 10);
    expect(s.entities.some(e => e.kind === 'dat-unit-41')).toBe(true);
    const saved = JSON.parse(JSON.stringify(s)); activateAutomaticTechnologies(saved);
    expect(saved.players[1].populationCap).toBe(cap + 10);
    const houses = s.entities.filter(e => e.owner === 1 && e.kind === 'house');
    expect(applyCommand(s, { kind: 'delete', player: 1, entityIds: houses.map(e => e.id) }).ok).toBe(true);
    expect(s.players[1].populationCap).toBe(cap);
  });

  it('hunting preserves gathering throughput while consuming less carcass food and banking the larger load', () => {
    const s = arena(0);
    const workers: Entity[] = [], carcasses: Entity[] = [];
    for (const owner of [1, 2] as const) {
      const tc = s.entities.find(e => e.owner === owner && e.kind === 'town-center')!;
      tc.position = { x: owner === 1 ? 25 : 75, y: 50 };
      const prey = unit(s, 'boar', owner, tc.position.x + 6, 50);
      Object.assign(prey, { dead: true, amount: 1000, resourceKind: 'food', decayTicks: 100000 });
      const worker = unit(s, 'villager', owner, prey.position.x - prey.radius - .2, 50);
      updateVisibility(s);
      expect(applyCommand(s, { kind: 'order', player: owner, entityIds: [worker.id], target: prey.position, targetId: prey.id }).ok).toBe(true);
      workers.push(worker); carcasses.push(prey);
    }
    for (let i = 0; i < 400; i++) stepGame(s);
    expect(workers[0].carrying?.amount).toBe(workers[1].carrying?.amount);
    expect(workers[0].carrying?.amount).toBeGreaterThan(0);
    expect(carcasses[0].amount! - carcasses[1].amount!).toBeCloseTo(workers[0].carrying!.amount * (1 - 1 / 1.23), 5);
    const before = [s.players[1].food, s.players[2].food];
    until(s, () => s.players[1].food > before[0] && s.players[2].food > before[1]);
    expect(s.players[1].food - before[0]).toBe(rulesForPlayer(s, 1).villagerGather.hunter.capacity + 15);
    expect(s.players[2].food - before[1]).toBe(rulesForPlayer(s, 2).villagerGather.hunter.capacity);
  });

  it('Incendiaries gives sunk fire ships a source death explosion through the shared death lifecycle', () => {
    const s = arena(3), university = building(s, 'university', 1);
    research(s, university, 'siphons'); research(s, university, 'incendiaries');
    for (let y = 40; y < 70; y++) for (let x = 40; x < 70; x++) s.terrain[y * s.width + x] = 1;
    const fire = unit(s, 'fire-galley', 1, 50, 50), enemy = unit(s, 'galley', 2, 52, 50);
    const nearby = unit(s, 'fishing-ship', 2, 50, 52), friendly = unit(s, 'fishing-ship', 1, 50, 48);
    fire.hp = 1; fire.attackCooldown = 10000;
    const hp = nearby.hp, friendlyHp = friendly.hp;
    updateVisibility(s);
    expect(applyCommand(s, { kind: 'order', player: 2, entityIds: [enemy.id], target: fire.position, targetId: fire.id }).ok).toBe(true);
    const saved = JSON.parse(JSON.stringify(s)) as GameState;
    until(s, () => !!fire.dead);
    expect(nearby.hp).toBeLessThan(hp); expect(friendly.hp).toBe(friendlyHp);
    expect(chooseAnimation(s, fire)).toEqual({ key: 'fire-ship-explosion', name: 'death' });
    while (saved.tick < s.tick) stepGame(saved);
    expect(synchronizationHash(saved)).toBe(synchronizationHash(s));
    const scuttled = unit(s, 'fire-galley', 1, 50, 54), before = nearby.hp;
    expect(applyCommand(s, { kind: 'delete', player: 1, entityIds: [scuttled.id] }).ok).toBe(true);
    expect(nearby.hp).toBeLessThan(before);
    expect(scuttled.deathReplacement?.art).toBe('fire-ship-explosion');
  });

  it('trains a Dromon and launches the source five-projectile volley into actual combat', () => {
    const s = arena(3);
    for (let y = 40; y < 70; y++) for (let x = 40; x < 70; x++) s.terrain[y * s.width + x] = 1;
    const dock = building(s, 'dock', 1, 40.5, 40.5);
    train(s, dock, 'dat-unit-1795'); until(s, () => !dock.training);
    const ship = s.entities.find(e => e.kind === 'dat-unit-1795')!;
    ship.position = { x: 50, y: 50 };
    const target = unit(s, 'fishing-ship', 2, 58, 50), hp = target.hp;
    updateVisibility(s);
    expect(applyCommand(s, { kind: 'order', player: 1, entityIds: [ship.id], target: target.position, targetId: target.id }).ok).toBe(true);
    until(s, () => s.projectiles.length > 0);
    expect(s.projectiles.filter(p => p.owner === 1)).toHaveLength(5);
    until(s, () => target.hp < hp);
  });

  it('captures a real Huskarl without recipient production or later donor elite promotion', () => {
    const s = arena(3), castle = building(s, 'castle', 1);
    const target = unit(s, 'dat-unit-41', 1, 54), monk = unit(s, 'monk', 2, 46);
    target.hp -= 7;
    updateVisibility(s);
    expect(applyCommand(s, { kind: 'order', player: 2, entityIds: [monk.id], target: target.position, targetId: target.id }).ok).toBe(true);
    until(s, () => target.owner === 2);
    expect(target.maxHp).toBe(60); expect(target.hp).toBe(53);
    research(s, castle, 'elite-huskarl');
    expect(target.kind).toBe('dat-unit-41'); expect(target.maxHp).toBe(60);
    const foreign = building(s, 'castle', 2, 80, 80), gold = s.players[2].gold;
    expect(applyCommand(s, { kind: 'train', player: 2, buildingId: foreign.id, unit: 'dat-unit-41' }).ok).toBe(false);
    expect(s.players[2].gold).toBe(gold);
    const saved = JSON.parse(JSON.stringify(s));
    for (let i = 0; i < 20; i++) { stepGame(s); stepGame(saved); }
    expect(synchronizationHash(saved)).toBe(synchronizationHash(s));
  });

  it('rejects missing Gothic stone defences and tower research without spending', () => {
    const s = arena(3), worker = unit(s, 'villager', 1, 40, 40), university = building(s, 'university', 1);
    const before = { ...s.players[1] };
    for (const kind of ['stone-wall', 'stone-gate', 'fortified-wall', 'guard-tower', 'keep'] as BuildingKind[]) {
      expect(applyCommand(s, { kind: 'build', player: 1, builderIds: [worker.id], building: kind, target: { x: 45.5, y: 40.5 } }).ok).toBe(false);
    }
    for (const tech of ['fortified-wall','guard-tower','keep','arrowslits']) {
      expect(applyCommand(s, { kind: 'research', player: 1, buildingId: university.id, tech }).ok).toBe(false);
    }
    expect(s.players[1]).toEqual(before);
  });

  it('replays public paid training/research with the real mixed catalogue and Gothic activation graph', async () => {
    const strategy: Strategy = { decide({ observation: o }) {
      if (o.time !== 0) return [];
      const tc = o.entities.find(e => e.owner === o.player && e.kind === 'town-center')!;
      return [{ kind: 'research', player: o.player, buildingId: tc.id, tech: 'loom' },
        { kind: 'train', player: o.player, buildingId: tc.id, unit: 'villager' }];
    } };
    const { record, result } = await runMatch({ version: 1, seed: 181, civilizations: { 1: 'goths', 2: 'franks' },
      maxTimeSeconds: 30, decideIntervalSeconds: 1 }, { 1: strategy, 2: strategy }, source!);
    expect(result.rejectedCommands).toEqual([]);
    expect(replayRecord(JSON.parse(JSON.stringify(record)), source!).ok).toBe(true);
  });
});
