import * as THREE from 'three/webgpu';
import { TILE_W, TILE_H, worldToIso } from './iso';
import type { ContentAssets } from './assets';
import type { GameState } from '../sim/types';

/**
 * Ground plane in the dimetric projection. With imported content the DAT's
 * terrain texture is sampled in world-tile space, so one repeat spans the
 * authored `dimensions` tiles (10x10 for Grass) and the surface stays
 * continuous across tile edges. Without it, a two-tone diamond grid stands in.
 */
// One terrain level uses the same vertical scale as one world-height unit for
// projectiles: half a tile face in this dimetric projection.
export const ELEVATION_PIXELS = TILE_H / 2;

/** Height at a world point, in authored levels. Tile means are deliberately
 * sampled rather than invented slopes for entities; ground vertices average
 * their adjacent means so every tile shares exactly the same edge. */
export function elevationAt(state: GameState, x: number, y: number): number {
  const tx = Math.max(0, Math.min(state.width - 1, Math.floor(x)));
  const ty = Math.max(0, Math.min(state.height - 1, Math.floor(y)));
  return state.elevation?.[ty * state.width + tx] ?? 0;
}

export function elevatedWorldToIso(state: GameState, x: number, y: number) {
  const iso = worldToIso(x, y);
  return { x: iso.x, y: iso.y + elevationAt(state, x, y) * ELEVATION_PIXELS };
}

function cornerElevation(state: GameState, x: number, y: number): number {
  let total = 0;
  let count = 0;
  for (const ty of [y - 1, y]) for (const tx of [x - 1, x]) {
    if (tx < 0 || ty < 0 || tx >= state.width || ty >= state.height) continue;
    total += state.elevation?.[ty * state.width + tx] ?? 0;
    count++;
  }
  return count ? total / count : 0;
}

/** One mesh per terrain class, hence four draw calls regardless of board size.
 * Each consumes the owned DAT texture for its surveyed OS class. */
export function createGround(state: GameState, assets?: ContentAssets): THREE.Group {
  const classes = [
    { key: 'ground', ids: new Set([0]), fallback: 0x6f8f4a },
    { key: 'forest', ids: new Set([10]), fallback: 0x315f35 },
    { key: 'water', ids: new Set([1]), fallback: 0x4f91bd },
    { key: 'road', ids: new Set([24]), fallback: 0xb18a58 },
  ];
  const buckets = classes.map(() => ({
    positions: [] as number[], uvs: [] as number[], colors: [] as number[],
  }));
  const maxElevation = state.elevation?.reduce((highest, level) => Math.max(highest, level), 0) ?? 0;
  const shadeAt = (x: number, y: number): number => {
    const sample = (px: number, py: number) => cornerElevation(
      state, Math.max(0, Math.min(state.width, px)), Math.max(0, Math.min(state.height, py)),
    );
    const level = sample(x, y);
    // Geometry provides the rise. This restrained north-west hillshade and
    // altitude tone merely make broad slopes legible in an otherwise unlit,
    // orthographic scene instead of letting the texture read as a flat sheet.
    const across = sample(x - 1, y) - sample(x + 1, y);
    const down = sample(x, y - 1) - sample(x, y + 1);
    const altitude = maxElevation ? level / maxElevation * 0.16 : 0.16;
    return Math.max(0.68, Math.min(1, 0.82 + altitude + (across + down) * 0.035));
  };
  for (let y = 0; y < state.height; y++) {
    for (let x = 0; x < state.width; x++) {
      const terrain = state.terrain[y * state.width + x] ?? 0;
      const category = Math.max(0, classes.findIndex(entry => entry.ids.has(terrain)));
      const slot = assets?.terrain?.[classes[category].key];
      const [spanX, spanY] = slot?.dimensions ?? [1, 1];
      const point = (px: number, py: number) => {
        const iso = worldToIso(px, py);
        iso.y += cornerElevation(state, px, py) * ELEVATION_PIXELS;
        return { iso, u: px / spanX, v: py / spanY, shade: shadeAt(px, py) };
      };
      const [north, east, south, west] = [
        point(x, y), point(x + 1, y), point(x + 1, y + 1), point(x, y + 1),
      ];
      const bucket = buckets[category];
      for (const [a, b, c] of [[north, east, south], [north, south, west]] as const) {
        for (const corner of [a, b, c]) {
          bucket.positions.push(corner.iso.x, corner.iso.y, 0);
          bucket.uvs.push(corner.u, corner.v);
          bucket.colors.push(corner.shade, corner.shade, corner.shade);
        }
      }
    }
  }
  const group = new THREE.Group();
  classes.forEach((entry, index) => {
    if (!buckets[index].positions.length) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(buckets[index].positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(buckets[index].uvs, 2));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(buckets[index].colors, 3));
    const slot = assets?.terrain?.[entry.key];
    const texture = slot && assets?.textures.get(slot.image);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
      ...(texture ? { map: texture } : { color: entry.fallback }),
      vertexColors: true, side: THREE.DoubleSide,
    }));
    mesh.renderOrder = 0;
    mesh.name = `terrain-${entry.key}`;
    group.add(mesh);
  });
  return group;
}

