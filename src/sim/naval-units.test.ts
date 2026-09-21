import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FALLBACK_RULES, NAVAL_RULES, rulesFromManifest, groundAllows, restrictionOf, type GameRules } from './data';
import { applyCommand, createGame, stepGame, canGarrison, holdOf, computeDamage } from './game';
import { checksumState } from './checksum';
import { observe } from './observe';
import { validateObservation, validateCommand } from '../protocol/validate';
import type { Entity, GameState, UnitKind, BuildingKind, Point } from './types';

const path = 'public/imported/aoe2/manifest.json';
const imported = existsSync(path) ? rulesFromManifest(JSON.parse(readFileSync(path, 'utf8'))) : undefined;
const modes: [string, GameRules][] = [['fallback', FALLBACK_RULES], ...(imported ? [['imported', imported] as [string, GameRules]] : [])];
function sea(rules: GameRules) {
  const state = createGame(97, rules);
  state.entities = state.entities.filter(e => e.owner !== 0);
  state.terrain = state.terrain.map(() => 0);
  for (let y = 8; y < 40; y++) for (let x = 8; x < 112; x++) state.terrain[y * state.width + x] = 1;
  const add = (kind: UnitKind | BuildingKind, owner: 1 | 2, position: Point): Entity => {
    const r = kind in rules.units ? rules.units[kind as UnitKind] : rules.buildings[kind as BuildingKind];
    const e: Entity = { id: state.nextId++, kind, owner, position, hp: r.hp, maxHp: r.hp, radius: r.radius,
      activity: 'idle', order: { kind: 'idle' } };
    state.entities.push(e);
    if (kind in rules.units) state.players[owner].population += rules.units[kind as UnitKind].popCost;
    return e;
  };
  for (let i = 0; i < 5; i++) add('house', 1, { x: 20 + i * 3, y: 70 });
  const dock = add('dock', 1, { x: 15.5, y: 8.5 });
  for (const p of [1, 2] as const) Object.assign(state.players[p], { food: 10000, wood: 10000, gold: 10000, stone: 10000, age: 3, populationCap: 30 });
  return { state, dock, add };
}
function run(state: GameState, ticks: number) { for (let i = 0; i < ticks; i++) stepGame(state); }
function until(state: GameState, predicate: () => boolean, ticks = 6000) {
  for (let i = 0; i < ticks && !predicate(); i++) stepGame(state);
  expect(predicate(), `condition within ${ticks} ticks`).toBe(true);
}
const order = (state: GameState, unit: Entity, target: Entity) => applyCommand(state,
  { kind: 'order', player: unit.owner as 1 | 2, entityIds: [unit.id], target: target.position, targetId: target.id });

it('the Hulk’s negative standard-building attack modifies the total before the minimum damage', () => {
  expect(computeDamage([{ class: 4, amount: 4 }, { class: 21, amount: -3 }],
    [{ class: 4, amount: 1 }, { class: 21, amount: 0 }])).toBe(1);
});

