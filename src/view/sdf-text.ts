/** CPU counterpart of mdsf_font_ps.so: bilinear RGB -> median -> smoothstep.
 * Rasterise at device resolution, only on a changed label/style. See ledger #92
 * for source arithmetic versus the treatment fitted to a native capture.
 */
export type GlyphArray = [w: number, h: number, u: number, v: number, s: number,
  t: number, page: number, xo: number, yo: number, advance: number];
export interface SDFFont {
  glyphs: Record<string, GlyphArray>;
  pages: string[];
  sourceSize: number;
}
export interface Pixels { width: number; height: number; data: Uint8ClampedArray }
export interface TextRaster extends Pixels { cssWidth: number; cssHeight: number }
export type Tint = readonly [number, number, number, number];
export interface SDFTreatment { threshold: number; edgeScale: number; haloEm?: number }
export const SOURCE_SDF_TREATMENT: Readonly<SDFTreatment> = { threshold: .5, edgeScale: 1 };
/** Fitted to native build185872 at2560x1440, not discovered shader uniforms.
 * Two surface classes, never per-string settings. See tools/sdf_metrics.py.
 */
export const COUNTER_SDF_TREATMENT: Readonly<SDFTreatment> = { threshold: .06, edgeScale: 2.25 };
export const AGE_SDF_TREATMENT: Readonly<SDFTreatment> = { threshold: .12, edgeScale: 1.75, haloEm: 3/88 };

export function smoothstep(low: number, high: number, value: number): number {
  if (low === high) return value >= high ? 1 : 0;
  const t = Math.max(0, Math.min(1, (value - low) / (high - low)));
  return t * t * (3 - 2 * t);
}

/** Interpolate channels BEFORE taking the median. The red-only PoC rounded corners. */
export function distanceAt(image: Pixels, x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const channel = (c: number): number => {
    const at = (dx: number, dy: number): number => image.data[(
      Math.max(0, Math.min(image.height - 1, iy + dy)) * image.width
      + Math.max(0, Math.min(image.width - 1, ix + dx))) * 4 + c] / 255;
    return (at(0, 0) * (1 - fx) + at(1, 0) * fx) * (1 - fy)
      + (at(0, 1) * (1 - fx) + at(1, 1) * fx) * fy;
  };
  const r = channel(0), g = channel(1), b = channel(2);
  return Math.max(Math.min(r, g), Math.min(Math.max(r, g), b));
}

export class SDFTextRenderer {
  private cache = new Map<string, TextRaster>();
  private font?: SDFFont;
  private images: Pixels[] = [];
  readonly stats = { renders: 0, hits: 0, milliseconds: 0 };
  setFont(font: SDFFont, images: Pixels[]): void {
    this.font = font;
    this.images = images;
    this.clearCache();
  }
  clearCache(): void { this.cache.clear(); }
  getCacheStats(): { size: number; maxSize: number } { return { size: this.cache.size, maxSize: 256 }; }

