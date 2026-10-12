import { describe, expect, it } from 'vitest';
import { applyCommand, createGame, stepGame, ungarrisonAll } from './game';
import { FALLBACK_RULES, groundAllows, isBuilding, isUnit, restrictionOf } from './data';
import { rulesForPlayer } from './civilizations';
import { buildNavGrid, distance, halfExtent, isBlocked } from './nav';
import { canonicalSnapshot, checksumState } from './checksum';
import { synchronizationHash } from '../shared/checksum';
import { createReplayGame } from './replay';
import { updateVisibility } from './visibility';
import { replayRecord, runMatch } from '../headless/runner';
import { MATCH_FORMAT_VERSION } from '../protocol/types';
import { validateMatchConfig, validateMatchRecord, validateMatchResult } from '../protocol/validate';
import type { Entity, GameState } from './types';

const home = (s: GameState) => s.entities.find(e => e.kind === 'town-center' && e.owner === 1)!;
const centre = (e: Entity) => {
  expect(e.position.x % 1, `${e.kind} ${e.id} x`).toBe(0.5);
  expect(e.position.y % 1, `${e.kind} ${e.id} y`).toBe(0.5);
};
function clear(s: GameState, e: Entity) {
  centre(e);
  expect(e.position.x - e.radius).toBeGreaterThanOrEqual(0);
  expect(e.position.y - e.radius).toBeGreaterThanOrEqual(0);
  expect(e.position.x + e.radius).toBeLessThanOrEqual(s.width);
  expect(e.position.y + e.radius).toBeLessThanOrEqual(s.height);
  const rules = rulesForPlayer(s, e.owner);
  expect(groundAllows(rules, restrictionOf(rules, e),
    s.terrain[Math.floor(e.position.y) * s.width + Math.floor(e.position.x)]), `${e.kind} ground`).toBe(true);
  for (const other of s.entities) {
    if (other.id === e.id || other.dead) continue;
    if (isBuilding(other.kind) || other.kind === 'resource') {
      const half = halfExtent(other);
      expect(Math.abs(e.position.x - other.position.x) >= half.x + e.radius
        || Math.abs(e.position.y - other.position.y) >= half.y + e.radius,
      `${e.kind} ${e.id} overlaps ${other.kind} ${other.id}`).toBe(true);
    } else if (isUnit(other.kind)) {
      expect(distance(e.position, other.position), `${e.id} overlaps unit ${other.id}`)
        .toBeGreaterThanOrEqual(e.radius + other.radius);
    }
  }
}
function arena(legacy = false) {
  const s = createGame(325, structuredClone(FALLBACK_RULES), undefined, 'arabia',
    undefined, undefined, undefined, 2, legacy ? 0 : 1);
  s.entities = s.entities.filter(e => e.owner !== 0);
  s.terrain.fill(0); s.elevation.fill(0);
  return s;
}
function train(s: GameState) {
  const tc = home(s), id = s.nextId;
  expect(applyCommand(s, { kind: 'train', player: 1, buildingId: tc.id, unit: 'villager' }).ok).toBe(true);
  tc.training!.remainingTicks = 1;
  stepGame(s);
  const unit = s.entities.find(e => e.id === id)!;
  expect(unit).toBeDefined();
  return unit;
}

function legacyCopy(s: GameState): GameState {
  const copy: GameState = JSON.parse(JSON.stringify(s));
  delete copy.gridSpawnVersion;
  return copy;
}
function sameRuntime(s: GameState, legacy: GameState) {
  const { gridSpawnVersion, ...dynamic } = JSON.parse(canonicalSnapshot(s));
  expect(gridSpawnVersion).toBe(1);
  expect(dynamic).toEqual(JSON.parse(canonicalSnapshot(legacy)));
}
function continuous(unit: Entity) {
  expect(unit.position.x % 1 === .5 && unit.position.y % 1 === .5).toBe(false);
}

