import { describe, expect, it } from 'vitest';
import { colorStats, edgeWidth, lumaProfile, matchCount } from './dev-debug-stats';

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

describe('matchCount', () => {
  it('counts pixels within the tolerance of a colour and ignores transparent ones', () => {
    const { matched, matchedFraction } = matchCount(pixels([
      [0, 0, 255, 255], [0, 0, 250, 255], [0, 0, 200, 255], [0, 0, 255, 0],
    ]), '#0000ff');
    expect(matched).toBe(2);
    expect(matchedFraction).toBe(0.5);
  });
});

describe('edgeWidth', () => {
  it('measures a hard step as zero wide and a ramp as its 10-90% span', () => {
    expect(edgeWidth([0, 0, 0, 0, 255, 255, 255, 255]).width).toBe(0);
    const ramp = Array.from({ length: 101 }, (_, i) => i * 2.55);
    expect(edgeWidth(ramp).width).toBe(80);
  });
  it('reads a falling edge the same as a rising one', () => {
    const ramp = Array.from({ length: 101 }, (_, i) => 255 - i * 2.55);
    const edge = edgeWidth(ramp);
    expect(edge.rising).toBe(false);
    expect(edge.width).toBe(80);
  });
  it('reports zero width for a flat profile', () => {
    expect(edgeWidth([7, 7, 7, 7]).width).toBe(0);
  });
});

describe('lumaProfile', () => {
  it('samples along a horizontal line at one pixel a step', () => {
    const row = pixels([[0, 0, 0, 255], [255, 255, 255, 255], [255, 255, 255, 255]]);
    expect(lumaProfile(row, 3, [0, 0], [2, 0])).toEqual([0, 255, 255]);
  });
});