  renderText(text: string, size: number, color: Tint, dpr = 1, outline = 0,
    treatment: Readonly<SDFTreatment> = SOURCE_SDF_TREATMENT): TextRaster | null {
    const font = this.font;
    if (!font || !text || !Number.isFinite(size) || size <= 0 || !Number.isFinite(dpr) || dpr <= 0) return null;
    // A nonpositive outer threshold makes zero-distance atlas background an
    // opaque black rectangle. Reject it rather than hiding it on a dark panel.
    if (!Number.isFinite(treatment.threshold) || !Number.isFinite(treatment.edgeScale)
      || treatment.edgeScale <= 0 || outline < 0 || outline >= treatment.threshold) return null;
    const key = JSON.stringify([text, size, color, dpr, outline, treatment]);
    const cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key); this.cache.set(key, cached); // actual LRU, not FIFO
      this.stats.hits++;
      return cached;
    }
    const started = performance.now();
    const placed: { g: GlyphArray; x: number }[] = [];
    let advance = 0, left = 0, right = 0, top = 0, bottom = 0;
    for (const char of text) {
      const g = font.glyphs[String(char.codePointAt(0))];
      // Never hide an unsupported character or a missing texture: whole-label CSS fallback.
      if (!g || !this.images[g[6]]) return null;
      placed.push({ g, x: advance });
      left = Math.min(left, advance + g[7]); right = Math.max(right, advance + g[7] + g[0]);
      top = Math.min(top, g[8]); bottom = Math.max(bottom, g[8] + g[1]);
      advance += g[9];
    }
    right = Math.max(right, advance);
    const scale = size / font.sourceSize * dpr;
    const width = Math.max(1, Math.ceil((right - left) * scale));
    const height = Math.max(1, Math.ceil((bottom - top) * scale));
    // Defend CPU/memory against malformed manifests or huge labels.
    if (width * height > 1_000_000) return null;
    const data = new Uint8ClampedArray(width * height * 4);
    for (const { g, x } of placed) {
      const [w, h, u, v, , , page, xo, yo] = g, image = this.images[page];
      const dx = (x + xo - left) * scale, dy = (yo - top) * scale;
      for (let py = Math.max(0, Math.floor(dy)); py < Math.min(height, Math.ceil(dy + h * scale)); py++) {
        for (let px = Math.max(0, Math.floor(dx)); px < Math.min(width, Math.ceil(dx + w * scale)); px++) {
          const sx = (px + .5 - dx) / scale, sy = (py + .5 - dy) / scale;
          if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
          const ax = u * image.width + sx - .5, ay = v * image.height + sy - .5;
          const d = distanceAt(image, ax, ay);
          // The shader sums two forward distance differences. A one-source-texel
          // stride is used here; native srcTextureWidth uniform is not in widgetui.
          const edge = (Math.abs(d - distanceAt(image, ax + 1, ay))
            + Math.abs(d - distanceAt(image, ax, ay + 1))) * treatment.edgeScale;
          const fill = smoothstep(treatment.threshold - edge, treatment.threshold + edge, d);
          const coverage = smoothstep(treatment.threshold - outline - edge, treatment.threshold - outline + edge, d);
          // Native final alpha: outer coverage * lerp(outline.a, font.a, fill)
          // * font.a. Our selected surface's outline is opaque black.
          const alpha = coverage * (1 + fill * (color[3] - 1)) * color[3], i = (py * width + px) * 4;
          const previous = data[i + 3] / 255, combined = alpha + previous * (1 - alpha);
          if (!combined) continue;
          for (let c = 0; c < 3; c++) data[i + c] =
            (color[c] * fill * alpha + data[i + c] * previous * (1 - alpha)) / combined;
          data[i + 3] = combined * 255;
        }
      }
    }
    // Fitted age outline: a black alpha-dilated halo, one physical pixel at the
    // native2560 capture scale. Unlike a negative distance cutoff this preserves
    // transparent corners/holes and works on light as well as dark panel art.
    const radius = Math.round(size * dpr * (treatment.haloEm ?? 0));
    let result: TextRaster = { width, height, data, cssWidth: width / dpr, cssHeight: height / dpr };
    if (radius > 0) {
      const outWidth = width + 2*radius, outHeight = height + 2*radius;
      if (outWidth * outHeight > 1_000_000) return null;
      const outlined = new Uint8ClampedArray(outWidth * outHeight * 4);
      for (let y = 0; y < outHeight; y++) for (let x = 0; x < outWidth; x++) {
        const sx = x-radius, sy = y-radius;
        let shadow = 0;
        for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
          if (sx+dx >= 0 && sx+dx < width && sy+dy >= 0 && sy+dy < height)
            shadow = Math.max(shadow, data[((sy+dy)*width+sx+dx)*4+3]/255);
        }
        const inside = sx >= 0 && sx < width && sy >= 0 && sy < height;
        const from = (sy*width+sx)*4, to = (y*outWidth+x)*4;
        const foreground = inside ? data[from+3]/255 : 0;
        const alpha = foreground + shadow*(1-foreground);
        if (!alpha) continue;
        for (let c = 0; c < 3; c++) outlined[to+c] = inside ? data[from+c]*foreground/alpha : 0;
        outlined[to+3] = alpha*255;
      }
      result = { width: outWidth, height: outHeight, data: outlined, cssWidth: outWidth/dpr, cssHeight: outHeight/dpr };
    }
    if (this.cache.size >= 256) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, result);
    this.stats.renders++;
    this.stats.milliseconds += performance.now() - started;
    return result;
  }
}

