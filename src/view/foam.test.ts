import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { createGame } from '../sim/game';
import { TERRAIN_BEACH, TERRAIN_WATER } from '../sim/mapgen';
import type { ContentAssets } from './assets';
import { createFoam } from './foam';
import { TILE_H, TILE_W, worldToIso } from './iso';

const foamAssets = (): ContentAssets => {
  const textures = new Map<string, THREE.Texture>();
  const diag = [1, 2, 3, 4].map(i => `water/foam/atlas_v1_diag_${i}.png`);
  const ortho = [1, 2, 3, 4].map(i => `water/foam/atlas_v1_ortho_${i}.png`);
  for (const image of [...diag, ...ortho]) textures.set(image, new THREE.Texture());
  return { textures, foam: { diag, ortho, frameSize: 256, framesPerRow: 8 } } as unknown as ContentAssets;
};

const quadsOf = (foam: THREE.Group) => {
  const mesh = foam.getObjectByName('foam') as THREE.Mesh;
  const position = mesh.geometry.getAttribute('position');
  const uv = mesh.geometry.getAttribute('uv');
  const kind = mesh.geometry.getAttribute('kind');
  const quads = [];
  for (let i = 0; i < position.count; i += 6) {
    quads.push({
      xs: [0, 1, 2, 5].map(k => position.getX(i + k)), ys: [0, 1, 2, 5].map(k => position.getY(i + k)),
      uvs: [0, 1, 2, 5].map(k => [uv.getX(i + k), uv.getY(i + k)]), kind: kind.getX(i),
    });
  }
  return quads;
};

