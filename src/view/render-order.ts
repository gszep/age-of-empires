/** Each pass occupies (layer - 1, layer + 1), independent of map dimensions.
 * Keep the existing pass bases; monotonically compress the old within-pass
 * key, including piece offsets, so its relative order cannot spill into fog,
 * contours or presentation overlays. Do not add offsets after compression.
 */
export const GROUND_FOG_ORDER = 900;
export const groundLayerOrder = (layer: number, depth: number): number =>
  layer + depth / (1 + Math.abs(depth));

export const spriteLayerOrder = (depth: number, piece = 0): number =>
  groundLayerOrder(1000, depth * 10 + piece);
export const projectileLayerOrder = (depth: number): number => groundLayerOrder(4000, depth);
export const contourLayerOrder = (depth: number): number => groundLayerOrder(4500, depth);
export const rallyLayerOrder = (depth: number, piece = 0): number => groundLayerOrder(4600, depth + piece);
