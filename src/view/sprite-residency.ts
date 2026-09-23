import type { Texture } from 'three/webgpu';

/** Presentation cache policy, not an emulation of DE's undocumented cache.
 * Active art is never evicted to meet the soft budget. A short grace keeps
 * animation pages warm; the idle timeout also cleans up below the budget. */
export const SPRITE_CACHE_POLICY = {
  budgetBytes: 512 * 1024 * 1024,
  idleMs: 120_000,
  graceMs: 60_000,
  sweepMs: 1000,
};

export class SpriteResidency {
  private pages = new Map<string, { texture: Texture; bytes: number; used: number }>();
  private nextSweep = 0;
  private bytes = 0;
  private evictions = 0;

  constructor(
    private textures: Map<string, Texture>,
    private now: () => number = () => performance.now(),
    private policy = SPRITE_CACHE_POLICY,
  ) {}

  touch(image: string): void {
    const page = this.pages.get(image);
    if (page) page.used = this.now();
  }

  add(image: string, texture: Texture): void {
    const size = texture.image as { width: number; height: number };
    const bytes = size.width * size.height * 4; // RGBA8, no sprite mipmaps
    this.textures.set(image, texture);
    this.pages.set(image, { texture, bytes, used: this.now() });
    this.bytes += bytes;
  }

  /** Called after scene synchronization: every drawable page has been touched. */
  sweep(): void {
    const now = this.now();
    if (now < this.nextSweep) return;
    this.nextSweep = now + this.policy.sweepMs;
    const candidates = [...this.pages].filter(([, page]) => now - page.used >= this.policy.graceMs)
      .sort((a, b) => a[1].used - b[1].used);
    for (const [image, page] of candidates) {
      if (now - page.used < this.policy.idleMs && this.bytes <= this.policy.budgetBytes) break;
      this.pages.delete(image);
      this.textures.delete(image);
      this.bytes -= page.bytes;
      this.evictions++;
      page.texture.dispose();
      // Hidden materials can still reference the old Texture object. Release
      // its decoded image as well as its GPU allocation; the next use rebinds
      // a newly loaded texture. THREE.Cache is disabled by default.
      page.texture.source.data = null;
    }
  }

  get stats(): { pages: number; bytes: number; evictions: number } {
    return { pages: this.pages.size, bytes: this.bytes, evictions: this.evictions };
  }
}
