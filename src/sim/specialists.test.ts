import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FALLBACK_RULES, isBuilding, rulesFromManifest, type GameRules, type ContentManifest } from './data';
import { activateAutomaticTechnologies, applyCommand, canGarrison, createGame, stepGame } from './game';
import { updateVisibility } from './visibility';
import { buildingRulesFor, inheritConvertedUnit, unitRulesFor } from './rules';
import { observe } from './observe';
import { validateCommand, validateObservation } from '../protocol/validate';
import { synchronizationHash } from '../shared/checksum';
import { SharedMatch } from '../shared/match';
import { contextCursor } from '../view/cursors';
import type { Command, Entity, EntityKind, GameState, PlayerId } from './types';

const modes: [string, GameRules][] = [['fallback', FALLBACK_RULES]];
const path = process.env.SPECIALIST_CONTENT ?? 'public/imported/aoe2/manifest.json';
if (existsSync(path)) {
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as ContentManifest;
  if (manifest.entities.petard) {
    modes.push(['britons', rulesFromManifest(manifest)]);
    if (manifest.civilizations?.franks) modes.push(['franks', rulesFromManifest(manifest.civilizations.franks)]);
  }
}

function fixture(rules: GameRules) {
  const state = createGame(161, structuredClone(rules));
  state.entities = state.entities.filter(e => e.kind === 'town-center');
  state.terrain.fill(0); state.elevation.fill(0);
  for (const player of [1, 2] as const) Object.assign(state.players[player], { age: 2, food: 10000, wood: 10000, gold: 10000, stone: 10000 });
  activateAutomaticTechnologies(state);
  const put = (kind: EntityKind, x = 50.5, y = 50.5, owner: PlayerId = 1): Entity => {
    if (kind === 'resource' || kind === 'relic') throw new Error('unit/building fixture only');
    const rule = isBuilding(kind) ? buildingRulesFor(state, owner, kind) : unitRulesFor(state, owner, kind);
    const entity: Entity = { id: state.nextId++, kind, owner, hp: rule.hp, maxHp: rule.hp,
      radius: rule.radius, position: { x, y }, activity: 'idle', order: { kind: 'idle' } };
    state.entities.push(entity);
    return entity;
  };
  return { state, put };
}
function run(state: GameState, ticks: number) { for (let i = 0; i < ticks; i++) stepGame(state); }
function until(state: GameState, done: () => boolean, ticks = 1500) {
  for (let i = 0; i < ticks && !done(); i++) stepGame(state);
  expect(done()).toBe(true);
}
function order(state: GameState, unit: Entity, target: Entity | { x: number; y: number }) {
  updateVisibility(state);
  const command: Command = { kind: 'order', player: unit.owner as PlayerId, entityIds: [unit.id],
    target: 'position' in target ? target.position : target, ...('id' in target ? { targetId: target.id } : {}) };
  expect(validateCommand(command)).toBe(true);
  expect(applyCommand(state, command).ok).toBe(true);
}

