import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FALLBACK_RULES, rulesFromManifest, type GameRules } from './data';
import { applyCommand, canGarrison, createGame, stepGame } from './game';
import { garrisonCount } from './garrison';
import { observe } from './observe';
import { synchronizationHash } from '../shared/checksum';
import type { Entity, GameState, UnitKind } from './types';

const modes: [string, GameRules][] = [['fallback', FALLBACK_RULES]];
if (existsSync('public/imported/aoe2/manifest.json')) modes.push(['owned', rulesFromManifest(JSON.parse(readFileSync('public/imported/aoe2/manifest.json', 'utf8')))]);

function fixture(rules: GameRules) {
  const state = createGame(251, rules);
  state.entities = state.entities.filter(e => e.kind === 'town-center');
  state.terrain.fill(0); state.elevation.fill(0);
  for (let y = 18; y <= 23; y++) for (let x = 25; x <= 30; x++) state.terrain[y * state.width + x] = 1;
  const make = (kind: UnitKind, x = 24.5, y = 20.5): Entity => {
    const r = rules.units[kind];
    return { id: state.nextId++, kind, owner: 1, position: { x, y }, hp: r.hp, maxHp: r.hp,
      radius: r.radius, order: { kind: 'idle' }, activity: 'idle' };
  };
  const ship = make('transport-ship', 25.5), ram = make('battering-ram');
  const capacity = rules.units['transport-ship'].transportCapacity!;
  ram.garrison = Array.from({ length: rules.units['battering-ram'].infantryCapacity! }, () => make('militia'));
  ram.garrison[0].hp -= 7;
  ram.garrison[0].orderQueue = [{ target: { x: 10, y: 10 } }];
  state.entities.push(ship, ram);
  const fill = (n: number) => { ship.garrison = Array.from({ length: n }, () => make('militia')); };
  return { state, ship, ram, capacity, make, fill };
}
function board(state: GameState, ship: Entity, unit: Entity) {
  return applyCommand(state, { kind: 'order', player: 1, entityIds: [unit.id], target: ship.position, targetId: ship.id });
}
function advance(state: GameState, ticks = 10) { for (let i = 0; i < ticks; i++) stepGame(state); }
function ids(entities: Entity[]): number[] { return entities.flatMap(e => [e.id, ...ids(e.garrison ?? [])]); }

