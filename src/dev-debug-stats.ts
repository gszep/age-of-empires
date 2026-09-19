/**
 * Colour statistics over raw RGBA pixel data, for the dev debug protocol.
 * Pure functions so they can be unit-tested in Node without a canvas.
 */

export interface ColorStats {
  /** Pixels examined. */
  pixels: number;
  /** Mean [r, g, b] over opaque pixels (alpha > 0), 0-255 integers. */
  mean: [number, number, number];
  /** Fraction of pixels with alpha > 0. */
  opaque: number;
  /** Dominant colours, quantized to 16 levels per channel, largest first. */
  colors: { hex: string; fraction: number }[];
}

const QUANT = 16; // 4 bits per channel keeps the histogram small but legible

export function colorStats(data: Uint8ClampedArray, topN = 8): ColorStats {
  const total = data.length / 4;
  const histogram = new Map<number, number>();
  let opaque = 0;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    opaque++;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    sumR += r;
    sumG += g;
    sumB += b;
    const key = (Math.floor(r / QUANT) << 8) | (Math.floor(g / QUANT) << 4) | Math.floor(b / QUANT);
    histogram.set(key, (histogram.get(key) ?? 0) + 1);
  }
  const bucketHex = (key: number): string => {
    // Report each bucket by its centre so the hex reads as a real colour.
    const channel = (v: number) => Math.min(255, v * QUANT + QUANT / 2);
    const r = channel((key >> 8) & 0xf);
    const g = channel((key >> 4) & 0xf);
    const b = channel(key & 0xf);
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
  };
  const colors = [...histogram.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([key, count]) => ({ hex: bucketHex(key), fraction: round(count / total) }));
  const mean: [number, number, number] = opaque
    ? [Math.round(sumR / opaque), Math.round(sumG / opaque), Math.round(sumB / opaque)]
    : [0, 0, 0];
  return { pixels: total, mean, opaque: round(opaque / (total || 1)), colors };
}

const round = (value: number): number => Math.round(value * 1000) / 1000;

/** Pixels within `tolerance` per channel of `hex` (e.g. "#0000ff"), as a count and a fraction. */
export function matchCount(data: Uint8ClampedArray, hex: string, tolerance = 8): { matched: number; matchedFraction: number } {
  const value = parseInt(hex.replace('#', ''), 16);
  const target = [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
  let matched = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    if (Math.abs(data[i] - target[0]) <= tolerance
      && Math.abs(data[i + 1] - target[1]) <= tolerance
      && Math.abs(data[i + 2] - target[2]) <= tolerance) matched++;
  }
  return { matched, matchedFraction: round(matched / (data.length / 4 || 1)) };
}

/** Rec. 601 luma, 0-255, of one RGBA pixel. */
const luma = (data: Uint8ClampedArray, i: number): number =>
  0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];

/**
 * How wide a luminance edge is along a line of samples: the distance, in
 * samples, between the points where the profile has moved 10% and 90% of the
 * way from its darker end to its brighter end. What the fog edge, the beach
 * rim and a blend seam are measured by -- previously in numpy over PNGs.
 */
export function edgeWidth(profile: number[]): { low: number; high: number; width: number; rising: boolean } {
  if (profile.length < 2) return { low: 0, high: 0, width: 0, rising: true };
  const ends = Math.max(1, Math.floor(profile.length / 8));
  const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;
  const rising = mean(profile.slice(-ends)) >= mean(profile.slice(0, ends));
  const low = Math.min(...profile);
  const high = Math.max(...profile);
  const span = high - low;
  if (span < 1) return { low: round(low), high: round(high), width: 0, rising };
  // Walk in the direction the edge rises; the width is the samples between
  // the 10% and 90% crossings, so a hard step is 0 wide and a linear ramp
  // over N samples is 0.8 N.
  const ordered = rising ? profile : [...profile].reverse();
  const at = (fraction: number): number => ordered.findIndex(v => v >= low + span * fraction);
  return { low: round(low), high: round(high), width: at(0.9) - at(0.1), rising };
}

/** Luma samples along a line through a captured rect, one per step of one pixel. */
export function lumaProfile(
  data: Uint8ClampedArray, width: number, from: [number, number], to: [number, number],
): number[] {
  const steps = Math.max(1, Math.round(Math.hypot(to[0] - from[0], to[1] - from[1])));
  const out: number[] = [];
  for (let s = 0; s <= steps; s++) {
    const x = Math.round(from[0] + (to[0] - from[0]) * (s / steps));
    const y = Math.round(from[1] + (to[1] - from[1]) * (s / steps));
    out.push(round(luma(data, (y * width + x) * 4)));
  }
  return out;
}