/**
 * Farms are terrain in AoE2DE, not sprites: the DAT points at terrain slots
 * (`Farm1`, `Farm Cnst1`) and there is no farm SLD to import. Draw one as its
 * own patch of the isometric grid so it sits flat on the ground like the real
 * game, tiled at the slot's authored span.
 */
export function createTerrainPatch(
  assets: ContentAssets | undefined, slot: string, half: number,
): THREE.Mesh | undefined {
  const terrain = assets?.terrain?.[slot];
  const texture = terrain && assets?.textures.get(terrain.image);
  if (!terrain || !texture) return undefined;
  const [spanX, spanY] = terrain.dimensions;
  const positions: number[] = [];
  const uvs: number[] = [];
  const tiles = Math.max(1, Math.round(half * 2));
  for (let y = 0; y < tiles; y++) {
    for (let x = 0; x < tiles; x++) {
      const corners = [
        { p: worldToIso(x, y), u: x / spanX, v: y / spanY },
        { p: worldToIso(x + 1, y), u: (x + 1) / spanX, v: y / spanY },
        { p: worldToIso(x + 1, y + 1), u: (x + 1) / spanX, v: (y + 1) / spanY },
        { p: worldToIso(x, y + 1), u: x / spanX, v: (y + 1) / spanY },
      ];
      for (const [a, b, c] of [[0, 1, 2], [0, 2, 3]] as const) {
        for (const index of [a, b, c]) {
          positions.push(corners[index].p.x, corners[index].p.y, 0);
          uvs.push(corners[index].u, corners[index].v);
        }
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    // Double-sided like the ground: `worldToIso` winds a tile quad clockwise,
    // so a ground-lying mesh left on the default FrontSide is back-face culled
    // and simply never appears (issue #2 -- every farm was invisible).
    map: texture, transparent: true, depthTest: false, depthWrite: false,
    side: THREE.DoubleSide,
  }));
  return mesh;
}

/**
 * Footprint outline for a building being placed, as the tile square it will
 * actually occupy. In the dimetric projection that square reads as a diamond,
 * so an axis-aligned quad would sit at the wrong angle to the grid and
 * misreport which tiles are covered.
 */
export function createFootprint(half: number | { x: number; y: number }): THREE.Mesh {
  const { x, y } = typeof half === 'number' ? { x: half, y: half } : half;
  const corners = [
    worldToIso(-x, -y),
    worldToIso(x, -y),
    worldToIso(x, y),
    worldToIso(-x, y),
  ];
  const positions: number[] = [];
  for (const [a, b, c] of [[0, 1, 2], [0, 2, 3]] as const) {
    for (const index of [a, b, c]) positions.push(corners[index].x, corners[index].y, 0);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    transparent: true, opacity: 0.35, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
  }));
  mesh.renderOrder = 5900;
  return mesh;
}

/**
 * AoE2 marks a selected building or resource by drawing its outline box on the
 * ground, not a circle: the DAT gives every non-unit an obstruction box
 * (`outline_size`, often a shade larger than the collision box) and the marker
 * is that box's iso diamond as a thin band.
 */
const SELECTION_OUTLINE_WIDTH = 2.5;

/**
 * Inset a convex polygon around the origin by `width`: each edge is pushed
 * toward the centre and neighbouring edges re-intersected, so the band between
 * the two rings has constant screen width even on the squashed iso diamond.
 */
