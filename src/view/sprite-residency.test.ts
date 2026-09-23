import { describe, expect, it, vi } from 'vitest';
import { Texture } from 'three/webgpu';
import { spriteTexture, type ContentAssets } from './assets';
import { SpriteResidency, SPRITE_CACHE_POLICY } from './sprite-residency';

describe('sprite page residency (#152)', () => {
  function fixture(budgetBytes = 512) {
    let clock = 0;
    const textures = new Map<string, Texture>();
    const residency = new SpriteResidency(textures, () => clock, {
      ...SPRITE_CACHE_POLICY, budgetBytes, idleMs: 120, graceMs: 10, sweepMs: 1,
    });
    const add = (image: string) => {
      const texture = new Texture({ width: 8, height: 8 } as HTMLImageElement);
      const dispose = vi.fn();
      texture.addEventListener('dispose', dispose);
      residency.add(image, texture);
      return { texture, dispose };
    };
    return { textures, residency, add, at: (time: number) => { clock = time; } };
  }

  it('releases GPU and decoded data, leaves pinned terrain alone, and requests evicted art again', () => {
    const f = fixture();
    const { texture, dispose } = f.add('idle');
    const terrain = new Texture();
    f.textures.set('terrain', terrain);
    f.at(121); f.residency.sweep();
    expect(dispose).toHaveBeenCalledOnce();
    expect(texture.image).toBeNull();
    expect(f.textures.get('terrain')).toBe(terrain);
    expect(f.residency.stats).toEqual({ pages: 0, bytes: 0, evictions: 1 });
    const loadTexture = vi.fn();
    const assets = { textures: f.textures, spriteResidency: f.residency, loadTexture } as unknown as ContentAssets;
    expect(spriteTexture(assets, 'idle')).toBeUndefined();
    expect(loadTexture).toHaveBeenCalledWith('idle');
    const replacement = f.add('idle');
    expect(spriteTexture(assets, 'idle')).toBe(replacement.texture);
    expect(replacement.dispose).not.toHaveBeenCalled();
  });

  it('evicts least recently used pages under pressure but keeps the current working set even above budget', () => {
    const f = fixture(256);
    const old = f.add('old');
    f.at(1); const recent = f.add('recent');
    f.at(11); f.residency.touch('recent'); f.residency.sweep();
    expect(old.dispose).toHaveBeenCalledOnce();
    expect(recent.dispose).not.toHaveBeenCalled();
    const active = f.add('active');
    f.at(200); f.residency.touch('recent'); f.residency.touch('active'); f.residency.sweep();
    expect(f.residency.stats.bytes).toBe(512);
    expect(active.dispose).not.toHaveBeenCalled();
    expect(recent.dispose).not.toHaveBeenCalled();
  });

  it('bounds residency over repeated animation cycles without evicting a page on its first use after a pause', () => {
    const f = fixture(256);
    for (let i = 0; i < 100; i++) {
      f.at(i * 20);
      f.add(`animation-${i}`);
      f.residency.sweep();
      expect(f.residency.stats.pages).toBe(1);
    }
    f.at(1_000_000);
    f.residency.touch('animation-99');
    f.residency.sweep();
    expect(f.residency.stats).toEqual({ pages: 1, bytes: 256, evictions: 99 });
  });

  it('keeps alternating work/carry art warm under pressure, then expires it once the worker stops (#170)', () => {
    let now = 0;
    const textures = new Map<string, Texture>();
    const residency = new SpriteResidency(textures, () => now, { ...SPRITE_CACHE_POLICY, budgetBytes: 0 });
    for (const image of ['work', 'carry']) residency.add(image, new Texture({ width: 8, height: 8 } as HTMLImageElement));
    const loadTexture = vi.fn();
    const assets = { textures, spriteResidency: residency, loadTexture } as unknown as ContentAssets;
    for (let trip = 1; trip <= 8; trip++) {
      now = trip * 20_000;
      expect(spriteTexture(assets, trip % 2 ? 'carry' : 'work')).toBeDefined();
      residency.sweep();
    }
    expect(loadTexture).not.toHaveBeenCalled();
    expect(residency.stats.evictions).toBe(0);
    now += 121_000;
    residency.sweep();
    expect(residency.stats.pages).toBe(0);
    expect(residency.stats.evictions).toBe(2);
  });
});
