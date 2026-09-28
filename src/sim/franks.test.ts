import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { rulesFromManifest, TICK_SECONDS } from './data';
import { activateAutomaticTechnologies, applyCommand, createGame, stepGame } from './game';
import { rulesForPlayer } from './civilizations';
import { buildingRulesFor, unitRulesFor } from './rules';
import { updateVisibility } from './visibility';
import { synchronizationHash } from '../shared/checksum';
import type { BuildingKind, Entity, GameState, PlayerId, UnitKind } from './types';

const path = 'public/imported/aoe2/manifest.json';
const imported = existsSync(path) ? rulesFromManifest(JSON.parse(readFileSync(path, 'utf8'))) : undefined;
function arena() {
  const state = createGame(180, imported!, { 1: 'franks', 2: 'britons' });
  state.entities = state.entities.filter(e => e.kind === 'town-center');
  state.terrain.fill(0); state.elevation.fill(0);
  for (const p of [1, 2] as const) Object.assign(state.players[p], {
    age: 3, food: 20000, wood: 20000, gold: 20000, stone: 20000,
  });
  activateAutomaticTechnologies(state);
  return state;
}
function unit(s: GameState, kind: UnitKind, owner: PlayerId, x: number, y = 50): Entity {
  const r = unitRulesFor(s, owner, kind);
  const e: Entity = { id: s.nextId++, kind, owner, position: { x, y }, hp: r.hp, maxHp: r.hp,
    radius: r.radius, activity: 'idle', order: { kind: 'idle' } };
  s.entities.push(e); return e;
}
function building(s: GameState, kind: BuildingKind, owner: PlayerId, x = 20, y = 20): Entity {
  const r = buildingRulesFor(s, owner, kind);
  const e: Entity = { id: s.nextId++, kind, owner, position: { x, y }, hp: r.hp, maxHp: r.hp,
    radius: r.radius, activity: 'idle', order: { kind: 'idle' } };
  s.entities.push(e); activateAutomaticTechnologies(s); return e;
}
function until(s: GameState, done: () => boolean, ticks = 4000) {
  for (let i = 0; i < ticks && !done(); i++) stepGame(s);
  expect(done()).toBe(true);
}
function research(s: GameState, home: Entity, tech: string) {
  const owner = home.owner as PlayerId, rule = rulesForPlayer(s, owner).technologies[tech];
  expect(rule, `${tech} must be published`).toBeDefined();
  const before = { ...s.players[owner] };
  expect(applyCommand(s, { kind: 'research', player: owner, buildingId: home.id, tech }).ok).toBe(true);
  for (const r of ['food', 'wood', 'gold', 'stone'] as const) {
    expect(before[r] - s.players[owner][r]).toBe(rule.cost[r]);
  }
  until(s, () => s.players[owner].researched.includes(tech));
  expect(applyCommand(s, { kind: 'research', player: owner, buildingId: home.id, tech }).ok).toBe(false);
}

describe.skipIf(!imported?.civilizations?.franks)('owned Frankish completion outcomes', () => {
  it('pays for Bearded Axe, fires from added range, and preserves it through existing/garrisoned/new elite axemen', () => {
    const s = arena(), castle = building(s, 'castle', 1);
    const axe = unit(s, 'dat-unit-281', 1, 50);
    const passenger = unit(s, 'dat-unit-281', 1, 20);
    s.entities = s.entities.filter(e => e.id !== passenger.id); castle.garrison = [passenger];
    research(s, castle, 'bearded-axe');
    const target = unit(s, 'villager', 2, 54.8);
    target.hp = target.maxHp = 1000;
    const at = { ...axe.position };
    updateVisibility(s);
    expect(applyCommand(s, { kind: 'order', player: 1, entityIds: [axe.id], target: target.position, targetId: target.id }).ok).toBe(true);
    until(s, () => target.hp < 1000);
    expect(axe.position).toEqual(at);
    expect(applyCommand(s, { kind: 'stop', player: 1, entityIds: [axe.id] }).ok).toBe(true);
    research(s, castle, 'elite-throwing-axeman');
    expect(axe.kind).toBe('dat-unit-531'); expect(passenger.kind).toBe('dat-unit-531');
    expect(applyCommand(s, { kind: 'train', player: 1, buildingId: castle.id, unit: 'dat-unit-531' }).ok).toBe(true);
    until(s, () => s.entities.some(e => e.kind === 'dat-unit-531' && e.id !== axe.id));
    target.hp = 1000;
    updateVisibility(s);
    expect(applyCommand(s, { kind: 'order', player: 1, entityIds: [axe.id], target: target.position, targetId: target.id }).ok).toBe(true);
    until(s, () => target.hp < 1000);
    expect(axe.position).toEqual(at);
    expect(s.players[2].researched).not.toContain('bearded-axe');
  });

  it('Chivalry accelerates real stable training and research without accelerating the opponent', () => {
    const s = arena(), castle = building(s, 'castle', 1);
    const own = building(s, 'stable', 1, 30, 20), enemy = building(s, 'stable', 2, 80, 80);
    research(s, castle, 'chivalry');
    const start = s.tick;
    for (const home of [own, enemy]) expect(applyCommand(s, { kind: 'train', player: home.owner as PlayerId,
      buildingId: home.id, unit: 'knight' }).ok).toBe(true);
    until(s, () => !own.training);
    const accelerated = s.tick - start;
    expect(enemy.training).toBeDefined();
    until(s, () => !enemy.training);
    const ordinary = s.tick - start;
    expect(accelerated).toBeCloseTo(ordinary / 1.4, -1);
    const researchStart = s.tick;
    for (const home of [own, enemy]) expect(applyCommand(s, { kind: 'research', player: home.owner as PlayerId,
      buildingId: home.id, tech: 'cavalier' }).ok).toBe(true);
    until(s, () => s.players[1].researched.includes('cavalier'));
    expect(s.players[2].researched).not.toContain('cavalier');
    expect((s.tick - researchStart) * TICK_SECONDS).toBeCloseTo(
      rulesForPlayer(s, 1).technologies.cavalier.researchSeconds / 1.4, 1);
    const saved = JSON.parse(JSON.stringify(s)) as GameState;
    until(s, () => s.players[2].researched.includes('cavalier'));
    while (saved.tick < s.tick) stepGame(saved);
    expect(synchronizationHash(saved)).toBe(synchronizationHash(s));
  });

  it('pays for Heresy, denies it to Britons, and kills a converted Frankish unit with normal death feedback', () => {
    const s = arena(), home = building(s, 'monastery', 1), foreign = building(s, 'monastery', 2, 80, 80);
    const gold = s.players[2].gold;
    expect(applyCommand(s, { kind: 'research', player: 2, buildingId: foreign.id, tech: 'heresy' }).ok).toBe(false);
    expect(s.players[2].gold).toBe(gold);
    research(s, home, 'heresy');
    const target = unit(s, 'villager', 1, 54), monk = unit(s, 'monk', 2, 50);
    updateVisibility(s);
    expect(applyCommand(s, { kind: 'order', player: 2, entityIds: [monk.id], target: target.position, targetId: target.id }).ok).toBe(true);
    const saved = JSON.parse(JSON.stringify(s)) as GameState;
    until(s, () => !!target.dead);
    while (saved.tick < s.tick) stepGame(saved);
    expect(synchronizationHash(saved)).toBe(synchronizationHash(s));
    expect(target).toMatchObject({ owner: 1, hp: 0, activity: 'dying' });
    expect(target.decayTicks).toBeGreaterThan(0);
    expect(monk.faith).toBe(0);
    expect(target.convertedRules).toBeUndefined();
  });
});
