import { describe, expect, it } from 'vitest';
import { FALLBACK_RULES } from './data';
import { applyCommand, createGame, stepGame } from './game';
import { buildNavGrid, findPath, isBlocked, type NavGrid } from './nav';
import { observe } from './observe';
import type { BuildingKind, Entity, GameState, Point } from './types';

/** An empty arena: the seeded map with every resource node removed. */
function arena(seed = 1): GameState {
  const state = createGame(seed);
  state.entities = state.entities.filter(e => e.kind !== 'resource');
  return state;
}

function unit(state: GameState, position: Point, owner: 1 | 2 = 1, kind: 'villager' | 'militia' = 'militia'): Entity {
  const rules = state.rules.units[kind];
  const entity: Entity = {
    id: state.nextId++, kind, owner, position: { ...position }, hp: rules.hp, maxHp: rules.hp,
    radius: rules.radius, activity: 'idle', order: { kind: 'idle' },
  };
  state.entities.push(entity);
  return entity;
}

function building(
  state: GameState, kind: BuildingKind, position: Point, owner: 1 | 2 = 1,
  footprint?: { x: number; y: number },
): Entity {
  const rules = state.rules.buildings[kind];
  const entity: Entity = {
    id: state.nextId++, kind, owner, position: { ...position }, hp: rules.hp, maxHp: rules.hp,
    radius: rules.radius, activity: 'idle', order: { kind: 'idle' },
    ...(footprint ? { footprint } : {}),
  };
  state.entities.push(entity);
  return entity;
}

/**
 * A palisade across the whole map at x = 15 with a gate in it at y = 14..15.
 * Every tile of the line is filled, so the only way through is the doorway.
 */
function wallWithGate(state: GameState, owner: 1 | 2 = 1): Entity {
  for (let y = 0; y < state.height; y++) {
    if (y === 14 || y === 15) continue;
    building(state, 'palisade-wall', { x: 15.5, y: y + 0.5 }, owner);
  }
  return building(state, 'palisade-gate', { x: 15.5, y: 15 }, owner, { x: 0.5, y: 1 });
}

const run = (state: GameState, ticks: number, invariant?: () => void) => {
  for (let i = 0; i < ticks; i++) {
    stepGame(state);
    invariant?.();
  }
};

/** True when the point lies strictly inside any standing building footprint. */
function insideAnyFootprint(state: GameState, point: Point, epsilon = 0.05): boolean {
  return state.entities.some(e =>
    !e.dead && (e.kind === 'house' || e.kind === 'barracks' || e.kind === 'town-center') &&
    Math.abs(point.x - e.position.x) < e.radius - epsilon &&
    Math.abs(point.y - e.position.y) < e.radius - epsilon,
  );
}

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

