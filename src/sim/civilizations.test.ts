import { describe, expect, it } from 'vitest';
import { FALLBACK_RULES, rulesFromManifest, type GameRules } from './data';
import { addNode, applyCommand, createGame, placementLegal, rulesForPlayer, stepGame } from './game';
import { civilizationRules } from './civilizations';
import { checksumState } from './checksum';
import { buildNavGrid, isBlocked, terrainLayer } from './nav';
import { updateVisibility } from './visibility';
import { observe } from './observe';
import { runMatch, replayRecord, type Strategy } from '../headless/runner';
import { SharedMatch } from '../shared/match';
import type { BuildingKind, Entity, GameState, PlayerId, UnitKind } from './types';

// Deliberately contrasting synthetic rules, not invented Frankish game data.
function catalog(): GameRules {
  const root = structuredClone(FALLBACK_RULES);
  const other = structuredClone(FALLBACK_RULES);
  other.civilization = { key: 'fixture-other', name: 'Fixture Other', unavailable: { technologies: [], units: [777], buildings: [] } };
  other.startingResources = { food: 345, wood: 456, gold: 567, stone: 678 };
  other.startingPopulationCap = 10;
  other.units.villager.hp = 80;
  other.units.villager.cost.food = 75;
  other.units.villager.popCost = 2;
  other.units.villager.trainSeconds = 0.1;
  root.units.villager.trainSeconds = 0.1;
  root.units.militia.datId = other.units.militia.datId = 777;
  other.units.militia.attacks = [{ class: 4, amount: 20 }];
  root.units.militia.attacks = [{ class: 4, amount: 10 }];
  root.units.villager.armors = other.units.villager.armors = [{ class: 4, amount: 0 }];
  other.buildings.house.cost.wood = 7;
  other.buildings.house.hp = 800;
  other.buildings.house.radius = 0.5;
  other.buildings.house.popSupport = 12;
  other.buildings.house.buildSeconds = root.buildings.house.buildSeconds = 0.1;
  other.buildings.farm.buildSeconds = root.buildings.farm.buildSeconds = 0.1;
  other.playerAttributes = { farmFoodAmount: 250, buildingRepairCost: 0.25 };
  root.technologies.loom.researchSeconds = other.technologies.loom.researchSeconds = 0.1;
  other.technologies.loom.cost = { food: 0, wood: 0, gold: 5, stone: 0 };
  other.technologies.loom.effects = [{ unit: 'villager', attribute: 'hitPoints', operation: 'add', amount: 30 }];
  root.civilizations = { 'fixture-other': other };
  return root;
}

const sides = { 1: 'open', 2: 'fixture-other' } as const;
const run = (state: GameState, ticks: number) => { for (let i = 0; i < ticks; i++) stepGame(state); };
function arena(rules = catalog()): GameState {
  const state = createGame(122, rules, sides);
  state.entities = state.entities.filter(e => e.owner !== 0);
  state.terrain.fill(0);
  state.elevation.fill(0);
  return state;
}
const tcOf = (state: GameState, owner: PlayerId) => state.entities.find(e => e.owner === owner && e.kind === 'town-center')!;
const workerOf = (state: GameState, owner: PlayerId) => state.entities.find(e => e.owner === owner && e.kind === 'villager')!;
function spawn(state: GameState, kind: UnitKind, owner: PlayerId, x: number, y: number): Entity {
  const rules = rulesForPlayer(state, owner).units[kind];
  const unit: Entity = { id: state.nextId++, kind, owner, position: { x, y }, hp: rules.hp, maxHp: rules.hp,
    radius: rules.radius, activity: 'idle', order: { kind: 'idle' } };
  state.entities.push(unit);
  return unit;
}
function build(state: GameState, owner: PlayerId, kind: BuildingKind): Entity {
  const worker = workerOf(state, owner);
  const target = { x: owner === 1 ? 40.5 : 80.5, y: kind === 'farm' ? 45.5 : 50.5 };
  expect(placementLegal(state, kind, target, 'x', owner).ok).toBe(true);
  worker.position = { x: target.x - rulesForPlayer(state, owner).buildings[kind].radius - 0.3, y: target.y };
  expect(applyCommand(state, { kind: 'build', player: owner, builderIds: [worker.id], building: kind, target }).ok).toBe(true);
  return state.entities.at(-1)!;
}

