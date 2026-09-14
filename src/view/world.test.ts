import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { worldToIso } from './iso';
import { FARM_TILES_PER_SPAN, FOG_UNSEEN, createFog, createFootprint, createGround, createSelectionOutline, createTerrainPatch, insetConvex, updateSelectionOutline } from './world';
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
        // Priority decides which of two meeting terrains is painted over the
        // other; grass (111) and forest (96) are the DAT's own numbers.
        blendPriority: id === 0 ? 111 : id === 10 ? 96 : 100,
        blendType: 0,
        minimapColor: [160, 159, 158] as [number, number, number] };
    };
    return {
      entities: {},
      terrain: {
        ground: slot('Grass', 'terrain/g_grs.png', 0),
        // The DAT's own differing dimensions for the two farm sheets, which is
        // the thing the farm scale must not be read from.
        farm: { ...slot('Farm1', 'terrain/g_fm1.png', 7), dimensions: [6, 6] as [number, number] },
        'farm-construction': { ...slot('Farm Cnst1', 'terrain/g_fc1.png', 29), dimensions: [3, 3] as [number, number] },
      },
      textures,
      playerRamps: new Map(),
      blends: {
        tile: [97, 49] as [number, number],
        modes: [new THREE.DataTexture(new Uint8Array(4), 1, 1)],
        // The four groups blendomatic's masks measure out to.
        edges: { '+x': [12, 13, 14, 15], '+y': [4, 5, 6, 7], '-x': [0, 1, 2, 3], '-y': [8, 9, 10, 11] },
        // Thirty-one owned masks and the solid column past them.
        masksPerMode: 32,
        solid: 31,
      },
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
    // One ground everywhere, so this stays a test about elevation: a board
    // dressed in a biome puts tile 0 in whichever terrain the roll dealt.
    state.terrain.fill(0);
    const ground = createGround(state);
    const mesh = ground.getObjectByName('terrain-ground') as THREE.Mesh;
    const positions = mesh.geometry.getAttribute('position');
    expect(positions.getY(0)).toBeGreaterThan(0);
    // East corner of tile 0 is shared with west-side tiles through one averaged
    // vertex height rather than each tile inventing its own cliff edge.
    expect(positions.getY(1)).toBeGreaterThan(worldToIso(1, 0).y);
    const colors = mesh.geometry.getAttribute('color');
    const shades = Array.from({ length: colors.count }, (_, index) => colors.getX(index));
    expect(Math.max(...shades) - Math.min(...shades)).toBeGreaterThan(0.1);
    expect((mesh.material as THREE.MeshBasicMaterial).vertexColors).toBe(true);
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

  it('gives a farm the reference\'s own furrow scale, whatever the sheet says', () => {
    // Issue #22: too many rows. `terrain_dimensions` is 6x6 for the grown farm
    // and 3x3 for the one being built, and both sheets carry the same forty
    // furrows across their span -- so reading it as tiles-per-span drew the
    // grown farm at 3/6 of the span (twenty furrows) and the one under
    // construction at 3/3 (forty), halving the pitch the moment it completed.
    // The owner of the reference reports about twelve furrows across a farm,
    // which over three tiles against forty per span is ten tiles to the span.
    // No masks, so the patch is the farm's own tiles with no fading ring
    // around them: this is a test about the furrow scale, not the edge.
    const assets = { ...groundAssets(), blends: undefined } as unknown as ContentAssets;
    const uvSpan = (slot: string) => {
      const uv = createTerrainPatch(assets, slot, 1.5)!.geometry.getAttribute('uv');
      const us = Array.from({ length: uv.count }, (_, i) => uv.getX(i));
      return Math.max(...us) - Math.min(...us);
    };
    // Three tiles of a ten-tile span, so forty furrows to the span show twelve.
    expect(uvSpan('farm')).toBeCloseTo(3 / FARM_TILES_PER_SPAN, 6);
    expect(40 * uvSpan('farm')).toBeCloseTo(12, 6);
    // And the ground does not change pitch when the crop comes up.
    expect(uvSpan('farm-construction')).toBeCloseTo(uvSpan('farm'), 6);
  });

  it('samples a farm by where it stands, so two are not one picture twice', () => {
    // Every farm drew the identical corner of the sheet, bringing the
    // thirty-six authored frames down to one arrangement.
    const assets = { ...groundAssets(), blends: undefined } as unknown as ContentAssets;
    const first = createTerrainPatch(assets, 'farm', 1.5, { x: 9, y: 12 })!.geometry.getAttribute('uv');
    const second = createTerrainPatch(assets, 'farm', 1.5, { x: 21, y: 30 })!.geometry.getAttribute('uv');
    // The sheet is laid a quarter turn round, so u follows world y and v world x.
    expect(first.getX(0)).toBeCloseTo(12 / FARM_TILES_PER_SPAN, 6);
    expect(second.getX(0)).toBeCloseTo(30 / FARM_TILES_PER_SPAN, 6);
    const differs = Array.from({ length: first.count }, (_, i) =>
      Math.abs(first.getX(i) - second.getX(i)) > 1e-6 || Math.abs(first.getY(i) - second.getY(i)) > 1e-6);
    expect(differs.every(Boolean)).toBe(true);
    // Same ground, same picture: the patch is a function of where it stands.
    const again = createTerrainPatch(assets, 'farm', 1.5, { x: 9, y: 12 })!.geometry.getAttribute('uv');
    expect(again.getX(0)).toBeCloseTo(first.getX(0), 6);
  });

  it('ploughs the farm across the axis the reference ploughs', () => {
    // The furrows in `g_fm1` run along one world axis and the reference runs
    // them along the other, so the sheet is sampled a quarter turn round: u
    // follows world y and v world x. On screen that swaps which diagonal of
    // the diamond the furrows lie along -- a 90 degree turn in world space,
    // which the dimetric projection shows as the other axis of the diamond
    // rather than as a right angle.
    const assets = { ...groundAssets(), blends: undefined } as unknown as ContentAssets;
    const uv = createTerrainPatch(assets, 'farm', 1.5, { x: 4, y: 7 })!.geometry.getAttribute('uv');
    // North corner of the patch: world (4,7) -> u from y, v from x.
    expect(uv.getX(0)).toBeCloseTo(7 / FARM_TILES_PER_SPAN, 6);
    expect(uv.getY(0)).toBeCloseTo(-4 / FARM_TILES_PER_SPAN, 6);
    // Read the first triangle of the first tile straight off the mesh: its
    // three vertices are the tile corners (0,0), (1,0) and (1,1) in world
    // tiles. Stepping one tile along world x must move v and leave u alone,
    // and along world y the other way about. That is what makes it a turn
    // rather than a scale, and it is read back rather than recomputed.
    const corner = (i: number) => ({ u: uv.getX(i), v: uv.getY(i) });
    const [origin, alongX, alongXY] = [corner(0), corner(1), corner(2)];
    expect(alongX.u).toBeCloseTo(origin.u, 6);
    expect(alongX.v).toBeCloseTo(origin.v - 1 / FARM_TILES_PER_SPAN, 6);
    expect(alongXY.u).toBeCloseTo(origin.u + 1 / FARM_TILES_PER_SPAN, 6);
    expect(alongXY.v).toBeCloseTo(alongX.v, 6);
    // Turning it does not change how many furrows cross the farm: both spans
    // are square, so the count is the same either way round.
    const us = Array.from({ length: uv.count }, (_, i) => uv.getX(i));
    expect(Math.max(...us) - Math.min(...us)).toBeCloseTo(3 / FARM_TILES_PER_SPAN, 6);
  });

  it('grades the fog across a boundary instead of stepping at the tile edge', () => {
    // A tile shaded flat carries one alpha on both its triangles, so every
    // fog boundary is a hard diamond edge. Averaging the up-to-four tiles that
    // meet at a corner lets the GPU interpolate across the quad.
    const state = createGame(11);
    const visibility = state.visibility[1];
    visibility.visible.fill(0);
    visibility.explored.fill(0);
    // A 3x3 block of seen tiles in a never-seen field, so there is an interior
    // corner as well as a boundary.
    const at = (x: number, y: number) => y * state.width + x;
    for (let y = 4; y <= 6; y++) for (let x = 4; x <= 6; x++) {
      visibility.visible[at(x, y)] = 1;
      visibility.explored[at(x, y)] = 1;
    }

    const fog = createFog(state);
    fog.update(state);
    const colors = (fog.mesh.geometry.getAttribute('color') as THREE.BufferAttribute);
    const alphasOf = (x: number, y: number) => {
      const first = (y * state.width + x) * 6;
      return Array.from({ length: 6 }, (_, i) => colors.getW(first + i));
    };

    // Every corner of the middle tile is surrounded by seen ground, so it is
    // still completely clear -- the gradient must not wash into the interior.
    const centre = alphasOf(5, 5);
    for (const alpha of centre) expect(alpha).toBeCloseTo(0, 6);

    // The tile on the block's edge is graded: its inner corners are clear and
    // its outer ones carry some of the dark beyond.
    const edge = alphasOf(6, 5);
    expect(Math.min(...edge)).toBeCloseTo(0, 6);
    expect(Math.max(...edge)).toBeGreaterThan(0.2);
    // And the first unseen tile out is graded the other way, rather than
    // snapping straight to full dark.
    const beyond = alphasOf(7, 5);
    expect(Math.min(...beyond)).toBeLessThan(FOG_UNSEEN - 0.05);
    expect(Math.max(...beyond)).toBeCloseTo(FOG_UNSEEN, 6);
    for (const alpha of [...centre, ...edge, ...beyond]) {
      expect(alpha).toBeGreaterThanOrEqual(0);
      expect(alpha).toBeLessThanOrEqual(FOG_UNSEEN + 1e-6);
    }

    // Far from anything seen it is still the flat unseen level, so the
    // gradient is local to the boundary and the rest is untouched.
    const far = alphasOf(state.width - 2, state.height - 2);
    for (const alpha of far) expect(alpha).toBeCloseTo(FOG_UNSEEN, 6);
  });

  it('leaves the map border as dark as the tiles inside it', () => {
    // Corners on the edge average only the tiles that exist; counting the
    // void beyond as unseen would draw a dark rim round the whole board.
    const state = createGame(11);
    state.visibility[1].visible.fill(1);
    state.visibility[1].explored.fill(1);
    const fog = createFog(state);
    fog.update(state);
    const colors = fog.mesh.geometry.getAttribute('color') as THREE.BufferAttribute;
    for (let i = 0; i < colors.count; i++) expect(colors.getW(i)).toBeCloseTo(0, 6);
  });

  it('fades a terrain into its lower-priority neighbour', () => {
    // Issue #42. A boundary used to stop at the tile edge. The higher
    // `blend_priority` terrain is now drawn over its neighbour through one of
    // blendomatic's own masks, in the mesh's second UV set.
    const state = createGame(11);
    state.terrain.fill(10);                       // forest, priority 96
    const at = (x: number, y: number) => y * state.width + x;
    state.terrain[at(5, 5)] = 0;                  // one tile of grass, priority 111
    const ground = createGround(state, groundAssets());
    const blend = ground.getObjectByName('blend-ground') as THREE.Mesh;
    expect(blend, 'grass should bleed into the forest around it').toBeDefined();
    // Four neighbours take the blend, two triangles each, three vertices.
    expect(blend.geometry.getAttribute('position').count).toBe(4 * 2 * 3);
    // The mask rides in uv1 while the terrain keeps uv.
    const uv1 = blend.geometry.getAttribute('uv1');
    expect(uv1).toBeDefined();
    const us = Array.from({ length: uv1.count }, (_, i) => uv1.getX(i));
    // Every mask column lies inside the atlas, and none spans the whole of it.
    expect(Math.min(...us)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...us)).toBeLessThanOrEqual(1);
    expect(Math.max(...us) - Math.min(...us)).toBeLessThan(0.5);
    const material = blend.material as THREE.MeshBasicMaterial;
    expect(material.alphaMap).toBeTruthy();
    expect(material.transparent).toBe(true);
    // Above the ground it fades into, below anything standing on it.
    expect(blend.renderOrder).toBeGreaterThan(0);
  });

  it('draws no blend where nothing out-ranks anything', () => {
    // One terrain everywhere, and a neighbour of equal priority, are both
    // edges with nothing to fade: the pass must not emit geometry for them.
    const state = createGame(11);
    state.terrain.fill(0);
    const flat = createGround(state, groundAssets());
    expect(flat.children.some(child => child.name.startsWith('blend-'))).toBe(false);
    // Forest beside forest is the same terrain; still nothing.
    state.terrain.fill(10);
    expect(createGround(state, groundAssets()).children
      .some(child => child.name.startsWith('blend-'))).toBe(false);
  });

  it('bleeds a farm into the ground around it', () => {
    // A farm out-ranks the ground it sits in (186 against grass's 111), so in
    // the reference it fades outward through the same masks a terrain edge
    // uses instead of stopping at its own footprint.
    const assets = groundAssets();
    const plain = { ...assets, blends: undefined } as unknown as ContentAssets;
    const bare = createTerrainPatch(plain, 'farm', 1.5, { x: 9, y: 12 })!;
    const fading = createTerrainPatch(assets, 'farm', 1.5, { x: 9, y: 12 })!;
    const quads = (mesh: THREE.Mesh) => mesh.geometry.getAttribute('position').count / 6;
    expect(quads(bare)).toBe(9);
    // Nine tiles of farm, plus the four sides of the ring; the four diagonal
    // tiles touch only at a corner and are left out.
    expect(quads(fading)).toBe(9 + 4 * 3);
    // The farm's own tiles stay solid and only the ring is masked, which is
    // what the extra column in the atlas is for.
    const uv1 = fading.geometry.getAttribute('uv1');
    const columns = assets.blends!.masksPerMode;
    const solid = assets.blends!.solid;
    const us = Array.from({ length: uv1.count }, (_, i) => uv1.getX(i));
    const solidVertices = us.filter(u => u >= solid / columns).length;
    expect(solidVertices).toBe(9 * 6);
    expect((fading.material as THREE.MeshBasicMaterial).alphaMap).toBeTruthy();
    // And with no masks there is no ring and nothing to mask with.
    expect((bare.material as THREE.MeshBasicMaterial).alphaMap).toBeFalsy();
  });

  it('is wound clockwise at all, so the check above is not vacuous', () => {
    // If the projection ever stops flipping y this test fails first, and the
    // one above becomes a check of nothing rather than silently passing.
    expect(winding(createFootprint(1.5))).toBeLessThan(0);
  });
});
