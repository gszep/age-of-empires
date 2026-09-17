import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FALLBACK_RULES, TICKS_PER_SECOND, rulesFromManifest, type ContentManifest, type GameRules } from './data';
import { applyCommand, createGame, isRepairable, placementLegal, repairRateFor, stepGame } from './game';
import { checksumState } from './checksum';
import type { BuildingKind, Entity, GameState, UnitKind } from './types';

const MANIFEST_PATH = 'public/imported/aoe2/manifest.json';
const importedRules: GameRules | undefined = existsSync(MANIFEST_PATH)
  ? rulesFromManifest(JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as ContentManifest)
  : undefined;

const run = (state: GameState, ticks: number) => {
  for (let i = 0; i < ticks; i++) stepGame(state);
};

function freeSpot(state: GameState, kind: BuildingKind, near: { x: number; y: number }) {
  for (let radius = 2; radius <= 16; radius += 0.5) {
    for (let step = 0; step < 16; step++) {
      const angle = step * Math.PI / 8;
      const spot = { x: near.x + Math.cos(angle) * radius, y: near.y + Math.sin(angle) * radius };
      if (placementLegal(state, kind, spot).ok) return spot;
    }
  }
  throw new Error(`no legal ${kind} placement near ${near.x},${near.y}`);
}

function place(state: GameState, kind: BuildingKind, owner: 1 | 2 = 1): Entity {
  const home = state.entities.find(e => e.owner === owner && e.kind === 'town-center')!;
  const rules = state.rules.buildings[kind];
  const entity: Entity = {
    id: state.nextId++, kind, owner, position: freeSpot(state, kind, home.position),
    hp: rules.hp, maxHp: rules.hp, radius: rules.radius,
    activity: 'idle', order: { kind: 'idle' },
  };
  state.entities.push(entity);
  return entity;
}

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

const villagerOf = (state: GameState) => state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
const order = (state: GameState, unit: Entity, target: Entity) => applyCommand(state, {
  kind: 'order', player: 1, entityIds: [unit.id], target: target.position, targetId: target.id,
});

describe('repair', () => {
  it('reads the repairer from the DAT: 12.5 a second, siege at a quarter, half price', () => {
    // Issue #74. VMREP (156) works at 12.5; its repair tasks name siege
    // (class 13, 51, 54) and ships at 0.25; attributes 270 and 271 are 0.5.
    for (const rules of [FALLBACK_RULES, importedRules].filter(Boolean) as GameRules[]) {
      const repair = rules.units.villager.repair!;
      expect(repair.hitPointsPerSecond).toBe(12.5);
      expect(repair.classFactors['13']).toBe(0.25);
      expect(repair.classFactors['51']).toBe(0.25);
      expect(rules.repairCostFraction).toEqual({ building: 0.5, unit: 0.5 });
      expect(rules.units['battering-ram'].datClass).toBe(13);
      expect(rules.units.trebuchet.datClass).toBe(51);
    }
  });

  it('mends its own damaged house at the DAT rate and pays as it goes', () => {
    const state = createGame(90);
    const villager = villagerOf(state);
    const house = place(state, 'house');
    house.hp = 50;
    const woodBefore = state.players[1].wood;
    expect(order(state, villager, house).ok).toBe(true);
    expect(villager.order).toEqual({ kind: 'repair', targetId: house.id });
    // Walk there, then measure the mending over ten seconds of work.
    run(state, 20 * TICKS_PER_SECOND);
    expect(villager.activity).toBe('repairing');
    const at = house.hp;
    run(state, 10 * TICKS_PER_SECOND);
    expect(house.hp - at).toBe(125);
    expect(Number.isInteger(house.hp)).toBe(true);
    // The price: half the house's cost over its hit points, charged whole.
    const cost = state.rules.buildings.house.cost.wood;
    const restored = house.hp - 50;
    expect(woodBefore - state.players[1].wood).toBe(Math.floor(restored * cost * 0.5 / house.maxHp));
    run(state, 60 * TICKS_PER_SECOND);
    expect(house.hp).toBe(house.maxHp);
    expect(villager.order.kind).toBe('idle');
    expect(woodBefore - state.players[1].wood).toBe(Math.floor((house.maxHp - 50) * cost * 0.5 / house.maxHp));
  });

  it('mends a siege engine at a quarter of the rate, and nothing else of its own', () => {
    const state = createGame(91);
    const villager = villagerOf(state);
    const ram = spawn(state, 'battering-ram', 1, { x: villager.position.x + 1, y: villager.position.y });
    ram.hp = 10;
    expect(isRepairable(state, villager, ram)).toBe(true);
    expect(repairRateFor(state, villager, ram)).toBeCloseTo(3.125, 6);
    order(state, villager, ram);
    expect(villager.order.kind).toBe('repair');
    run(state, 5 * TICKS_PER_SECOND);
    expect(villager.activity).toBe('repairing');
    const at = ram.hp;
    run(state, 16 * TICKS_PER_SECOND);
    expect(ram.hp - at).toBe(50);

    // A wounded soldier is a monk's work: the villager just walks over.
    const soldier = spawn(state, 'militia', 1, { x: villager.position.x + 2, y: villager.position.y });
    soldier.hp = 1;
    expect(isRepairable(state, villager, soldier)).toBe(false);
    order(state, villager, soldier);
    expect(villager.order.kind).toBe('move');
  });

  it('will not mend a foundation, an enemy, or a whole building', () => {
    const state = createGame(92);
    const villager = villagerOf(state);
    const whole = place(state, 'house');
    expect(isRepairable(state, villager, whole)).toBe(false);
    order(state, villager, whole);
    expect(villager.order.kind).toBe('move');
    const site = place(state, 'house');
    site.buildProgress = 0.2;
    site.hp = 20;
    order(state, villager, site);
    expect(villager.order.kind).toBe('build');
    const theirs = place(state, 'house', 2);
    theirs.hp = 20;
    order(state, villager, theirs);
    expect(villager.order.kind).toBe('attack');
  });

  it('stops where the money runs out', () => {
    const state = createGame(93);
    const villager = villagerOf(state);
    const house = place(state, 'house');
    house.hp = 1;
    state.players[1].wood = 0;
    order(state, villager, house);
    run(state, 30 * TICKS_PER_SECOND);
    // The first whole unit of wood fell due within a few hit points and
    // could not be paid, so the work stopped there.
    expect(house.hp).toBeLessThan(house.maxHp / 4);
    expect(villager.order.kind).toBe('idle');
    expect(state.players[1].wood).toBe(0);
  });

  it('replays identically through a repair', () => {
    const build = () => {
      const state = createGame(94);
      const villager = villagerOf(state);
      const house = place(state, 'house');
      house.hp = 100;
      order(state, villager, house);
      return state;
    };
    const a = build();
    const b = build();
    for (let i = 0; i < 40 * TICKS_PER_SECOND; i++) { stepGame(a); stepGame(b); }
    expect(checksumState(a)).toBe(checksumState(b));
    expect(a.entities.find(e => e.kind === 'house')!.hp).toBe(a.rules.buildings.house.hp);
  });
});