describe('navigation compatibility suite', () => {
  it('direct path: walks straight to an open destination', () => {
    const state = arena();
    const mover = unit(state, { x: 12, y: 15 });
    applyCommand(state, { kind: 'order', player: 1, entityIds: [mover.id], target: { x: 20, y: 15 } });
    run(state, 20 * 12);
    expect(distance(mover.position, { x: 20, y: 15 })).toBeLessThan(0.2);
    expect(mover.order.kind).toBe('idle');
  });

  it('blocked destination: stops adjacent to a building it was sent into', () => {
    const state = arena();
    const mover = unit(state, { x: 12, y: 15 });
    const house = building(state, 'house', { x: 16, y: 15 });
    applyCommand(state, { kind: 'order', player: 1, entityIds: [mover.id], target: house.position });
    run(state, 20 * 15, () => expect(insideAnyFootprint(state, mover.position)).toBe(false));
    expect(mover.order.kind).toBe('idle');
    expect(distance(mover.position, house.position)).toBeLessThan(house.radius + 1.2);
  });

  it('building detour: goes around a barracks wall without entering it', () => {
    const state = arena();
    const mover = unit(state, { x: 12, y: 15 });
    building(state, 'barracks', { x: 16, y: 15 });
    building(state, 'barracks', { x: 16, y: 12 });
    applyCommand(state, { kind: 'order', player: 1, entityIds: [mover.id], target: { x: 20, y: 15 } });
    run(state, 20 * 25, () => expect(insideAnyFootprint(state, mover.position)).toBe(false));
    expect(distance(mover.position, { x: 20, y: 15 })).toBeLessThan(0.2);
  });

  it('one-tile gap: threads between two buildings', () => {
    const state = arena();
    // Barracks blocks rows y12..14, the house rows y16..17: one free row at y15.
    building(state, 'barracks', { x: 16, y: 13.5 });
    const south = building(state, 'house', { x: 16, y: 17 });
    const grid = buildNavGrid(state);
    expect(isBlocked(grid, 15, 15)).toBe(false);
    expect(isBlocked(grid, 15, 14)).toBe(true);
    expect(isBlocked(grid, 15, 16)).toBe(true);
    const path = findPath(grid, { x: 12, y: 15.5 }, { x: 20, y: 15.5 })!;
    expect(path).toBeDefined();
    for (const waypoint of path) {
      expect(isBlocked(grid, Math.floor(waypoint.x), Math.floor(waypoint.y))).toBe(false);
    }
    // The path uses the gap row rather than a long detour.
    expect(path.some(w => Math.floor(w.y) === 15 && Math.floor(w.x) >= 14 && Math.floor(w.x) <= 17)).toBe(true);
    expect(south.id).toBeGreaterThan(0);
  });

  it('gate: is a doorway for its owner and a wall for everybody else', () => {
    const state = arena();
    const gate = wallWithGate(state, 1);

    const shared = buildNavGrid(state);
    const mine = buildNavGrid(state, undefined, 1);
    const theirs = buildNavGrid(state, undefined, 2);
    // Both tiles the gate covers, and no more than those.
    for (const y of [14, 15]) {
      expect(isBlocked(shared, 15, y), `shared ${y}`).toBe(true);
      expect(isBlocked(mine, 15, y), `owner ${y}`).toBe(false);
      expect(isBlocked(theirs, 15, y), `enemy ${y}`).toBe(true);
    }
    expect(isBlocked(mine, 15, 13)).toBe(true);
    expect(isBlocked(mine, 15, 16)).toBe(true);
    expect(gate.footprint).toEqual({ x: 0.5, y: 1 });
  });

  it('gate: its owner walks through and the enemy is left outside', () => {
    const state = arena();
    wallWithGate(state, 1);
    const mine = unit(state, { x: 12, y: 15 }, 1);
    const theirs = unit(state, { x: 12, y: 16 }, 2);
    applyCommand(state, { kind: 'order', player: 1, entityIds: [mine.id], target: { x: 20, y: 15 } });
    applyCommand(state, { kind: 'order', player: 2, entityIds: [theirs.id], target: { x: 20, y: 16 } });
    run(state, 20 * 40);
    expect(distance(mine.position, { x: 20, y: 15 })).toBeLessThan(0.6);
    // The wall runs the height of the map, so there is no way round it at all.
    expect(theirs.position.x).toBeLessThan(15);
  });

  it('gate: is not a doorway until it is built', () => {
    // A foundation is a hole nobody may walk through, its owner included:
    // otherwise a wall could be opened for the cost of starting a gate.
    const state = arena();
    const gate = wallWithGate(state, 1);
    gate.buildProgress = 0.5;
    expect(isBlocked(buildNavGrid(state, undefined, 1), 15, 15)).toBe(true);
    const mine = unit(state, { x: 12, y: 15 }, 1);
    applyCommand(state, { kind: 'order', player: 1, entityIds: [mine.id], target: { x: 20, y: 15 } });
    run(state, 20 * 20);
    expect(mine.position.x).toBeLessThan(15);
  });

  it('finds the shortest way it can, and the same one twice', () => {
    // The open list is a heap; a heap that sifts wrongly still returns a path,
    // just not the best one. Octile distance is what an optimal 8-connected
    // search costs on open ground, so measuring the path against it is what
    // catches that — and a second identical run is what the replay depends on.
    const state = arena();
    state.entities = state.entities.filter(e => e.kind !== 'house' && e.kind !== 'barracks');
    const grid = buildNavGrid(state);
    const from = { x: 10.5, y: 10.5 };
    const to = { x: 70.5, y: 40.5 };
    const path = findPath(grid, from, to)!;
    expect(path).toBeDefined();

    const cost = (steps: Point[]) => {
      let total = 0;
      let at = from;
      for (const step of steps) {
        total += Math.abs(step.x - at.x) === 0 || Math.abs(step.y - at.y) === 0 ? 1 : Math.SQRT2;
        at = step;
      }
      return total;
    };
    const dx = Math.abs(to.x - from.x);
    const dy = Math.abs(to.y - from.y);
    const octile = Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
    // Open ground: nothing to walk round, so the walk is the straight cost.
    expect(cost(path)).toBeCloseTo(octile, 6);
    expect(findPath(grid, from, to)).toEqual(path);
  });

  it('crossing groups: two opposing groups pass and settle without stacking', () => {
    const state = arena();
    const left = [0, 1, 2].map(i => unit(state, { x: 10, y: 14 + i * 0.5 }));
    const right = [0, 1, 2].map(i => unit(state, { x: 22, y: 14 + i * 0.5 }));
    applyCommand(state, { kind: 'order', player: 1, entityIds: left.map(u => u.id), target: { x: 22, y: 15 } });
    applyCommand(state, { kind: 'order', player: 1, entityIds: right.map(u => u.id), target: { x: 10, y: 15 } });
    run(state, 20 * 30);
    for (const u of left) expect(distance(u.position, { x: 22, y: 15 })).toBeLessThan(2);
    for (const u of right) expect(distance(u.position, { x: 10, y: 15 })).toBeLessThan(2);
    // Settled units keep personal space.
    const settled = [...left, ...right];
    for (const a of settled) {
      for (const b of settled) {
        if (a.id < b.id) expect(distance(a.position, b.position)).toBeGreaterThan(0.2);
      }
    }
  });

  it('surround: six militia all reach attack range around one house', () => {
    const state = arena();
    const house = building(state, 'house', { x: 16, y: 15 }, 2);
    const attackers = [0, 1, 2, 3, 4, 5].map(i => unit(state, { x: 10 + (i % 3), y: 13 + i * 0.8 }));
    applyCommand(state, { kind: 'order', player: 1, entityIds: attackers.map(u => u.id), target: house.position, targetId: house.id });
    run(state, 20 * 30);
    for (const attacker of attackers) {
      expect(attacker.activity).toBe('attacking');
      expect(distance(attacker.position, house.position)).toBeLessThanOrEqual(house.radius + attacker.radius + 0.36);
    }
  });

  it('dynamic building insertion: repaths around a foundation dropped on the route', () => {
    const state = arena();
    const mover = unit(state, { x: 10, y: 15 }, 1, 'villager');
    const builder = unit(state, { x: 16, y: 14 }, 1, 'villager');
    applyCommand(state, { kind: 'order', player: 1, entityIds: [mover.id], target: { x: 24, y: 15 } });
    run(state, 20 * 2);
    // A friendly foundation appears directly on the path.
    expect(applyCommand(state, { kind: 'build', player: 1, builderIds: [builder.id], building: 'house', target: { x: 16, y: 15.4 } }).ok).toBe(true);
    run(state, 20 * 30, () => expect(insideAnyFootprint(state, mover.position)).toBe(false));
    expect(distance(mover.position, { x: 24, y: 15 })).toBeLessThan(0.2);
  });
});