describe.each(modes)('%s specialists', (_mode, rules) => {
  it.each(['petard', 'siege-tower'] as const)('pays for and completes %s through public training and observation', kind => {
    const { state, put } = fixture(rules);
    const rule = state.rules.units[kind];
    const producer = put(rule.trainedAt);
    const before = state.players[1].gold;
    const command = { kind: 'train', player: 1, buildingId: producer.id, unit: kind } as const;
    expect(validateCommand(command)).toBe(true);
    expect(applyCommand(state, command).ok).toBe(true);
    expect(state.players[1].gold).toBe(before - rule.cost.gold);
    until(state, () => state.entities.some(e => e.kind === kind));
    updateVisibility(state);
    expect(validateObservation(observe(state, 1))).toBe(true);
  });

  it('petard self-destructs once, damages a building and nearby enemy, and spares distant/allied units', () => {
    const { state, put } = fixture(rules);
    const petard = put('petard');
    const house = put('house', 51.8, 50.5, 2);
    const nearby = put('villager', 50.5, 51.05, 2);
    const distant = put('villager', 50.5, 54, 2);
    const ally = put('villager', 50.5, 50, 1);
    order(state, petard, house);
    until(state, () => !!petard.dead);
    expect(house.maxHp - house.hp).toBeGreaterThanOrEqual(500);
    expect(nearby.maxHp - nearby.hp).toBe(25);
    expect(distant.hp).toBe(distant.maxHp);
    expect(ally.hp).toBe(ally.maxHp);
    const hp = house.hp;
    run(state, 20);
    expect(house.hp).toBe(hp);
  });

  it('closes inside its blast radius before detonating after a defended diagonal approach', () => {
    const { state, put } = fixture(rules);
    const petard = put('petard', 44.5, 41.5);
    const house = put('house', 49.5, 41.5, 2);
    const defender = put('villager', 47.5, 41.5, 2);
    put('villager', 47.5, 38.5); // spotter: the house is a legal public attack target
    order(state, petard, house);
    order(state, defender, petard);
    until(state, () => !!petard.dead);
    expect(house.maxHp - house.hp).toBeGreaterThanOrEqual(500);
    expect(defender.dead).toBe(true);
  });

  it('intercepting or deleting a petard does not detonate its attack', () => {
    const { state, put } = fixture(rules);
    const petard = put('petard');
    const victim = put('house', 51.8, 50.5, 2);
    expect(applyCommand(state, { kind: 'delete', player: 1, entityIds: [petard.id] }).ok).toBe(true);
    run(state, 1);
    expect(victim.hp).toBe(victim.maxHp);
    const intercepted = put('petard');
    intercepted.hp = 1;
    order(state, intercepted, { x: 50.5, y: 60 });
    const enemy = put('militia', 50.6, 50.5, 2);
    order(state, enemy, intercepted);
    until(state, () => !!intercepted.dead);
    expect(enemy.hp).toBe(enemy.maxHp);
  });

  it.each(['battering-ram', 'capped-ram', 'siege-tower'] as const)('%s gains infantry speed, loses it on unload, and preserves converted snapshots', kind => {
    const { state, put } = fixture(rules);
    const carrier = put(kind);
    const infantry = put('militia', 50, 50.5);
    order(state, infantry, carrier);
    until(state, () => carrier.garrison?.length === 1);
    carrier.position = { x: 50.5, y: 50.5 }; // straight lane after boarding separation
    inheritConvertedUnit(state, carrier, 2);
    const snapshot = JSON.stringify(carrier.convertedRules);
    const empty = JSON.parse(JSON.stringify(state)) as GameState;
    const copy = empty.entities.find(e => e.id === carrier.id)!;
    expect(applyCommand(empty, { kind: 'ungarrison', player: 2, buildingId: copy.id }).ok).toBe(true);
    empty.entities = empty.entities.filter(e => e.id !== infantry.id);
    order(state, carrier, { x: 60.5, y: 50.5 });
    order(empty, copy, { x: 60.5, y: 50.5 });
    run(state, 40); run(empty, 40);
    expect(carrier.position.x - copy.position.x).toBeCloseTo(0.1, 5);
    expect(JSON.stringify(carrier.convertedRules)).toBe(snapshot);
    expect(applyCommand(state, { kind: 'ungarrison', player: 2, buildingId: carrier.id }).ok).toBe(true);
    state.entities = state.entities.filter(e => e.id !== infantry.id);
    const x = carrier.position.x, emptyX = copy.position.x;
    run(state, 40); run(empty, 40);
    expect(carrier.position.x - x).toBeCloseTo(copy.position.x - emptyX, 5);
  });

  it('ram infantry adds building damage, villagers do not; unloaded damage returns to base', () => {
    const { state, put } = fixture(rules);
    const ram = put('battering-ram');
    const soldier = put('militia', 50, 50.5);
    const villager = put('villager', 50.5, 50);
    order(state, soldier, ram); order(state, villager, ram);
    until(state, () => ram.garrison?.length === 2);
    const empty = JSON.parse(JSON.stringify(state)) as GameState;
    const emptyRam = empty.entities.find(e => e.id === ram.id)!;
    expect(applyCommand(empty, { kind: 'ungarrison', player: 1, buildingId: ram.id }).ok).toBe(true);
    empty.entities = empty.entities.filter(e => e.id !== soldier.id && e.id !== villager.id);
    const house = put('house', 52, 50.5, 2);
    const controlHouse = structuredClone(house); empty.entities.push(controlHouse);
    order(state, ram, house); order(empty, emptyRam, controlHouse);
    until(state, () => house.hp < house.maxHp); until(empty, () => controlHouse.hp < controlHouse.maxHp);
    expect(controlHouse.hp - house.hp).toBe(10);
    expect(applyCommand(state, { kind: 'ungarrison', player: 1, buildingId: ram.id }).ok).toBe(true);
    state.entities = state.entities.filter(e => e.id !== soldier.id && e.id !== villager.id);
    const before = house.hp;
    until(state, () => house.hp < before);
    expect(before - house.hp).toBe(controlHouse.maxHp - controlHouse.hp);
  });

  it.each(['palisade-wall', 'stone-wall', 'fortified-wall'] as const)('tower crosses %s with cargo intact through JSON shared snapshots', kind => {
    const { state, put } = fixture(rules);
    const tower = put('siege-tower', 48.5);
    const soldier = put('villager', 48, 50.5); // a real carrying passenger, with wounds/provenance
    expect(canGarrison(state, put('archer', 35), tower)).toBe(true);
    expect(canGarrison(state, put('knight', 30), tower)).toBe(false);
    const house = put('house', 60, 50.5, 2);
    order(state, tower, house);
    expect(tower.order.kind).toBe('move');
    soldier.hp -= 7;
    inheritConvertedUnit(state, soldier, 1);
    soldier.carrying = { kind: 'food', amount: 7, node: 'berries' };
    order(state, soldier, tower);
    until(state, () => tower.garrison?.length === 1);
    const wall = put(kind, 51.5, 50.5, 2);
    order(state, tower, wall);
    expect(tower.order.kind).toBe('cross-wall');
    expect(contextCursor(state, 1, [tower], wall.position, wall)).toBe('unboard');
    expect(validateObservation(observe(state, 1))).toBe(true);
    const host = new SharedMatch(state);
    const saved = JSON.parse(JSON.stringify(host.snapshot()));
    const clone = saved.state as GameState;
    const passenger = clone.entities.find(e => e.id === tower.id)!.garrison![0];
    expect(passenger).toMatchObject({ id: soldier.id, hp: soldier.hp, carrying: soldier.carrying });
    expect(passenger.convertedRules).toEqual(JSON.parse(JSON.stringify(soldier.convertedRules)));
    until(state, () => !tower.garrison?.length);
    run(clone, state.tick - clone.tick);
    expect(synchronizationHash(state)).toBe(synchronizationHash(clone));
    expect(soldier.position.x).toBeGreaterThan(wall.position.x + wall.radius);
    expect(tower.position.x).toBeLessThan(wall.position.x - wall.radius);
    expect(wall.hp).toBe(wall.maxHp);
    expect(soldier.carrying?.amount).toBe(7);
  });

  it('a blocked far side keeps cargo aboard instead of teleporting over a second wall', () => {
    const { state, put } = fixture(rules);
    const tower = put('siege-tower', 49.4);
    const soldier = put('militia', 49, 50.5);
    order(state, soldier, tower);
    until(state, () => !!tower.garrison?.length);
    const wall = put('palisade-wall', 50.5, 50.5, 2);
    put('palisade-wall', 51.5, 50.5, 2);
    order(state, tower, wall);
    run(state, 100);
    expect(tower.garrison?.map(e => e.id)).toEqual([soldier.id]);
    expect(wall.hp).toBe(wall.maxHp);
  });

  it('fills ten tower places, refuses overflow, and releases living passengers on destruction', () => {
    const { state, put } = fixture(rules);
    const tower = put('siege-tower');
    for (let i = 0; i < 10; i++) {
      const soldier = put('militia', tower.position.x - 0.5, tower.position.y);
      order(state, soldier, tower);
      until(state, () => tower.garrison?.length === i + 1);
    }
    const extra = put('militia', 49, 50.5);
    expect(canGarrison(state, extra, tower)).toBe(false);
    const ids = tower.garrison!.map(e => e.id);
    expect(applyCommand(state, { kind: 'delete', player: 1, entityIds: [tower.id] }).ok).toBe(true);
    expect(state.entities.filter(e => ids.includes(e.id) && !e.dead)).toHaveLength(10);
    expect(tower.garrison).toBeUndefined();
  });

  it('uses the ram tree variant for availability without changing its effect identity', () => {
    const { state, put } = fixture(rules);
    state.rules.units['battering-ram'].treeUnitId = 1258;
    state.rules.units['battering-ram'].datId = 35;
    state.rules.civilization.unavailable.units.push(1258);
    const workshop = put('siege-workshop');
    const gold = state.players[1].gold;
    expect(applyCommand(state, { kind: 'train', player: 1, buildingId: workshop.id, unit: 'battering-ram' }).ok).toBe(false);
    expect(state.players[1].gold).toBe(gold);
  });
});