describe.each(modes)('%s naval roster (#97)', (_mode, rules) => {
  it.each(Object.keys(NAVAL_RULES) as (keyof typeof NAVAL_RULES)[])('trains %s through the public command and launches afloat', kind => {
    const { state, dock } = sea(rules);
    const upgrades = { 'war-galley': ['warships'], 'fire-ship': ['warships'], 'war-hulk': ['warships'],
      galleon: ['warships', 'heavy-warships'], 'fast-fire-ship': ['warships', 'heavy-warships'],
      'demolition-ship': ['demolition-ship'], 'heavy-demolition-ship': ['demolition-ship', 'heavy-demolition-ship'],
      'cannon-galleon': ['chemistry'] } as Partial<Record<UnitKind, string[]>>;
    state.players[1].researched = upgrades[kind] ?? [];
    const command = { kind: 'train' as const, player: 1 as const, buildingId: dock.id, unit: kind };
    expect(validateCommand(command)).toBe(true);
    expect(applyCommand(state, command)).toEqual({ ok: true });
    until(state, () => !dock.training);
    const ship = state.entities.find(e => e.owner === 1 && e.kind === kind)!;
    expect(ship).toBeDefined();
    expect(groundAllows(rules, restrictionOf(rules, ship), state.terrain[Math.floor(ship.position.y) * state.width + Math.floor(ship.position.x)])).toBe(true);
    expect(validateObservation(observe(state, 1))).toBe(true);
  });

  it('upgrades living and queued warships together without losing wounds', () => {
    const { state, dock, add } = sea(rules);
    const galley = add('galley', 1, { x: 22.5, y: 20.5 });
    const fire = add('fire-galley', 1, { x: 25.5, y: 20.5 });
    const hulk = add('hulk', 1, { x: 28.5, y: 20.5 });
    galley.hp -= 17;
    for (let i = 0; i < 3; i++) expect(applyCommand(state, { kind: 'train', player: 1, buildingId: dock.id, unit: 'galley' }).ok).toBe(true);
    expect(applyCommand(state, { kind: 'research', player: 1, buildingId: dock.id, tech: 'warships' }).ok).toBe(true);
    until(state, () => state.players[1].researched.includes('warships'));
    expect(galley.kind).toBe('war-galley');
    expect(galley.maxHp - galley.hp).toBe(17);
    expect(fire.kind).toBe('fire-ship'); expect(hulk.kind).toBe('war-hulk');
    expect(dock.training?.kind).toBe('war-galley');
    expect(dock.trainingQueue).toEqual(['war-galley']);
  });

  it.each(['galley', 'fire-galley', 'hulk', 'cannon-galleon'] as const)('%s deals damage while staying on water', kind => {
    const { state, add } = sea(rules);
    const ship = add(kind, 1, { x: 25.5, y: 20.5 });
    const target = add('transport-ship', 2, { x: 25.5 + (kind === 'cannon-galleon' ? 5 : 1.5), y: 20.5 });
    const hp = target.hp;
    expect(order(state, ship, target).ok).toBe(true);
    until(state, () => target.hp < hp, 1000);
    expect(groundAllows(rules, restrictionOf(rules, ship), state.terrain[Math.floor(ship.position.y) * state.width + Math.floor(ship.position.x)])).toBe(true);
  });

  it('Heavy Warships triggers its automatic Galleon and Fast Fire children, not the unavailable Carrack', () => {
    const { state, dock, add } = sea(rules);
    state.players[1].researched = ['warships'];
    const galley = add('war-galley', 1, { x: 25.5, y: 20.5 });
    const fire = add('fire-ship', 1, { x: 28.5, y: 20.5 });
    const hulk = add('war-hulk', 1, { x: 31.5, y: 20.5 });
    expect(applyCommand(state, { kind: 'train', player: 1, buildingId: dock.id, unit: 'galleon' }).ok).toBe(false);
    expect(applyCommand(state, { kind: 'research', player: 1, buildingId: dock.id, tech: 'heavy-warships' }).ok).toBe(true);
    until(state, () => state.players[1].researched.includes('heavy-warships'));
    expect(galley.kind).toBe('galleon'); expect(fire.kind).toBe('fast-fire-ship'); expect(hulk.kind).toBe('war-hulk');
    expect(applyCommand(state, { kind: 'train', player: 1, buildingId: dock.id, unit: 'galleon' }).ok).toBe(true);
  });

  it('demolition self-destructs once, damages nearby enemies and spares friendly ships', () => {
    const { state, add } = sea(rules);
    const demo = add('demolition-raft', 1, { x: 25.5, y: 20.5 });
    const friend = add('transport-ship', 1, { x: 25.5, y: 22 });
    const enemy = add('transport-ship', 2, { x: 26.5, y: 20.5 });
    const far = add('transport-ship', 2, { x: 35.5, y: 20.5 });
    order(state, demo, enemy); run(state, 5);
    expect(demo.dead).toBe(true); expect(enemy.dead).toBe(true);
    expect(friend.hp).toBe(friend.maxHp); expect(far.hp).toBe(far.maxHp);
  });

  it('transports carry land units and loads, refuse ships, unload only at shore and lose cargo on sinking', () => {
    const { state, add } = sea(rules);
    const transport = add('transport-ship', 1, { x: 25.5, y: 8.5 });
    const worker = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
    worker.position = { x: 25.5, y: 7.5 };
    worker.carrying = { kind: 'wood', amount: 7 };
    const before = state.players[1].wood;
    expect(canGarrison(state, transport, transport)).toBe(false);
    expect(canGarrison(state, add('galley', 1, { x: 26.5, y: 8.5 }), transport)).toBe(false);
    expect(order(state, worker, transport).ok).toBe(true);
    until(state, () => !!transport.garrison?.length, 100);
    expect(state.entities.includes(worker)).toBe(false);
    expect(state.players[1].wood).toBe(before);
    const home = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
    const hp = worker.maxHp;
    expect(applyCommand(state, { kind: 'research', player: 1, buildingId: home.id, tech: 'loom' }).ok).toBe(true);
    until(state, () => state.players[1].researched.includes('loom'));
    expect(worker.maxHp).toBe(hp + 15);
    transport.position = { x: 30.5, y: 20.5 };
    applyCommand(state, { kind: 'ungarrison', player: 1, buildingId: transport.id });
    expect(transport.garrison).toHaveLength(1);
    const cmd = { kind: 'ungarrison' as const, player: 1 as const, buildingId: transport.id, target: { x: 40.5, y: 6.5 } };
    expect(validateCommand(cmd)).toBe(true); expect(applyCommand(state, cmd).ok).toBe(true);
    const replay = JSON.parse(JSON.stringify(state)) as GameState;
    for (let i = 0; i < 2000; i++) { stepGame(state); stepGame(replay); }
    expect(transport.garrison).toBeUndefined();
    expect(state.entities.includes(worker)).toBe(true);
    expect(worker.carrying?.amount).toBe(7);
    expect(groundAllows(rules, restrictionOf(rules, worker), state.terrain[Math.floor(worker.position.y) * state.width + Math.floor(worker.position.x)])).toBe(true);
    expect(checksumState(replay)).toBe(checksumState(state));
    worker.position = { x: transport.position.x, y: 7.5 };
    order(state, worker, transport); until(state, () => !!transport.garrison?.length, 100);
    const pop = state.players[1].population;
    applyCommand(state, { kind: 'delete', player: 1, entityIds: [transport.id] });
    expect(state.entities.includes(worker)).toBe(false);
    expect(state.players[1].population).toBe(pop - 2);
  });

  it('a fishing ship builds a water-only trap, gathers it exclusively and banks its food', () => {
    const { state, add } = sea(rules);
    const ship = add('fishing-ship', 1, { x: 20.5, y: 11.5 });
    const second = add('fishing-ship', 1, { x: 20.5, y: 12.5 });
    const builder = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
    const target = { x: 21.5, y: 11.5 };
    expect(applyCommand(state, { kind: 'build', player: 1, builderIds: [builder.id], building: 'fish-trap', target }).ok).toBe(false);
    expect(applyCommand(state, { kind: 'build', player: 1, builderIds: [ship.id], building: 'fish-trap', target: { x: 21.5, y: 6.5 } }).ok).toBe(false);
    expect(applyCommand(state, { kind: 'build', player: 1, builderIds: [ship.id], building: 'fish-trap', target }).ok).toBe(true);
    const trap = state.entities.find(e => e.kind === 'fish-trap')!;
    until(state, () => trap.buildProgress === undefined);
    expect(trap.amount).toBe(700);
    order(state, second, trap);
    expect(second.order.kind).toBe('idle');
    const before = state.players[1].food;
    until(state, () => state.players[1].food > before);
    expect(state.players[1].food - before).toBe(holdOf(state, ship));
    expect(trap.amount).toBe(700 - holdOf(state, ship));
    trap.amount = 1;
    until(state, () => !!trap.dead);
    const wood = state.players[1].wood;
    expect(applyCommand(state, { kind: 'build', player: 1, builderIds: [ship.id], building: 'fish-trap', target }).ok).toBe(true);
    expect(state.players[1].wood).toBe(wood - 100);
    const replacement = state.entities.find(e => e.kind === 'fish-trap' && e.id !== trap.id)!;
    until(state, () => replacement.buildProgress === undefined);
    expect(replacement.amount).toBe(700);
  });

  it('boards only twenty passengers from a group order and never boards enemy units', () => {
    const { state, add } = sea(rules);
    const ship = add('transport-ship', 1, { x: 25.5, y: 8.5 });
    const passengers = Array.from({ length: 21 }, () => add('villager', 1, { x: 25.5, y: 7.5 }));
    const enemy = add('villager', 2, { x: 26.5, y: 7.5 });
    expect(canGarrison(state, enemy, ship)).toBe(false);
    expect(applyCommand(state, { kind: 'order', player: 1, entityIds: passengers.map(e => e.id), target: ship.position, targetId: ship.id }).ok).toBe(true);
    run(state, 5);
    expect(ship.garrison).toHaveLength(20);
    expect(state.entities.filter(e => passengers.some(p => p.id === e.id))).toHaveLength(1);
  });

  it('a trade cog earns gold between foreign docks rather than markets', () => {
    const { state, add } = sea(rules);
    const ship = add('trade-cog', 1, { x: 18.5, y: 10.5 });
    const foreign = add('dock', 2, { x: 45.5, y: 8.5 });
    const before = state.players[1].gold;
    expect(order(state, ship, foreign).ok).toBe(true);
    expect(ship.order.kind).toBe('trade');
    until(state, () => state.players[1].gold > before);
  });
});