describe('per-player civilisation rules', () => {
  it('creates each side with its own resources, unit stats and population, keeping Gaia on root rules', () => {
    const state = arena();
    expect(state.players[1].food).toBe(FALLBACK_RULES.startingResources.food);
    expect(state.players[2].food).toBe(345);
    expect(workerOf(state, 1).maxHp).toBe(FALLBACK_RULES.units.villager.hp);
    expect(workerOf(state, 2).maxHp).toBe(80);
    expect(state.players[1].population).toBe(4);
    expect(state.players[2].population).toBe(7);
    expect(state.players[2].populationCap).toBe(10 + state.rules.buildings['town-center'].popSupport);
    expect(rulesForPlayer(state, 0)).toBe(state.rules);
    expect(observe(state, 2).civilization).toBe('fixture-other');
    expect(civilizationRules(state.rules, 'toString')).toBeUndefined();
    expect(() => createGame(122, state.rules, { ...sides, 2: 'unloaded' })).toThrow('not loaded');
  });

  it('charges, queues, refunds and spawns using the producer owner rather than player one', () => {
    const state = arena();
    for (const owner of [1, 2] as const) {
      const tc = tcOf(state, owner), before = state.players[owner].food;
      const price = rulesForPlayer(state, owner).units.villager.cost.food;
      for (let i = 0; i < 2; i++) expect(applyCommand(state, { kind: 'train', player: owner, buildingId: tc.id, unit: 'villager' }).ok).toBe(true);
      expect(state.players[owner].food).toBe(before - 2 * price);
      expect(applyCommand(state, { kind: 'cancel-train', player: owner, buildingId: tc.id }).ok).toBe(true);
      expect(state.players[owner].food).toBe(before - price);
    }
    run(state, 3);
    for (const owner of [1, 2] as const) {
      const villagers = state.entities.filter(e => e.owner === owner && e.kind === 'villager');
      expect(villagers).toHaveLength(4);
      expect(villagers.at(-1)!.maxHp).toBe(rulesForPlayer(state, owner).units.villager.hp);
    }
  });

  it('enforces each tree through public training and research commands without charging refusals', () => {
    const rules = catalog();
    rules.civilizations!['fixture-other'].civilization.unavailable.technologies.push(rules.technologies.loom.techId);
    const state = arena(rules);
    for (const owner of [1, 2] as const) {
      const rule = rulesForPlayer(state, owner).buildings.barracks;
      const barracks: Entity = { id: state.nextId++, kind: 'barracks', owner,
        position: { x: owner === 1 ? 40.5 : 80.5, y: 50.5 }, hp: rule.hp, maxHp: rule.hp,
        radius: rule.radius, activity: 'idle', order: { kind: 'idle' } };
      state.entities.push(barracks);
      const before = { food: state.players[owner].food, gold: state.players[owner].gold };
      expect(applyCommand(state, { kind: 'train', player: owner, buildingId: barracks.id, unit: 'militia' }).ok).toBe(owner === 1);
      expect(applyCommand(state, { kind: 'research', player: owner, buildingId: tcOf(state, owner).id, tech: 'loom' }).ok).toBe(owner === 1);
      if (owner === 2) {
        expect(state.players[owner].food).toBe(before.food);
        expect(state.players[owner].gold).toBe(before.gold);
        expect(barracks.training).toBeUndefined();
        expect(tcOf(state, owner).researching).toBeUndefined();
      }
    }
  });

  it('completes each side’s version of the same research key, including garrisoned units and future trainees', () => {
    const state = arena();
    for (const owner of [1, 2] as const) {
      const tc = tcOf(state, owner), worker = workerOf(state, owner);
      tc.garrison = [worker];
      state.entities = state.entities.filter(e => e.id !== worker.id);
      const before = state.players[owner].gold;
      expect(applyCommand(state, { kind: 'research', player: owner, buildingId: tc.id, tech: 'loom' }).ok).toBe(true);
      expect(state.players[owner].gold).toBe(before - rulesForPlayer(state, owner).technologies.loom.cost.gold);
    }
    const resumed = JSON.parse(JSON.stringify(state)) as GameState;
    for (const match of [state, resumed]) {
      run(match, 3);
      expect(tcOf(match, 1).garrison![0].maxHp).toBe(FALLBACK_RULES.units.villager.hp + 15);
      expect(tcOf(match, 2).garrison![0].maxHp).toBe(110);
      for (const owner of [1, 2] as const) {
        expect(applyCommand(match, { kind: 'train', player: owner, buildingId: tcOf(match, owner).id, unit: 'villager' }).ok).toBe(true);
      }
      run(match, 3);
      expect(match.entities.filter(e => e.owner === 2 && e.kind === 'villager').at(-1)!.maxHp).toBe(110);
    }
    expect(checksumState(resumed)).toBe(checksumState(state));
    expect(state.rules.units.villager.hp).toBe(FALLBACK_RULES.units.villager.hp);
    expect(rulesForPlayer(state, 2).units.villager.hp).toBe(80);
  });

  it('constructs houses and farms with each owner’s cost, footprint, health, housing and food', () => {
    const state = arena();
    const houses = [1, 2].map(owner => {
      const p = owner as PlayerId, before = state.players[p].wood;
      const house = build(state, p, 'house');
      expect(state.players[p].wood).toBe(before - rulesForPlayer(state, p).buildings.house.cost.wood);
      return house;
    });
    for (let tick = 0; tick < 200 && houses.some(e => e.buildProgress !== undefined); tick++) stepGame(state);
    expect(houses.every(e => e.buildProgress === undefined)).toBe(true);
    expect(houses[1]).toMatchObject({ hp: 800, maxHp: 800, radius: 0.5 });
    expect(state.players[2].populationCap).toBe(10 + state.rules.buildings['town-center'].popSupport + 12);
    for (const owner of [1, 2] as const) {
      const farm = build(state, owner, 'farm');
      for (let tick = 0; tick < 200 && farm.buildProgress !== undefined; tick++) stepGame(state);
      expect(farm.buildProgress).toBeUndefined();
      expect(farm.amount).toBe(owner === 1 ? 175 : 250);
    }
  });

  it('uses the attacker’s own combat rules and the viewer’s own line of sight', () => {
    for (const owner of [1, 2] as const) {
      const rules = catalog();
      rules.civilizations!['fixture-other'].units.militia.lineOfSight = 10;
      const state = arena(rules);
      const attacker = spawn(state, 'militia', owner, 60.5, 60.5);
      const victim = spawn(state, 'villager', owner === 1 ? 2 : 1, 61.3, 60.5);
      updateVisibility(state);
      expect(state.visibility[owner].visible[60 * state.width + 69]).toBe(owner === 2 ? 1 : 0);
      expect(applyCommand(state, { kind: 'order', player: owner, entityIds: [attacker.id], target: victim.position, targetId: victim.id }).ok).toBe(true);
      const before = victim.hp;
      for (let tick = 0; tick < 100 && victim.hp === before; tick++) stepGame(state);
      expect(before - victim.hp).toBe(owner === 1 ? 10 : 20);
    }
  });

  it('collects resources at the working player’s task rate rather than the root rate', () => {
    const rules = catalog();
    rules.villagerGather.forager = { ratePerSecond: 2, capacity: 100 };
    rules.civilizations!['fixture-other'].villagerGather.forager = { ratePerSecond: 4, capacity: 100 };
    const state = arena(rules);
    const workers = [1, 2].map(owner => workerOf(state, owner as PlayerId));
    for (const worker of workers) {
      const home = tcOf(state, worker.owner as PlayerId);
      const node = addNode(state, 'berries', { x: home.position.x + 5.5, y: home.position.y + 4.5 });
      worker.position = { x: node.position.x - 1, y: node.position.y };
      updateVisibility(state);
      expect(applyCommand(state, { kind: 'order', player: worker.owner as PlayerId,
        entityIds: [worker.id], target: node.position, targetId: node.id }).ok).toBe(true);
    }
    for (let tick = 0; tick < 200 && workers.some(w => w.activity !== 'gathering'); tick++) stepGame(state);
    expect(workers.every(w => w.activity === 'gathering')).toBe(true);
    const before = workers.map(w => w.carrying?.amount ?? 0);
    run(state, 100);
    expect(workers.map((w, i) => (w.carrying?.amount ?? 0) - before[i])).toEqual([10, 20]);
  });

  it('isolates terrain-layer caches and placement modes even when restriction IDs agree', () => {
    const rules = catalog();
    rules.civilizations!['fixture-other'].terrainRestrictions[7] = [0, 2];
    rules.terrainRestrictions[7] = [0];
    rules.civilizations!['fixture-other'].buildings.house.hillMode = 2;
    const state = arena(rules);
    state.terrain.fill(2);
    expect(isBlocked(buildNavGrid(state, undefined, 1, 7), 60, 60)).toBe(true);
    expect(isBlocked(buildNavGrid(state, undefined, 2, 7), 60, 60)).toBe(false);
    expect(terrainLayer(state, 7, 1)).not.toBe(terrainLayer(state, 7, 2));
    state.terrain = new Array(state.width * state.height).fill(0);
    const at = { x: 60, y: 60 };
    state.elevation[60 * state.width + 60] = 2;
    expect(placementLegal(state, 'house', at, 'x', 1).ok).toBe(true);
    expect(placementLegal(state, 'house', at, 'x', 2).ok).toBe(false);
  });

  it('preserves the selected sides when the shared host restarts', () => {
    const match = new SharedMatch(arena());
    match.restart(123, 'arabia');
    expect(match.state.players[2].civilization).toBe('fixture-other');
    expect(workerOf(match.state, 2).maxHp).toBe(80);
  });

  it('records and replays a mixed match across JSON without swapping rules', async () => {
    const rules = catalog();
    const strategy: Strategy = { decide: ({ observation }) => observation.time === 0
      ? [{ kind: 'train', player: observation.player,
        buildingId: observation.entities.find(e => e.owner === observation.player && e.kind === 'town-center')!.id, unit: 'villager' }]
      : [] };
    const { result, record } = await runMatch({ version: 1, seed: 122, maxTimeSeconds: 5, civilizations: sides },
      { 1: strategy, 2: strategy }, rules);
    expect(result.rejectedCommands).toEqual([]);
    expect(record.civilizations).toEqual(sides);
    const replay = replayRecord(JSON.parse(JSON.stringify(record)), JSON.parse(JSON.stringify(rules)));
    expect(replay).toMatchObject({ ok: true, checked: 1 });
    expect(result.players[2].food).toBe(345 - 75);
  });

  it('loads complete manifest profiles independently and rejects ambiguous catalogue keys', () => {
    const civilization = { key: 'fixture-other', name: 'Fixture', unavailable: { units: [], technologies: [], buildings: [] } };
    const rules = rulesFromManifest({ entities: {}, playerAttributes: { farmFoodAmount: 999 },
      civilizations: { 'fixture-other': { civilization, entities: {}, playerAttributes: { farmFoodAmount: 222 } } } });
    expect(rules.civilizations!['fixture-other'].playerAttributes.farmFoodAmount).toBe(222);
    expect(() => rulesFromManifest({ entities: {}, civilizations: {
      wrong: { civilization, entities: {} },
    } })).toThrow('invalid civilisation profile');
  });
});
