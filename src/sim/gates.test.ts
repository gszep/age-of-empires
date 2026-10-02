import { describe, expect, it } from 'vitest';
import { applyCommand, createGame, stepGame } from './game';
import { updateGates } from './gates';
import { buildNavGrid, isBlocked } from './nav';
import { checksumState } from './checksum';
import { synchronizationHash } from '../shared/checksum';
import { chooseAnimation } from '../view/sprites';
import type { BuildingKind, Entity, GameState, Point } from './types';

function fixture(kind: BuildingKind, axis: 'x' | 'y') {
  const state = createGame(133);
  state.entities = state.entities.filter(e => e.kind === 'town-center');
  state.terrain.fill(0);
  const at = (along: number, across: number): Point => axis === 'x'
    ? { x: along, y: across } : { x: across, y: along };
  const rules = state.rules.buildings[kind];
  const half = kind === 'palisade-gate' ? 1 : 2;
  const gate: Entity = { id: state.nextId++, kind, owner: 1, position: at(40, 40.5),
    hp: rules.hp, maxHp: rules.hp, radius: rules.radius,
    footprint: axis === 'x' ? { x: half, y: .5 } : { x: .5, y: half },
    activity: 'idle', order: { kind: 'idle' } };
  state.entities.push(gate);
  const unit = (owner: 1 | 2, along: number, across: number): Entity => {
    const r = state.rules.units.villager;
    const e: Entity = { id: state.nextId++, kind: 'villager', owner, position: at(along, across),
      hp: r.hp, maxHp: r.hp, radius: r.radius, activity: 'idle', order: { kind: 'idle' } };
    state.entities.push(e); return e;
  };
  const doorwayBlocked = (owner: 1 | 2) => {
    const p = at(39, 40);
    return isBlocked(buildNavGrid(state, undefined, owner), p.x, p.y);
  };
  return { state, gate, at, unit, doorwayBlocked };
}

describe.each(['palisade-gate', 'stone-gate', 'fortified-gate'] as const)('%s authoritative state', kind => {
  it.each(['x', 'y'] as const)('opens, closes behind, and gives enemy contact precedence along %s', axis => {
    const { state, gate, at, unit, doorwayBlocked } = fixture(kind, axis);
    const friend = unit(1, 40, 38.5);
    stepGame(state);
    expect(gate.gateState).toBe('open');
    expect(chooseAnimation(state, gate).name).toBe('open');
    expect(doorwayBlocked(1)).toBe(false);
    expect(doorwayBlocked(2)).toBe(false);
    const enemy = unit(2, 40, 40.5);
    stepGame(state);
    expect(gate.gateState).toBe('blocked');
    expect(chooseAnimation(state, gate).name).toBe('idle');
    expect(doorwayBlocked(1)).toBe(true);
    expect(doorwayBlocked(2)).toBe(true);
    enemy.position = at(40, 50);
    stepGame(state);
    expect(gate.gateState).toBe('open');
    friend.position = at(40, 30);
    stepGame(state);
    expect(gate.gateState).toBe('closed');
    expect(doorwayBlocked(1)).toBe(true);
    friend.position = at(40, 38.5);
    gate.buildProgress = .5;
    stepGame(state);
    expect(gate.gateState).toBe('closed');
    expect(chooseAnimation(state, gate).name).toBe('construction');
    gate.dead = true;
    expect(doorwayBlocked(1)).toBe(false);
  });

  it.each(['x', 'y'] as const)('routes a distant owner through a closed gate along %s, then shuts', axis => {
    const { state, gate, at, unit } = fixture(kind, axis);
    const half = gate.footprint![axis];
    // Seal the entire board: this must use the gate, not detour around it.
    for (let n = 0; n < state.width; n++) {
      if (n >= 40 - half && n < 40 + half) continue;
      state.entities.push({ ...gate, id: state.nextId++, kind: 'palisade-wall', radius: .5,
        footprint: { x: .5, y: .5 }, position: at(n + .5, 40.5) });
    }
    const friend = unit(1, 39.5, 30.5), target = at(39.5, 48.5);
    expect(applyCommand(state, { kind: 'order', player: 1, entityIds: [friend.id], target }).ok).toBe(true);
    let opened = false;
    for (let n = 0; n < 600; n++) { stepGame(state); opened ||= gate.gateState === 'open'; }
    expect(opened).toBe(true);
    expect(Math.hypot(friend.position.x - target.x, friend.position.y - target.y)).toBeLessThan(.2);
    expect(gate.gateState).toBe('closed');
  });
});

it('retains gate state through JSON snapshots and detects it in both checksums', () => {
  const { state, gate, unit } = fixture('palisade-gate', 'x');
  unit(1, 40, 38.5);
  updateGates(state);
  const restored: GameState = JSON.parse(JSON.stringify(state));
  expect(restored.entities.find(e => e.id === gate.id)!.gateState).toBe('open');
  const replayHash = checksumState(state), sharedHash = synchronizationHash(state);
  gate.gateState = 'closed';
  expect(checksumState(state)).not.toBe(replayHash);
  expect(synchronizationHash(state)).not.toBe(sharedHash);
  updateGates(state);
  for (let n = 0; n < 10; n++) { stepGame(state); stepGame(restored); }
  expect(synchronizationHash(restored)).toBe(synchronizationHash(state));
});

it('closes against an approaching enemy with a cached open route and reopens after retreat', () => {
  const { state, gate, unit } = fixture('stone-gate', 'x');
  unit(1, 40, 42.5);
  const enemy = unit(2, 39.5, 38.5);
  expect(applyCommand(state, { kind: 'order', player: 2, entityIds: [enemy.id], target: { x: 39.5, y: 43.5 } }).ok).toBe(true);
  stepGame(state);
  expect(gate.gateState).toBe('open');
  expect(enemy.path?.some(p => Math.floor(p.y) === 40)).toBe(true);
  let closed = false;
  for (let n = 0; n < 100; n++) {
    stepGame(state);
    closed ||= gate.gateState === 'blocked';
    // It may detour around the whole gate but cannot enter its closed leaf.
    if (Math.abs(enemy.position.x - 40) < 1) expect(enemy.position.y).toBeLessThan(40);
  }
  expect(closed).toBe(true);
  expect(applyCommand(state, { kind: 'order', player: 2, entityIds: [enemy.id], target: { x: 39.5, y: 35.5 } }).ok).toBe(true);
  for (let n = 0; n < 180; n++) stepGame(state);
  expect(gate.gateState).toBe('open');
});

it('ignores dead units and neutral wildlife and resolves contact independent of entity order', () => {
  const { state, gate, unit } = fixture('palisade-gate', 'x');
  unit(1, 40, 38.5);
  const enemy = unit(2, 40, 40.5);
  const reversed = structuredClone(state);
  reversed.entities.reverse();
  updateGates(state); updateGates(reversed);
  expect(gate.gateState).toBe('blocked');
  expect(reversed.entities.find(e => e.id === gate.id)!.gateState).toBe('blocked');
  enemy.dead = true;
  updateGates(state);
  expect(gate.gateState).toBe('open');
  enemy.dead = false; enemy.owner = 0; enemy.kind = 'sheep';
  updateGates(state);
  expect(gate.gateState).toBe('open');
});
