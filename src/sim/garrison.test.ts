import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FALLBACK_RULES, TICKS_PER_SECOND, rulesFromManifest, type ContentManifest, type GameRules } from './data';
import { applyCommand, canGarrison, createGame, placementLegal, stepGame, volleyArrows } from './game';
import { observe } from './observe';
import { validateObservation, explain } from '../protocol/validate';
import { checksumState } from './checksum';
import type { BuildingKind, Entity, GameState, UnitKind } from './types';

const MANIFEST_PATH = 'public/imported/aoe2/manifest.json';
const importedRules: GameRules | undefined = existsSync(MANIFEST_PATH)
  ? rulesFromManifest(JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as ContentManifest)
  : undefined;

const run = (state: GameState, ticks: number) => {
  for (let i = 0; i < ticks; i++) stepGame(state);
};
const townCenter = (state: GameState, owner: 1 | 2 = 1) =>
  state.entities.find(e => e.owner === owner && e.kind === 'town-center')!;
const villagers = (state: GameState) => state.entities.filter(e => e.owner === 1 && e.kind === 'villager');

function spawn(state: GameState, kind: UnitKind, owner: 1 | 2, at: { x: number; y: number }): Entity {
  const rules = state.rules.units[kind];
  const entity: Entity = {
    id: state.nextId++, kind, owner, position: { ...at },
    hp: rules.hp, maxHp: rules.hp, radius: rules.radius,
    activity: 'idle', order: { kind: 'idle' },
  };
  state.entities.push(entity);
  return entity;
}

function freeSpot(state: GameState, kind: BuildingKind, near: { x: number; y: number }) {
  for (let radius = 3; radius <= 16; radius += 0.5) {
    for (let step = 0; step < 16; step++) {
      const angle = step * Math.PI / 8;
      const spot = { x: near.x + Math.cos(angle) * radius, y: near.y + Math.sin(angle) * radius };
      if (placementLegal(state, kind, spot).ok) return spot;
    }
  }
  throw new Error(`no legal ${kind} placement`);
}

function place(state: GameState, kind: BuildingKind, owner: 1 | 2 = 1): Entity {
  const rules = state.rules.buildings[kind];
  const entity: Entity = {
    id: state.nextId++, kind, owner, position: freeSpot(state, kind, townCenter(state, owner).position),
    hp: rules.hp, maxHp: rules.hp, radius: rules.radius,
    activity: 'idle', order: { kind: 'idle' },
  };
  state.entities.push(entity);
  return entity;
}

const order = (state: GameState, units: Entity[], target: Entity) => applyCommand(state, {
  kind: 'order', player: 1, entityIds: units.map(u => u.id), target: target.position, targetId: target.id,
});

