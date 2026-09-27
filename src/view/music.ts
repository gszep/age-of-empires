import type { AudioAssets } from './assets';

/** One streaming browser element at a time. Pausing/hidden tabs preserve the
 * playhead; a new match releases it and starts the owned numbered playlist.
 */
export class MusicPlayer {
  private element?: HTMLAudioElement;
  private index = 0;
  private enabled = false;
  private unlocked = false;
  private requested = false;
  private blocked = false;
  private failed = new Set<string>();
  private playlistKey = '';
  private volume = 0.35;

  constructor(private assets: () => AudioAssets | undefined) {}

  unlock(): void {
    this.unlocked = true;
    this.blocked = false;
    this.reconcile();
  }

  update(enabled: boolean): void {
    const key = this.assets()?.music?.playlist.join('|') ?? '';
    if (key !== this.playlistKey) { this.reset(); this.playlistKey = key; }
    this.enabled = enabled;
    this.reconcile();
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.element) this.element.volume = this.volume;
  }

  reset(): void {
    this.release();
    this.index = 0;
    this.failed.clear();
    this.blocked = false;
  }

  private reconcile(): void {
    if (!this.enabled || !this.unlocked || this.blocked || document.hidden) {
      if (this.requested) this.element?.pause();
      this.requested = false;
      return;
    }
    const assets = this.assets();
    const playlist = assets?.music?.playlist;
    if (!playlist?.length) return;
    if (!this.element) {
      let remaining = playlist.length;
      while (remaining-- > 0 && (this.failed.has(playlist[this.index]) || !assets?.audio[playlist[this.index]]?.files.length)) {
        this.failed.add(playlist[this.index]);
        this.index = (this.index + 1) % playlist.length;
      }
      const alias = playlist[this.index];
      const source = assets?.audio[alias]?.files[0];
      if (!source || this.failed.has(alias)) return;
      const element = new Audio(`${assets!.base}${source.file}`);
      element.preload = 'metadata';
      element.volume = this.volume;
      this.element = element;
      const next = (failed: boolean) => {
        if (this.element !== element) return;
        if (failed) this.failed.add(alias);
        this.release();
        this.index = (this.index + 1) % playlist.length;
        this.reconcile();
      };
      element.onended = () => next(false);
      element.onerror = () => next(true);
    }
    if (this.requested) return;
    this.requested = true;
    const element = this.element;
    void element.play().catch(error => {
      if (this.element !== element || error?.name === 'AbortError') return;
      this.requested = false;
      // Autoplay denial needs another real gesture, not a render-loop retry.
      this.blocked = true;
    });
  }

  private release(): void {
    if (this.element) {
      this.element.onended = this.element.onerror = null;
      this.element.pause();
      this.element.removeAttribute('src');
      this.element.load();
      this.element = undefined;
    }
    this.requested = false;
  }
}