describe('combat golden values', () => {
  it('militia cannot erase a town center: DAT armor reduces hits to 1', () => {
    const { units, buildings } = FALLBACK_RULES;
    const perHit = Math.max(
      1,
      units.militia.attacks.reduce((sum, attack) => {
        const armor = buildings['town-center'].armors.find(a => a.class === attack.class);
        return armor ? sum + Math.max(0, attack.amount - armor.amount) : sum;
      }, 0),
    );
    expect(perHit).toBe(1);
    // Under two seconds per hit, one militia needs over an hour: not erasable.
    expect(buildings['town-center'].hp / (perHit / units.militia.attackReloadSeconds)).toBeGreaterThan(3600);
  });

  it('kills leave a decaying corpse that is untargetable and unobservable', () => {
    const state = arena();
    const victim = unit(state, { x: 16, y: 15 }, 2, 'villager');
    const killers = [0, 1, 2].map(i => unit(state, { x: 15, y: 14 + i }, 1, 'militia'));
    applyCommand(state, { kind: 'order', player: 1, entityIds: killers.map(u => u.id), target: victim.position, targetId: victim.id });
    run(state, 20 * 30);
    expect(victim.hp).toBeLessThanOrEqual(0);
    expect(victim.dead).toBe(true);
    expect(victim.activity).toBe('dying');
    // Killers moved on: dead targets invalidate orders.
    for (const killer of killers) expect(killer.order.kind).not.toBe('attack');
    // The corpse is not observable and cannot be targeted.
    expect(observe(state, 2).entities.some(e => e.id === victim.id)).toBe(false);
    const retarget = applyCommand(state, { kind: 'order', player: 1, entityIds: [killers[0].id], target: victim.position, targetId: victim.id });
    expect(retarget).toEqual({ ok: false, reason: `target ${victim.id} does not exist` });
    run(state, 61);
    expect(state.entities.includes(victim)).toBe(false);
  });

  it('militia defend themselves: idle units acquire enemies that enter sight', () => {
    const state = arena();
    const defender = unit(state, { x: 16, y: 15 }, 1, 'militia');
    const intruder = unit(state, { x: 16 + state.rules.units.militia.lineOfSight - 1, y: 15 }, 2, 'villager');
    run(state, 20);
    expect(defender.order.kind).toBe('attack');
    expect((defender.order as { targetId: number }).targetId).toBe(intruder.id);
  });
});

describe('unreachable goals', () => {
  it('walks as close as the grid allows instead of refusing to move', () => {
    // A goal sealed off by obstruction used to return no path at all, which
    // callers read as "arrived" — a unit that believes it has arrived
    // somewhere it never left walks on the spot for the rest of the match.
    const grid: NavGrid = { width: 8, height: 8, blocked: new Uint8Array(64) };
    for (let y = 0; y < 8; y++) grid.blocked[y * 8 + 4] = 1; // a wall down the middle
    const path = findPath(grid, { x: 1.5, y: 1.5 }, { x: 6.5, y: 1.5 });
    expect(path).toBeDefined();
    expect(path!.length).toBeGreaterThan(0);
    const last = path![path!.length - 1];
    // Right up against the wall, on our side of it.
    expect(last.x).toBeLessThan(4);
    expect(last.x).toBeGreaterThanOrEqual(3);
  });

  it('still refuses when the walker has nowhere at all to step', () => {
    const grid: NavGrid = { width: 5, height: 5, blocked: new Uint8Array(25) };
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) grid.blocked[y * 5 + x] = x === 2 && y === 2 ? 0 : 1;
    }
    expect(findPath(grid, { x: 2.5, y: 2.5 }, { x: 0.5, y: 0.5 })).toBeUndefined();
  });
});
