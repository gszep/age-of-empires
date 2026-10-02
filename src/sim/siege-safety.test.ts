import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FALLBACK_RULES, isBuilding, rulesFromManifest, TICKS_PER_SECOND, type GameRules } from './data';
import { activateAutomaticTechnologies, applyCommand, createGame, stepGame } from './game';
import { buildingRulesFor, unitRulesFor } from './rules';
import { updateVisibility } from './visibility';
import { synchronizationHash } from '../shared/checksum';
import type { Entity, EntityKind, GameState, PlayerId, Point, UnitKind } from './types';

const manifest = JSON.parse(readFileSync('public/imported/aoe2/manifest.json', 'utf8'));
const owned = rulesFromManifest(manifest.civilizations.teutons);
const cases = [
  ...(['mangonel', 'onager'] as const).map(kind => ({ mode: 'fallback', kind, rules: FALLBACK_RULES })),
  ...(['mangonel', 'onager', 'dat-unit-588'] as const).map(kind => ({ mode: 'owned', kind, rules: owned })),
];

function fixture(rules: GameRules, kind: UnitKind = 'mangonel') {
  const state = createGame(278, structuredClone(rules));
  state.entities = state.entities.filter(e => e.kind === 'town-center');
  state.terrain.fill(0); state.elevation.fill(0);
  for (const player of [1, 2] as const) state.players[player].age = 3;
  activateAutomaticTechnologies(state);
  const put = (kind: EntityKind, x: number, y: number, owner: PlayerId = 1): Entity => {
    if (kind === 'resource' || kind === 'relic') throw new Error('unit/building fixture');
    const rule = isBuilding(kind) ? buildingRulesFor(state, owner, kind) : unitRulesFor(state, owner, kind);
    const entity: Entity = { id: state.nextId++, kind, owner, hp: rule.hp, maxHp: rule.hp, radius: rule.radius,
      position: { x, y }, activity: 'idle', order: { kind: 'idle' } };
    state.entities.push(entity); return entity;
  };
  const siege = put(kind, 42.5, 40.5), target = put('outpost', 48.5, 40.5, 2), friend = put('villager', 49.5, 40.5);
  updateVisibility(state);
  return { state, siege, target, friend, put };
}
function run(state: GameState, ticks: number) { for (let i = 0; i < ticks; i++) stepGame(state); }
function until(state: GameState, done: () => boolean, ticks = 1500) {
  for (let i = 0; i < ticks && !done(); i++) stepGame(state);
  expect(done()).toBe(true);
}
function order(state: GameState, entity: Entity, target: Entity | Point) {
  updateVisibility(state);
  expect(applyCommand(state, { kind: 'order', player: entity.owner as PlayerId, entityIds: [entity.id],
    target: 'position' in target ? target.position : target, ...('id' in target ? { targetId: target.id } : {}) }).ok).toBe(true);
}
function stop(state: GameState, entity: Entity) {
  expect(applyCommand(state, { kind: 'stop', player: entity.owner as PlayerId, entityIds: [entity.id] }).ok).toBe(true);
}

