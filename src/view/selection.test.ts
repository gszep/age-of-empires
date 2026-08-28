import { describe, expect, it } from 'vitest';
import { createGame } from '../sim/game';
import type { Entity, GameState, Point } from '../sim/types';
import { sameKindOnScreen } from './selection';

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
