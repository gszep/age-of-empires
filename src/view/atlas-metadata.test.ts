import { describe, expect, it } from 'vitest';
import { expandAtlasFrames } from './atlas-metadata';

describe('published atlas frame interning', () => {
  it('hydrates root, profile and annex geometry with shared arrays while retaining per-use pages and scale', () => {
    const frames = [{ x: 8, y: 4, w: 20, h: 30, cx: -2, cy: 7, page: 1 }];
    const small = { image: 'a.png', size: [32, 32], framesRef: 'shared', scale: 1 };
    const large = { image: 'b.png', size: [64, 64], framesRef: 'shared', scale: 2,
      pages: [{ image: 'b.png', size: [64, 64] }, { image: 'b-p1.png', size: [64, 32] }] };
    const manifest = { atlasFrames: { shared: frames }, entities: { root: { atlases: { idle: small } } },
      civilizations: { other: { entities: { unit: { atlases: { idle: large }, annexes: [{ atlases: { idle: { ...small } } }] } } } } };
    const hydrated = expandAtlasFrames(JSON.parse(JSON.stringify(manifest)));
    const a = hydrated.entities.root.atlases.idle, b = hydrated.civilizations.other.entities.unit.atlases.idle;
    expect(a.frames).toEqual(frames); expect(b.frames).toBe(a.frames);
    expect(hydrated.civilizations.other.entities.unit.annexes[0].atlases.idle.frames).toBe(a.frames);
    expect(a.scale).toBe(1); expect(b.scale).toBe(2); expect(b.pages).toEqual(large.pages);
    expect(a.framesRef).toBeUndefined(); expect(hydrated.atlasFrames).toBeUndefined();
    expect(expandAtlasFrames(hydrated)).toBe(hydrated);
  });

  it('keeps legacy inline geometry and rejects missing references instead of drawing wrong frames', () => {
    const legacy = { entities: { unit: { atlases: { idle: { frames: [{ x: 1 }] } } } } };
    expect(expandAtlasFrames(legacy)).toEqual(legacy);
    expect(() => expandAtlasFrames({ entities: { unit: { atlases: { idle: { framesRef: 'missing' } } } } })).toThrow('Missing atlas frame set');
  });
});
