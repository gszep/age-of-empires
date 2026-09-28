import { describe, expect, it } from 'vitest';
import { generateMap, MAPS, type MapDescriptor, type MapgenContext } from './mapgen';
import { seedFrom } from './random';

function draw(seed: number, descriptor: MapDescriptor, width = 80, height = 60) {
  const occupied = new Set<number>();
  const ctx: MapgenContext = { width, height, rng: { seed: seedFrom(seed) },
    free: p => p.x >= 0 && p.y >= 0 && p.x < width && p.y < height
      && !occupied.has(Math.floor(p.y) * width + Math.floor(p.x)),
    place: (_kind, p) => { occupied.add(Math.floor(p.y) * width + Math.floor(p.x)); } };
  const mirror = (p: { x: number; y: number }) => ({ x: width - p.x, y: height - p.y });
  const start = { x: width / 4 + 0.5, y: height / 2 + 0.5 };
  return generateMap(ctx, descriptor, [start, mirror(start)], mirror);
}

describe('owned RMS clumping defaults (#56)', () => {
  it.each([1, 7, 42])('omitted land clumping equals explicit8, not terrain20, on seed %i', seed => {
    const base: MapDescriptor = { base: 'water', opening: [],
      land: { percent: 35, baseSize: 3, clearance: 3 } };
    const explicit = (clumping: number) => ({ ...base, land: { ...base.land!, clumping } });
    expect(draw(seed, base)).toEqual(draw(seed, explicit(8)));
    expect(draw(seed, base)).not.toEqual(draw(seed, explicit(20)));
    expect(draw(seed, explicit(22))).not.toEqual(draw(seed, explicit(15))); // modern RMS overrides are not clamped to the legacy guide range
  });
  it('applies the land default to resource islets while retaining their explicit overrides', () => {
    const base = MAPS.islands;
    expect(base.resourceIslets!.length).toBeGreaterThan(0);
    const explicit = (clumping: number): MapDescriptor => ({ ...base,
      resourceIslets: base.resourceIslets!.map(spec => ({ ...spec, clumping })) });
    const omitted = draw(3, base, 120, 120);
    expect(omitted).toEqual(draw(3, explicit(8), 120, 120));
    expect(omitted).not.toEqual(draw(3, explicit(20), 120, 120));
  });
});
