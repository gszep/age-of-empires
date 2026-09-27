import { describe, expect, it } from 'vitest';
import { createGame } from '../sim/game';
import { ConstructionCues } from './construction-cues';

describe('construction completion audio', () => {
  it('observes owned completion once, without replaying existing buildings or deaths', () => {
    const state = createGame(57);
    const watcher = new ConstructionCues();
    const own = state.entities.find(e => e.kind === 'town-center' && e.owner === 1)!;
    const enemy = state.entities.find(e => e.kind === 'town-center' && e.owner === 2)!;
    expect(watcher.poll(state, 1)).toEqual([]);
    own.buildProgress = 0.99;
    enemy.buildProgress = 0.99;
    expect(watcher.poll(state, 1)).toEqual([]);
    delete own.buildProgress;
    delete enemy.buildProgress;
    const before = JSON.stringify(state);
    expect(watcher.poll(state, 1)).toEqual([own.id]);
    expect(JSON.stringify(state)).toBe(before);
    expect(watcher.poll(state, 1)).toEqual([]);
    own.buildProgress = 0.5;
    watcher.poll(state, 1);
    own.dead = true;
    delete own.buildProgress;
    expect(watcher.poll(state, 1)).toEqual([]);
  });

  it('a fresh watcher makes a reconnect/restart a silent baseline', () => {
    const state = createGame(58);
    expect(new ConstructionCues().poll(state, 1)).toEqual([]);
  });
});
