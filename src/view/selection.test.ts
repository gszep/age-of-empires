import { describe, expect, it } from 'vitest';
import { createGame } from '../sim/game';
import type { Entity, GameState, Point } from '../sim/types';
import { contextTargets, pickTarget, sameKindOnScreen } from './selection';

/** A camera that can see a square of the map, so "on screen" is decidable. */
const window = (half: number, at: Point) => (point: Point) =>
  Math.abs(point.x - at.x) <= half && Math.abs(point.y - at.y) <= half;

const put = (state: GameState, kind: Entity['kind'], owner: Entity['owner'], at: Point): Entity => {
  const entity: Entity = {
    id: state.nextId++, kind, owner, position: { ...at },
    hp: 10, maxHp: 10, radius: 0.2, activity: 'idle', order: { kind: 'idle' },
  };
  state.entities.push(entity);
  return entity;
};

describe('clicking units on farms (#289)', () => {
  const fixture = () => {
    const state = createGame(289);
    state.entities = [];
    const farm = put(state, 'farm', 1, { x: 30.5, y: 30.5 });
    farm.radius = state.rules.buildings.farm.radius;
    const villager = put(state, 'villager', 1, farm.position);
    return { state, farm, villager };
  };
  it.each([false, true])('selects the unit over a farm but keeps context orders on the crop (reverse entity order: %s)', reverse => {
    const { state, farm, villager } = fixture();
    if (reverse) state.entities.reverse();
    const targets = () => contextTargets(state, 1);
    expect(pickTarget(targets(), villager.position, 'selection')?.id).toBe(villager.id);
    expect(pickTarget(targets(), villager.position, 'context')?.id).toBe(farm.id);
    // The exposed corner of the same field is still selectable.
    expect(pickTarget(targets(), { x: 31.7, y: 31.7 }, 'selection')?.id).toBe(farm.id);
    expect(pickTarget(targets(), { x: 40, y: 40 }, 'selection')).toBeUndefined();
  });

  it('uses interpolated positions, chooses the nearest overlapping unit, and covers foundations', () => {
    const { state, farm, villager } = fixture();
    farm.buildProgress = .5;
    const other = put(state, 'villager', 1, { x: 31, y: 30.5 });
    const drawn = { x: 30.6, y: 30.5 };
    villager.position = { x: 40, y: 40 };
    const position = (entity: { id: number; position: Point }) => entity.id === villager.id ? drawn : entity.position;
    expect(pickTarget(contextTargets(state, 1), farm.position, 'selection', position)?.id).toBe(villager.id);
    expect(pickTarget(contextTargets(state, 1), other.position, 'selection', position)?.id).toBe(other.id);
  });

  it('respects visibility and allows inspection of visible enemy units over farms', () => {
    const { state, farm, villager } = fixture();
    villager.owner = 2;
    state.visibility[1].visible.fill(0);
    expect(pickTarget(contextTargets(state, 1), farm.position, 'selection')?.id).toBe(farm.id);
    state.visibility[1].visible[30 * state.width + 30] = 1;
    expect(pickTarget(contextTargets(state, 1), farm.position, 'selection')?.id).toBe(villager.id);
    villager.dead = true;
    expect(pickTarget(contextTargets(state, 1), farm.position, 'selection')?.id).toBe(farm.id);
  });

  it('leaves carcasses accessible beneath workers and does not prefer units over ordinary buildings', () => {
    const { state, farm, villager } = fixture();
    farm.kind = 'sheep'; farm.owner = 0; farm.radius = .4;
    farm.dead = true; farm.amount = 50; farm.resourceKind = 'food';
    expect(pickTarget(contextTargets(state, 1, true), farm.position, 'selection')?.id).toBe(farm.id);
    expect(pickTarget(contextTargets(state, 1, true), farm.position, 'context')?.id).toBe(farm.id);
    farm.amount = 0;
    expect(pickTarget(contextTargets(state, 1, true), farm.position, 'selection')?.id).toBe(villager.id);
    farm.kind = 'town-center'; farm.dead = false; farm.radius = 2;
    expect(pickTarget(contextTargets(state, 1, true), farm.position, 'selection')?.id).toBe(farm.id);
  });

  it('uses the saved position for remembered resources rather than a hidden live interpolation', () => {
    const { farm } = fixture();
    farm.kind = 'resource'; farm.owner = 0;
    expect(pickTarget([{ entity: farm, remembered: true }], farm.position, 'selection',
      () => ({ x: 100, y: 100 }))?.id).toBe(farm.id);
  });
});

describe('what a double-click takes', () => {
  it('takes every one of that kind that can be seen, and none that cannot', () => {
    const state = createGame(150);
    state.entities = [];
    const here = put(state, 'militia', 1, { x: 50, y: 50 });
    put(state, 'militia', 1, { x: 52, y: 51 });
    const far = put(state, 'militia', 1, { x: 90, y: 90 });
    const other = put(state, 'archer', 1, { x: 51, y: 50 });
    const taken = sameKindOnScreen(state.entities, here, 1, window(10, { x: 50, y: 50 }));
    expect(taken).toHaveLength(2);
    expect(taken.map(e => e.id)).toContain(here.id);
    expect(taken.map(e => e.id)).not.toContain(far.id);
    expect(taken.map(e => e.id)).not.toContain(other.id);
  });

  it('leaves the dead out of it', () => {
    const state = createGame(151);
    state.entities = [];
    const here = put(state, 'militia', 1, { x: 50, y: 50 });
    const fallen = put(state, 'militia', 1, { x: 51, y: 50 });
    fallen.dead = true;
    expect(sameKindOnScreen(state.entities, here, 1, window(10, { x: 50, y: 50 })))
      .toEqual([here]);
  });

  it('does not group somebody else\'s units, or a building, or a tree', () => {
    const state = createGame(152);
    state.entities = [];
    const theirs = put(state, 'militia', 2, { x: 50, y: 50 });
    put(state, 'militia', 2, { x: 51, y: 50 });
    expect(sameKindOnScreen(state.entities, theirs, 1, window(10, { x: 50, y: 50 })))
      .toEqual([theirs]);

    const house = put(state, 'house', 1, { x: 60, y: 60 });
    put(state, 'house', 1, { x: 62, y: 60 });
    expect(sameKindOnScreen(state.entities, house, 1, window(10, { x: 60, y: 60 })))
      .toEqual([house]);

    const tree = put(state, 'resource', 0, { x: 70, y: 70 });
    expect(sameKindOnScreen(state.entities, tree, 1, window(10, { x: 70, y: 70 })))
      .toEqual([tree]);
  });

  it('always includes the one that was clicked', () => {
    // The camera can move between the click and the answer; the unit under the
    // pointer is in the selection whatever the window says.
    const state = createGame(153);
    state.entities = [];
    const here = put(state, 'militia', 1, { x: 50, y: 50 });
    put(state, 'militia', 1, { x: 51, y: 50 });
    const taken = sameKindOnScreen(state.entities, here, 1, window(10, { x: 200, y: 200 }));
    expect(taken.map(e => e.id)).toContain(here.id);
  });
});