/** A failure leaves the DOM face untouched; no blank owned labels. */
export async function loadSDFRenderer(font: SDFFont, base: string): Promise<SDFTextRenderer> {
  const images = await Promise.all(font.pages.map(async path => {
    const image = new Image(); image.src = base + path; await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('no 2D canvas for HUD distance font');
    ctx.drawImage(image, 0, 0);
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  }));
  const renderer = new SDFTextRenderer(); renderer.setFont(font, images); return renderer;
}

/** Keep real text in the accessibility tree, with a decorative canvas alongside.
 * No computed-style reads or pixel work on unchanged frames. Resize/DPR invalidate.
 */
export class SDFLabels {
  private labels = new Map<HTMLElement, { text: string; signature: string; size: number; outline: number;
    color?: Tint; treatment: Readonly<SDFTreatment> }>();
  private renderer?: SDFTextRenderer;
  private disposed = false;
  private scale = 1;
  private dpr = 1;
  readonly ready: Promise<void>;
  constructor(font: SDFFont | null | undefined, base: string) {
    this.ready = font ? loadSDFRenderer(font, base).then(renderer => {
      if (this.disposed) return;
      this.renderer = renderer; this.refresh();
    }).catch(error => { console.warn('HUD distance font unavailable; retaining CSS text', error); }) : Promise.resolve();
  }
  get stats(): SDFTextRenderer['stats'] | undefined { return this.renderer?.stats; }
  resize(scale: number, dpr: number): void {
    if (scale === this.scale && dpr === this.dpr) return;
    this.scale = scale; this.dpr = dpr; this.refresh();
  }
  private refresh(): void {
    for (const [element, label] of this.labels) {
      label.signature = ''; this.set(element, label.text, label.size, label.outline, label.color, label.treatment);
    }
  }
  set(element: HTMLElement, text: string, size: number, outline = 0, tint?: Tint,
    treatment: Readonly<SDFTreatment> = SOURCE_SDF_TREATMENT): void {
    if (this.disposed) return;
    const signature = JSON.stringify([text, size, outline, tint, treatment, this.scale, this.dpr, !!this.renderer]);
    if (this.labels.get(element)?.signature === signature) return;
    this.labels.set(element, { text, size, outline, signature, color: tint, treatment });
    const css = getComputedStyle(element);
    const components = css.color.match(/[\d.]+/g)?.map(Number) ?? [250, 230, 211];
    const color: Tint = tint ?? [components[0], components[1], components[2], components[3] ?? 1];
    const raster = this.renderer?.renderText(text, size * this.scale, color, this.dpr, outline, treatment);
    if (!raster) {
      element.classList.remove('sdf-label'); element.textContent = text; return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = raster.width; canvas.height = raster.height;
    canvas.style.width = `${raster.cssWidth}px`; canvas.style.height = `${raster.cssHeight}px`;
    canvas.setAttribute('aria-hidden', 'true');
    const ctx = canvas.getContext('2d');
    if (!ctx) { element.classList.remove('sdf-label'); element.textContent = text; return; }
    ctx.putImageData(new ImageData(new Uint8ClampedArray(raster.data), raster.width, raster.height), 0, 0);
    const accessible = document.createElement('span');
    accessible.className = 'sdf-accessible'; accessible.textContent = text;
    element.replaceChildren(accessible, canvas); element.classList.add('sdf-label');
  }
  destroy(): void { this.disposed = true; this.labels.clear(); this.renderer?.clearCache(); }
}
