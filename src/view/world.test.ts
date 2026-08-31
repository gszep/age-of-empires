import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { worldToIso } from './iso';
import { createFootprint, createGround, createSelectionOutline, createTerrainPatch, insetConvex, updateSelectionOutline } from './world';
import { createGame } from '../sim/game';
import type { ContentAssets } from './assets';

/** Perpendicular distance from a point to the infinite line through a and b. */
const lineDistance = (
  point: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number },
): number => Math.abs((b.x - a.x) * (a.y - point.y) - (a.x - point.x) * (b.y - a.y))
  / Math.hypot(b.x - a.x, b.y - a.y);

const diamond = (hx: number, hy: number) => [
  worldToIso(-hx, -hy), worldToIso(hx, -hy), worldToIso(hx, hy), worldToIso(-hx, hy),
];

describe('insetConvex', () => {
  it('keeps a constant band width on the squashed iso diamond', () => {
    // The iso projection halves the vertical axis, so a naive scale toward the
    // centre would make the band thinner on the steep edges than the flat.
    const outer = diamond(1.5, 1.5);
    const inner = insetConvex(outer, 3);
    for (let edge = 0; edge < 4; edge++) {
      const a = outer[edge];
      const b = outer[(edge + 1) % 4];
      expect(lineDistance(inner[edge], a, b)).toBeCloseTo(3, 5);
      expect(lineDistance(inner[(edge + 1) % 4], a, b)).toBeCloseTo(3, 5);
    }
  });

  it('moves every corner inward, including on a gate-thin box', () => {
    const outer = diamond(2, 0.5);
    const inner = insetConvex(outer, 2.5);
    for (let index = 0; index < 4; index++) {
      expect(Math.hypot(inner[index].x, inner[index].y))
        .toBeLessThan(Math.hypot(outer[index].x, outer[index].y));
    }
  });
});

describe('updateSelectionOutline', () => {
  // The geometry stores Float32, so compare to pixel precision.
  const expectCorner = (mesh: THREE.Mesh, vertex: number, world: { x: number; y: number }) => {
    const positions = mesh.geometry.getAttribute('position');
    const iso = worldToIso(world.x, world.y);
    expect(positions.getX(vertex)).toBeCloseTo(iso.x, 3);
    expect(positions.getY(vertex)).toBeCloseTo(iso.y, 3);
  };

  it('lays the band on the outline box iso diamond', () => {
    const mesh = createSelectionOutline(0xffffff);
    updateSelectionOutline(mesh, { x: 1.6, y: 1.6 });
    // First triangle starts at the box's north corner, in iso pixels.
    expectCorner(mesh, 0, { x: -1.6, y: -1.6 });
    expectCorner(mesh, 1, { x: 1.6, y: -1.6 });
  });

  it('reshapes when a pooled mesh is handed a different building', () => {
    const mesh = createSelectionOutline(0xffffff);
    updateSelectionOutline(mesh, { x: 1.6, y: 1.6 });
    updateSelectionOutline(mesh, { x: 2, y: 0.5 });
    expectCorner(mesh, 0, { x: -2, y: -0.5 });
  });
});


/**
 * Everything that lies flat on the ground is wound the same way, and it is the
 * wrong way round: `worldToIso` negates y, so a tile quad listed
 * north-east-south-west comes out clockwise and is back-facing under the
 * default `FrontSide`. The ground and the footprint set `DoubleSide` and draw;
 * the farm's terrain patch did not, and every farm was invisible (issue #2)
 * with nothing logged and no test failing. This asserts the whole class.
 */
describe('meshes that lie on the ground', () => {
  /** Signed area of the first triangle; negative is clockwise in scene space. */
  const winding = (mesh: THREE.Mesh): number => {
    const position = mesh.geometry.getAttribute('position');
    const [ax, ay] = [position.getX(0), position.getY(0)];
    const [bx, by] = [position.getX(1), position.getY(1)];
    const [cx, cy] = [position.getX(2), position.getY(2)];
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  };

  const groundAssets = (): ContentAssets => {
    const textures = new Map<string, THREE.Texture>();
    const slot = (name: string, image: string, id: number) => {
      const texture = new THREE.DataTexture(new Uint8Array(4 * 4 * 4), 4, 4);
      texture.needsUpdate = true;
      textures.set(image, texture);
      return { name, terrainId: id, texture: name, image, dimensions: [6, 6] as [number, number],
        minimapColor: [160, 159, 158] as [number, number, number] };
    };
    return {
      entities: {},
      terrain: {
        ground: slot('Grass', 'terrain/g_grs.png', 0),
        farm: slot('Farm1', 'terrain/g_fm1.png', 7),
      },
      textures,
      playerRamps: new Map(),
    } as unknown as ContentAssets;
  };

  it('gives surveyed water and roads their own terrain meshes', () => {
    const state = createGame(11);
    state.terrain[0] = 1;
    state.terrain[1] = 24;
    const ground = createGround(state);
    const water = ground.getObjectByName('terrain-water') as THREE.Mesh;
    const road = ground.getObjectByName('terrain-road') as THREE.Mesh;
    expect((water.material as THREE.MeshBasicMaterial).color.getHex()).toBe(0x4f91bd);
    expect((road.material as THREE.MeshBasicMaterial).color.getHex()).toBe(0xb18a58);
  });

  it('raises a surveyed hill while keeping neighbouring tile edges joined', () => {
    const state = createGame(11);
    state.elevation.fill(0);
    state.elevation[0] = 4;
    const ground = createGround(state);
    const positions = (ground.getObjectByName('terrain-ground') as THREE.Mesh)
      .geometry.getAttribute('position');
    expect(positions.getY(0)).toBeGreaterThan(0);
    // East corner of tile 0 is shared with west-side tiles through one averaged
    // vertex height rather than each tile inventing its own cliff edge.
    expect(positions.getY(1)).toBeGreaterThan(worldToIso(1, 0).y);
  });

  it('never leaves a clockwise ground quad on the culled side', () => {
    const assets = groundAssets();
    const ground = createGround(createGame(11), assets);
    const meshes: [string, THREE.Mesh][] = [
      ['ground', ground.children[0] as THREE.Mesh],
      ['farm patch', createTerrainPatch(assets, 'farm', 1.5)!],
      ['footprint', createFootprint(1.5)],
    ];
    for (const [name, mesh] of meshes) {
      expect(mesh, `${name} was not built`).toBeDefined();
      if (winding(mesh) >= 0) continue; // counter-clockwise: FrontSide is fine
      const material = mesh.material as THREE.Material;
      expect(material.side, `${name} is wound clockwise and would be culled`)
        .not.toBe(THREE.FrontSide);
    }
  });

  it('is wound clockwise at all, so the check above is not vacuous', () => {
    // If the projection ever stops flipping y this test fails first, and the
    // one above becomes a check of nothing rather than silently passing.
    expect(winding(createFootprint(1.5))).toBeLessThan(0);
  });
});
