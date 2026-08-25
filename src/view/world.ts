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
export function createGround(state: GameState, assets?: ContentAssets): THREE.Mesh {
  const ground = assets?.terrain?.ground;
  const texture = ground && assets?.textures.get(ground.image);
  const positions: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const light = new THREE.Color(0x6f8f4a);
  const dark = new THREE.Color(0x66854a);
  const [spanX, spanY] = ground?.dimensions ?? [1, 1];
  for (let y = 0; y < state.height; y++) {
    for (let x = 0; x < state.width; x++) {
      const color = (x + y) % 2 === 0 ? light : dark;
      const corners = {
        north: { iso: worldToIso(x, y), u: x / spanX, v: y / spanY },
        east: { iso: worldToIso(x + 1, y), u: (x + 1) / spanX, v: y / spanY },
        south: { iso: worldToIso(x + 1, y + 1), u: (x + 1) / spanX, v: (y + 1) / spanY },
        west: { iso: worldToIso(x, y + 1), u: x / spanX, v: (y + 1) / spanY },
      };
      const { north, east, south, west } = corners;
      for (const [a, b, c] of [[north, east, south], [north, south, west]] as const) {
        for (const corner of [a, b, c]) {
          positions.push(corner.iso.x, corner.iso.y, 0);
          uvs.push(corner.u, corner.v);
          colors.push(color.r, color.g, color.b);
        }
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  if (!texture) geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const material = texture
    ? new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide })
    : new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 0;
  return mesh;
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
    map: texture, transparent: true, depthTest: false, depthWrite: false,
  }));
  return mesh;
}

/**
 * Footprint outline for a building being placed, as the tile square it will
 * actually occupy. In the dimetric projection that square reads as a diamond,
 * so an axis-aligned quad would sit at the wrong angle to the grid and
 * misreport which tiles are covered.
 */
export function createFootprint(half: number): THREE.Mesh {
  const corners = [
    worldToIso(-half, -half),
    worldToIso(half, -half),
    worldToIso(half, half),
    worldToIso(-half, half),
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
      const north = worldToIso(x, y);
      const east = worldToIso(x + 1, y);
      const south = worldToIso(x + 1, y + 1);
      const west = worldToIso(x, y + 1);
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
