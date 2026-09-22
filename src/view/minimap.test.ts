import { describe, expect, it } from 'vitest';
import { minimapReliefShade, minimapResourceDotSize } from './minimap';

describe('minimap resource density', () => {
  it('keeps classic-board resource dots at their established size', () => {
    expect(minimapResourceDotSize(120, 120)).toBe(3);
  });

  it('shrinks Windsor tree dots to one pixel instead of covering ten tiles each', () => {
    expect(minimapResourceDotSize(392, 392)).toBe(1);
  });
});

describe('minimap relief', () => {
  const field = (heightAt: (x: number, y: number) => number) => ({
    width: 7, height: 5,
    elevation: Array.from({ length: 35 }, (_, i) => heightAt(i % 7, Math.floor(i / 7))),
  });

  it('keeps elevated plateaus flat, including map boundaries', () => {
    for (const level of [0, 4, 19.25]) {
      const state = field(() => level);
      for (let y = 0; y < state.height; y++) for (let x = 0; x < state.width; x++) {
        expect(minimapReliefShade(state, x, y)).toBe(1);
      }
    }
  });

  it.each([
    ['x', (x: number, _y: number) => x, 0],
    ['y', (_x: number, y: number) => y, 2],
    ['screen-horizontal', (x: number, y: number) => x - y, 0],
  ] as const)('gives opposite %s slopes opposite shades without depending on altitude', (_name, heightAt, shade) => {
    const descending = field((x, y) => 30 - heightAt(x, y));
    const ascending = field((x, y) => heightAt(x, y));
    const raised = field((x, y) => 100 + heightAt(x, y));
    expect(minimapReliefShade(descending, 3.5, 2.5)).toBe(2 - shade);
    expect(minimapReliefShade(ascending, 3.5, 2.5)).toBe(shade);
    expect(minimapReliefShade(raised, 3.5, 2.5)).toBe(shade);
  });

  it('leaves a slope perpendicular to the shading axis neutral', () => {
    expect(minimapReliefShade(field((x, y) => 10 + x + y), 3, 2)).toBe(1);
  });

  it('lights the screen-right faces of a four-sided hill, not both front faces', () => {
    const state = field((x, y) => Math.max(0, 3 - Math.abs(x - 3) - Math.abs(y - 2)));
    // Relative to the peak: -x projects upper-right; +y projects lower-right.
    expect(minimapReliefShade(state, 2, 2)).toBe(0);
    expect(minimapReliefShade(state, 3, 3)).toBe(0);
    // +x projects lower-left; -y projects upper-left.
    expect(minimapReliefShade(state, 4, 2)).toBe(2);
    expect(minimapReliefShade(state, 3, 1)).toBe(2);
    expect(minimapReliefShade(state, 3, 2)).toBe(1);
  });

  it('handles old flat snapshots without elevation and ignores numerical noise', () => {
    expect(minimapReliefShade({ width: 7, height: 5, elevation: [] }, 3, 2)).toBe(1);
    expect(minimapReliefShade(field((x, y) => 4 + (x + y) * 1e-9), 3, 2)).toBe(1);
  });
});