describe('garrison', () => {
  it('reads the DAT: who fits where, how many, and what they add to the volley', () => {
    // Issue #75. `garrison_capacity` 15/20/5, `garrison_type` 11/15/11,
    // `total_projectiles` 1/5/1 to `max_total_projectiles` 11/21/5, and the
    // town center's own projectile is -1.
    for (const rules of [FALLBACK_RULES, importedRules].filter(Boolean) as GameRules[]) {
      const tc = rules.buildings['town-center'].garrison!;
      expect([tc.capacity, tc.types, tc.volley!.base, tc.volley!.max]).toEqual([15, 11, 1, 11]);
      expect(tc.volley!.ownProjectile).toBe(false);
      const castle = rules.buildings.castle.garrison!;
      expect([castle.capacity, castle.types, castle.volley!.base, castle.volley!.max]).toEqual([20, 15, 5, 21]);
      expect(castle.volley!.ownProjectile).toBe(true);
      expect(rules.buildings['watch-tower'].garrison!.capacity).toBe(5);
      expect(rules.buildings.barracks.garrison?.types ?? 0).toBe(0);
      expect(rules.units.archer.garrisonFirepower).toBe(1);
      expect(rules.units.villager.garrisonFirepower).toBe(-2.5);
      expect(rules.units.militia.garrisonFirepower ?? 0).toBe(0);
    }
  });

  it('takes a villager in on a right-click, banks its load, and lets it out again', () => {
    const state = createGame(95);
    const tc = townCenter(state);
    const [villager] = villagers(state);
    villager.carrying = { kind: 'food', amount: 7 };
    const food = state.players[1].food;
    const before = state.players[1].population;
    expect(order(state, [villager], tc).ok).toBe(true);
    expect(villager.order).toEqual({ kind: 'garrison', targetId: tc.id });
    run(state, 15 * TICKS_PER_SECOND);
    // Inside: out of the entity list, still counted, load banked.
    expect(state.entities.find(e => e.id === villager.id)).toBeUndefined();
    expect(tc.garrison?.map(u => u.id)).toEqual([villager.id]);
    expect(state.players[1].food).toBe(food + 7);
    expect(state.players[1].population).toBe(before);
    // The owner sees the count; the opponent sees nothing of it.
    const mine = observe(state, 1);
    expect(mine.entities.find(e => e.id === tc.id)?.garrisoned).toBe(1);
    expect(validateObservation(mine), explain(validateObservation)).toBe(true);
    expect(observe(state, 2).entities.find(e => e.id === tc.id)?.garrisoned).toBeUndefined();
    // Out, beside the building, idle.
    expect(applyCommand(state, { kind: 'ungarrison', player: 1, buildingId: tc.id }).ok).toBe(true);
    const out = state.entities.find(e => e.id === villager.id)!;
    expect(out).toBeDefined();
    expect(out.order.kind).toBe('idle');
    expect(Math.hypot(out.position.x - tc.position.x, out.position.y - tc.position.y)).toBeGreaterThan(tc.radius);
    expect(tc.garrison).toBeUndefined();
    expect(applyCommand(state, { kind: 'ungarrison', player: 1, buildingId: tc.id }).ok).toBe(false);
  });

  it('turns away cavalry at the town center, anybody at a barracks, and the sixteenth', () => {
    const state = createGame(96);
    const tc = townCenter(state);
    const knight = spawn(state, 'knight', 1, { x: tc.position.x + 3, y: tc.position.y });
    expect(canGarrison(state, knight, tc)).toBe(false);
    const castle = place(state, 'castle');
    expect(canGarrison(state, knight, castle)).toBe(true);
    const barracks = place(state, 'barracks');
    const militia = spawn(state, 'militia', 1, { x: tc.position.x + 3, y: tc.position.y + 1 });
    expect(canGarrison(state, militia, barracks)).toBe(false);
    expect(canGarrison(state, militia, tc)).toBe(true);
    tc.garrison = Array.from({ length: 15 }, (_, i) => ({ ...militia, id: 90000 + i }));
    expect(canGarrison(state, militia, tc)).toBe(false);
    // Nor the enemy's, nor a foundation.
    expect(canGarrison(state, militia, townCenter(state, 2))).toBe(false);
    tc.garrison = undefined;
    const site = place(state, 'watch-tower');
    site.buildProgress = 0.5;
    expect(canGarrison(state, militia, site)).toBe(false);
  });

  it('shoots for its garrison: nothing empty, villager DPS, and no phantom primary arrow', () => {
    const state = createGame(97);
    const tc = townCenter(state);
    const enemy = spawn(state, 'militia', 2, { x: tc.position.x + 4, y: tc.position.y });
    enemy.order = { kind: 'idle' };
    // Hold the enemy still, out of the fight, so only the arrows tell.
    const hp = enemy.hp;
    run(state, 4 * TICKS_PER_SECOND);
    expect(enemy.hp).toBe(hp);
    expect(volleyArrows(state, tc)).toBe(0);
    const [a, b, c] = villagers(state);
    tc.garrison = [a, b, c];
    state.entities = state.entities.filter(e => ![a, b, c].includes(e));
    expect(volleyArrows(state, tc)).toBe(3);
    run(state, 4 * TICKS_PER_SECOND);
    expect(enemy.hp).toBeLessThan(hp);
    // Fifteen inside: the DAT's cap, not fifteen arrows.
    tc.garrison = Array.from({ length: 15 }, (_, i) => ({ ...a, id: 91000 + i }));
    expect(volleyArrows(state, tc)).toBe(10);
    // A castle empty shoots its five.
    const castle = place(state, 'castle');
    expect(volleyArrows(state, castle)).toBe(5);
    const archer = spawn(state, 'archer', 1, castle.position);
    castle.garrison = [archer];
    // One archer's DPS is below one castle arrow's DPS.
    expect(volleyArrows(state, castle)).toBe(5);
  });

  it('heals those inside, and lets them out when it falls', () => {
    const state = createGame(98);
    const tc = townCenter(state);
    const [villager] = villagers(state);
    villager.hp = 5;
    order(state, [villager], tc);
    run(state, 15 * TICKS_PER_SECOND);
    expect(tc.garrison?.length).toBe(1);
    const inside = tc.garrison![0];
    // 0.1 a second, as the DAT gives it: a hit point every ten seconds, so
    // twenty seconds inside is two more whatever the phase.
    const at = inside.hp;
    run(state, 20 * TICKS_PER_SECOND);
    expect(inside.hp).toBe(at + 2);
    tc.hp = 0;
    run(state, 1);
    expect(tc.dead).toBe(true);
    const out = state.entities.find(e => e.id === villager.id)!;
    expect(out).toBeDefined();
    expect(out.dead).toBeFalsy();
  });

  it('replays identically with a garrison in the fight', () => {
    const build = () => {
      const state = createGame(99);
      const tc = townCenter(state);
      order(state, villagers(state), tc);
      spawn(state, 'militia', 2, { x: tc.position.x + 4, y: tc.position.y });
      return state;
    };
    const a = build();
    const b = build();
    for (let i = 0; i < 30 * TICKS_PER_SECOND; i++) { stepGame(a); stepGame(b); }
    expect(checksumState(a)).toBe(checksumState(b));
    expect(townCenter(a).garrison?.length).toBe(3);
  });
});
