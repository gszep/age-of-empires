import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { worldToIso } from './iso';
import { FARM_TILES_PER_SPAN, FOG_EDGE_INNER, FOG_EDGE_OUTER, FOG_EXPLORED, FOG_UNSEEN, blendInfluences, blendMasksFor, blendModeFor, createFog, fogAlpha, createFootprint, createGround, createSelectionOutline, createTerrainPatch, insetConvex, updateSelectionOutline } from './world';
import { createGame } from '../sim/game';
import { maskU, type ContentAssets } from './assets';

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
 * Everything that lies flat on the ground is wound the same way. Under the
 * mirrored projection it was the wrong way round -- a tile quad listed from
 * the north corner came out clockwise and back-facing under the default
 * `FrontSide`; the ground and the footprint set `DoubleSide` and drew, the
 * farm's terrain patch did not, and every farm was invisible (issue #2)
 * with nothing logged and no test failing. With AoE2's own handedness the
 * same listing winds counter-clockwise, and the class still sets
 * `DoubleSide` so that nothing hangs on the winding. This asserts the whole
 * class, and that the winding is what it is said to be.
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
        // Thirty-one owned masks and the solid column past them, each with
        // two pixels of gutter either side.
        masksPerMode: 32,
        gutter: 2,
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
    // The sheet lies as authored: u follows world x and v world y.
    expect(first.getX(0)).toBeCloseTo(9 / FARM_TILES_PER_SPAN, 6);
    expect(second.getX(0)).toBeCloseTo(21 / FARM_TILES_PER_SPAN, 6);
    const differs = Array.from({ length: first.count }, (_, i) =>
      Math.abs(first.getX(i) - second.getX(i)) > 1e-6 || Math.abs(first.getY(i) - second.getY(i)) > 1e-6);
    expect(differs.every(Boolean)).toBe(true);
    // Same ground, same picture: the patch is a function of where it stands.
    const again = createTerrainPatch(assets, 'farm', 1.5, { x: 9, y: 12 })!.geometry.getAttribute('uv');
    expect(again.getX(0)).toBeCloseTo(first.getX(0), 6);
  });

  it('ploughs the farm across the axis the reference ploughs', () => {
    // The furrows in `g_fm1` run along one world axis. Under the mirrored
    // projection the sheet had to be sampled a quarter turn round to plough
    // the way the reference does; with AoE2's own handedness it lies as
    // authored, u along world x and v along world y, and the same screen
    // diagonal comes out of it.
    const assets = { ...groundAssets(), blends: undefined } as unknown as ContentAssets;
    const uv = createTerrainPatch(assets, 'farm', 1.5, { x: 4, y: 7 })!.geometry.getAttribute('uv');
    // North corner of the patch: world (4,7) -> u from x, v from y.
    expect(uv.getX(0)).toBeCloseTo(4 / FARM_TILES_PER_SPAN, 6);
    expect(uv.getY(0)).toBeCloseTo(7 / FARM_TILES_PER_SPAN, 6);
    // Read the first triangle of the first tile straight off the mesh: its
    // three vertices are the tile corners (0,0), (1,0) and (1,1) in world
    // tiles. Stepping one tile along world x moves u and leaves v alone,
    // and along world y the other way about.
    const corner = (i: number) => ({ u: uv.getX(i), v: uv.getY(i) });
    const [origin, alongX, alongXY] = [corner(0), corner(1), corner(2)];
    expect(alongX.u).toBeCloseTo(origin.u + 1 / FARM_TILES_PER_SPAN, 6);
    expect(alongX.v).toBeCloseTo(origin.v, 6);
    expect(alongXY.u).toBeCloseTo(alongX.u, 6);
    expect(alongXY.v).toBeCloseTo(origin.v + 1 / FARM_TILES_PER_SPAN, 6);
    // Three tiles of a ten-tile span: twelve furrows across the farm.
    const us = Array.from({ length: uv.count }, (_, i) => uv.getX(i));
    expect(Math.max(...us) - Math.min(...us)).toBeCloseTo(3 / FARM_TILES_PER_SPAN, 6);
  });

  it('writes each tile into the visibility texture as seen-now and ever-seen', () => {
    // The fog's shape is the GPU sampling this texture bilinearly, so what
    // the update has to get right is one texel per tile with the two flags
    // in the two channels it filters.
    const state = createGame(11);
    const visibility = state.visibility[1];
    visibility.visible.fill(0);
    visibility.explored.fill(0);
    const at = (x: number, y: number) => y * state.width + x;
    visibility.explored[at(5, 5)] = 1;
    visibility.visible[at(5, 5)] = 1;
    visibility.explored[at(6, 5)] = 1;
    const fog = createFog(state);
    fog.update(state);
    const flags = fog.texture.image.data as Uint8Array;
    expect(fog.texture.image.width).toBe(state.width);
    expect(fog.texture.image.height).toBe(state.height);
    expect(Array.from(flags.subarray(at(5, 5) * 2, at(5, 5) * 2 + 2))).toEqual([255, 255]);
    expect(Array.from(flags.subarray(at(6, 5) * 2, at(6, 5) * 2 + 2))).toEqual([0, 255]);
    expect(Array.from(flags.subarray(at(7, 5) * 2, at(7, 5) * 2 + 2))).toEqual([0, 0]);
    expect(fog.texture.magFilter).toBe(THREE.LinearFilter);
    expect(fog.texture.minFilter).toBe(THREE.LinearFilter);
    // An update after the tile is lost from sight has to reach the GPU:
    // `needsUpdate` is a setter that bumps the version the renderer compares.
    const uploaded = fog.texture.version;
    visibility.visible[at(5, 5)] = 0;
    fog.update(state);
    expect(flags[at(5, 5) * 2]).toBe(0);
    expect(fog.texture.version).toBe(uploaded + 1);
    // The corner of tile (x, y) samples at (x / width, y / height): halfway
    // between the texels of the tiles that meet there, so the sampler's
    // average is the corner's, and the map's edge clamps onto its own tiles.
    const uv = fog.mesh.geometry.getAttribute('uv') as THREE.BufferAttribute;
    const first = at(5, 5) * 6;
    expect(uv.getX(first)).toBeCloseTo(5 / state.width, 6);
    expect(uv.getY(first)).toBeCloseTo(5 / state.height, 6);
    expect(uv.getX(first + 2)).toBeCloseTo(6 / state.width, 6);
    expect(uv.getY(first + 2)).toBeCloseTo(6 / state.height, 6);
  });

  it('snaps the fog edge to a rounded contour rather than a tile-wide ramp', () => {
    // Issue #41. Bilinear sampling of the tile grid is a ramp one tile wide;
    // the edge is where that ramp is snapped. Along a straight run the
    // boundary between a seen tile and an unseen one reads 0.5 at the tile
    // edge, so that is where the fog turns over.
    expect(fogAlpha(1, 1)).toBeCloseTo(0, 6);
    expect(fogAlpha(0, 0)).toBeCloseTo(FOG_UNSEEN, 6);
    expect(fogAlpha(0, 1)).toBeCloseTo(FOG_EXPLORED, 6);
    expect(fogAlpha(0.5, 1)).toBeCloseTo(FOG_EXPLORED / 2, 6);
    expect(fogAlpha(0.5, 0.5)).toBeCloseTo((FOG_UNSEEN + FOG_EXPLORED / 2) / 2, 6);
    // The corner of a staircase: one seen tile of the four that meet there
    // samples a quarter, which is fully fogged, and three of four samples
    // three quarters, which is fully clear. That is the corner cut across --
    // the diamond's points shaved and its notches filled -- and it is what
    // makes a circle of tiles a circle.
    expect(fogAlpha(0.25, 1)).toBeCloseTo(FOG_EXPLORED, 6);
    expect(fogAlpha(0.75, 1)).toBeCloseTo(0, 6);
    // The transition is confined to the band around the midpoint, so it is
    // an edge and not a gradient: the whole ramp outside it is flat.
    expect(fogAlpha(FOG_EDGE_INNER, 1)).toBeCloseTo(FOG_EXPLORED, 6);
    expect(fogAlpha(FOG_EDGE_OUTER, 1)).toBeCloseTo(0, 6);
    expect(FOG_EDGE_OUTER - FOG_EDGE_INNER).toBeLessThan(0.5);
    expect(FOG_EDGE_INNER + FOG_EDGE_OUTER).toBeCloseTo(1, 6);
    // Monotone across the band, so nothing rings.
    let last = fogAlpha(0, 1);
    for (let t = 0.05; t <= 1; t += 0.05) {
      const next = fogAlpha(t, 1);
      expect(next).toBeLessThanOrEqual(last + 1e-9);
      last = next;
    }
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
    // Four edge neighbours take an edge mask and four corner neighbours a
    // corner mask, one quad each: two triangles, three vertices.
    expect(blend.geometry.getAttribute('position').count).toBe(8 * 2 * 3);
    // The mask rides in uv1 while the terrain keeps uv.
    const uv1 = blend.geometry.getAttribute('uv1');
    expect(uv1).toBeDefined();
    const us = Array.from({ length: uv1.count }, (_, i) => uv1.getX(i));
    // Every mask column lies inside the atlas, and none spans the whole of
    // it: the eight quads use edge masks 0-15 and corner masks 16-19, so u
    // ranges over at most twenty of the thirty-two columns.
    expect(Math.min(...us)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...us)).toBeLessThanOrEqual(20 / 32 + 1e-6);
    // And a column's u never reaches the gutter between it and the next:
    // the seam sample that drew a dotted line of the terrain underneath
    // along every blended edge stays inside its own mask.
    const blends = groundAssets().blends!;
    const pitch = blends.tile[0] + 2 * blends.gutter;
    for (const u of us) {
      const within = (u * pitch * blends.masksPerMode) % pitch;
      expect(within).toBeGreaterThanOrEqual(blends.gutter - 1e-6);
      expect(within).toBeLessThanOrEqual(blends.gutter + blends.tile[0] + 1e-6);
    }
    const material = blend.material as THREE.MeshBasicNodeMaterial;
    expect(material.opacityNode).toBeTruthy();
    expect(material.transparent).toBe(true);
    // Above the ground it fades into, below anything standing on it.
    expect(blend.renderOrder).toBeGreaterThan(0);
  });

  it('gates a land crossing by both terrains\' overlay masks, and a shore by none', () => {
    // Issue #116. `TerrainBlend_ps` gates the layer by its terrain's
    // `overlay_mask_name` at the tile's own uv; between two land terrains
    // the lower one also reaches back over the higher's tile through its
    // mask, so the crossing is a band rather than a line along the tile.
    // Water keeps the plain shape: the reference's shore is a rim.
    const state = createGame(11);
    state.terrain.fill(10);                       // forest, priority 96
    const at = (x: number, y: number) => y * state.width + x;
    state.terrain[at(5, 5)] = 0;                  // grass, priority 111
    state.terrain[at(20, 20)] = 1;                // water, priority 166
    const assets = groundAssets();
    const more = { forest: [10, 96, 'masks/leaves.png'], water: [1, 166, 'masks/water.png'] } as const;
    for (const [key, [id, blendPriority, overlayMask]] of Object.entries(more)) {
      assets.textures.set(`terrain/${key}.png`, new THREE.Texture());
      assets.terrain[key] = {
        ...assets.terrain.ground, name: key, terrainId: id, image: `terrain/${key}.png`, blendPriority, overlayMask,
      };
    }
    assets.terrain.ground.overlayMask = 'masks/grass.png';
    for (const slot of Object.values(assets.terrain)) {
      if (slot.overlayMask) assets.textures.set(slot.overlayMask, new THREE.Texture());
    }
    const ground = createGround(state, assets);
    const names = ground.children.map(child => child.name);
    // Grass over the forest through its mask, and the forest back over the grass.
    expect(names).toContain('blend-ground');
    expect(names).toContain('blend-forest');
    // The grass tile sees forest on all eight sides: one mask, one quad.
    const forestBack = ground.getObjectByName('blend-forest') as THREE.Mesh;
    expect(forestBack.geometry.getAttribute('position').count).toBe(2 * 3);
    // Water over the forest keeps its shape alone: no forest reaches back
    // over the water tile.
    expect(names.filter(name => name === 'blend-forest')).toHaveLength(1);
    const water = ground.getObjectByName('blend-water') as THREE.Mesh;
    expect(water).toBeDefined();
    // The back pass is drawn under the forward one.
    expect(forestBack.renderOrder).toBeLessThan((ground.getObjectByName('blend-ground') as THREE.Mesh).renderOrder);
  });

  it('picks the reference\'s one mask for a whole neighbourhood', () => {
    // The engine looks at all eight neighbours and draws each higher
    // terrain through the mask for the configuration -- not one mask per
    // edge composited. Numbering is clockwise from the north tip: odd
    // indexes are edges, even are corners.
    const priority = (id: number) => ({ 0: 111, 10: 96, 1: 166 } as Record<number, number>)[id];
    const field = (ids: Partial<Record<string, number>>) =>
      (dx: number, dy: number) => ids[`${dx},${dy}`] ?? 10;
    // Grass across the south-east edge only (+y: +x runs down-left).
    let bits = blendInfluences(10, priority, field({ '0,1': 0 })).get(0)!;
    expect(bits).toBe(0b00001000);
    expect(blendMasksFor(bits, 0, 0)).toEqual([0]);
    expect(blendMasksFor(bits, 1, 0)).toEqual([1]);
    // The same neighbour's corner is covered by its edge and adds nothing.
    bits = blendInfluences(10, priority, field({ '0,1': 0, '-1,1': 0 })).get(0)!;
    expect(bits).toBe(0b00001000);
    // A corner alone is its own mask: the east tip is (-1, +1).
    bits = blendInfluences(10, priority, field({ '-1,1': 0 })).get(0)!;
    expect(bits).toBe(0b00000100);
    expect(blendMasksFor(bits, 0, 0)).toEqual([16]);
    // And across +x, the south-west edge, the south-west masks.
    expect(blendMasksFor(blendInfluences(10, priority, field({ '1,0': 0 })).get(0)!, 0, 0)).toEqual([8]);
    // Two edges, three, four: one mask each, from the table.
    expect(blendMasksFor(0b00100010, 0, 0)).toEqual([20]);
    expect(blendMasksFor(0b10100000, 0, 0)).toEqual([22]);
    expect(blendMasksFor(0b00101010, 0, 0)).toEqual([26]);
    expect(blendMasksFor(0b10101010, 0, 0)).toEqual([30]);
    // Surrounded by grass on every side: one mask, the surrounded one.
    const all: Record<string, number> = {};
    for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) if (dx || dy) all[`${dx},${dy}`] = 0;
    bits = blendInfluences(10, priority, field(all)).get(0)!;
    expect(bits).toBe(0b10101010);
    // Two terrains out-rank the tile: both are listed, lowest priority first.
    const both = blendInfluences(10, priority, field({ '1,0': 0, '-1,0': 1 }));
    expect([...both.keys()]).toEqual([0, 1]);
    // Nothing out-ranks nothing, and a lower terrain is no influence.
    expect(blendInfluences(0, priority, field({ '1,0': 10 })).size).toBe(0);
    // The mode is looked up from the two blend types: grass on beach and
    // water on beach get different families of edge.
    expect(blendModeFor(2, 0)).toBe(2);
    expect(blendModeFor(2, 3)).toBe(1);
    expect(blendModeFor(0, 1)).toBe(3);
    expect(blendModeFor(3, 3)).toBe(0);
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
    const us = Array.from({ length: uv1.count }, (_, i) => uv1.getX(i));
    const solidVertices = us.filter(u => u >= maskU(assets.blends!, assets.blends!.solid, 0)).length;
    expect(solidVertices).toBe(9 * 6);
    expect((fading.material as THREE.MeshBasicMaterial).alphaMap).toBeTruthy();
    // And with no masks there is no ring and nothing to mask with.
    expect((bare.material as THREE.MeshBasicMaterial).alphaMap).toBeFalsy();
  });

  it('is wound counter-clockwise at all, so the check above is not vacuous', () => {
    // If the projection's handedness ever changes again this test fails
    // first, and the one above becomes a check of nothing rather than
    // silently passing.
    expect(winding(createFootprint(1.5))).toBeGreaterThan(0);
  });
});
