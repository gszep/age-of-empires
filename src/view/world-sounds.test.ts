import { describe, expect, it } from 'vitest';
import { WorldSounds, type SoundPose } from './world-sounds';

const pose = (frame: number, key = 'militia/attack/1', direction = 0): SoundPose => ({
  key, frame, direction,
  animation: { frames: 30, frameSeconds: 0.05, directions: 16, mirroringMode: 0,
    soundEvents: [{ frame: 12, direction: 0, event: 42 }, { frame: 12, direction: 1, event: 43 }] },
});
const poll = (watcher: WorldSounds, frame: number, key?: string, direction?: number) =>
  watcher.poll(new Map([[7, pose(frame, key, direction)]]));

describe('world sound frame crossings', () => {
  it('plays the owned marker once across skipped frames and stays quiet while paused', () => {
    const watcher = new WorldSounds();
    expect(poll(watcher, 0)).toEqual([]);
    expect(poll(watcher, 11)).toEqual([]);
    expect(poll(watcher, 14)).toEqual([{ id: 7, event: 42 }]);
    expect(poll(watcher, 14)).toEqual([]);
    expect(poll(watcher, 29)).toEqual([]);
    expect(poll(watcher, 0, 'militia/attack/2')).toEqual([]);
    expect(poll(watcher, 12, 'militia/attack/2')).toEqual([{ id: 7, event: 42 }]);
  });

  it('selects the actual direction without treating turning as another swing', () => {
    const watcher = new WorldSounds();
    poll(watcher, 11);
    expect(poll(watcher, 12, undefined, 1)).toEqual([{ id: 7, event: 43 }]);
    expect(poll(watcher, 12, undefined, 0)).toEqual([]);
  });

  it('does not replay sounds on reveal/reconnect and bounds a long missed interval', () => {
    const watcher = new WorldSounds();
    expect(poll(watcher, 14)).toEqual([]);
    watcher.poll(new Map());
    expect(poll(watcher, 44)).toEqual([]);
    expect(poll(watcher, 3014)).toEqual([{ id: 7, event: 42 }]);
  });

  it('plays a frame-zero death only on an observed live-to-dead transition', () => {
    const watcher = new WorldSounds();
    poll(watcher, 29);
    const death = pose(0, 'militia/death');
    death.animation.soundEvents = [{ frame: 0, event: 91 }];
    const records = new Map([[7, death]]);
    expect(watcher.poll(records)).toEqual([{ id: 7, event: 91 }]);
    expect(watcher.poll(records)).toEqual([]);
    expect(new WorldSounds().poll(records)).toEqual([]);
  });
});
