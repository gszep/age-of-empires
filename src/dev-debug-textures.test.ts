import { describe, expect, it, vi } from 'vitest';
import { CompressedTexture, DataTexture, RGBA_S3TC_DXT1_Format, Texture } from 'three/webgpu';
import { spriteTextureStats } from './dev-debug';
import { SpriteResidency } from './view/sprite-residency';

describe('read-only textures debug query', () => {
  it('reports an empty open fallback', () => {
    expect(spriteTextureStats()).toEqual({ resident: 0, bytes: 0, compressed: 0, png: 0 });
  });
  it('counts mixed BC and PNG pages using real residency bytes without touching or sweeping them', () => {
    let clock = 0;
    const textures = new Map<string, Texture>();
    const spriteResidency = new SpriteResidency(textures, () => clock);
    const png = new DataTexture(new Uint8Array(64), 4, 4);
    const bc = new CompressedTexture([{ data: new Uint8Array(8), width: 4, height: 4 }], 4, 4, RGBA_S3TC_DXT1_Format);
    spriteResidency.add('png', png); spriteResidency.add('bc', bc);
    const touch = vi.spyOn(spriteResidency, 'touch'), sweep = vi.spyOn(spriteResidency, 'sweep');
    const assets = { textures, spriteResidency };
    clock = 121_000;
    expect(spriteTextureStats(assets)).toEqual({ resident: 2, bytes: 72, compressed: 1, png: 1 });
    expect(spriteTextureStats(assets)).toEqual({ resident: 2, bytes: 72, compressed: 1, png: 1 });
    expect(touch).not.toHaveBeenCalled(); expect(sweep).not.toHaveBeenCalled();
    spriteResidency.sweep();
    expect(spriteTextureStats(assets)).toEqual({ resident: 0, bytes: 0, compressed: 0, png: 0 });
  });
  it('distinguishes sprite residency from the broader content map format counts', () => {
    const textures = new Map<string, Texture>();
    const spriteResidency = new SpriteResidency(textures);
    textures.set('terrain', new DataTexture(new Uint8Array(64), 4, 4));
    expect(spriteTextureStats({ textures, spriteResidency })).toEqual({ resident: 0, bytes: 0, compressed: 0, png: 1 });
  });
  it('reads the current assets through a context getter after hot replacement', () => {
    const textures = new Map<string, Texture>();
    let current: { textures: Map<string, Texture>; spriteResidency: SpriteResidency } | undefined;
    const context = { get assets() { return current; } };
    expect(spriteTextureStats(context.assets)).toEqual({ resident: 0, bytes: 0, compressed: 0, png: 0 });
    textures.set('terrain', new DataTexture(new Uint8Array(64), 4, 4));
    current = { textures, spriteResidency: new SpriteResidency(textures) };
    expect(spriteTextureStats(context.assets)).toEqual({ resident: 0, bytes: 0, compressed: 0, png: 1 });
  });
});
