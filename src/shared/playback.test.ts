import { describe, expect, it } from 'vitest';
import { TickPlayback, PLAYBACK_DELAY_MS } from './playback';
import type { HostMessage } from './protocol';

const tick = (number: number, speed = 0): Extract<HostMessage, { type: 'tick' }> => ({
  type: 'tick', tick: number, commands: [], settings: { speed, paused: false, generation: 0 },
});

describe('bounded network playback', () => {
  it('paces a packet burst and interpolates between simulation ticks', () => {
    const playback = new TickPlayback();
    const applied: number[] = [];
    for (let i = 1; i <= 4; i++) playback.enqueue(tick(i), 0);
    let now = 0;
    const drain = () => playback.drain(() => now, message => { if (message.type === 'tick') applied.push(message.tick); });
    expect(drain()).toBe(PLAYBACK_DELAY_MS);
    expect(applied).toEqual([]);
    now = 100; drain();
    expect(applied).toEqual([1]);
    expect(playback.alpha(125)).toBe(0.5);
    now = 150; drain();
    expect(applied).toEqual([1, 2]);
    now = 250; drain();
    expect(applied).toEqual([1, 2, 3, 4]);
    expect(playback.pendingTicks).toBe(0);
  });

  it('uses the same wall-clock jitter buffer at fast-forward and yields during expensive catch-up', () => {
    const playback = new TickPlayback();
    for (let i = 1; i <= 100; i++) playback.enqueue(tick(i, 5), 0);
    let now = 99;
    let count = 0;
    expect(playback.drain(() => now, () => count++)).toBe(1);
    now = 1000;
    playback.drain(() => now, () => { count++; now += 3; });
    expect(count).toBe(2); // yield after crossing the 4 ms budget, not all 100 ticks
    expect(playback.pendingTicks).toBe(98);
  });

  it('drains pre-pause ticks in order and starts a fresh buffer after a long pause', () => {
    const playback = new TickPlayback();
    const applied: string[] = [];
    playback.enqueue(tick(1), 0);
    playback.enqueue({ type: 'settings', settings: { speed: 0, paused: true, generation: 0 } }, 10);
    const consume = (message: { type: string }) => applied.push(message.type);
    playback.drain(() => 99, consume);
    expect(applied).toEqual([]);
    playback.drain(() => 100, consume);
    expect(applied).toEqual(['tick', 'settings']);
    expect(playback.alpha(100)).toBe(1);
    playback.enqueue(tick(2), 10_000);
    expect(playback.drain(() => 10_000, consume)).toBe(100);
    playback.drain(() => 10_100, consume);
    expect(applied).toEqual(['tick', 'settings', 'tick']);
  });

  it('can abandon a failed stream during delivery without executing queued stale commands', () => {
    const playback = new TickPlayback();
    playback.enqueue(tick(1), 0); playback.enqueue(tick(2), 0);
    let applied = 0;
    playback.drain(() => 1000, () => { applied++; playback.clear(); });
    expect(applied).toBe(1);
    expect(playback.pendingTicks).toBe(0);
  });
});
