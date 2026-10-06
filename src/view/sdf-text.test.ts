import { describe, it, expect } from 'vitest';
import { AGE_SDF_TREATMENT, COUNTER_SDF_TREATMENT, distanceAt, smoothstep, SDFTextRenderer, type Pixels, type SDFFont } from './sdf-text';

function fixture() {
  const image: Pixels = { width: 8, height: 8, data: new Uint8ClampedArray(8 * 8 * 4) };
  for (let i = 0; i < image.data.length; i += 4) image.data.set([0, 255, 255, 255], i);
  const font: SDFFont = { sourceSize: 8, pages: ['synthetic'], glyphs: {
    '65': [4, 4, .25, .25, .75, .75, 0, -1, -2, 3],
    '48': [4, 4, .25, .25, .75, .75, 0, 0, 0, 4],
    '32': [1, 1, .25, .25, .375, .375, 0, 0, 0, 2],
  } };
  const renderer = new SDFTextRenderer(); renderer.setFont(font, [image]);
  return { renderer, font, image };
}
const white = [255, 255, 255, 1] as const;
describe('RGB distance font rasterisation (real pixels, no canvas mocks)', () => {
  it('uses the median, not red or luminance', () => {
    expect(distanceAt(fixture().image, 2, 2)).toBe(1);
  });
  it('bilinearly interpolates channels before taking their median', () => {
    const image = { width: 2, height: 1, data: new Uint8ClampedArray([0, 255, 255, 255, 255, 0, 255, 255]) };
    expect(distanceAt(image, .5, 0)).toBe(.5);
  });
  it('implements shader smoothstep and its zero-gradient limit', () => {
    expect(smoothstep(.4, .6, .5)).toBeCloseTo(.5);
    expect(smoothstep(.4, .6, .3)).toBe(0);
    expect(smoothstep(.4, .6, .7)).toBe(1);
    expect(smoothstep(.5, .5, .1)).toBe(0);
    expect(smoothstep(.5, .5, 1)).toBe(1);
  });
  it('draws nonblank pixels with tint and alpha', () => {
    const result = fixture().renderer.renderText('A', 8, [200, 40, 10, .5])!;
    expect(Array.from(result.data.slice(0, 4))).toEqual([200, 40, 10, 64]);
  });
  it('does not crop negative offsets or right overhang', () => {
    const result = fixture().renderer.renderText('AA', 8, white)!;
    expect([result.width, result.height]).toEqual([7, 4]);
    expect(result.data[3]).toBe(255);
    expect(result.data[(6 * 4) + 3]).toBe(255);
  });
  it('scales dimensions and pixels with size', () => {
    const r = fixture().renderer;
    expect(r.renderText('A', 16, white)!.width).toBe(r.renderText('A', 8, white)!.width * 2);
  });
  it('keys and sizes the backing raster by DPR, keeping logical size', () => {
    const r = fixture().renderer, one = r.renderText('A', 8, white, 1)!;
    const two = r.renderText('A', 8, white, 2)!;
    expect(two.width).toBe(one.width * 2); expect(two.cssWidth).toBe(one.cssWidth);
    expect(two).not.toBe(one);
  });
  it('returns the same raster without repeated pixel work', () => {
    const r = fixture().renderer, first = r.renderText('A', 8, white);
    for (let i = 0; i < 100; i++) expect(r.renderText('A', 8, white)).toBe(first);
    expect(r.stats.renders).toBe(1); expect(r.stats.hits).toBe(100);
  });
  it('keys cache by text, tint, size and outline', () => {
    const r = fixture().renderer;
    r.renderText('A', 8, white); r.renderText('0', 8, white);
    r.renderText('A', 9, white); r.renderText('A', 8, [1, 2, 3, 1]); r.renderText('A', 8, white, 1, .05);
    expect(r.getCacheStats().size).toBe(5);
  });
  it('evicts least recently used rather than first inserted', () => {
    const r = fixture().renderer, first = r.renderText('A', 8, white);
    for (let i = 1; i < 256; i++) r.renderText('A', 8, [i, 0, 0, 1]);
    expect(r.renderText('A', 8, white)).toBe(first);
    r.renderText('0', 8, white);
    expect(r.getCacheStats().size).toBe(256);
    expect(r.renderText('A', 8, white)).toBe(first);
  });
  it('invalidates when a font changes or is explicitly cleared', () => {
    const { renderer: r, font, image } = fixture(); r.renderText('A', 8, white);
    r.setFont(font, [image]); expect(r.getCacheStats().size).toBe(0);
    r.renderText('A', 8, white); r.clearCache(); expect(r.getCacheStats().size).toBe(0);
  });
  it('falls back for the whole label, never silently drops unknown characters', () => {
    expect(fixture().renderer.renderText('A★', 8, white)).toBeNull();
  });
  it('falls back without font, texture or text, or at invalid size', () => {
    const { renderer: r, font } = fixture();
    expect(new SDFTextRenderer().renderText('A', 8, white)).toBeNull();
    expect(r.renderText('', 8, white)).toBeNull(); expect(r.renderText('A', 0, white)).toBeNull();
    r.setFont(font, []); expect(r.renderText('A', 8, white)).toBeNull();
  });
  it('uses advances for spaces and does not overlap adjacent glyph origins', () => {
    const r = fixture().renderer;
    expect(r.renderText('A A', 8, white)!.width).toBe(r.renderText('AA', 8, white)!.width + 2);
  });
  it('produces transparent pixels outside the signed edge', () => {
    const { renderer: r, font, image } = fixture(); image.data.fill(0); r.setFont(font, [image]);
    expect(r.renderText('A', 8, white)!.data.every(v => v === 0)).toBe(true);
  });
  it('computes the shader forward-difference edge and black outline coverage', () => {
    const { renderer: r, font, image } = fixture();
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const d = 40 * x; image.data.set([d, d, d, 255], (y * 8 + x) * 4);
    }
    r.setFont(font, [image]);
    const plain = r.renderText('A', 8, white)!, outlined = r.renderText('A', 8, white, 1, .1)!;
    const d = 80 / 255, edge = 40 / 255;
    expect(plain.data[3]).toBe(Math.round(smoothstep(.5-edge, .5+edge, d) * 255));
    expect(outlined.data[3]).toBe(Math.round(smoothstep(.4-edge, .4+edge, d) * 255));
    expect(outlined.data[3]).toBeGreaterThan(plain.data[3]);
  });
  it('keys the cached raster by calibrated treatment, not just the label', () => {
    const r = fixture().renderer, source = r.renderText('A', 8, white);
    const counter = r.renderText('A', 8, white, 1, .025, COUNTER_SDF_TREATMENT);
    const age = r.renderText('A', 8, white, 1, .1, AGE_SDF_TREATMENT);
    expect(counter).not.toBe(source); expect(age).not.toBe(counter);
    expect(r.renderText('A', 8, white, 1, .1, AGE_SDF_TREATMENT)).toBe(age);
  });
  it('keeps zero-distance background transparent under both fitted treatments', () => {
    const { renderer: r, font, image } = fixture(); image.data.fill(0); r.setFont(font, [image]);
    for (const [treatment, outline] of [[COUNTER_SDF_TREATMENT, .025], [AGE_SDF_TREATMENT, .1]] as const) {
      expect(r.renderText('A', 8, white, 1, outline, treatment)!.data.every(v => v === 0)).toBe(true);
    }
    expect(r.renderText('A', 8, white, 1, .15, AGE_SDF_TREATMENT)).toBeNull();
  });
  it('adds stroke coverage instead of changing advances or tint to fake weight', () => {
    const { renderer: r, font, image } = fixture();
    for (let i = 0; i < image.data.length; i += 4) image.data.set([90, 90, 90, 255], i);
    r.setFont(font, [image]);
    const source = r.renderText('A', 8, white)!;
    const fitted = r.renderText('A', 8, white, 1, .025, COUNTER_SDF_TREATMENT)!;
    expect(fitted.width).toBe(source.width); expect(fitted.height).toBe(source.height);
    expect(source.data[3]).toBe(0); expect(fitted.data[3]).toBe(255);
    expect(fitted.data[0]).toBe(255);
  });
  it('draws a padded black halo without recolouring the stroke core', () => {
    const r = fixture().renderer;
    const source = r.renderText('A', 8, white)!;
    const halo = r.renderText('A', 8, white, 1, 0, { threshold: .5, edgeScale: 1, haloEm: 1/8 })!;
    expect(halo.width).toBe(source.width+2); expect(halo.height).toBe(source.height+2);
    expect(Array.from(halo.data.slice(0, 4))).toEqual([0, 0, 0, 255]);
    expect(Array.from(halo.data.slice((halo.width+1)*4, (halo.width+1)*4+4))).toEqual([255, 255, 255, 255]);
  });
});
