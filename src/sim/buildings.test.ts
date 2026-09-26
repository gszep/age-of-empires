import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FALLBACK_RULES, isBuilding, rulesFromManifest, type ContentManifest, type GameRules } from './data';
import { activateAutomaticTechnologies, applyCommand, buildingRulesFor, createGame, stepGame } from './game';
import { buildNavGrid, isBlocked } from './nav';
import { observe } from './observe';
import { validateCommand, validateObservation } from '../protocol/validate';
import { buildMenu } from '../view/build-menu';
import { gateArtKey, wallShape, WALL_RUN_X } from '../view/sprites';
import { synchronizationHash } from '../shared/checksum';
import type { BuildingKind, Entity, GameState } from './types';

const manifestPath = 'public/imported/aoe2/manifest.json';
const manifest: ContentManifest | undefined = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : undefined;
const sources: Record<string, ContentManifest> = process.env.CIV_BUILDING_CONTENT
  ? JSON.parse(readFileSync(process.env.CIV_BUILDING_CONTENT, 'utf8'))
  : manifest?.entities['stone-wall'] ? { britons: manifest, ...manifest.civilizations } : {};
const profiles: Record<string, GameRules> = Object.keys(sources).length
  ? Object.fromEntries(Object.entries(sources).map(([key, value]) => [key, rulesFromManifest(value)])) : { open: FALLBACK_RULES };

function fixture(source: GameRules): GameState {
  const rules = structuredClone(source);
  // Short fixture clocks, not test timeouts. The scenario includes completed
  // age-prerequisite buildings so HP/replacement tests exercise legal research.
  for (const r of Object.values(rules.buildings)) r.buildSeconds = .1;
  for (const r of Object.values(rules.technologies)) r.researchSeconds = .1;
  const state = createGame(126, rules);
  state.entities = state.entities.filter(e => e.kind === 'town-center' || e.kind === 'villager');
  state.terrain.fill(0); state.elevation.fill(0);
  for (const id of [1, 2] as const) Object.assign(state.players[id], { food: 9000, wood: 9000, gold: 9000, stone: 9000 });
  for (const [i, kind] of (['mill', 'barracks', 'blacksmith', 'market', 'castle'] as BuildingKind[]).entries()) {
    const b = buildingRulesFor(state, 1, kind);
    state.entities.push({ id: state.nextId++, kind, owner: 1, position: { x: 60 + i * 6, y: 20 },
      hp: b.hp, maxHp: b.hp, radius: b.radius, activity: 'idle', order: { kind: 'idle' } });
  }
  activateAutomaticTechnologies(state);
  return state;
}
function until(state: GameState, done: () => boolean, limit = 200) {
  for (let i = 0; i < limit && !done(); i++) stepGame(state);
  expect(done()).toBe(true);
}
function build(state: GameState, kind: BuildingKind, x = 40.5, y = 40.5, orientation: 'x' | 'y' = 'x') {
  const worker = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
  const half = state.rules.buildings[kind].footprint ?? { x: state.rules.buildings[kind].radius, y: state.rules.buildings[kind].radius };
  worker.position = { x: x + Math.max(half.x, half.y) + .2, y };
  const cmd = { kind: 'build' as const, player: 1 as const, builderIds: [worker.id], building: kind, target: { x, y }, orientation };
  expect(validateCommand(cmd)).toBe(true);
  expect(applyCommand(state, cmd)).toEqual({ ok: true });
  const site = state.entities.find(e => e.kind === kind && e.position.x === x && e.position.y === y)!;
  until(state, () => site.buildProgress === undefined);
  return site;
}
function research(state: GameState, tech: string, building?: Entity) {
  activateAutomaticTechnologies(state);
  const producer = building ?? state.entities.find(e => e.owner === 1 && e.kind === state.rules.technologies[tech].researchedAt)!;
  expect(applyCommand(state, { kind: 'research', player: 1, buildingId: producer.id, tech })).toEqual({ ok: true });
  until(state, () => state.players[1].researched.includes(tech));
}

