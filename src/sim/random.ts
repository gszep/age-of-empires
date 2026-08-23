export function random01(state: { seed: number }): number {
  let x = state.seed | 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  state.seed = x >>> 0;
  return state.seed / 0x1_0000_0000;
}
