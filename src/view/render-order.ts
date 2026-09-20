/** Keep ground passes below fog and every sprite body above it, independent
 * of map dimensions. Within a ground pass the isometric depth still sorts. */
export const GROUND_FOG_ORDER = 900;
export const groundLayerOrder = (layer: number, depth: number): number =>
  layer + depth / (1 + Math.abs(depth));