export function insetConvex(
  points: { x: number; y: number }[], width: number,
): { x: number; y: number }[] {
  const count = points.length;
  const edges = points.map((from, index) => {
    const to = points[(index + 1) % count];
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy) || 1;
    let nx = dy / length;
    let ny = -dx / length;
    const midX = (from.x + to.x) / 2;
    const midY = (from.y + to.y) / 2;
    if (nx * midX + ny * midY > 0) { nx = -nx; ny = -ny; }
    return { px: from.x + nx * width, py: from.y + ny * width, dx, dy };
  });
  return points.map((_, index) => {
    const into = edges[(index + count - 1) % count];
    const out = edges[index];
    const det = into.dx * out.dy - into.dy * out.dx;
    if (Math.abs(det) < 1e-6) return { x: out.px, y: out.py };
    const t = ((out.px - into.px) * out.dy - (out.py - into.py) * out.dx) / det;
    return { x: into.px + t * into.dx, y: into.py + t * into.dy };
  });
}

export function createSelectionOutline(color: number): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(8 * 3 * 3), 3));
  return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    color, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
  }));
}

/** Reshape a pooled outline to `half` extents; a no-op while they hold. */
export function updateSelectionOutline(mesh: THREE.Mesh, half: { x: number; y: number }): void {
  const shape = `${half.x},${half.y}`;
  if (mesh.userData.outlineShape === shape) return;
  mesh.userData.outlineShape = shape;
  const outer = [
    worldToIso(-half.x, -half.y), worldToIso(half.x, -half.y),
    worldToIso(half.x, half.y), worldToIso(-half.x, half.y),
  ];
  const inner = insetConvex(outer, SELECTION_OUTLINE_WIDTH);
  const positions = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
  let vertex = 0;
  const put = (point: { x: number; y: number }) => positions.setXYZ(vertex++, point.x, point.y, 0);
  for (let corner = 0; corner < 4; corner++) {
    const next = (corner + 1) % 4;
    put(outer[corner]); put(outer[next]); put(inner[next]);
    put(outer[corner]); put(inner[next]); put(inner[corner]);
  }
  positions.needsUpdate = true;
}

export interface FogLayer {
  mesh: THREE.Mesh;
  update(state: GameState): void;
}

/** Per-tile fog quad-grid: unexplored is black, explored-not-visible dimmed. */
export function createFog(state: GameState): FogLayer {
  const size = state.width * state.height;
  const positions = new Float32Array(size * 6 * 3);
  const alphas = new Float32Array(size * 6);
  let offset = 0;
  for (let y = 0; y < state.height; y++) {
    for (let x = 0; x < state.width; x++) {
      const raised = (px: number, py: number) => {
        const iso = worldToIso(px, py);
        iso.y += cornerElevation(state, px, py) * ELEVATION_PIXELS;
        return iso;
      };
      const north = raised(x, y);
      const east = raised(x + 1, y);
      const south = raised(x + 1, y + 1);
      const west = raised(x, y + 1);
      for (const p of [north, east, south, north, south, west]) {
        positions[offset * 3] = p.x;
        positions[offset * 3 + 1] = p.y;
        positions[offset * 3 + 2] = 0;
        offset++;
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  // Black overlay with per-vertex RGBA alpha: unexplored opaque, fogged dim.
  const colorAttribute = new THREE.BufferAttribute(new Float32Array(size * 6 * 4), 4);
  geometry.setAttribute('color', colorAttribute);
  void alphas;
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide }),
  );
  mesh.renderOrder = 5000;

  const update = (current: GameState) => {
    const visibility = current.visibility[1];
    const colors = colorAttribute.array as Float32Array;
    for (let index = 0; index < size; index++) {
      const alpha = visibility.visible[index] ? 0 : visibility.explored[index] ? 0.45 : 0.97;
      for (let vertex = 0; vertex < 6; vertex++) {
        const base = (index * 6 + vertex) * 4;
        colors[base] = 0;
        colors[base + 1] = 0;
        colors[base + 2] = 0;
        colors[base + 3] = alpha;
      }
    }
    colorAttribute.needsUpdate = true;
  };
  update(state);
  return { mesh, update };
}

export const mapPixelSize = (state: GameState) => ({
  width: (state.width + state.height) * (TILE_W / 2),
  height: (state.width + state.height) * (TILE_H / 2),
});
