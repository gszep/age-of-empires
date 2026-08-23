import * as THREE from 'three/webgpu';
import { TILE_W, TILE_H, worldToIso } from './iso';
import type { GameState } from '../sim/types';

/** Two-tone grass diamond grid (terrain textures are not imported yet). */
export function createGround(state: GameState): THREE.Mesh {
  const positions: number[] = [];
  const colors: number[] = [];
  const light = new THREE.Color(0x6f8f4a);
  const dark = new THREE.Color(0x66854a);
  for (let y = 0; y < state.height; y++) {
    for (let x = 0; x < state.width; x++) {
      const color = (x + y) % 2 === 0 ? light : dark;
      const north = worldToIso(x, y);
      const east = worldToIso(x + 1, y);
      const south = worldToIso(x + 1, y + 1);
      const west = worldToIso(x, y + 1);
      for (const [a, b, c] of [[north, east, south], [north, south, west]] as const) {
        positions.push(a.x, a.y, 0, b.x, b.y, 0, c.x, c.y, 0);
        for (let i = 0; i < 3; i++) colors.push(color.r, color.g, color.b);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  mesh.renderOrder = 0;
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
