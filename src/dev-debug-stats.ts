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