describe('shore foam', () => {
  it('draws one frame in the water tile\'s own screen rectangle per shore edge, turned to the land\'s side', () => {
    // Issue #89. The frame's crest arrives 82 texels from its centre, which
    // in the tile's 96x48 rectangle is three pixels short of the tile edge;
    // unturned it serves land at +x, and the other sides are the frame
    // turned over. Land on two adjacent sides with water on the flanking
    // diagonals is a stair-step, drawn once with the `ortho` crest.
    const state = createGame(11);
    state.terrain.fill(TERRAIN_WATER);
    const at = (x: number, y: number) => y * state.width + x;
    for (let y = 0; y < state.height; y++) for (let x = 0; x < state.width; x++) {
      // A land quadrant, and a stair-stepped shore across the top-left corner.
      if ((x >= 20 && y >= 20) || x + y <= 10) state.terrain[at(x, y)] = TERRAIN_BEACH;
    }
    const foam = createFoam(state, foamAssets())!;
    const quads = quadsOf(foam);
    const rect = (x: number, y: number) => {
      const c = worldToIso(x + 0.5, y + 0.5);
      return quads.filter(q => q.xs[0] === c.x - TILE_W / 2 && q.ys[0] === c.y - TILE_H / 2);
    };
    // (19, 25): land at +x alone, the frame unturned in the tile's rectangle.
    const plusX = rect(19, 25);
    expect(plusX).toHaveLength(1);
    const c = worldToIso(19.5, 25.5);
    expect(plusX[0].xs).toEqual([c.x - TILE_W / 2, c.x + TILE_W / 2, c.x + TILE_W / 2, c.x - TILE_W / 2]);
    expect(plusX[0].ys).toEqual([c.y - TILE_H / 2, c.y - TILE_H / 2, c.y + TILE_H / 2, c.y + TILE_H / 2]);
    expect(plusX[0].kind).toBeLessThan(4);
    expect(plusX[0].uvs).toEqual([[0, 1], [1, 1], [1, 0], [0, 0]]);
    // (25, 19): land at +y alone, the frame mirrored left to right.
    const plusY = rect(25, 19);
    expect(plusY).toHaveLength(1);
    expect(plusY[0].uvs.map(([u]) => u)).toEqual([1, 0, 0, 1]);
    expect(plusY[0].uvs.map(([, v]) => v)).toEqual([1, 1, 0, 0]);
    // (19, 19): land on the diagonal only, no shore edge, no frame.
    expect(rect(19, 19)).toHaveLength(0);
    // (5, 6): land on -x and -y with water on the flanks, a stair-step with
    // the land above: one `ortho` frame turned over, its arrival at the top.
    const above = rect(5, 6);
    expect(above).toHaveLength(1);
    expect(above[0].kind).toBeGreaterThanOrEqual(4);
    expect(above[0].uvs.map(([, v]) => v)).toEqual([0, 0, 1, 1]);
    expect((foam.getObjectByName('foam') as THREE.Mesh).renderOrder).toBe(400);
  });

  it('leaves a tile tucked into a corner, and a one-tile channel, without foam', () => {
    // The reference's cove and inward bend carry none.
    const state = createGame(11);
    state.terrain.fill(TERRAIN_BEACH);
    const at = (x: number, y: number) => y * state.width + x;
    // An L-shaped pond: (10, 10) is its corner, tucked in with land on +x,
    // +y and both flanking diagonals... and the arms are one-tile channels.
    for (const [x, y] of [[10, 10], [9, 10], [8, 10], [10, 9], [10, 8]]) state.terrain[at(x, y)] = TERRAIN_WATER;
    expect(createFoam(state, foamAssets())).toBeUndefined();
    // Widen the pond to two tiles and its outer edges are shore again.
    for (const [x, y] of [[9, 9], [8, 9], [9, 8]]) state.terrain[at(x, y)] = TERRAIN_WATER;
    expect(createFoam(state, foamAssets())).toBeDefined();
  });

  it('turns a side-stepped run a quarter, with the roll arriving at the land\'s side', () => {
    const state = createGame(11);
    state.terrain.fill(TERRAIN_WATER);
    const at = (x: number, y: number) => y * state.width + x;
    // Land down-left and up-left of (10, 10): a shore stepped down the screen with the land on the left.
    state.terrain[at(11, 10)] = TERRAIN_BEACH;
    state.terrain[at(10, 9)] = TERRAIN_BEACH;
    const quads = quadsOf(createFoam(state, foamAssets())!);
    const c = worldToIso(10.5, 10.5);
    const left = quads.find(q => q.kind >= 4 && q.xs[0] === c.x - TILE_W / 2)!;
    expect(left).toBeDefined();
    // The roll's v runs along screen x, 1 at the left edge; the crest's u along screen y.
    expect(left.uvs).toEqual([[0, 1], [0, 0], [1, 0], [1, 1]]);
  });

  it('rolls a coast together: neighbouring tiles are a fiftieth of the roll apart', () => {
    // A coin per tile made each tile's crest leap on its own; the reference
    // shows a stretch at one point of the roll.
    const state = createGame(11);
    state.terrain.fill(TERRAIN_WATER);
    const at = (x: number, y: number) => y * state.width + x;
    for (let y = 5; y < 15; y++) state.terrain[at(20, y)] = TERRAIN_BEACH;   // a straight shore along y
    const mesh = createFoam(state, foamAssets())!.getObjectByName('foam') as THREE.Mesh;
    const phase = mesh.geometry.getAttribute('phase');
    const kind = mesh.geometry.getAttribute('kind');
    const position = mesh.geometry.getAttribute('position');
    // The water tiles at x = 19, land at +x: one quad each; read their phases in y order.
    const phases: number[] = [];
    for (let y = 5; y < 15; y++) {
      const c = worldToIso(19.5, y + 0.5);
      for (let i = 0; i < position.count; i += 6) {
        if (Math.abs(position.getX(i) - (c.x - TILE_W / 2)) < 1e-3 && Math.abs(position.getY(i) - (c.y - TILE_H / 2)) < 1e-3) {
          phases.push(phase.getX(i));
          break;
        }
      }
    }
    expect(phases.length).toBeGreaterThan(5);
    for (let i = 1; i < phases.length; i++) {
      const step = ((phases[i] - phases[i - 1]) % 1 + 1) % 1;
      expect(step).toBeCloseTo(1 / 50, 6);
    }
    // And the pair holds along a dozen tiles.
    expect(new Set(Array.from({ length: kind.count }, (_, i) => kind.getX(i))).size).toBeLessThanOrEqual(2);
  });

  it('is nothing without the atlases or a shore', () => {
    const state = createGame(11);
    state.terrain.fill(TERRAIN_WATER);
    expect(createFoam(state, foamAssets())).toBeUndefined();
    state.terrain[0] = TERRAIN_BEACH;
    expect(createFoam(state, undefined)).toBeUndefined();
    expect(createFoam(state, foamAssets())).toBeDefined();
  });
});
