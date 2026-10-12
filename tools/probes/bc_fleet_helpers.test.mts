/** Exercise the runner's real functions, not copies that can diverge. */
import { describe, it, expect } from 'vitest';
import { comparePixels, validateTextureFormats, checkAcceptance, createFleetFixture } from './bc_fleet_desktop.mjs';

describe('BC fleet pixel statistics', () => {
  it('detects identical pixels', () => {
    const pixels = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]);
    const result = comparePixels(pixels, pixels, 2, 1);
    expect(result.changedPixels).toBe(0); expect(result.changedChannels).toBe(0);
    expect(result.maxAbsDiff).toBe(0); expect(result.meanAbsPerChannel).toEqual([0, 0, 0, 0]);
    expect(result.histogram.map((h: number[]) => h[0])).toEqual([2, 2, 2, 2]);
  });
  it('reports correct per-channel means/maxima and a complete absolute-byte histogram', () => {
    const bc = new Uint8Array([255, 128, 64, 255, 0, 0, 0, 255]);
    const png = new Uint8Array([253, 130, 61, 255, 4, 2, 2, 251]);
    const result = comparePixels(bc, png, 2, 1);
    expect(result.changedPixels).toBe(2); expect(result.changedChannels).toBe(7);
    expect(result.maxAbsPerChannel).toEqual([4, 2, 3, 4]);
    expect(result.meanAbsPerChannel).toEqual([3, 2, 2.5, 2]);
    expect(result.meanAbsDiff).toBe(19 / 8);
    expect(result.histogram[0][2]).toBe(1); expect(result.histogram[0][4]).toBe(1);
    expect(result.histogram.map((h: number[]) => h.reduce((a, b) => a + b))).toEqual([2, 2, 2, 2]);
    expect(result.examples[0]).toEqual({ pixel: 0, bc: [255, 128, 64, 255], png: [253, 130, 61, 255] });
  });
  it.each([
    [null, null, 1, 1], [new Uint8Array(4), new Uint8Array(8), 1, 1],
    [new Uint8Array(8), new Uint8Array(8), 1, 1], [new Uint8Array(), new Uint8Array(), 0, 1],
  ])('fails closed on missing/mismatched pixels or dimensions (%#)', (a, b, w, h) => {
    expect(() => comparePixels(a, b, w, h)).toThrow();
  });
});

describe('BC fleet texture acceptance', () => {
  it('accepts BC with PNG-only masks and ineligible pages', () => {
    expect(validateTextureFormats('bc', { compressed: 10, png: 5 }).valid).toBe(true);
    expect(validateTextureFormats('bc', { compressed: 10, png: 0 }).valid).toBe(true);
  });
  it('rejects BC without compressed pages', () => {
    expect(validateTextureFormats('bc', { compressed: 0, png: 5 }).valid).toBe(false);
  });
  it('accepts PNG only', () => {
    expect(validateTextureFormats('png', { compressed: 0, png: 10 }).valid).toBe(true);
  });
  it('rejects compressed PNG-mode pages', () => {
    expect(validateTextureFormats('png', { compressed: 5, png: 10 }).valid).toBe(false);
  });
  it('rejects empty/missing/invalid PNG counts', () => {
    for (const counts of [undefined, {}, { compressed: 0, png: 0 }, { compressed: -1, png: 2 }]) {
      expect(validateTextureFormats('png', counts).valid).toBe(false);
    }
  });
});

describe('BC fleet cross-process acceptance', () => {
  const counters = { rows: [{}], dedicated: 1024, committed: 2048 };
  const valid = {
    adapter: { vendor: 'nvidia', isFallbackAdapter: false }, webgpu: true, bc: true,
    textures: { compressed: 10, png: 5 }, simulationHash: 'abcd1234', errors: [],
    memory: { before: counters, after: counters },
  };
  const png = { ...valid, textures: { compressed: 0, png: 15 } };
  it('accepts valid results', () => {
    expect(checkAcceptance(valid, png)).toEqual({ pass: true, failures: [] });
  });
  it.each(['bc', 'png'])('validates %s adapter and feature independently', mode => {
    for (const patch of [
      { adapter: { isFallbackAdapter: true } }, { adapter: { isFallbackAdapter: false, description: 'SwiftShader' } },
      { adapter: undefined }, { bc: false }, { webgpu: false },
    ]) {
      expect(checkAcceptance(mode === 'bc' ? { ...valid, ...patch } : valid,
        mode === 'png' ? { ...png, ...patch } : png).pass).toBe(false);
    }
  });
  it('rejects adapter mismatch', () => {
    expect(checkAcceptance(valid, { ...png, adapter: { ...png.adapter, vendor: 'intel' } }).pass).toBe(false);
  });
  it('rejects texture mismatch', () => {
    expect(checkAcceptance({ ...valid, textures: { compressed: 0, png: 10 } }, png).pass).toBe(false);
  });
  it('rejects hash mismatch and missing/fabricated zero hashes even if equal', () => {
    expect(checkAcceptance({ ...valid, simulationHash: 'different' }, png).pass).toBe(false);
    for (const simulationHash of [undefined, '', '000000000000']) {
      expect(checkAcceptance({ ...valid, simulationHash }, { ...png, simulationHash }).pass).toBe(false);
    }
  });
  it('rejects missing counters and captured browser failures', () => {
    for (const patch of [{ memory: undefined }, { memory: { before: counters, after: {} } },
      { error: 'timeout' }, { errors: ['GPU validation failed'] }]) {
      expect(checkAcceptance({ ...valid, ...patch }, png).pass).toBe(false);
    }
  });
  it('accumulates multiple failures instead of hiding them', () => {
    expect(checkAcceptance({}, {}).failures.length).toBeGreaterThan(3);
  });
  it('does not replace a missing manifest/fixture with a green skip', () => {
    expect(() => createFleetFixture(null)).toThrow();
  });
});
