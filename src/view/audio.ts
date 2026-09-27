import type { AudioAssets } from './assets';
import { seedFrom } from '../sim/random';

export type AudioChannel = 'ui' | 'voice' | 'world' | 'ambient';

/** Bounded browser playback, independent of simulation and its random stream.
 * Only the referenced file is loaded. There is no eager audio-depot decode.
 */
export class AudioPlayer {
  private sequence = new Map<string, number>();
  private active = new Map<HTMLAudioElement, AudioChannel>();
  private unlocked = false;
  private volume = 1;
  private baseVolumes = new WeakMap<HTMLAudioElement, number>();
  private pending = new Map<HTMLAudioElement, ReturnType<typeof setTimeout>>();
  private fades = new Map<HTMLAudioElement, { start: number; seconds: number }>();
  private fadeFrame?: number;
  private ambientAlias?: string;
  private ambientDue = 0;

  constructor(private assets: () => AudioAssets | undefined, private seed: () => number = () => 0) {}

  unlock(): void { this.unlocked = true; }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    for (const element of this.active.keys()) this.gain(element);
  }

  play(alias: string, channel: AudioChannel = 'ui', volume = 1): void {
    const assets = this.assets();
    const cue = assets?.audio[alias];
    const files = cue?.files;
    if (!this.unlocked || !files?.length || document.hidden || this.volume === 0) return;
    if (channel === 'voice') this.stop('voice');
    const sequence = this.sequence.get(alias) ?? 0;
    this.sequence.set(alias, sequence + 1);
    const layers = cue?.layers ?? [{ actionId: 0, fileIndices: files.map((_, index) => index),
      delaySeconds: 0, delayRange: [0, 0], fadeSeconds: 0, fadeRange: [0, 0], probability: 100, probabilityRange: [0, 0], curve: 4 }];
    for (const layer of layers) {
      // A cosmetic stream derived from the match seed, never the sim RNG.
      const draw = (salt: number) => seedFrom(this.seed() ^ layer.actionId ^ Math.imul(sequence + 1, 0x9e3779b9) ^ salt) / 0x1_0000_0000;
      const ranged = (base: number, range: number[], salt: number) => base + range[0] + (range[1] - range[0]) * draw(salt);
      const probability = Math.max(0, Math.min(100, ranged(layer.probability, layer.probabilityRange, 1)));
      if (!layer.fileIndices.length || draw(2) * 100 >= probability) continue;
      if (this.active.size >= 24) {
        if (channel === 'world' || channel === 'ambient') continue;
        const oldest = [...this.active].find(([, kind]) => kind === 'world');
        if (oldest) this.release(oldest[0]);
        else continue;
      }
      const source = files[layer.fileIndices[sequence % layer.fileIndices.length]];
      if (!source) continue;
      const delay = Math.max(0, ranged(layer.delaySeconds, layer.delayRange, 3));
      const fade = Math.max(0, ranged(layer.fadeSeconds, layer.fadeRange, 4));
      const element = new Audio(`${assets!.base}${source.file}`);
      this.baseVolumes.set(element, Math.max(0, Math.min(1, volume)));
      if (fade > 0) this.fades.set(element, { start: Infinity, seconds: fade });
      element.volume = fade > 0 ? 0 : (this.baseVolumes.get(element) ?? 1) * this.volume;
      this.active.set(element, channel); // delayed layers reserve capacity too
      element.onended = element.onerror = () => this.release(element);
      const start = () => {
        this.pending.delete(element);
        if (!this.active.has(element)) return;
        if (document.hidden || this.volume === 0) { this.release(element); return; }
        void element.play().then(() => {
          if (fade <= 0 || !this.active.has(element)) return;
          this.fades.set(element, { start: performance.now(), seconds: fade });
          this.gain(element);
          this.fadeFrame ??= requestAnimationFrame(() => this.advanceFades());
        }).catch(() => this.release(element));
      };
      if (delay > 0) this.pending.set(element, setTimeout(start, delay * 1000));
      else start();
    }
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
    const pending = this.pending.get(element);
    if (pending !== undefined) { clearTimeout(pending); this.pending.delete(element); }
    this.fades.delete(element);
    element.onended = element.onerror = null;
    element.pause();
    element.removeAttribute('src');
    element.load();
    this.active.delete(element);
    if (!this.fades.size && this.fadeFrame !== undefined) { cancelAnimationFrame(this.fadeFrame); this.fadeFrame = undefined; }
  }

  private gain(element: HTMLAudioElement): void {
    const fade = this.fades.get(element);
    const fraction = fade ? Math.max(0, Math.min(1, (performance.now() - fade.start) / (fade.seconds * 1000))) : 1;
    element.volume = (this.baseVolumes.get(element) ?? 1) * this.volume * fraction;
  }

  private advanceFades(): void {
    this.fadeFrame = undefined;
    for (const [element, fade] of this.fades) {
      this.gain(element);
      if (performance.now() - fade.start >= fade.seconds * 1000) this.fades.delete(element);
    }
    if (this.fades.size) this.fadeFrame = requestAnimationFrame(() => this.advanceFades());
  }
}