describe.each(modes)('%s nested transport capacity (#251)', (_mode, rules) => {
  it('does not board a loaded ram into one remaining slot or lose its payload', () => {
    const { state, ship, ram, capacity, fill } = fixture(rules);
    fill(capacity - 1);
    const payload = JSON.stringify(ram.garrison), originalIds = ids(state.entities).sort((a, b) => a - b);
    expect(canGarrison(state, ram, ship)).toBe(false);
    expect(board(state, ship, ram).ok).toBe(true); // ordinary move fallback, not a boarding order
    expect(ram.order.kind).not.toBe('garrison');
    advance(state);
    expect(state.entities).toContain(ram);
    expect(garrisonCount(ship)).toBe(capacity - 1);
    expect(JSON.stringify(ram.garrison)).toBe(payload);
    expect(ids(state.entities).sort((a, b) => a - b)).toEqual(originalIds);
  });

  it('accepts exact capacity and reports nested occupancy only to the owner', () => {
    const { state, ship, ram, capacity, make, fill } = fixture(rules);
    const required = 1 + garrisonCount(ram);
    fill(capacity - required);
    const payload = JSON.stringify(ram.garrison);
    expect(canGarrison(state, ram, ship)).toBe(true);
    expect(board(state, ship, ram).ok).toBe(true);
    advance(state);
    expect(state.entities).not.toContain(ram);
    expect(garrisonCount(ship)).toBe(capacity);
    expect(JSON.stringify(ram.garrison)).toBe(payload);
    const extra = make('villager'); state.entities.push(extra);
    expect(canGarrison(state, extra, ship)).toBe(false); // existing nested cargo counts too
    expect(observe(state, 1).entities.find(e => e.id === ship.id)?.garrisoned).toBe(capacity);
    state.visibility[2].visible.fill(1);
    const enemyView = observe(state, 2).entities.find(e => e.id === ship.id)!;
    expect(enemyView.hasGarrison).toBe(true);
    expect(enemyView).not.toHaveProperty('garrisoned');
    expect(new Set(ids(state.entities)).size).toBe(ids(state.entities).length);
  });

  it('rechecks capacity when two loaded rams arrive during the same update', () => {
    const { state, ship, ram, capacity, make, fill } = fixture(rules);
    const cost = 1 + garrisonCount(ram);
    fill(capacity - cost);
    const other = make('battering-ram', 24.5, 20.8);
    other.garrison = Array.from({ length: ram.garrison!.length }, () => make('militia'));
    state.entities.push(other);
    expect(board(state, ship, ram).ok).toBe(true);
    expect(board(state, ship, other).ok).toBe(true);
    expect(other.order.kind).toBe('garrison');
    advance(state);
    expect(garrisonCount(ship)).toBe(capacity);
    expect([ram, other].filter(r => state.entities.includes(r))).toHaveLength(1);
    expect(new Set(ids(state.entities)).size).toBe(ids(state.entities).length);
  });

  it('keeps legacy over-capacity cargo intact while refusing further boarding', () => {
    const { state, ship, ram, capacity, make, fill } = fixture(rules);
    fill(capacity - 1);
    ship.garrison!.push(ram); state.entities = state.entities.filter(e => e.id !== ram.id);
    const before = ids(state.entities).sort((a, b) => a - b);
    advance(state);
    expect(garrisonCount(ship)).toBe(capacity + ram.garrison!.length);
    expect(ids(state.entities).sort((a, b) => a - b)).toEqual(before);
    expect(canGarrison(state, make('villager'), ship)).toBe(false);
  });

  it('uses a converted carrier’s stored capacity rather than its new owner’s base capacity', () => {
    const { state, ship, ram, make } = fixture(rules);
    ship.convertedRules = { ...rules.units['transport-ship'], transportCapacity: 1 + garrisonCount(ram) };
    expect(board(state, ship, ram).ok).toBe(true);
    advance(state);
    expect(garrisonCount(ship)).toBe(ship.convertedRules.transportCapacity);
    expect(canGarrison(state, make('villager'), ship)).toBe(false);
  });

  it('unloads a whole loaded ram and its payload identically after JSON continuation', () => {
    const { state, ship, ram } = fixture(rules);
    const payload = JSON.stringify(ram.garrison);
    board(state, ship, ram); advance(state);
    expect(ship.garrison).toContain(ram);
    const clone = JSON.parse(JSON.stringify(state)) as GameState;
    for (const s of [state, clone]) {
      expect(applyCommand(s, { kind: 'ungarrison', player: 1, buildingId: ship.id }).ok).toBe(true);
      advance(s);
      const landed = s.entities.find(e => e.id === ram.id)!;
      expect(landed).toBeDefined();
      expect(JSON.stringify(landed.garrison)).toBe(payload);
      expect(garrisonCount(s.entities.find(e => e.id === ship.id)!)).toBe(0);
    }
    expect(synchronizationHash(state)).toBe(synchronizationHash(clone));
  });

  it('loses all nested passengers on sinking, without spawning them on shore', () => {
    const { state, ship, ram } = fixture(rules);
    const passengers = ids([ram]);
    board(state, ship, ram); advance(state);
    expect(ship.garrison).toContain(ram);
    expect(applyCommand(state, { kind: 'delete', player: 1, entityIds: [ship.id] }).ok).toBe(true);
    expect(garrisonCount(ship)).toBe(0);
    expect(ids(state.entities).some(id => passengers.includes(id))).toBe(false);
  });
});
