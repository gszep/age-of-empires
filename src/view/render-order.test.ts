import { describe, expect, it } from 'vitest';
import { contourLayerOrder, groundLayerOrder, GROUND_FOG_ORDER, projectileLayerOrder, rallyLayerOrder, spriteLayerOrder } from './render-order';

describe('map-independent presentation passes', () => {
  it('keeps world sprites, projectiles and contours between fog and placement at every depth', () => {
    // Includes both current map sizes, the old crossover, a future larger board,
    // and slightly off-board art. Each pass is checked against all other depths.
    const depths = [-1, 0, 85, 240, 389, 500, 515, 784, 4096, 10000];
    const bodies = depths.flatMap(d => [0, 1, 1.5, 2, 2.1, 9, 16, 64].map(p => spriteLayerOrder(d, p)));
    const projectiles = depths.map(projectileLayerOrder);
    const contours = depths.map(contourLayerOrder);
    const flags = depths.flatMap(d => [rallyLayerOrder(d), rallyLayerOrder(d, 1)]);
    expect(Math.max(...depths.map(d => groundLayerOrder(500, d)))).toBeLessThan(GROUND_FOG_ORDER);
    expect(Math.min(...bodies)).toBeGreaterThan(950); // selection markers above ground fog
    expect(Math.max(...bodies)).toBeLessThan(Math.min(...projectiles));
    expect(Math.max(...projectiles)).toBeLessThan(Math.min(...contours));
    expect(Math.max(...contours)).toBeLessThan(Math.min(...flags));
    expect(Math.max(...flags)).toBeLessThan(5900); // existing placement footprint
  });

  it('preserves the old body/piece total order instead of lifting masks above unrelated nearer bodies', () => {
    const pieces = [
      [0, 0], [85, 0], [85, 1], [85, 1.5], [85, 2], [85, 2.1], [85, 9], [85, 16],
      [85.25, 0], [86, 0], [500, 0], [500, 1], [500, 2.1], [500, 9], [500.5, 0],
      [784, 0], [784, 1], [784, 16], [4096, 0], [4096, 2.1],
    ];
    for (const [ad, ap] of pieces) for (const [bd, bp] of pieces) {
      const old = Math.sign((1000 + ad * 10 + ap) - (1000 + bd * 10 + bp));
      expect(Math.sign(spriteLayerOrder(ad, ap) - spriteLayerOrder(bd, bp))).toBe(old);
    }
  });
});