describe('grid-locked load placement only (#325 owner clarification)', () => {
  it.each(['arabia', 'islands', 'black-forest', 'painted-proof', 'senlac', 'windsor'])('%s starts on free tile centres', map => {
    for (const mode of ['random-map', 'regicide'] as const) {
      const s = createGame(325, undefined, undefined, map, mode);
      expect(s.gridSpawnVersion).toBe(1);
      const units = s.entities.filter(e => e.owner !== 0 && isUnit(e.kind));
      expect(units.length).toBe(mode === 'regicide' ? 24 : 8);
      for (const e of units) clear(s, e);
      // Load-time landmark units must be legal; mapgen animals are checked
      // separately (Windsor deals some onto water in both policies).
      for (const e of s.entities.filter(e => e.owner === 0 && isUnit(e.kind))) {
        if (['sheep', 'deer', 'boar'].includes(e.kind)) centre(e); else clear(s, e);
      }
    }
  });

  it('snaps the unit landmark at load while preserving its old recorded coordinate', () => {
    const current = createGame(325, undefined, undefined, 'windsor');
    const legacy = createGame(325, undefined, undefined, 'windsor', undefined, undefined, undefined, 2, 0);
    const horse = (s: GameState) => s.entities.find(e => e.owner === 0 && e.kind === 'scout-cavalry')!;
    expect(horse(current).position).toEqual({ x: 375.5, y: 375.5 });
    expect(horse(legacy).position).toEqual({ x: 375.012, y: 375.012 });
  });

  it.each([false, true])('training (rally=%s) retains identical continuous placement regardless of marker', rally => {
    const s = arena(), tc = home(s);
    if (rally) expect(applyCommand(s, { kind: 'rally', player: 1, buildingId: tc.id,
      target: { x: tc.position.x - 10, y: tc.position.y - 10 } }).ok).toBe(true);
    const legacy = legacyCopy(s);
    const unit = train(s), oldUnit = train(legacy);
    expect(unit.position).toEqual(oldUnit.position);
    continuous(unit);
    sameRuntime(s, legacy);
    expect(Math.sign(unit.position.x - tc.position.x)).toBe(rally ? -1 : 1);
    expect(Math.sign(unit.position.y - tc.position.y)).toBe(rally ? -1 : 1);
    const initial = { ...unit.position };
    expect(applyCommand(s, { kind: 'order', player: 1, entityIds: [unit.id],
      target: { x: initial.x + 5, y: initial.y + 5 } }).ok).toBe(true);
    expect(applyCommand(legacy, { kind: 'order', player: 1, entityIds: [oldUnit.id],
      target: { x: initial.x + 5, y: initial.y + 5 } }).ok).toBe(true);
    stepGame(s); stepGame(legacy);
    expect(unit.position).not.toEqual(initial);
    continuous(unit);
    sameRuntime(s, legacy);
  });

  it('keeps runtime training identical to base beside a footprint at the map edge', () => {
    const s = arena(), tc = home(s);
    tc.position = { x: s.width - tc.radius, y: s.height - tc.radius };
    const blocker = { ...tc, id: s.nextId++, position: { x: tc.position.x - 4, y: tc.position.y } };
    s.entities.push(blocker);
    const legacy = legacyCopy(s);
    expect(train(s).position).toEqual(train(legacy).position);
    sameRuntime(s, legacy);
  });

  it('retains base radius-only runtime clearance beside a fractional foundation in both policies', () => {
    const positions = [];
    for (const legacy of [false, true]) {
      const s = arena(legacy), tc = home(s);
      const builder = s.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
      s.entities = s.entities.filter(e => e.kind === 'town-center' || e === builder);
      builder.position = { x: tc.position.x - 4, y: tc.position.y };
      // Preserve the base behavior, including its existing nav-raster mismatch:
      // the physical footprint clears the unit but clips its navigation tile.
      const target = { x: tc.position.x + 2.5 + s.rules.buildings.house.radius + builder.radius + .01,
        y: tc.position.y + .5 };
      expect(applyCommand(s, { kind: 'build', player: 1, builderIds: [builder.id],
        building: 'house', target })).toEqual({ ok: true });
      const unit = train(s);
      expect(isBlocked(buildNavGrid(s), Math.floor(unit.position.x), Math.floor(unit.position.y))).toBe(true);
      continuous(unit);
      positions.push(unit.position);
    }
    expect(positions[0]).toEqual(positions[1]);
  });

  it('garrisons through public orders and ejects the same continuous batch with or without the marker', () => {
    const s = arena(), tc = home(s);
    const units = s.entities.filter(e => e.owner === 1 && e.kind === 'villager');
    expect(applyCommand(s, { kind: 'order', player: 1, entityIds: units.map(e => e.id),
      target: tc.position, targetId: tc.id }).ok).toBe(true);
    for (let i = 0; i < 300 && tc.garrison?.length !== units.length; i++) stepGame(s);
    expect(tc.garrison).toHaveLength(units.length);
    const legacy = legacyCopy(s);
    expect(applyCommand(s, { kind: 'ungarrison', player: 1, buildingId: tc.id }).ok).toBe(true);
    expect(applyCommand(legacy, { kind: 'ungarrison', player: 1, buildingId: tc.id }).ok).toBe(true);
    expect(tc.garrison).toBeUndefined();
    for (const unit of units) continuous(unit);
    sameRuntime(s, legacy);
  });

  it('unloads transport cargo at exactly the base continuous coast positions', () => {
    const s = arena();
    const units = s.entities.filter(e => e.owner === 1 && e.kind === 'villager');
    s.entities = s.entities.filter(e => !units.includes(e));
    const r = s.rules.units['transport-ship'];
    const ship: Entity = { id: s.nextId++, kind: 'transport-ship', owner: 1,
      position: { x: 50.2, y: 50.2 }, hp: r.hp, maxHp: r.hp, radius: r.radius,
      activity: 'idle', order: { kind: 'idle' }, garrison: units };
    s.entities.push(ship);
    // Vertical shore: ship in water, passengers must land to its right.
    for (let y = 0; y < s.height; y++) for (let x = 0; x <= 50; x++) s.terrain[y * s.width + x] = 1;
    const legacy = legacyCopy(s), oldShip = legacy.entities.find(e => e.id === ship.id)!;
    expect(ungarrisonAll(s, ship)).toHaveLength(3);
    expect(ungarrisonAll(legacy, oldShip)).toHaveLength(3);
    for (const unit of units) continuous(unit);
    // Base transport unloading does not deduplicate simultaneous passengers.
    expect(units.every(e => e.position.x === units[0].position.x && e.position.y === units[0].position.y)).toBe(true);
    sameRuntime(s, legacy);
  });

  function wallCrossing(legacy: boolean, axis: 'x' | 'y', side: number, blocked = false) {
    const s = arena(legacy), at = { x: 51.5, y: 50.5 };
    const wallRule = s.rules.buildings['palisade-wall'], towerRule = s.rules.units['siege-tower'];
    const wall: Entity = { id: s.nextId++, kind: 'palisade-wall', owner: 2, position: at,
      hp: wallRule.hp, maxHp: wallRule.hp, radius: wallRule.radius, activity: 'idle', order: { kind: 'idle' } };
    const tower: Entity = { id: s.nextId++, kind: 'siege-tower', owner: 1,
      position: { ...at, [axis]: at[axis] + side * 3 }, hp: towerRule.hp, maxHp: towerRule.hp,
      radius: towerRule.radius, activity: 'idle', order: { kind: 'idle' } };
    s.entities.push(wall, tower);
    if (blocked) s.entities.push({ ...wall, id: s.nextId++, position: { ...at, [axis]: at[axis] - side } });
    const unit = s.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
    unit.position = { ...tower.position, [axis]: tower.position[axis] + side * .4 };
    expect(applyCommand(s, { kind: 'order', player: 1, entityIds: [unit.id],
      target: tower.position, targetId: tower.id }).ok).toBe(true);
    for (let i = 0; i < 100 && !tower.garrison?.length; i++) stepGame(s);
    expect(tower.garrison?.map(e => e.id)).toEqual([unit.id]);
    updateVisibility(s);
    expect(applyCommand(s, { kind: 'order', player: 1, entityIds: [tower.id],
      target: wall.position, targetId: wall.id }).ok).toBe(true);
    expect(tower.order.kind).toBe('cross-wall');
    return { s, tower, wall, unit };
  }

  it.each([['x', -1], ['x', 1], ['y', -1], ['y', 1]] as const)('siege-tower unloading across %s/%s remains continuous for both policies', (axis, side) => {
    const positions = [];
    for (const legacy of [false, true]) {
      const { s, tower, wall, unit } = wallCrossing(legacy, axis, side);
      for (let i = 0; i < 200 && tower.garrison?.length; i++) stepGame(s);
      expect(tower.garrison).toBeUndefined();
      expect(s.entities).toContain(unit);
      expect((unit.position[axis] - wall.position[axis]) * side).toBeLessThan(-wall.radius);
      expect(unit.position[axis]).toBeCloseTo(wall.position[axis] - side * (wall.radius + unit.radius + .1));
      continuous(unit);
      positions.push(unit.position);
    }
    expect(positions[0]).toEqual(positions[1]);
  });

  it('does not search beyond a second wall when the continuous siege-tower landing is blocked', () => {
    const { s, tower, unit } = wallCrossing(false, 'x', -1, true);
    for (let i = 0; i < 200; i++) stepGame(s);
    expect(tower.garrison?.map(e => e.id)).toEqual([unit.id]);
    expect(s.entities).not.toContain(unit);
  });

  it.each(['villager', 'sheep'] as const)('tech grants the same continuous %s batch regardless of marker', kind => {
    const s = arena();
    s.rules.technologies.loom.effects = [{ operation: 'set', amount: 1,
      spawn: { unit: kind, building: 'town-center', count: 3 } }];
    expect(applyCommand(s, { kind: 'research', player: 1, buildingId: home(s).id, tech: 'loom' }).ok).toBe(true);
    home(s).researching!.remainingTicks = 1;
    const id = s.nextId, restored: GameState = JSON.parse(JSON.stringify(s)), legacy = legacyCopy(s);
    stepGame(s); stepGame(restored); stepGame(legacy);
    expect(checksumState(restored)).toBe(checksumState(s));
    const added = s.entities.filter(e => e.id >= id);
    expect(added).toHaveLength(3);
    for (const unit of added) continuous(unit);
    expect(added.every(e => e.position.x === added[0].position.x && e.position.y === added[0].position.y)).toBe(true);
    sameRuntime(s, legacy);
  });

  it('retains the exact continuous hemmed-in fallback regardless of marker', () => {
    for (const legacy of [false, true]) {
      const s = arena(legacy), tc = home(s);
      s.terrain.fill(1);
      const unit = train(s);
      expect(unit.position).toEqual(tc.position);
    }
  });

  it('marker-less snapshots retain continuous training positions; markers participate in both hashes', () => {
    const legacy = arena(true), tc = home(legacy);
    const restored: GameState = JSON.parse(JSON.stringify(legacy));
    const unit = train(legacy);
    train(restored);
    expect(checksumState(restored)).toBe(checksumState(legacy));
    expect(restored).not.toHaveProperty('gridSpawnVersion');
    expect(unit.position.x % 1).not.toBe(.5);
    expect(unit.position.x).toBeGreaterThan(tc.position.x);
    const current = arena(), without = structuredClone(current);
    delete without.gridSpawnVersion;
    expect(checksumState(current)).not.toBe(checksumState(without));
    expect(synchronizationHash(current)).not.toBe(synchronizationHash(without));
  });

  // Measured from git archive f56c30e, before this patch, not regenerated expectations.
  it.each([
    ['arabia', 'random-map', 'ef3e54ed', 'd33241b5'],
    ['arabia', 'regicide', '7cbf95bd', 'ee32fd17'],
    ['islands', 'random-map', '38d0ba63', 'e9fb496b'],
    ['islands', 'regicide', 'fe0e69b2', '9c2a4a52'],
  ] as const)('v9 %s %s preserves initial positions and continuation', (map, mode, initial, continued) => {
    const s = createReplayGame({ version: 9, seed: 325, map, mode, civilizations: { 1: 'open', 2: 'open' } });
    expect(s).not.toHaveProperty('gridSpawnVersion');
    expect(checksumState(s)).toBe(initial);
    if (mode === 'random-map') {
      const villager = s.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
      expect(villager.position.x).toBe(home(s).position.x + 2.8);
    }
    const restored: GameState = JSON.parse(JSON.stringify(s));
    for (let i = 0; i < 20; i++) { stepGame(s); stepGame(restored); }
    expect(checksumState(s)).toBe(continued);
    expect(checksumState(restored)).toBe(continued);
  });

  it('writes format10, accepts historical formats and replays through JSON', async () => {
    expect(MATCH_FORMAT_VERSION).toBe(10);
    for (let version = 1; version <= 10; version++) expect(validateMatchConfig({ version, seed: 325 })).toBe(true);
    expect(validateMatchConfig({ version: 11, seed: 325 })).toBe(false);
    const idle = { decide: () => [] };
    const { record, result } = await runMatch({ version: 9, seed: 325, maxTimeSeconds: 5 }, { 1: idle, 2: idle });
    expect(record.version).toBe(10); expect(result.version).toBe(10);
    const wire = JSON.parse(JSON.stringify(record));
    expect(validateMatchRecord(wire)).toBe(true);
    expect(validateMatchResult(result)).toBe(true);
    expect(replayRecord(wire)).toEqual({ ok: true, checked: record.checksums.length });
    expect(replayRecord({ ...wire, version: 9 }).ok).toBe(false);
  });
});
