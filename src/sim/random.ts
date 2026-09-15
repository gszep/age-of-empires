/**
 * Mix a seed so its very first draw is already well spread.
 *
 * `random01` is an xorshift, and an xorshift started from a small integer
 * takes several rounds to reach full entropy: seeded with 1, 2, 7, 42 or 101
 * its *first* output is 0.0001, 0.0001, 0.0004, 0.0026 and 0.0062. Every one
 * of those is the bottom of the range, so the first decision any seed made was
 * effectively the same decision — which is how four different seeds came to
 * deal the same biome. This is SplitMix32's finalising mix, which spreads a
 * counter-like input across the whole word in one step, so the first draw is
 * already as good as the thousandth.
 *
 * Applied both where a stream is derived and to the match seed itself, so no
 * part of a match makes its first decision from the bottom of the range.
 */
export function seedFrom(value: number): number {
  let x = (value | 0) >>> 0;
  x = (x + 0x9e37_79b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0_aaad) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x735a_2d97) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  // The xorshift's one forbidden state.
  return x || 1;
}

export function random01(state: { seed: number }): number {
  let x = state.seed | 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  state.seed = x >>> 0;
  return state.seed / 0x1_0000_0000;
}