describe.each(Object.entries(profiles))('%s building outcomes', (_key, source) => {
  it('pays for stone defences, upgrades existing and new gates/walls, and exposes only current build buttons', () => {
    const state = fixture(source); state.players[1].age = 2;
    const university = build(state, 'university', 30, 30);
    const before = state.players[1].stone;
    const wall = build(state, 'stone-wall');
    const gate = build(state, 'stone-gate', 44, 40.5);
    expect(before - state.players[1].stone).toBe(35);
    gate.hp -= 20; wall.hp -= 10;
    const denied = { kind: 'build' as const, player: 1 as const, builderIds: [], building: 'fortified-wall' as const, target: { x: 50.5, y: 40.5 } };
    expect(applyCommand(state, denied).ok).toBe(false);
    const food = state.players[1].food;
    research(state, 'fortified-wall', university);
    expect(food - state.players[1].food).toBe(200);
    expect(wall.kind).toBe('fortified-wall'); expect(wall.hp).toBe(wall.maxHp - 10);
    expect(gate.kind).toBe('fortified-gate'); expect(gate.hp).toBe(gate.maxHp - 20);
    expect(gate.footprint).toEqual({ x: 2, y: .5 });
    expect(gateArtKey(gate)).toBe('fortified-gate');
    const fresh = build(state, 'fortified-gate', 50.5, 40, 'y');
    expect(fresh.maxHp).toBe(gate.maxHp);
    expect(gateArtKey(fresh)).toBe('fortified-gate-y');
    expect(applyCommand(state, { ...denied, building: 'stone-wall' }).ok).toBe(false);
    const menu = buildMenu(state.rules, 2, 'military', state.players[1].researched);
    expect(menu).toContain('fortified-wall'); expect(menu).not.toContain('stone-wall');
    expect(menu).toContain('fortified-gate'); expect(menu).not.toContain('stone-gate');
    expect(validateObservation(JSON.parse(JSON.stringify(observe(state, 1))))).toBe(true);
  });

  it('keeps end posts solid while the owner walks through the gate doorway; enemy must go around', () => {
    const state = fixture(source); state.players[1].age = 1;
    const gate = build(state, 'stone-gate', 40, 40.5);
    const own = buildNavGrid(state, undefined, 1), enemy = buildNavGrid(state, undefined, 2);
    for (const x of [38, 41]) expect(isBlocked(own, x, 40)).toBe(true);
    for (const x of [39, 40]) { expect(isBlocked(own, x, 40)).toBe(false); expect(isBlocked(enemy, x, 40)).toBe(true); }
    const walker = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
    walker.position = { x: 39.5, y: 38.5 };
    expect(applyCommand(state, { kind: 'order', player: 1, entityIds: [walker.id], target: { x: 39.5, y: 42.5 } }).ok).toBe(true);
    until(state, () => walker.position.y > 42);
    const segment = build(state, 'stone-wall', 37.5, 40.5);
    expect(wallShape(state, segment)).toBe(WALL_RUN_X);
    gate.buildProgress = .5;
    expect(isBlocked(buildNavGrid(state, undefined, 1), 39, 40)).toBe(true);
  });

  it('promotes an occupied tower without losing the passenger, then hits harder and builds the new tier', () => {
    const state = fixture(source); state.players[1].age = 2;
    const university = build(state, 'university', 30, 30), tower = build(state, 'watch-tower');
    const worker = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
    expect(applyCommand(state, { kind: 'order', player: 1, entityIds: [worker.id], target: tower.position, targetId: tower.id }).ok).toBe(true);
    until(state, () => !!tower.garrison?.length);
    const passenger = tower.garrison![0]; tower.hp -= 17;
    research(state, 'guard-tower', university);
    expect(tower.kind).toBe('guard-tower'); expect(tower.hp).toBe(tower.maxHp - 17);
    expect(tower.garrison![0].id).toBe(passenger.id);
    expect(applyCommand(state, { kind: 'ungarrison', player: 1, buildingId: tower.id }).ok).toBe(true);
    expect(state.entities.some(e => e.id === passenger.id)).toBe(true);
    const victim = state.entities.find(e => e.owner === 2 && e.kind === 'villager')!;
    victim.position = { x: 44.5, y: 40.5 }; victim.hp = victim.maxHp = 1000;
    until(state, () => victim.hp < 1000);
    expect(1000 - victim.hp).toBe(7);
    const fresh = build(state, 'guard-tower', 50.5, 50.5);
    expect(fresh.maxHp).toBe(tower.maxHp);
    state.players[1].age = 3;
    if (state.rules.technologies.keep) {
      research(state, 'keep', university);
      expect(tower.kind).toBe('keep'); expect(fresh.kind).toBe('keep');
      expect(buildMenu(state.rules, 3, 'military', state.players[1].researched)).toContain('keep');
    } else {
      expect(applyCommand(state, { kind: 'research', player: 1, buildingId: university.id, tech: 'keep' }).ok).toBe(false);
      expect(tower.kind).toBe('guard-tower');
    }
  });

  it.skipIf(!source.buildings.house.ageStats)('ages existing and new houses with armour affecting actual damage; survives JSON replay', () => {
    const play = () => {
      const state = fixture(source);
      const house = build(state, 'house'); house.hp -= 40;
      const enemy = state.entities.find(e => e.owner === 2 && e.kind === 'town-center')!;
      const oldEnemyHp = enemy.maxHp;
      const unit = state.entities.find(e => e.owner === 2 && e.kind === 'villager')!;
      const hit = () => {
        unit.position = { x: house.position.x + 1.2, y: house.position.y }; unit.attackCooldown = 0;
        const before = house.hp;
        expect(applyCommand(state, { kind: 'order', player: 2, entityIds: [unit.id], target: house.position, targetId: house.id }).ok).toBe(true);
        until(state, () => house.hp < before);
        expect(applyCommand(state, { kind: 'stop', player: 2, entityIds: [unit.id] }).ok).toBe(true);
        return before - house.hp;
      };
      const darkDamage = hit(), missing = house.maxHp - house.hp;
      research(state, 'feudal-age');
      expect(house.maxHp).toBe(750); expect(house.maxHp - house.hp).toBe(missing);
      expect(hit()).toBeLessThan(darkDamage); expect(enemy.maxHp).toBe(oldEnemyHp);
      expect(build(state, 'house', 50.5, 50.5).maxHp).toBe(750);
      const clone = JSON.parse(JSON.stringify(state)) as GameState;
      research(state, 'castle-age'); research(clone, 'castle-age');
      expect(synchronizationHash(state)).toBe(synchronizationHash(clone));
      expect(house.maxHp).toBe(900);
      if (state.rules.technologies['imperial-age']) {
        research(state, 'imperial-age'); research(clone, 'imperial-age');
        expect(buildingRulesFor(state, 1, 'house').armors.find(a => a.class === 4)?.amount).toBe(3);
        expect(synchronizationHash(state)).toBe(synchronizationHash(clone));
      }
      return JSON.parse(JSON.stringify(state));
    };
    expect(play()).toEqual(play());
  });

  it('selects distinct stone-wall diagonal, lone-post and junction art', () => {
    const state = fixture(source);
    const wall: Entity = { id: state.nextId++, kind: 'stone-wall', owner: 1, position: { x: 50.5, y: 50.5 },
      radius: .5, hp: 1080, maxHp: 1080, activity: 'idle', order: { kind: 'idle' } };
    state.entities.push(wall); expect(wallShape(state, wall)).toBe(2);
    const neighbour = { ...wall, id: state.nextId++, position: { x: 51.5, y: 51.5 } };
    state.entities.push(neighbour); expect(wallShape(state, wall)).toBe(4);
    neighbour.position.y = 49.5; expect(wallShape(state, wall)).toBe(3);
    state.entities.push({ ...neighbour, id: state.nextId++, position: { x: 49.5, y: 50.5 } });
    expect(wallShape(state, wall)).toBe(2);
  });

  it('updates an unfinished building proportionally and rejects malformed kinds without payment', () => {
    const state = fixture(source); state.players[1].age = 2;
    const university = build(state, 'university', 30, 30), site = build(state, 'stone-wall');
    site.buildProgress = .25; site.hp = site.maxHp * .25 - 5;
    for (const unit of state.entities.filter(e => e.kind === 'villager')) unit.order = { kind: 'idle' };
    research(state, 'fortified-wall', university);
    expect(site.hp).toBe(site.maxHp * .25 - 5); expect(site.buildProgress).toBe(.25);
    expect(isBuilding(site.kind)).toBe(true);
    const before = JSON.stringify(state.players[1]);
    expect(applyCommand(state, { kind: 'build', player: 1, builderIds: [], building: 'dat-building-999999' as BuildingKind, target: { x: 60, y: 60 } }).ok).toBe(false);
    expect(JSON.stringify(state.players[1])).toBe(before);
  });

  it.skipIf(!source.buildings['stone-wall'].ageStats)('applies automatic age HP to existing/new walls only once with the complete research journal', () => {
    const state = fixture(source); state.players[1].age = 1;
    const wall = build(state, 'stone-wall'); wall.hp -= 19;
    research(state, 'castle-age');
    expect(wall.maxHp).toBeCloseTo(1800, 3);
    expect(wall.maxHp - wall.hp).toBeCloseTo(19);
    expect(build(state, 'stone-wall', 45.5, 45.5).maxHp).toBe(wall.maxHp);
    expect(state.players[1].researched).toContain('automatic-71');
    expect(buildingRulesFor(state, 1, 'stone-wall').hp).toBe(wall.maxHp);
  });

  it.skipIf(!source.buildings['guard-tower'].garrison?.volley?.arrowUnitId)('upgrades the secondary arrows fired by an occupied guard tower', () => {
    const state = fixture(source); state.players[1].age = 2;
    const university = build(state, 'university', 30, 30), tower = build(state, 'watch-tower');
    for (const worker of state.entities.filter(e => e.owner === 1 && e.kind === 'villager').slice(0, 2)) {
      worker.position = { x: 41.2, y: 40.5 };
      expect(applyCommand(state, { kind: 'order', player: 1, entityIds: [worker.id], target: tower.position, targetId: tower.id }).ok).toBe(true);
      until(state, () => !!tower.garrison?.some(e => e.id === worker.id));
    }
    research(state, 'guard-tower', university);
    const victim = state.entities.find(e => e.owner === 2 && e.kind === 'villager')!;
    victim.position = { x: 44.5, y: 40.5 }; victim.hp = victim.maxHp = 1000;
    until(state, () => victim.hp < 1000);
    expect(1000 - victim.hp).toBe(14); // 7 primary + 7 secondary, not the old 5
  });

  it.skipIf(!source.civilizationBonuses)('gates Arrowslits descendants on paid tower upgrades and applies their actual volley damage', () => {
    const state = fixture(source); state.players[1].age = 3;
    const university = build(state, 'university', 30, 30), tower = build(state, 'watch-tower');
    research(state, 'arrowslits', university);
    expect(state.players[1].researched).not.toContain('automatic-610');
    expect(state.players[1].researched).not.toContain('automatic-611');
    research(state, 'guard-tower', university);
    expect(state.players[1].researched.filter(k => k === 'automatic-610')).toHaveLength(1);
    expect(state.players[1].researched).not.toContain('automatic-611');
    let attack = 9;
    if (state.rules.technologies.keep) {
      research(state, 'keep', university); attack = 11;
      expect(state.players[1].researched.filter(k => k === 'automatic-611')).toHaveLength(1);
    }
    for (const worker of state.entities.filter(e => e.owner === 1 && e.kind === 'villager')) {
      worker.position = { x: 41.2, y: 40.5 };
      expect(applyCommand(state, { kind: 'order', player: 1, entityIds: [worker.id], target: tower.position, targetId: tower.id }).ok).toBe(true);
      until(state, () => !!tower.garrison?.some(e => e.id === worker.id));
    }
    const victim = state.entities.find(e => e.owner === 2 && e.kind === 'villager')!;
    victim.position = { x: 44.5, y: 40.5 }; victim.hp = victim.maxHp = 1000;
    until(state, () => victim.hp < 1000);
    expect(1000 - victim.hp).toBe(attack * 2);
  });
});
