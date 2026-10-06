import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FALLBACK_RULES, isBuilding, rulesFromManifest, TICKS_PER_SECOND, type ContentManifest, type GameRules } from './data';
import { activateAutomaticTechnologies, applyCommand, createGame, resolveUnitOrder, stepGame } from './game';
import { buildingRulesFor, unitRulesFor, unitRulesForEntity } from './rules';
import { updateVisibility } from './visibility';
import { synchronizationHash } from '../shared/checksum';
import type { Entity, EntityKind, GameState, Point } from './types';

const manifestPath = process.env.CIV_PROFILE_CONTENT ?? 'public/imported/aoe2/manifest.json';
const manifest = existsSync(manifestPath)
  ? JSON.parse(readFileSync(manifestPath, 'utf8')) : undefined;
const owned = manifest !== undefined ? rulesFromManifest(manifest) : undefined;
const cases = [{ mode: 'open', rules: FALLBACK_RULES }, ...(owned ? [{ mode: 'owned', rules: owned }] : [])];

function arena(rules: GameRules) {
  const state = createGame(131, structuredClone(rules));
  state.entities = state.entities.filter(e => e.kind === 'town-center');
  state.terrain.fill(0); state.elevation.fill(0);
  for (const player of [1, 2] as const) state.players[player].age = 3;
  activateAutomaticTechnologies(state);
  const put = (kind: EntityKind, x: number, y: number, owner: 1 | 2 = 1): Entity => {
    if (kind === 'resource' || kind === 'relic') throw new Error('unit/building fixture');
    const r = isBuilding(kind) ? buildingRulesFor(state, owner, kind) : unitRulesFor(state, owner, kind);
    const e: Entity = { id: state.nextId++, kind, owner, position: { x, y }, hp: r.hp, maxHp: r.hp,
      radius: r.radius, order: { kind: 'idle' }, activity: 'idle' };
    state.entities.push(e); return e;
  };
  const treb = put('trebuchet', 40.5, 40.5), target = put('house', 52.5, 40.5, 2);
  updateVisibility(state);
  return { state, treb, target, put };
}
const run = (s: GameState, ticks: number) => { for (let i = 0; i < ticks; i++) stepGame(s); };
function until(s: GameState, done: () => boolean, ticks = 2000) {
  for (let i = 0; i < ticks && !done(); i++) stepGame(s);
  expect(done()).toBe(true);
}
function order(s: GameState, treb: Entity, target: Entity | Point) {
  updateVisibility(s);
  expect(applyCommand(s, { kind: 'order', player: 1, entityIds: [treb.id],
    target: 'position' in target ? target.position : target, ...('id' in target ? { targetId: target.id } : {}) }).ok).toBe(true);
}

// Deliberately vary the two source inputs independently: neither a hard-coded
// native duration nor the coincidentally equal train time may replace task125.
function packingManifest(packingWork: number | undefined, workRate: number) {
  const entity: ContentManifest['entities'][string] = { hitPoints: 150, collision: [0.5, 0.5], lineOfSight: 19 };
  return rulesFromManifest({ entities: {
    trebuchet: { ...entity, packingWork, train: { seconds: 999, buildingId: 82 } },
    'trebuchet-unpacked': { ...entity, workRate },
  } });
}

it.each([
  { mode: 'open native baseline', rules: FALLBACK_RULES, ticks: 222 },
  { mode: 'task125 native baseline', rules: packingManifest(50, 4.5), ticks: 222 },
  { mode: 'older manifest missing task125', rules: packingManifest(undefined, 4.5), ticks: 222 },
  { mode: 'different work', rules: packingManifest(72, 4.5), ticks: 320 },
  { mode: 'different rate', rules: packingManifest(50, 5), ticks: 200 },
])('$mode: public pack/unpack completes at work/rate, not work-rate seconds', ({ rules, ticks }) => {
  const { state, treb, target } = arena(rules);
  target.owner = 1; // no automatic deployment between manual cycles
  for (let cycle = 0; cycle < 3; cycle++) for (const unpacked of [true, false]) {
    expect(applyCommand(state, { kind: 'pack', player: 1, entityIds: [treb.id], unpacked }).ok).toBe(true);
    run(state, ticks - 1);
    expect(treb.unpacked === true).toBe(!unpacked);
    expect(treb.packingTicks).toBe(1);
    stepGame(state);
    expect(treb.unpacked).toBe(unpacked);
    expect(treb.packingTicks).toBeUndefined();
  }
});

