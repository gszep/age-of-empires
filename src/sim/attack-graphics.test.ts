import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FALLBACK_RULES, rulesFromManifest, type GameRules } from './data';
import { applyCommand, createGame, stepGame, swingSeconds } from './game';
import { unitRulesFor } from './rules';
import { updateVisibility } from './visibility';
import { chooseAnimation } from '../view/sprites';
import { synchronizationHash } from '../shared/checksum';
import type { Entity, GameState, UnitKind } from './types';

function arena(rules: GameRules, kind: UnitKind = 'militia', water = false) {
  const s = createGame(270, rules);
  s.entities = s.entities.filter(e => e.kind === 'town-center');
  s.terrain.fill(water ? 23 : 0); s.elevation.fill(0);
  const stats = unitRulesFor(s, 1, kind);
  const actor: Entity = { id: s.nextId++, kind, owner: 1, position: { x: 40.5, y: 40.5 },
    hp: stats.hp, maxHp: stats.hp, radius: stats.radius, activity: 'idle', order: { kind: 'idle' } };
  const target: Entity = { id: s.nextId++, kind: water ? 'transport-ship' : 'trade-cart', owner: 2,
    position: { x: water ? 44.5 : 41, y: 40.5 }, hp: 10000, maxHp: 10000, radius: .3,
    activity: 'idle', order: { kind: 'idle' } };
  s.entities.push(actor, target); updateVisibility(s);
  return { s, actor, target };
}
function attack(s: GameState, actor: Entity, target: Entity) {
  expect(applyCommand(s, { kind: 'order', player: 1, entityIds: [actor.id], targetId: target.id, target: target.position })).toEqual({ ok: true });
}
function until(s: GameState, done: () => boolean, ticks = 200) {
  for (let i = 0; i < ticks && !done(); i++) stepGame(s);
  expect(done()).toBe(true);
}

describe('authoritative first/second attack graphics', () => {
  const source = () => {
    const rules = structuredClone(FALLBACK_RULES);
    // Deliberately different release clocks discriminate selection before
    // windup from a cosmetic toggle applied only after damage.
    rules.units.militia.attackReleaseSeconds = .1;
    rules.units.militia.secondAttackReleaseSeconds = .3;
    rules.units.militia.attackReloadSeconds = 2;
    return rules;
  };

  it('alternates before windup and lands three real hits on the corresponding release clocks', () => {
    const { s, actor, target } = arena(source()); attack(s, actor, target);
    const hits: { tick: number; animation: string }[] = []; let hp = target.hp;
    until(s, () => {
      if (target.hp < hp) { hits.push({ tick: s.tick, animation: chooseAnimation(s, actor).name }); hp = target.hp; }
      return hits.length === 3;
    });
    expect(hits).toEqual([{ tick: 2, animation: 'attack' }, { tick: 46, animation: 'attack-2' }, { tick: 82, animation: 'attack' }]);
  });

  it('preserves a second windup through JSON and continues the sequence after Stop/re-task', () => {
    const { s, actor, target } = arena(source()); attack(s, actor, target);
    until(s, () => actor.attackAnimation === 1 && (actor.attackWindup ?? 0) > 0);
    const saved = JSON.parse(JSON.stringify(s)) as GameState;
    expect(chooseAnimation(saved, saved.entities.find(e => e.id === actor.id)!).name).toBe('attack-2');
    expect(swingSeconds(saved, saved.entities.find(e => e.id === actor.id)!)).toBe(swingSeconds(s, actor));
    for (const state of [s, saved]) {
      expect(applyCommand(state, { kind: 'stop', player: 1, entityIds: [actor.id] }).ok).toBe(true);
      attack(state, state.entities.find(e => e.id === actor.id)!, state.entities.find(e => e.id === target.id)!);
    }
    stepGame(s); stepGame(saved); expect(actor.attackAnimation).toBe(0);
    for (let i = 0; i < 100; i++) { stepGame(s); stepGame(saved); }
    expect(synchronizationHash(saved)).toBe(synchronizationHash(s));
  });

  it('keeps charged special artwork authoritative and ignores stale second-graphic state after a definition change', () => {
    const { s, actor } = arena(source()); actor.activity = 'attacking'; actor.attackAnimation = 1;
    actor.attackWeapon = 'alternate'; expect(chooseAnimation(s, actor).name).toBe('attack-special');
    actor.attackWeapon = undefined; delete s.rules.units.militia.secondAttackReleaseSeconds;
    expect(chooseAnimation(s, actor).name).toBe('attack');
  });
});

const path = process.env.CIV_PROFILE_CONTENT ?? 'public/imported/aoe2/manifest.json';
const imported = existsSync(path) ? rulesFromManifest(JSON.parse(readFileSync(path, 'utf8'))) : undefined;
describe.skipIf(imported?.units['dat-unit-329']?.secondAttackReleaseSeconds === undefined)('owned alternate attacks', () => {
  it.each(['dat-unit-329', 'long-swordsman', 'dat-unit-25', 'galley'] as const)('%s changes the actual attack phase without changing its source reload period', kind => {
    const { s, actor, target } = arena(imported!, kind, kind === 'galley');
    attack(s, actor, target); until(s, () => actor.attackAnimation === 0);
    const start = s.tick; expect(chooseAnimation(s, actor).name).toBe('attack');
    until(s, () => actor.attackAnimation === 1);
    expect(s.tick - start).toBe(Math.round(unitRulesFor(s, 1, kind).attackReloadSeconds * 20));
    expect(chooseAnimation(s, actor).name).toBe('attack-2');
    until(s, () => target.hp < target.maxHp);
  });

  it('Cannon Galleon Attack Ground alternates the same owned graphics and releases real shots', () => {
    const { s, actor } = arena(imported!, 'cannon-galleon', true);
    expect(applyCommand(s, { kind: 'attack-ground', player: 1, entityIds: [actor.id], target: { x: 48.5, y: 40.5 } })).toEqual({ ok: true });
    until(s, () => actor.attackAnimation === 0);
    expect(s.projectiles.some(p => p.shooterId === actor.id)).toBe(true);
    until(s, () => actor.attackAnimation === 1, 400);
    expect(chooseAnimation(s, actor).name).toBe('attack-2');
    expect(s.projectiles.some(p => p.shooterId === actor.id)).toBe(true);
  });
});
