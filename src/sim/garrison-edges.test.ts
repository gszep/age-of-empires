import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FALLBACK_RULES, rulesFromManifest, type GameRules } from './data';
import { addNode, applyCommand, canGarrison, createGame, stepGame, volleyArrows } from './game';
import { synchronizationHash } from '../shared/checksum';
import { observe } from './observe';
import { updateVisibility } from './visibility';
import { validateCommand, validateObservation } from '../protocol/validate';
import type { BuildingKind, Entity, GameState, UnitKind } from './types';

const manifest = 'public/imported/aoe2/manifest.json';
const modes: [string, GameRules][] = [['fallback', FALLBACK_RULES]];
if (existsSync(manifest)) modes.push(['imported', rulesFromManifest(JSON.parse(readFileSync(manifest, 'utf8')))]);
function fixture(rules: GameRules) {
  const state = createGame(137, rules);
  state.entities = state.entities.filter(e => e.owner !== 0);
  state.terrain.fill(0);
  const tc = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
  const workers = state.entities.filter(e => e.owner === 1 && e.kind === 'villager');
  const put = (kind: BuildingKind | UnitKind, dx: number, dy: number): Entity => {
    const rule = (rules.units as any)[kind] ?? (rules.buildings as any)[kind];
    const e: Entity = { id: state.nextId++, kind, owner: 1, hp: rule.hp, maxHp: rule.hp,
      radius: rule.radius, position: { x: tc.position.x + dx, y: tc.position.y + dy },
      activity: 'idle', order: { kind: 'idle' } };
    state.entities.push(e); return e;
  };
  return { state, tc, workers, put };
}
function until(state: GameState, done: () => boolean, limit = 4000) {
  for (let i = 0; i < limit && !done(); i++) stepGame(state);
  expect(done()).toBe(true);
}
function bell(state: GameState, tc: Entity, enabled: boolean) {
  const command = { kind: 'town-bell', player: 1, buildingId: tc.id, enabled } as const;
  expect(validateCommand(command)).toBe(true);
  expect(applyCommand(state, command).ok).toBe(true);
}
const order = (state: GameState, units: Entity[], target: Entity) =>
  applyCommand(state, { kind: 'order', player: 1, entityIds: units.map(e => e.id), target: target.position, targetId: target.id });

