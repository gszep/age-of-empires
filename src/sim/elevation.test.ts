import { describe, expect, it } from 'vitest';
import { checksumState } from './checksum';
import { FALLBACK_RULES } from './data';
import { elevationAt } from './elevation';
import { applyCommand, createGame, stepGame } from './game';
import { buildNavGrid, findPath } from './nav';
import { updateVisibility } from './visibility';
import type { Entity, GameState, UnitKind } from './types';

function arena() {
  const state = createGame(42);
  state.entities = state.entities.filter(e => e.kind === 'town-center');
  state.terrain = state.terrain.map(() => 0);
  state.elevation.fill(0);
  return state;
}

function spawn(state: GameState, kind: UnitKind, owner: 1 | 2, x: number): Entity {
  const entity: Entity = {
    id: state.nextId++, kind, owner, position: { x, y: 20.5 }, hp: 1000, maxHp: 1000,
    radius: state.rules.units[kind].radius, activity: 'idle', order: { kind: 'idle' },
  };
  state.entities.push(entity);
  return entity;
}

function height(state: GameState, entity: Entity, level: number) {
  state.elevation[Math.floor(entity.position.y) * state.width + Math.floor(entity.position.x)] = level;
}

function until(state: GameState, done: () => boolean) {
  for (let tick = 0; tick < 300 && !done(); tick++) stepGame(state);
  expect(done()).toBe(true);
}

describe('authoritative elevation', () => {
  it.each(['militia', 'archer'] as const)('%s deals a fixed hill advantage after armour', kind => {
    const damage = (source: number, target: number) => {
      const state = arena();
      const attacker = spawn(state, kind, 1, 20.5);
      const defender = spawn(state, 'militia', 2, kind === 'militia' ? 21.2 : 23.5);
      height(state, attacker, source);
      height(state, defender, target);
      updateVisibility(state);
      expect(applyCommand(state, { kind: 'order', player: 1, entityIds: [attacker.id], target: defender.position, targetId: defender.id }).ok).toBe(true);
      until(state, () => defender.hp < defender.maxHp);
      return defender.maxHp - defender.hp;
    };
    const flat = damage(0, 0);
    expect(damage(1, 0)).toBeCloseTo(flat * 1.25);
    expect(damage(7, 0)).toBeCloseTo(flat * 1.25);
    expect(damage(0, 1)).toBeCloseTo(flat * 0.75);
    expect(damage(5, 5)).toBeCloseTo(flat);
  });

  it('a flying shot retains its launch ground after the shooter is removed and a snapshot is restored', () => {
    const state = arena();
    const attacker = spawn(state, 'archer', 1, 20.5);
    const defender = spawn(state, 'militia', 2, 23.5);
    height(state, attacker, 3);
    updateVisibility(state);
    applyCommand(state, { kind: 'order', player: 1, entityIds: [attacker.id], target: defender.position, targetId: defender.id });
    until(state, () => state.projectiles.length > 0);
    state.entities = state.entities.filter(e => e.id !== attacker.id);
    const restored = JSON.parse(JSON.stringify(state)) as GameState;
    until(state, () => defender.hp < defender.maxHp);
    while (restored.tick < state.tick) stepGame(restored);
    expect(defender.maxHp - defender.hp).toBe(3.75); // (4 pierce − 1 armour) ×1.25
    expect(checksumState(restored)).toBe(checksumState(state));
  });

  it('ordinary hills remain traversable, with the same ground sampling as combat', () => {
    const state = arena();
    const walker = spawn(state, 'militia', 1, 20.5);
    for (let y = 0; y < state.height; y++) for (let x = 21; x < 25; x++) state.elevation[y * state.width + x] = 1;
    const target = { x: 26.5, y: 20.5 };
    expect(findPath(buildNavGrid(state), walker.position, target)?.at(-1)).toEqual(target);
    applyCommand(state, { kind: 'order', player: 1, entityIds: [walker.id], target });
    let crossedHill = false;
    until(state, () => {
      crossedHill ||= elevationAt(state, walker.position.x, walker.position.y) === 1;
      return Math.hypot(walker.position.x - target.x, walker.position.y - target.y) < 0.2;
    });
    expect(crossedHill).toBe(true);
  });

  it.each(['blast', 'piercing', 'miss'] as const)('%s impacts compare launch ground with each victim, including after shooter removal', mode => {
    const state = arena();
    const low = spawn(state, 'villager', 2, 24.5);
    const high = spawn(state, 'villager', 2, 25.5);
    height(state, high, 3);
    state.elevation[20 * state.width + 20] = 2;
    // A serialized in-flight shot is authoritative input: its shooter is gone.
    // 8 pierce versus unarmoured villagers gives 10 downhill and 6 uphill.
    state.projectiles.push({
      id: state.nextId++, owner: 1, shooterId: -1, targetId: mode === 'miss' ? -1 : low.id,
      origin: { x: 20.5, y: 20.5 }, position: { x: 23.5, y: 20.5 },
      aim: { x: mode === 'piercing' ? 26.5 : 24.5, y: 20.5 },
      speed: 20, launchHeight: 0, attacks: [{ class: 3, amount: 8 }],
      ...(mode === 'blast' ? { blastRadius: 2, blastAttackLevel: 3 } : {}),
      ...(mode === 'piercing' ? { piercing: { radius: 0.1, attacks: [{ class: 3, amount: 8 }], hitIds: [] } } : {}),
    });
    until(state, () => state.projectiles.length === 0);
    expect(low.maxHp - low.hp).toBe(10);
    expect(high.maxHp - high.hp).toBe(mode === 'miss' ? 0 : 6);
  });

  it.each(['arabia', 'black-forest'])('%s generates deterministic, mirrored, traversable hill terraces', map => {
    for (const seed of [1, 7, 42]) {
      const state = createGame(seed, FALLBACK_RULES, undefined, map);
      expect(state.elevation.some(level => level > 0)).toBe(true);
      expect(checksumState(createGame(seed, FALLBACK_RULES, undefined, map))).toBe(checksumState(state));
      for (let y = 0; y < state.height; y++) for (let x = 0; x < state.width; x++) {
        const level = elevationAt(state, x, y);
        expect(level).toBe(elevationAt(state, state.width - 1 - x, y));
        for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [-1, 1]]) {
          expect(Math.abs(level - elevationAt(state, x + dx, y + dy))).toBeLessThanOrEqual(1);
        }
      }
      for (const tc of state.entities.filter(e => e.kind === 'town-center')) expect(elevationAt(state, tc.position.x, tc.position.y)).toBe(0);
      const before = checksumState(state);
      state.elevation[0]++;
      expect(checksumState(state)).not.toBe(before);
    }
  });
});
