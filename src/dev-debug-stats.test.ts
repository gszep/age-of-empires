import { describe, expect, it } from 'vitest';
import { colorStats } from './dev-debug-stats';

function pixels(colors: [number, number, number, number][]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(colors.length * 4);
  colors.forEach((c, i) => data.set(c, i * 4));
  return data;
}

describe('colorStats', () => {
  it('reports the mean and dominant colour of a solid block', () => {
    const stats = colorStats(pixels(Array(16).fill([255, 0, 0, 255])));
    expect(stats.mean).toEqual([255, 0, 0]);
    expect(stats.opaque).toBe(1);
    expect(stats.colors[0].fraction).toBe(1);
    // 255 falls in the top bucket, whose centre is 0xf8.
    expect(stats.colors[0].hex).toBe('#f80808');
  });

  it('ignores transparent pixels in the mean but counts them in coverage', () => {
    const stats = colorStats(pixels([
      [0, 0, 255, 255],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]));
    expect(stats.mean).toEqual([0, 0, 255]);
    expect(stats.opaque).toBe(0.25);
  });

  it('ranks colours by frequency', () => {
    const stats = colorStats(pixels([
      [0, 255, 0, 255],
      [0, 255, 0, 255],
      [0, 255, 0, 255],
      [255, 0, 0, 255],
    ]));
    expect(stats.colors[0].hex).toBe('#08f808');
    expect(stats.colors[0].fraction).toBe(0.75);
    expect(stats.colors[1].fraction).toBe(0.25);
  });

  it('handles empty input', () => {
    const stats = colorStats(pixels([]));
    expect(stats.mean).toEqual([0, 0, 0]);
    expect(stats.pixels).toBe(0);
  });
});
