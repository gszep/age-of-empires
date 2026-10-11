import { describe, expect, it } from 'vitest';
import { FALLBACK_RULES, isBuilding, rulesFromManifest, type ContentManifest, type GameRules, type NodeKind } from './data';
import { applyCommand, createGame, stepGame, carryCapacityFor, addNode, placementLegal, rulesForPlayer } from './game';
import { checksumState } from './checksum';
import { buildMenu } from '../view/build-menu';
import { replayRecord, runMatch } from '../headless/runner';
import { SharedMatch } from '../shared/match';
import type { BuildingKind, Entity, GameState, PlayerId, ResourceKind, UnitKind } from './types';

const sides = { 1: 'inca', 2: 'britons' } as const;

// Synthetic plumbing fixtures, NOT Inca balance/reference data. The importer
// owns source calibration; exercise its manifest contract rather than bypass it.
function manifest(): ContentManifest {
  const civilization = { ...structuredClone(FALLBACK_RULES.civilization), key: 'britons' };
  const entity = { hitPoints: 600, collision: [1, 1] as [number, number], lineOfSight: 6 };
  return {
    civilization, entities: {}, civilizations: {
      inca: {
        civilization: { ...civilization, key: 'inca', startingScout: 'dat-unit-2550' },
        entities: {
          barracks: { ...entity, id: 12 },
          'dat-unit-2550': { ...entity, id: 2550, category: 'unit',
            hitPoints: 47, collision: [0.2, 0.2], train: { buildingId: 12, seconds: 20 } },
          settlement: { ...entity, id: 2556, category: 'building', hillMode: 3,
            cost: { wood: 100 }, build: { builderId: 83, seconds: 0.1, button: 2 },
            popSupport: 5, accepts: ['wood', 'gold', 'stone'] },
          ...Object.fromEntries((['lumberjack', 'goldminer', 'stonemason'] as const).map(task => [
            `villager-${task}`, { ...entity, gather: {
              resource: task === 'lumberjack' ? 'wood' : task === 'goldminer' ? 'gold' : 'stone',
              ratePerSecond: 1, capacity: 10, dropSites: [2556],
            } },
          ])),
        },
      },
    },
  };
}

function arena(rules: GameRules): GameState {
  const state = createGame(199, rules, sides);
  state.entities = state.entities.filter(e => e.owner !== 0);
  state.terrain.fill(0);
  state.elevation.fill(0);
  return state;
}

function building(state: GameState, kind: BuildingKind, x: number, owner: PlayerId = 1): Entity {
  const rules = rulesForPlayer(state, owner);
  const e: Entity = {
    id: state.nextId++, kind, owner, position: { x, y: 60 },
    hp: rules.buildings[kind].hp, maxHp: rules.buildings[kind].hp,
    radius: rules.buildings[kind].radius, activity: 'idle', order: { kind: 'idle' },
  };
  state.entities.push(e);
  return e;
}

function loaded(state: GameState, task: 'forager' | 'lumberjack' | 'goldminer' | 'stonemason', resource: ResourceKind): Entity {
  const worker = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
  worker.position = { x: 42, y: 60 };
  const nodeMap: Record<string, NodeKind> = {
    forager: 'berries',
    lumberjack: 'tree',
    goldminer: 'gold',
    stonemason: 'stone',
  };
  const node = nodeMap[task];
  worker.carrying = {
    kind: resource,
    amount: carryCapacityFor(state, 1, task),
    task,
    node,
  };
  const source = addNode(state, node, { x: 50.5, y: 60.5 });
  expect(applyCommand(state, {
    kind: 'order', player: 1, entityIds: [worker.id], target: source.position, targetId: source.id,
  }).ok).toBe(true);
  state.entities = state.entities.filter(e => e.id !== source.id);
  return worker;
}

function bank(state: GameState, worker: Entity, resource: ResourceKind): number {
  const before = state.players[1][resource];
  for (let tick = 0; tick < 600 && state.players[1][resource] === before; tick++) stepGame(state);
  expect(worker.carrying).toBeUndefined();
  return state.players[1][resource] - before;
}