describe.each(modes)('%s garrison edges (#137)', (_mode, rules) => {
  it('rings the bell, banks loads, and resumes interrupted work and queued orders through JSON', () => {
    const { state, tc, workers, put } = fixture(rules);
    const berries = addNode(state, 'berries', { x: tc.position.x + 6, y: tc.position.y });
    const sentry = put('militia', 3, 0);
    order(state, [sentry], tc);
    until(state, () => !!tc.garrison?.length);
    order(state, workers, berries);
    const route = { x: tc.position.x + 10, y: tc.position.y + 3 };
    applyCommand(state, { kind: 'order', player: 1, entityIds: [workers[0].id], target: route, queue: true });
    const queue = structuredClone(workers[0].orderQueue);
    workers[0].carrying = { kind: 'wood', amount: 7 };
    const bank = state.players[1].wood;
    const population = state.players[1].population;
    bell(state, tc, true);
    bell(state, tc, true); // idempotent: must not overwrite the saved work
    until(state, () => tc.garrison?.length === 4);
    expect(state.players[1].wood).toBe(bank + 7);
    expect(state.players[1].population).toBe(population);
    const clone = JSON.parse(JSON.stringify(state)) as GameState;
    bell(state, tc, false);
    bell(clone, clone.entities.find(e => e.id === tc.id)!, false);
    expect(tc.garrison?.map(e => e.id)).toEqual([sentry.id]);
    expect(workers[0].orderQueue).toEqual(queue);
    for (const worker of workers) {
      expect(worker.order).toEqual({ kind: 'gather', targetId: berries.id });
      expect(worker.bellReturn).toBeUndefined();
    }
    for (let i = 0; i < 600; i++) { stepGame(state); stepGame(clone); }
    expect(synchronizationHash(state)).toBe(synchronizationHash(clone));
    expect(berries.amount).toBeLessThan(125);
  });

  it('cancels an incoming recall and respects a newer player order', () => {
    const { state, tc, workers } = fixture(rules);
    const target = { x: tc.position.x + 12, y: tc.position.y };
    applyCommand(state, { kind: 'order', player: 1, entityIds: workers.map(e => e.id), target });
    bell(state, tc, true);
    applyCommand(state, { kind: 'stop', player: 1, entityIds: [workers[0].id] });
    bell(state, tc, false);
    expect(workers[0].order.kind).toBe('idle');
    expect(workers[1].order).toEqual({ kind: 'move', target });
    expect(workers.every(e => !e.bellReturn)).toBe(true);
  });

  it('does not restore orders on a worker killed during recall', () => {
    const { state, tc, workers } = fixture(rules);
    applyCommand(state, { kind: 'order', player: 1, entityIds: [workers[0].id],
      target: { x: tc.position.x + 12, y: tc.position.y } });
    bell(state, tc, true);
    applyCommand(state, { kind: 'delete', player: 1, entityIds: [workers[0].id] });
    bell(state, tc, false);
    expect(workers[0].dead).toBe(true);
    expect(workers[0].activity).toBe('dying');
    expect(workers[0].order.kind).toBe('idle');
    expect(workers[0].bellReturn).toBeUndefined();
  });

  it('does not recall more workers than fit, and refuses enemy or unfinished bells', () => {
    const { state, tc, workers, put } = fixture(rules);
    const capacity = rules.buildings['town-center'].garrison!.capacity;
    tc.garrison = Array.from({ length: capacity - 1 }, (_, i) => ({ ...workers[0], id: 90000 + i }));
    bell(state, tc, true);
    expect(workers.filter(e => e.order.kind === 'garrison')).toHaveLength(1);
    expect(applyCommand(state, { kind: 'town-bell', player: 2, buildingId: tc.id, enabled: true }).ok).toBe(false);
    const foundation = put('town-center', 15, 15);
    foundation.buildProgress = 0.1;
    expect(applyCommand(state, { kind: 'town-bell', player: 1, buildingId: foundation.id, enabled: true }).ok).toBe(false);
  });

  it('holds newly trained units at a self-rally, counts their population, and releases them', () => {
    const { state, tc, put } = fixture(rules);
    const barracks = put('barracks', 8, 0);
    state.players[1].food = 1000; state.players[1].gold = 1000;
    applyCommand(state, { kind: 'rally', player: 1, buildingId: barracks.id, target: barracks.position, targetId: barracks.id });
    const population = state.players[1].population;
    expect(applyCommand(state, { kind: 'train', player: 1, buildingId: barracks.id, unit: 'militia' }).ok).toBe(true);
    until(state, () => !!barracks.garrison?.length);
    const soldier = barracks.garrison![0];
    expect(soldier.kind).toBe('militia');
    expect(state.entities.some(e => e.id === soldier.id)).toBe(false);
    expect(state.players[1].population).toBe(population + 1);
    expect(canGarrison(state, soldier, barracks)).toBe(false); // type 0 is production-only
    expect(applyCommand(state, { kind: 'ungarrison', player: 1, buildingId: barracks.id }).ok).toBe(true);
    expect(state.entities.some(e => e.id === soldier.id)).toBe(true);
    expect(barracks.garrison).toBeUndefined();
    expect(tc.dead).toBeFalsy();
  });

  it('lets a full producer release its next completed unit outside without exceeding capacity', () => {
    const { state, put } = fixture(rules);
    const barracks = put('barracks', 8, 0);
    for (let i = 0; i < 8; i++) put('house', -10 + i * 3, 12);
    const soldier = put('militia', 6, 0);
    barracks.garrison = Array.from({ length: 10 }, (_, i) => ({ ...soldier, id: state.nextId++ }));
    state.players[1].populationCap = 45;
    state.players[1].food = 1000; state.players[1].gold = 1000;
    applyCommand(state, { kind: 'rally', player: 1, buildingId: barracks.id, target: barracks.position, targetId: barracks.id });
    applyCommand(state, { kind: 'train', player: 1, buildingId: barracks.id, unit: 'militia' });
    until(state, () => !barracks.training);
    expect(barracks.garrison).toHaveLength(10);
    expect(state.entities.filter(e => e.kind === 'militia' && e.owner === 1)).toHaveLength(2);
  });

  it('carries six infantry in a ram, refuses archers/cavalry, moves cargo and unloads on land', () => {
    const { state, put } = fixture(rules);
    const ram = put('battering-ram', 8, 0);
    const soldiers = Array.from({ length: 7 }, (_, i) => put('militia', 7, i * 0.4));
    expect(canGarrison(state, put('archer', 7, 0), ram)).toBe(false);
    expect(canGarrison(state, put('knight', 7, 0), ram)).toBe(false);
    order(state, soldiers, ram);
    until(state, () => ram.garrison?.length === 6);
    expect(state.entities.filter(e => soldiers.some(s => s.id === e.id))).toHaveLength(1);
    const target = { x: ram.position.x + 6, y: ram.position.y };
    applyCommand(state, { kind: 'order', player: 1, entityIds: [ram.id], target });
    until(state, () => ram.order.kind === 'idle');
    expect(applyCommand(state, { kind: 'ungarrison', player: 1, buildingId: ram.id }).ok).toBe(true);
    expect(ram.garrison).toBeUndefined();
    for (const soldier of soldiers.slice(0, 6)) {
      expect(state.entities.includes(soldier)).toBe(true);
      expect(Math.hypot(soldier.position.x - target.x, soldier.position.y - target.y)).toBeLessThan(5);
    }
  });

  it('shows opponents the flag but not passenger counts or town-bell state, and remembers only the seen flag', () => {
    const { state, tc, workers } = fixture(rules);
    bell(state, tc, true);
    until(state, () => tc.garrison?.length === workers.length);
    state.visibility[2].visible.fill(1);
    const enemy = observe(state, 2).entities.find(e => e.id === tc.id)!;
    expect(enemy.hasGarrison).toBe(true);
    expect(enemy).not.toHaveProperty('garrisoned');
    expect(enemy).not.toHaveProperty('townBell');
    expect(validateObservation(observe(state, 1))).toBe(true);
    expect(validateObservation(observe(state, 2))).toBe(true);
    const observer = state.entities.find(e => e.owner === 2 && e.kind === 'villager')!;
    observer.position = { x: tc.position.x + 3, y: tc.position.y };
    updateVisibility(state);
    expect(state.visibility[2].memory[tc.id]?.hasGarrison).toBe(true);
    observer.position = { x: state.width - 3, y: state.height - 3 };
    updateVisibility(state);
    bell(state, tc, false);
    updateVisibility(state);
    expect(observe(state, 2).memory.find(e => e.id === tc.id)?.hasGarrison).toBe(true);
  });

  it('holds new villagers while the bell rings, then releases them to the rally resource', () => {
    const { state, tc } = fixture(rules);
    const berries = addNode(state, 'berries', { x: tc.position.x + 6, y: tc.position.y });
    applyCommand(state, { kind: 'rally', player: 1, buildingId: tc.id, target: berries.position, targetId: berries.id });
    bell(state, tc, true);
    expect(applyCommand(state, { kind: 'train', player: 1, buildingId: tc.id, unit: 'villager' }).ok).toBe(true);
    const nextId = state.nextId;
    until(state, () => tc.garrison?.some(e => e.id === nextId) ?? false);
    bell(state, tc, false);
    expect(state.entities.find(e => e.id === nextId)?.order).toEqual({ kind: 'gather', targetId: berries.id });
  });

  it('releases a ram crew when the ram is destroyed', () => {
    const { state, put } = fixture(rules);
    const ram = put('battering-ram', 8, 0);
    const soldier = put('militia', 7, 0);
    order(state, [soldier], ram);
    until(state, () => ram.garrison?.length === 1);
    applyCommand(state, { kind: 'delete', player: 1, entityIds: [ram.id] });
    expect(state.entities.some(e => e.id === soldier.id && !e.dead)).toBe(true);
    expect(ram.garrison).toBeUndefined();
  });

  it('uses villager flat DPS and researched building damage rather than a fixed extra arrow', () => {
    const { state, tc, workers } = fixture(rules);
    expect(volleyArrows(state, tc)).toBe(0);
    tc.garrison = workers;
    expect(volleyArrows(state, tc)).toBe(3);
    state.players[1].researched.push('fletching');
    expect(volleyArrows(state, tc)).toBe(rules.origin === 'imported' ? 2 : 3);
  });

  it.each([false, true])('releases the computed garrison volley into actual combat (Fletching: %s)', researched => {
    const { state, tc, workers, put } = fixture(rules);
    tc.garrison = workers;
    state.entities = state.entities.filter(e => !workers.includes(e));
    if (researched) state.players[1].researched.push('fletching');
    const target = put('militia', 4, 0);
    target.owner = 2; target.hp = 1000; target.maxHp = 1000;
    until(state, () => state.projectiles.some(p => p.shooterId === tc.id));
    expect(state.projectiles.filter(p => p.shooterId === tc.id)).toHaveLength(
      researched && rules.origin === 'imported' ? 2 : 3);
    until(state, () => target.hp < 1000);
  });
});
