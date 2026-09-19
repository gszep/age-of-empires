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
    // turned over.
    const state = createGame(11);
    state.terrain.fill(TERRAIN_BEACH);
    const at = (x: number, y: number) => y * state.width + x;
    state.terrain[at(10, 10)] = TERRAIN_WATER;
    state.terrain[at(11, 10)] = TERRAIN_WATER;   // so (10, 10) has water at +x: land on -x, +y, -y
    const foam = createFoam(state, foamAssets())!;
    const quads = quadsOf(foam);
    // (10, 10): land on -x and -y is a stepped run above, plus +y alone;
    // (11, 10): +x and +y below, plus -y alone.
    expect(quads).toHaveLength(4);
    const c = worldToIso(10.5, 10.5);
    const first = quads.find(q => q.xs[0] === c.x - TILE_W / 2 && q.ys[0] === c.y - TILE_H / 2)!;
    expect(first).toBeDefined();
    expect(first.xs).toEqual([c.x - TILE_W / 2, c.x + TILE_W / 2, c.x + TILE_W / 2, c.x - TILE_W / 2]);
    expect(first.ys).toEqual([c.y - TILE_H / 2, c.y - TILE_H / 2, c.y + TILE_H / 2, c.y + TILE_H / 2]);
    const kinds = quads.map(q => q.kind);
    // Two ortho (4+) and two diag (0 or 2) frames.
    expect(kinds.filter(k => k >= 4)).toHaveLength(2);
    expect(kinds.filter(k => k < 4)).toHaveLength(2);
    // Land above: the ortho frame turned over, its arrival (v = 1) at the top.
    const above = quads.filter(q => q.kind >= 4).find(q => q.xs[0] === c.x - TILE_W / 2)!;
    expect(above.uvs.map(([, v]) => v)).toEqual([0, 0, 1, 1]);
    // Land at +y on (10, 10): the diag frame mirrored left to right.
    const plusY = quads.filter(q => q.kind < 4).find(q => q.xs[0] === c.x - TILE_W / 2)!;
    expect(plusY.uvs.map(([u]) => u)).toEqual([1, 0, 0, 1]);
    expect(plusY.uvs.map(([, v]) => v)).toEqual([1, 1, 0, 0]);
    expect((foam.getObjectByName('foam') as THREE.Mesh).renderOrder).toBe(400);
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
