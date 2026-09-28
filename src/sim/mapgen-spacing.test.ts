import { describe, expect, it } from 'vitest';
import { generateMap, type MapDescriptor, type MapgenContext } from './mapgen';
import { seedFrom } from './random';
import type { Point } from './types';

function deal(seed: number, descriptor: MapDescriptor) {
  const width = 64, height = 40;
  const objects: { kind: string; x: number; y: number }[] = [];
  const occupied = new Set<number>();
  const ctx: MapgenContext = {
    width, height, rng: { seed: seedFrom(seed) },
    free: p => p.x >= 0 && p.y >= 0 && p.x < width && p.y < height
      && !occupied.has(Math.floor(p.y) * width + Math.floor(p.x)),
    place: (kind, p) => { objects.push({ kind, ...p }); occupied.add(Math.floor(p.y) * width + Math.floor(p.x)); },
  };
  const mirror = (p: Point) => ({ x: width - p.x, y: height - p.y });
  const start = { x: 16.5, y: 20.5 };
  const layers = generateMap(ctx, descriptor, [start, mirror(start)], mirror);
  return { objects, layers, seed: ctx.rng.seed };
}

describe('map candidate exclusion (#90)', () => {
  const spacing = 6;
  const separated = (objects: { x: number; y: number }[]) => {
    const home = objects.filter(p => p.x < 32);
    expect(home).toHaveLength(6);
    for (let i = 0; i < home.length; i++) for (let j = i + 1; j < home.length; j++) {
      expect(Math.max(Math.abs(home[i].x - home[j].x), Math.abs(home[i].y - home[j].y))).toBeGreaterThanOrEqual(spacing);
    }
  };
  it('keeps accepted forest seeds apart before growing the clumps', () => {
    // One tile per clump exposes the seed locations through the actual tree
    // placements, rather than testing an unused candidate-list helper.
    const descriptor: MapDescriptor = { base: 'grass', opening: [],
      playerForest: { tiles: 1, groups: 6, near: 0, far: 13, groupSpacing: spacing } };
    for (const seed of [1, 2, 3, 7, 11, 20, 42, 90]) {
      const result = deal(seed, descriptor);
      separated(result.objects);
      expect(result).toEqual(deal(seed, descriptor));
    }
  });
  it.each(['tight', 'loose'] as const)('keeps %s opening-group anchors apart', grouping => {
    const descriptor: MapDescriptor = { base: 'grass', opening: [{ kind: 'gold', count: 1, groups: 6,
      near: 0, far: 13, grouping, spread: 0, groupSpacing: spacing }] };
    for (const seed of [1, 2, 3, 7, 11, 20, 42, 90]) {
      const result = deal(seed, descriptor);
      separated(result.objects);
      expect(result.objects).toHaveLength(12);
      for (const p of result.objects) expect(result.objects).toContainEqual({ kind: p.kind, x: 64 - p.x, y: 40 - p.y });
      expect(result).toEqual(deal(seed, descriptor));
    }
  });
  it('exhausts an undersized band without violating spacing to fill a quota', () => {
    const result = deal(90, { base: 'grass', opening: [{ kind: 'gold', count: 1, groups: 6,
      near: 0, far: 1, grouping: 'tight', groupSpacing: spacing }] });
    expect(result.objects).toHaveLength(2);
  });
  it('admits candidates exactly at the spacing boundary, including band edges', () => {
    const result = deal(90, { base: 'grass', opening: [{ kind: 'gold', count: 1, groups: 9,
      near: 0, far: 1, grouping: 'tight', groupSpacing: 1 }] });
    expect(result.objects).toHaveLength(18); // every tile in the 3x3 box and its mirror
    expect(new Set(result.objects.map(p => `${p.x},${p.y}`)).size).toBe(18);
  });
});