describe('Inca simulation support', () => {
  it.each([1, 2] as const)('player %s starts with its profile scout without leaking to Britons', incaPlayer => {
    const rules = rulesFromManifest(manifest());
    const britonPlayer = incaPlayer === 1 ? 2 : 1;
    const selected = { [incaPlayer]: 'inca', [britonPlayer]: 'britons' } as Record<PlayerId, string>;
    const s = createGame(199, rules, selected);

    const incaScouts = s.entities.filter(e => e.owner === incaPlayer && e.kind === 'dat-unit-2550');
    expect(incaScouts.length).toBe(1);
    expect(incaScouts[0].hp).toBe(47);

    const incaDefaultScouts = s.entities.filter(e => e.owner === incaPlayer && e.kind === 'scout-cavalry');
    expect(incaDefaultScouts.length).toBe(0);

    const britonScouts = s.entities.filter(e => e.owner === britonPlayer && e.kind === 'scout-cavalry');
    expect(britonScouts.length).toBe(1);

    const britonCustom = s.entities.filter(e => e.owner === britonPlayer && e.kind === 'dat-unit-2550');
    expect(britonCustom.length).toBe(0);
    expect(checksumState(createGame(199, rules, selected))).toBe(checksumState(s));
  });

  it.each([undefined, 'dat-unit-999999', 'toString'] as const)('uses the legacy scout when startingScout is %s', kind => {
    const rules = rulesFromManifest(manifest());
    rules.civilizations!.inca.civilization.startingScout = kind as UnitKind | undefined;
    const state = createGame(199, rules, sides);
    expect(state.entities.filter(e => e.owner === 1 && e.kind === 'scout-cavalry')).toHaveLength(1);
    expect(state.entities.filter(e => e.owner === 1 && e.kind === 'dat-unit-2550')).toHaveLength(0);
  });

  it('settlement accepts wood, gold, and stone resources at drop-off', () => {
    const rules = rulesFromManifest(manifest());
    const state = arena(rules);
    Object.assign(state.players[1], { age: 1, wood: 5000, gold: 5000, stone: 5000 });

    const settlement = building(state, 'settlement', 40);

    for (const [task, resource] of [['lumberjack', 'wood'], ['goldminer', 'gold'], ['stonemason', 'stone']] as const) {
      const worker = loaded(state, task, resource);
      const amount = worker.carrying!.amount;
      const before = state.players[1][resource];
      stepGame(state);
      expect(state.players[1][resource]).toBe(before);
      expect(bank(state, worker, resource)).toBe(amount);
      expect(Math.hypot(worker.position.x - settlement.position.x, worker.position.y - settlement.position.y))
        .toBeLessThanOrEqual(worker.radius + settlement.radius + 0.3);
    }
  });

  it('settlement provides popSupport and removes it when destroyed', () => {
    const rules = rulesFromManifest(manifest());
    const state = arena(rules);
    const initialPopCap = state.players[1].populationCap;
    const britonPopCap = state.players[2].populationCap;
    const worker = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
    const target = { x: 50, y: 45 };
    worker.position = { x: 48.7, y: 45 };
    expect(isBuilding('settlement')).toBe(true);
    expect(placementLegal(state, 'settlement', target, 'x', 1).ok).toBe(true);
    const before = state.players[1].wood;
    expect(applyCommand(state, { kind: 'build', player: 1, builderIds: [worker.id], building: 'settlement', target }).ok).toBe(true);
    expect(state.players[1].wood).toBe(before - 100);
    const settlement = state.entities.find(e => e.kind === 'settlement')!;
    expect(settlement.buildProgress).toBe(0);
    expect(state.players[1].populationCap).toBe(initialPopCap);

    for (let tick = 0; tick < 200 && settlement.buildProgress !== undefined; tick++) stepGame(state);
    expect(settlement.buildProgress).toBeUndefined();
    expect(state.players[1].populationCap).toBe(initialPopCap + 5);
    expect(state.players[2].populationCap).toBe(britonPopCap);

    expect(applyCommand(state, { kind: 'delete', player: 1, entityIds: [settlement.id] }).ok).toBe(true);
    expect(settlement.dead).toBe(true);
    expect(state.players[1].populationCap).toBe(initialPopCap);
    expect(state.players[2].populationCap).toBe(britonPopCap);
    // Housing disappears at death, not only when the corpse expires.
    const decayTicks = settlement.decayTicks!;
    for (let tick = 0; tick <= decayTicks; tick++) stepGame(state);
    expect(state.entities.some(e => e.id === settlement.id)).toBe(false);
  });

  it('keeps the placeholder unavailable in open/old profiles and respects imported unavailability', () => {
    const data = manifest();
    data.civilizations!.inca.civilization.unavailable.buildings = [2556];
    for (const rules of [FALLBACK_RULES, rulesFromManifest({ entities: {} }),
      rulesFromManifest(data).civilizations!.inca]) {
      expect(rules.buildings.settlement.buildable).toBe(false);
      for (const page of ['economic', 'military'] as const) {
        expect(buildMenu(rules, 3, page)).not.toContain('settlement');
      }
      const state = createGame(199, rules);
      const worker = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
      expect(applyCommand(state, { kind: 'build', player: 1, builderIds: [worker.id],
        building: 'settlement', target: { x: 50, y: 45 } }).ok).toBe(false);
      expect(state.entities.some(e => e.kind === 'settlement')).toBe(false);
    }
    const imported = rulesFromManifest(manifest()).civilizations!.inca;
    expect(buildMenu(imported, 0, 'economic')).toContain('settlement');
  });

  it('preserves the custom opening through JSON continuation, restart and recorded replay', async () => {
    const rules = rulesFromManifest(manifest());
    const state = createGame(199, rules, sides);
    const resumed = JSON.parse(JSON.stringify(state)) as GameState;
    for (let tick = 0; tick < 20; tick++) { stepGame(state); stepGame(resumed); }
    expect(checksumState(resumed)).toBe(checksumState(state));
    const match = new SharedMatch(resumed);
    match.restart(199, 'arabia');
    expect(checksumState(match.state)).toBe(checksumState(createGame(199, rules, sides)));
    const idle = { decide: () => [] };
    const { record } = await runMatch({ version: 1, seed: 199, maxTimeSeconds: 5, civilizations: sides },
      { 1: idle, 2: idle }, rules);
    expect(replayRecord(JSON.parse(JSON.stringify(record)), JSON.parse(JSON.stringify(rules))))
      .toMatchObject({ ok: true, checked: 1 });
  });
});
