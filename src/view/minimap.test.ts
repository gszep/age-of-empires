import { describe, expect, it } from 'vitest';
import { minimapResourceDotSize } from './minimap';

describe('minimap resource density', () => {
  it('keeps classic-board resource dots at their established size', () => {
    expect(minimapResourceDotSize(120, 120)).toBe(3);
  });

  it('shrinks Windsor tree dots to one pixel instead of covering ten tiles each', () => {
    expect(minimapResourceDotSize(392, 392)).toBe(1);
  });
});
