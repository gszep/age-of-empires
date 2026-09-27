import type { AudioAssets } from './assets';

export type AudioChannel = 'ui' | 'voice' | 'world' | 'ambient';

/** Bounded browser playback, independent of simulation and its random stream.
 * Only the referenced file is loaded. There is no eager audio-depot decode.
 */
export class AudioPlayer {
  private sequence = new Map<string, number>();
  private active = new Map<HTMLAudioElement, AudioChannel>();
  private unlocked = false;
  private ambientAlias?: string;
  private ambientDue = 0;

  constructor(private assets: () => AudioAssets | undefined) {}

  unlock(): void { this.unlocked = true; }

  play(alias: string, channel: AudioChannel = 'ui', volume = 1): void {
    const assets = this.assets();
    const files = assets?.audio[alias]?.files;
    if (!this.unlocked || !files?.length || document.hidden) return;
    if (channel === 'voice') this.stop('voice');
    if (this.active.size >= 24) {
      if (channel === 'world' || channel === 'ambient') return;
      const oldest = [...this.active].find(([, kind]) => kind === 'world');
      if (oldest) this.release(oldest[0]);
      else return;
    }
    const sequence = this.sequence.get(alias) ?? 0;
    this.sequence.set(alias, sequence + 1);
    const source = files[sequence % files.length];
    const element = new Audio(`${assets!.base}${source.file}`);
    element.volume = Math.max(0, Math.min(1, volume));
    this.active.set(element, channel);
    element.onended = element.onerror = () => this.release(element);
    void element.play().catch(() => this.release(element));
  }

  ambient(alias: string | undefined, now: number): void {
    if (alias !== this.ambientAlias) {
      this.stop('ambient');
      this.ambientAlias = alias;
      this.ambientDue = now;
    }
    if (!alias || now < this.ambientDue || [...this.active.values()].includes('ambient')) return;
    this.play(alias, 'ambient', 0.18);
    this.ambientDue = now + 2;
  }

  stop(channel?: AudioChannel): void {
    for (const [element, kind] of this.active) {
      if (channel === undefined || channel === kind) this.release(element);
    }
  }

  reset(): void {
    this.stop();
    this.sequence.clear();
    this.ambientAlias = undefined;
    this.ambientDue = 0;
  }

  private release(element: HTMLAudioElement): void {
    element.onended = element.onerror = null;
    element.pause();
    element.removeAttribute('src');
    element.load();
    this.active.delete(element);
  }
}
