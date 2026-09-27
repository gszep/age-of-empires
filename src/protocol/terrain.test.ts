import { describe, expect, it } from 'vitest';
import { createGame } from '../sim/game';
import { observe } from '../sim/observe';
import { decodeObservedTerrain } from './terrain';
import { validateObservation } from './validate';

describe('explored terrain observation', () => {
  it('round-trips only explored terrain and elevation over JSON, without mutating state', () => {
    const state = createGame(91);
    const before = JSON.stringify(state);
    const observation = JSON.parse(JSON.stringify(observe(state, 1)));
    expect(validateObservation(observation)).toBe(true);
    const grid = decodeObservedTerrain(observation)!;
    for (let i = 0; i < grid.tiles.length; i++) {
      expect(grid.tiles[i]).toBe(state.visibility[1].explored[i] ? state.terrain[i] : -1);
      expect(grid.elevation[i]).toBe(state.visibility[1].explored[i] ? state.elevation[i] : -1);
    }
    expect(JSON.stringify(state)).toBe(before);
  });

  it('does not expose a hidden coast or cliff through run boundaries', () => {
    const state = createGame(92);
    const index = state.visibility[1].explored.findIndex(value => !value);
    expect(index).toBeGreaterThanOrEqual(0);
    const before = observe(state, 1);
    state.terrain[index] = 23; state.elevation[index] = 99;
    expect(observe(state, 1)).toEqual(before);
    state.visibility[1].explored[index] = 1;
    const grid = decodeObservedTerrain(observe(state, 1))!;
    expect([grid.tiles[index], grid.elevation[index]]).toEqual([23, 99]);
  });

  it('compresses unknown rows and rejects malformed runs instead of planning from them', () => {
    const state = createGame(93); state.visibility[1].explored.fill(0);
    const observation = observe(state, 1);
    expect(observation.terrain!.every(row => row.length === 1 && row[0][0] === state.width)).toBe(true);
    observation.terrain![0][0][0]++;
    expect(decodeObservedTerrain(observation)).toBeUndefined();
    observation.terrain![0][0][0] = 0;
    expect(validateObservation(observation)).toBe(false);
  });
});
