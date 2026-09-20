import { TICK_SECONDS } from '../sim/data';
import { SHARED_SPEEDS, type HostMessage } from './protocol';

type PlaybackMessage = Extract<HostMessage, { type: 'tick' | 'settings' }>;
/** Wall-clock jitter allowance, independent of game speed. Engineering policy,
 * not a gameplay rule. Timers drain bounded batches and yield to rendering. */
export const PLAYBACK_DELAY_MS = 100;
export const PLAYBACK_BUDGET_MS = 4;

export class TickPlayback {
  private queue: { message: PlaybackMessage; arrived: number }[] = [];
  private head = 0;
  private due?: number;
  private previousDue?: number;
  private interval = TICK_SECONDS * 1000;
  pendingTicks = 0;

  enqueue(message: PlaybackMessage, arrived: number): void {
    this.queue.push({ message, arrived });
    if (message.type === 'tick') this.pendingTicks++;
  }

  clear(): void {
    this.queue = []; this.head = 0; this.pendingTicks = 0;
    this.due = undefined; this.previousDue = undefined;
  }

  /** Returns the delay until the next batch, or undefined when nothing remains. */
  drain(clock: () => number, consume: (message: PlaybackMessage) => void): number | undefined {
    const started = clock();
    let count = 0;
    while (this.head < this.queue.length) {
      if (count && (clock() - started >= PLAYBACK_BUDGET_MS || count >= 32)) break;
      const entry = this.queue[this.head];
      if (entry.message.type === 'tick') {
        this.due ??= entry.arrived + PLAYBACK_DELAY_MS;
        if (clock() < this.due) break;
        this.previousDue = this.due;
        this.interval = TICK_SECONDS * 1000 / SHARED_SPEEDS[entry.message.settings.speed];
        this.due += this.interval;
        this.pendingTicks--;
      } else if (entry.message.settings.paused) {
        // Pause arrives after the last tick. Resume gets a fresh wall-clock anchor.
        this.due = undefined; this.previousDue = undefined;
      }
      this.head++;
      count++;
      consume(entry.message);
    }
    if (this.head === this.queue.length) { this.queue = []; this.head = 0; return; }
    if (this.head > 256) { this.queue.splice(0, this.head); this.head = 0; }
    return this.queue[this.head].message.type === 'tick'
      ? Math.max(0, (this.due ?? clock()) - clock()) : 0;
  }

  alpha(now: number): number {
    return this.previousDue === undefined ? 1 : Math.max(0, Math.min(1, (now - this.previousDue) / this.interval));
  }
}