describe.each(cases)('$mode $kind friendly blast avoidance', ({ rules, kind }) => {
  it('holds automatic fire, then actually damages the enemy after the friend walks clear', () => {
    const { state, siege, target, friend } = fixture(rules, kind);
    stop(state, siege);
    run(state, Math.ceil((unitRulesFor(state, 1, kind).attackReloadSeconds * 2 + 1) * TICKS_PER_SECOND));
    expect(siege.order.kind).toBe('idle'); expect(state.projectiles).toHaveLength(0);
    expect(target.hp).toBe(target.maxHp); expect(friend.hp).toBe(friend.maxHp);
    order(state, friend, { x: 53.5, y: 40.5 });
    until(state, () => target.hp < target.maxHp);
    expect(friend.hp).toBe(friend.maxHp);
    expect(siege.order).toMatchObject({ kind: 'attack', targetId: target.id, automatic: true });
  });

  it('chooses a farther safe target instead of firing into the nearest friendly body', () => {
    const { state, siege, target, friend, put } = fixture(rules, kind);
    const safe = put('outpost', 48.5, 44.5, 2);
    stop(state, siege);
    until(state, () => safe.hp < safe.maxHp);
    expect(target.hp).toBe(target.maxHp); expect(friend.hp).toBe(friend.maxHp);
    expect(siege.order).toMatchObject({ kind: 'attack', targetId: safe.id, automatic: true });
  });

  it.each(['attack', 'attack-ground'])('keeps deliberate %s and its real friendly splash under player control', command => {
    const { state, siege, target, friend } = fixture(rules, kind);
    stop(state, siege); run(state, 20);
    if (command === 'attack') order(state, siege, target);
    else expect(applyCommand(state, { kind: 'attack-ground', player: 1, entityIds: [siege.id], target: target.position }).ok).toBe(true);
    expect('automatic' in siege.order).toBe(false);
    until(state, () => friend.hp < friend.maxHp);
    expect(target.hp).toBeLessThan(target.maxHp);
  });

  it.each([-0.05, 0.05])('uses actual blast radius plus friendly body radius at boundary delta %s', delta => {
    const { state, siege, target, friend } = fixture(rules, kind);
    const radius = unitRulesFor(state, 1, kind).blastRadius!;
    friend.position.x = target.position.x + radius + friend.radius + delta;
    stop(state, siege); run(state, 200);
    expect(friend.hp).toBe(friend.maxHp);
    if (delta < 0) expect(target.hp).toBe(target.maxHp);
    else expect(target.hp).toBeLessThan(target.maxHp);
  });
});

it.each([['fallback', FALLBACK_RULES], ['owned', owned]] as const)('rechecks acquired intent and preserves safe holding through JSON (%s)', (_, rules) => {
  const { state, siege, target, friend } = fixture(rules);
  siege.position.x = 39.5; friend.position.x = 50.5;
  stop(state, siege);
  until(state, () => siege.order.kind === 'attack');
  expect(siege.order).toMatchObject({ automatic: true });
  expect(state.projectiles).toHaveLength(0);
  order(state, friend, { x: 49.5, y: 40.5 });
  until(state, () => Math.abs(friend.position.x - 49.5) < 0.05);
  run(state, 20);
  expect(siege.activity).toBe('idle'); expect(state.projectiles).toHaveLength(0);
  expect(target.hp).toBe(target.maxHp); expect(friend.hp).toBe(friend.maxHp);
  expect(siege.order).toMatchObject({ targetId: target.id, automatic: true });
  const restored = JSON.parse(JSON.stringify(state)) as GameState;
  for (const s of [state, restored]) run(s, 200);
  expect(synchronizationHash(restored)).toBe(synchronizationHash(state));
  // Explicitly retasking the same enemy must replace the saved automatic intent.
  for (const s of [state, restored]) {
    const attacker = s.entities.find(e => e.id === siege.id)!, victim = s.entities.find(e => e.id === target.id)!;
    order(s, attacker, victim);
    expect('automatic' in attacker.order).toBe(false);
    run(s, 240);
  }
  expect(state.entities.find(e => e.id === friend.id)?.hp ?? 0).toBeLessThan(friend.maxHp);
  expect(synchronizationHash(restored)).toBe(synchronizationHash(state));
});

it('does not let a dead friendly body block acquisition', () => {
  const { state, siege, target, friend } = fixture(owned);
  friend.hp = 0; friend.dead = true; friend.activity = 'dying'; friend.decayTicks = 1000;
  stop(state, siege); until(state, () => target.hp < target.maxHp);
});

it('cancels an existing fallback windup when a friend walks into danger', () => {
  const { state, siege, target, friend } = fixture(FALLBACK_RULES);
  friend.position.x = 49.75;
  stop(state, siege); until(state, () => siege.attackWindup !== undefined);
  expect(state.projectiles).toHaveLength(0);
  order(state, friend, { x: 49.5, y: 40.5 });
  run(state, 200);
  expect(siege.attackWindup).toBeUndefined(); expect(siege.activity).toBe('idle');
  expect(state.projectiles).toHaveLength(0);
  expect(friend.hp).toBe(friend.maxHp); expect(target.hp).toBe(target.maxHp);
});