describe.each(cases)('$mode trebuchet automation', ({ rules }) => {
  it('automatically deploys for a visible building and really damages it without moving', () => {
    const { state, treb, target } = arena(rules), origin = { ...treb.position };
    until(state, () => treb.packingTicks !== undefined);
    expect(treb.order).toEqual({ kind: 'attack', targetId: target.id, automatic: true });
    const ticks = Math.round(unitRulesForEntity(state, treb).unpacked!.seconds * TICKS_PER_SECOND);
    expect(treb.packingTicks).toBe(ticks);
    run(state, ticks - 1);
    expect(treb.unpacked).toBeFalsy(); expect(target.hp).toBe(target.maxHp);
    expect(state.projectiles).toHaveLength(0);
    stepGame(state); expect(treb.unpacked).toBe(true);
    until(state, () => target.hp < target.maxHp);
    expect(treb.position).toEqual(origin);
  });

  it.each(['too-close', 'too-far', 'unit', 'friendly', 'dead'] as const)('does not automatically deploy for %s targets', reason => {
    const { state, treb, target, put } = arena(rules);
    if (reason === 'too-close') target.position.x = treb.position.x + 3;
    if (reason === 'too-far') target.position.x = treb.position.x + 25;
    if (reason === 'unit') { target.dead = true; put('villager', 52, 40, 2); }
    if (reason === 'friendly') target.owner = 1;
    if (reason === 'dead') target.dead = true;
    updateVisibility(state); run(state, 160);
    expect(treb.order.kind).toBe('idle'); expect(treb.packingTicks).toBeUndefined();
    expect(treb.unpacked).toBeFalsy(); expect(state.projectiles).toHaveLength(0);
  });

  it('uses actual sight for acquisition and preserves an explicit move past a building', () => {
    const { state, treb, target } = arena(rules);
    state.tick = 9; state.visibility[1].visible.fill(0);
    stepGame(state);
    expect(treb.order.kind).toBe('idle');
    order(state, treb, { x: 40.5, y: 30.5 });
    run(state, 100);
    expect(treb.position.y).toBeLessThan(40);
    expect(treb.packingTicks).toBeUndefined(); expect(treb.unpacked).toBeFalsy();
    expect(target.hp).toBe(target.maxHp);
  });

  it('right-clicks a distant enemy: packed approach, setup, shot; can redeploy to a new distant target', () => {
    const { state, treb, target, put } = arena(rules);
    target.position.x = 70.5;
    // A scout legitimately reveals the target for the public target-id order.
    put('villager', 68, 45);
    order(state, treb, target);
    expect(resolveUnitOrder(state, treb, target.position, target).kind).toBe('attack');
    expect(treb.order).toEqual({ kind: 'attack', targetId: target.id });
    until(state, () => target.hp < target.maxHp);
    expect(treb.unpacked).toBe(true); expect(treb.position.x).toBeGreaterThan(40.5);
    expect(treb.position.x).toBeLessThan(60);
    const second = put('house', 82.5, 40.5, 2);
    put('villager', 80, 45);
    order(state, treb, second);
    const origin = { ...treb.position };
    stepGame(state); expect(treb.packingTicks).toBeGreaterThan(0);
    expect(treb.position).toEqual(origin);
    until(state, () => second.hp < second.maxHp);
    expect(treb.position.x).toBeGreaterThan(origin.x); expect(treb.unpacked).toBe(true);
  });

  it('honours manual Pack, cancels setup on move, and does not restart a pack on repeated moves', () => {
    const { state, treb, target } = arena(rules);
    until(state, () => treb.packingTicks !== undefined);
    order(state, treb, { x: 40.5, y: 30.5 });
    expect(treb.packingTicks).toBeUndefined(); run(state, 20);
    expect(treb.unpacked).toBeFalsy(); expect(treb.position.y).toBeLessThan(40.5);
    order(state, treb, target);
    until(state, () => !!treb.unpacked);
    expect(applyCommand(state, { kind: 'pack', player: 1, entityIds: [treb.id], unpacked: false }).ok).toBe(true);
    until(state, () => !treb.unpacked);
    run(state, 200); expect(treb.unpacked).toBe(false); expect(treb.packingTicks).toBeUndefined();
    order(state, treb, target); until(state, () => !!treb.unpacked);
    order(state, treb, { x: 35.5, y: 30.5 });
    run(state, 10); const remaining = treb.packingTicks;
    order(state, treb, { x: 34.5, y: 30.5 });
    expect(treb.packingTicks).toBe(remaining);
  });

  it('finishes a saved setup deterministically and reacquires after its target is destroyed', () => {
    const { state, treb, target, put } = arena(rules);
    until(state, () => treb.packingTicks !== undefined);
    run(state, 20);
    const resumed: GameState = JSON.parse(JSON.stringify(state));
    const remaining = treb.packingTicks!;
    expect(remaining).toBeGreaterThan(0);
    run(state, remaining); run(resumed, remaining);
    for (const completed of [treb, resumed.entities.find(e => e.id === treb.id)!]) {
      expect(completed.unpacked).toBe(true);
      expect(completed.packingTicks).toBeUndefined();
    }
    expect(synchronizationHash(resumed)).toBe(synchronizationHash(state));
    const next = put('house', 52.5, 43.5, 2);
    target.hp = 0;
    until(state, () => next.hp < next.maxHp);
    expect(treb.order).toMatchObject({ kind: 'attack', targetId: next.id, automatic: true });
  });
});

it.skipIf(manifest === undefined)('automatic deployment uses Japanese Kataparuto setup time', () => {
  const { state, treb } = arena(rulesFromManifest(manifest.civilizations.japanese));
  state.players[1].researched.push('kataparuto');
  const setup = unitRulesForEntity(state, treb).unpacked!.seconds;
  expect(setup).toBeCloseTo(50 / 18);
  until(state, () => treb.packingTicks !== undefined);
  expect(treb.packingTicks).toBe(Math.round(setup * TICKS_PER_SECOND));
  run(state, Math.round(setup * TICKS_PER_SECOND));
  expect(treb.unpacked).toBe(true);
});