it.each([['fallback', FALLBACK_RULES], ['owned', owned]] as const)('retargets an acquired unsafe enemy to a safe alternative (%s)', (_, rules) => {
  const { state, siege, target, friend, put } = fixture(rules);
  siege.position.x = 39.5; friend.position.x = 50.5;
  const safe = put('outpost', 48.5, 42.5, 2);
  stop(state, siege); until(state, () => siege.order.kind === 'attack');
  expect(siege.order).toMatchObject({ targetId: target.id, automatic: true });
  order(state, friend, { x: 49.5, y: 40.5 });
  until(state, () => safe.hp < safe.maxHp);
  expect(target.hp).toBe(target.maxHp); expect(friend.hp).toBe(friend.maxHp);
  expect(siege.order).toMatchObject({ targetId: safe.id, automatic: true });
});

it('retains ordinary non-splash autonomous attacks without the new marker', () => {
  const { state, siege: archer, target, friend } = fixture(owned, 'archer');
  stop(state, archer); until(state, () => target.hp < target.maxHp);
  expect(friend.hp).toBe(friend.maxHp); expect('automatic' in archer.order).toBe(false);
});

it.each([['fallback', FALLBACK_RULES], ['owned', owned]] as const)('rechecks between shots and lets cooldown expire while holding (%s)', (_, rules) => {
  const { state, siege, target, friend } = fixture(rules);
  friend.position.x = 50.5;
  stop(state, siege);
  until(state, () => target.hp < target.maxHp && state.projectiles.length === 0);
  const hitPoints = target.hp;
  expect(friend.hp).toBe(friend.maxHp);
  order(state, friend, { x: 49.5, y: 40.5 });
  until(state, () => Math.abs(friend.position.x - 49.5) < 0.05);
  run(state, 240);
  expect(target.hp).toBe(hitPoints); expect(friend.hp).toBe(friend.maxHp);
  expect(state.projectiles).toHaveLength(0); expect(siege.attackCooldown).toBe(0);
  order(state, friend, { x: 53.5, y: 40.5 });
  until(state, () => target.hp < hitPoints);
  expect(friend.hp).toBe(friend.maxHp);
});

it('protects a friendly building that would actually take splash damage', () => {
  const { state, siege, target, friend, put } = fixture(owned);
  friend.position = { x: 55.5, y: 40.5 };
  const house = put('house', 50, 40.5);
  stop(state, siege); run(state, 260);
  expect(target.hp).toBe(target.maxHp); expect(house.hp).toBe(house.maxHp);
  expect(state.projectiles).toHaveLength(0);
  order(state, siege, target);
  until(state, () => house.hp < house.maxHp);
  expect(target.hp).toBeLessThan(target.maxHp);
});

it('retains unmarked legacy attack orders through JSON without inferring player intent', () => {
  const { state, siege, target, friend } = fixture(owned);
  // A pre-marker saved attack is deliberately interpreted like an explicit order.
  siege.order = { kind: 'attack', targetId: target.id };
  const restored = JSON.parse(JSON.stringify(state)) as GameState;
  until(restored, () => (restored.entities.find(e => e.id === friend.id)?.hp ?? 0) < friend.maxHp);
  expect(restored.entities.find(e => e.id === target.id)!.hp).toBeLessThan(target.maxHp);
  expect(restored.entities.find(e => e.id === siege.id)!.order).not.toHaveProperty('automatic');
});

it('checks the led impact area for a moving target, not only its current position', () => {
  const scene = (ballistics: boolean, explicit: boolean) => {
    const { state, siege, target, friend, put } = fixture(owned);
    state.entities = state.entities.filter(e => e.id !== target.id);
    friend.position = { x: 48.5, y: 42.5 };
    const cart = put('trade-cart', 48.5, 40.5, 2);
    if (ballistics) state.players[1].researched.push('ballistics');
    order(state, cart, { x: 48.5, y: 50.5 });
    run(state, 1); // Establish movement through a public order before either shot.
    if (explicit) order(state, siege, cart);
    else stop(state, siege);
    return { state, siege, cart, friend };
  };
  const unled = scene(false, false), guarded = scene(true, false), manual = scene(true, true);
  for (const { state } of [unled, guarded]) run(state, 15);
  expect(unled.state.projectiles.some(p => p.shooterId === unled.siege.id)).toBe(true);
  expect(guarded.state.projectiles).toHaveLength(0);
  expect(guarded.cart.hp).toBe(guarded.cart.maxHp);
  expect(guarded.friend.hp).toBe(guarded.friend.maxHp);
  // The same source weapon/positions really can harm that friend if explicitly fired.
  until(manual.state, () => manual.friend.hp < manual.friend.maxHp);
});
