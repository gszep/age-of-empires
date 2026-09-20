import * as THREE from 'three/webgpu';
import { attribute, floor, fract, smoothstep as smoothstepNode, texture as textureNode, uv, vec2 } from 'three/tsl';
import { TILE_W, TILE_H, worldToIso } from './iso';
import { isOpenWater } from '../sim/mapgen';
import { maskU, type ContentAssets, type ImportedTerrain } from './assets';
import { createFoam } from './foam';
import { GROUND_FOG_ORDER } from './render-order';
import { createWaterMaterial, surfaceOpacity, waterPresetFor } from './water';
import type { GameState, ReadonlyGameState, PlayerId } from '../sim/types';

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
export function elevationAt(state: ReadonlyGameState, x: number, y: number): number {
  const tx = Math.max(0, Math.min(state.width - 1, Math.floor(x)));
  const ty = Math.max(0, Math.min(state.height - 1, Math.floor(y)));
  return state.elevation?.[ty * state.width + tx] ?? 0;
}

export function elevatedWorldToIso(state: ReadonlyGameState, x: number, y: number) {
  const iso = worldToIso(x, y);
  return { x: iso.x, y: iso.y + elevationAt(state, x, y) * ELEVATION_PIXELS };
}

function cornerElevation(state: ReadonlyGameState, x: number, y: number): number {
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
/**
 * Ground colours for a board with no imported art, and for any terrain the
 * import does not carry. The open fallback has no textures at all, so these
 * four are what it draws; a biome terrain nobody imported falls back to its
 * family's colour rather than vanishing.
 */
const FALLBACK_GROUND: Record<number, number> = {
  0: 0x6f8f4a, 10: 0x315f35, 1: 0x4f91bd, 24: 0xb18a58,
};
const FALLBACK_DEFAULT = 0x6f8f4a;
/** Mesh names for the four the open fallback draws, so a board without any
 * imported art still names its meshes what everything else calls them. */
const FALLBACK_KEYS: Record<number, string> = {
  0: 'ground', 10: 'forest', 1: 'water', 24: 'road',
};

export function createGround(state: ReadonlyGameState, assets?: ContentAssets): THREE.Group {
  // One mesh per terrain the board actually carries, rather than per hardcoded
  // class. A biome dresses the ground in its own base, four blend terrains and
  // three forest variations, so the four-class list drew every one of them as
  // plain grass.
  const byId = new Map<number, { key: string; slot: ImportedTerrain }>();
  for (const [key, slot] of Object.entries(assets?.terrain ?? {})) byId.set(slot.terrainId, { key, slot });
  const present: number[] = [];
  const seen = new Set<number>();
  for (const id of state.terrain) {
    if (seen.has(id)) continue;
    seen.add(id);
    present.push(id);
  }
  // Deterministic order, so two runs build the same scene graph.
  present.sort((a, b) => a - b);
  const classes = present.map(id => ({
    id,
    key: byId.get(id)?.key ?? FALLBACK_KEYS[id] ?? String(id),
    fallback: FALLBACK_GROUND[id] ?? FALLBACK_DEFAULT,
  }));
  const index = new Map(classes.map((entry, i) => [entry.id, i]));
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
  // The water surface is added over each water tile at the preset's weight
  // for the tile's class (shallow along the rim, normal in the open sea),
  // averaged at a corner over the water tiles meeting there so the step
  // between two classes is a ramp across one tile.
  const waterPreset = assets && waterPresetFor(state, assets);
  const weightOf = new Map<number, number>();
  if (waterPreset) {
    for (const { id } of classes) {
      if (isOpenWater(id)) weightOf.set(id, surfaceOpacity(waterPreset, byId.get(id)?.slot.waterClass));
    }
  }
  const weightAt = (px: number, py: number): number => {
    let sum = 0;
    let wet = 0;
    for (const [tx, ty] of [[px - 1, py - 1], [px, py - 1], [px - 1, py], [px, py]]) {
      if (tx < 0 || ty < 0 || tx >= state.width || ty >= state.height) continue;
      const weight = weightOf.get(state.terrain[ty * state.width + tx]);
      if (weight === undefined) continue;
      sum += weight;
      wet++;
    }
    return wet ? sum / wet : 0;
  };
  const weights = classes.map(() => [] as number[]);
  for (let y = 0; y < state.height; y++) {
    for (let x = 0; x < state.width; x++) {
      const terrain = state.terrain[y * state.width + x] ?? 0;
      const category = index.get(terrain) ?? 0;
      const slot = byId.get(classes[category].id)?.slot;
      const [spanX, spanY] = slot?.dimensions ?? [1, 1];
      const point = (px: number, py: number) => {
        const iso = worldToIso(px, py);
        iso.y += cornerElevation(state, px, py) * ELEVATION_PIXELS;
        return { iso, u: px / spanX, v: py / spanY, shade: shadeAt(px, py), weight: weightAt(px, py) };
      };
      const [north, west, south, east] = [
        point(x, y), point(x + 1, y), point(x + 1, y + 1), point(x, y + 1),
      ];
      const bucket = buckets[category];
      for (const [a, b, c] of [[north, west, south], [north, south, east]] as const) {
        for (const corner of [a, b, c]) {
          bucket.positions.push(corner.iso.x, corner.iso.y, 0);
          bucket.uvs.push(corner.u, corner.v);
          bucket.colors.push(corner.shade, corner.shade, corner.shade);
          weights[category].push(corner.weight);
        }
      }
    }
  }
  // Terrain-to-terrain edges, the reference's own way (see `blendInfluences`
  // and `blendMasksFor`): every tile looks at its eight neighbours, and each
  // higher-priority terrain among them is drawn over the tile through the one
  // mask that fits the whole configuration -- an edge, a corner, two edges,
  // three, or all four -- rather than one mask per edge composited. Higher
  // priorities are drawn last, so the dominant terrain advances over the
  // rest, and the mode (the family of mask shapes) is looked up from the two
  // terrains' blend types, so water on sand and grass on dirt each get their
  // own edge.
  const blends = assets?.blends;
  const priority = (id: number): number => byId.get(id)?.slot.blendPriority ?? 0;
  /** Whether `there` is drawn over `here` through its overlay mask: both land, and a mask to draw with. */
  const masked = (here: number, there: number): boolean =>
    !isOpenWater(here) && !isOpenWater(there) && !!byId.get(there)?.slot.overlayMask;
  const blendType = (id: number): number => byId.get(id)?.slot.blendType ?? 0;
  /** Blend quads per (overlying terrain id, mode), drawn in priority order. */
  const overlays = new Map<string, {
    id: number; mode: number; back: boolean; gated: boolean; positions: number[]; uvs: number[];
    uv1s: number[]; colors: number[]; weights: number[];
  }>();
  if (blends) {
    const at = (x: number, y: number): number | undefined =>
      x < 0 || y < 0 || x >= state.width || y >= state.height
        ? undefined : state.terrain[y * state.width + x] ?? 0;
    for (let y = 0; y < state.height; y++) {
      for (let x = 0; x < state.width; x++) {
        const here = at(x, y)!;
        const neighbour = (dx: number, dy: number) => at(x + dx, y + dy);
        // The higher terrain advances over this tile through the edge's
        // shape; between two land terrains it is also gated by its own
        // overlay mask, and the lower terrain reaches back over the
        // higher's tile the same way, so the crossing is a band of each in
        // the other rather than a line along the tile (#116). Water keeps
        // the plain shape: its mask is a marble, not blobs, and the
        // reference's shore is a rim, not a band.
        const influences = [
          ...[...blendInfluences(here, priority, neighbour)].map(([there, bits]) => [there, bits, false] as const),
          ...[...blendInfluences(here, id => -priority(id), neighbour)]
            .filter(([there]) => masked(here, there))
            .map(([there, bits]) => [there, bits, true] as const),
        ];
        for (const [there, bits, back] of influences) {
          const slot = byId.get(there)?.slot;
          const texture = slot && assets?.textures.get(slot.image);
          if (!texture) continue;
          const mode = blendModeFor(blendType(here), blendType(there));
          const gated = masked(here, there);
          const key = `${there}:${mode}:${back ? 'back' : gated ? 'masked' : 'over'}`;
          let bucket = overlays.get(key);
          if (!bucket) {
            bucket = { id: there, mode, back, gated, positions: [], uvs: [], uv1s: [], colors: [], weights: [] };
            overlays.set(key, bucket);
          }
          const [spanX, spanY] = slot.dimensions;
          for (const column of blendMasksFor(bits, x, y)) {
            // The mask is one diamond in a row of them: its four points are
            // the tile's four corners, so the column is a scale and an
            // offset on u.
            const mu = (t: number): number => maskU(blends, column, t);
            const point = (px: number, py: number, u1: number, v1: number) => {
              const iso = worldToIso(px, py);
              iso.y += cornerElevation(state, px, py) * ELEVATION_PIXELS;
              const shade = shadeAt(px, py);
              bucket!.positions.push(iso.x, iso.y, 0);
              bucket!.uvs.push(px / spanX, py / spanY);
              bucket!.uv1s.push(mu(u1), v1);
              bucket!.colors.push(shade, shade, shade);
              // Water lapping over a tile carries its own surface with it.
              bucket!.weights.push(weightOf.get(there) ?? 0);
            };
            // North, west, south, east of the tile (+x runs down-left)
            // against the mask's own top, left, bottom and right points. The
            // texture is flipped on load, so v runs up from the bottom and
            // the north corner takes v = 1.
            const corners: [number, number, number, number][] = [
              [x, y, 0.5, 1], [x + 1, y, 0, 0.5], [x + 1, y + 1, 0.5, 0], [x, y + 1, 1, 0.5],
            ];
            for (const [a, b, c] of [[0, 1, 2], [0, 2, 3]] as const) {
              for (const index of [a, b, c]) {
                const [px, py, u1, v1] = corners[index];
                point(px, py, u1, v1);
              }
            }
          }
        }
      }
    }
  }

  const group = new THREE.Group();
  const foam = createFoam(state, assets);
  if (foam) group.add(foam);
  classes.forEach((entry, i) => {
    if (!buckets[i].positions.length) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(buckets[i].positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(buckets[i].uvs, 2));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(buckets[i].colors, 3));
    geometry.setAttribute('surfaceWeight', new THREE.Float32BufferAttribute(weights[i], 1));
    const slot = byId.get(entry.id)?.slot;
    const texture = slot && assets?.textures.get(slot.image);
    // Water is its tile with the preset's surface over it, where the owned
    // presets are in.
    const material = weightOf.has(entry.id) && waterPreset && slot && texture
      ? createWaterMaterial(assets!, waterPreset, { span: slot.dimensions[0], board: [state.width, state.height], tile: texture })
      : new THREE.MeshBasicMaterial({
        ...(texture ? { map: texture } : { color: entry.fallback }),
        vertexColors: true, side: THREE.DoubleSide,
      });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 0;
    mesh.name = `terrain-${entry.key}`;
    group.add(mesh);
  });

  // Lowest priority first, so where two terrains both out-rank a tile the
  // higher of the two is painted over the other's edge, as the reference
  // draws them.
  const ordered = [...overlays.values()]
    .sort((a, b) => Number(b.back) - Number(a.back) || priority(a.id) - priority(b.id) || a.id - b.id || a.mode - b.mode);
  ordered.forEach((bucket, order) => {
    if (!bucket.positions.length) return;
    const slot = byId.get(bucket.id)!.slot;
    const texture = assets!.textures.get(slot.image)!;
    const mask = blends!.modes[bucket.mode] ?? blends!.modes[0];
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(bucket.positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(bucket.uvs, 2));
    geometry.setAttribute('uv1', new THREE.Float32BufferAttribute(bucket.uv1s, 2));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(bucket.colors, 3));
    geometry.setAttribute('surfaceWeight', new THREE.Float32BufferAttribute(bucket.weights, 1));
    // The edge's shape is the blend mask in `uv1`; within it the terrain
    // shows through its own overlay mask at the tile's uv, as
    // `TerrainBlend_ps` gates `g_LayerTexture` by `g_MaskTexture`, which is
    // what makes the reference's crossings ragged below the tile (#116).
    const overlay = bucket.gated && slot.overlayMask ? assets!.textures.get(slot.overlayMask) : undefined;
    const material = weightOf.has(bucket.id) && waterPreset
      ? createWaterMaterial(assets!, waterPreset, {
        span: slot.dimensions[0], board: [state.width, state.height], tile: texture, masked: mask, overlay,
      })
      : createBlendMaterial(texture, mask, overlay);
    const mesh = new THREE.Mesh(geometry, material);
    // Above every base terrain, below anything standing on the ground, and
    // in priority order among themselves.
    mesh.renderOrder = 1 + 100 * order / Math.max(1, ordered.length);
    mesh.name = `blend-${byId.get(bucket.id)!.key}`;
    group.add(mesh);
  });
  return group;
}

/**
 * A land terrain drawn over a neighbour's tile: its texture in the ground's
 * shade, faded through the blend mask in `uv1`, and gated by its overlay
 * mask at the tile's own uv where it has one.
 */
function createBlendMaterial(
  texture: THREE.Texture, mask: THREE.Texture, overlay: THREE.Texture | undefined,
): THREE.MeshBasicNodeMaterial {
  const material = new THREE.MeshBasicNodeMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  material.colorNode = textureNode(texture, uv()).rgb.mul(attribute('color', 'vec3'));
  const shape = textureNode(mask, uv(1)).r;
  material.opacityNode = overlay ? shape.mul(textureNode(overlay, uv()).r) : shape;
  return material;
}

/**
 * The eight neighbours as the reference numbers them, clockwise from the
 * tile's north tip on screen: 0 north tip, 1 north-east edge, 2 east tip,
 * 3 south-east edge, 4 south tip, 5 south-west edge, 6 west tip, 7
 * north-west edge -- as world offsets (dx, dy). Even numbers are corners,
 * odd numbers edges.
 */
const NEIGHBOURS: [number, number][] = [
  [-1, -1], [-1, 0], [-1, 1], [0, 1], [1, 1], [1, 0], [1, -1], [0, -1],
];

/**
 * Which higher-priority terrains draw over a tile, and from which of its
 * eight neighbours, as a bit per neighbour. A corner neighbour is ignored
 * when either edge beside it already influences the tile -- the edge's mask
 * covers the corner. The map is in ascending priority order.
 *
 * This is the engine's algorithm as the openage project documents it
 * (doc/media/blendomatic.md), reimplemented.
 */
export function blendInfluences(
  here: number, priority: (id: number) => number,
  neighbour: (dx: number, dy: number) => number | undefined,
): Map<number, number> {
  const ids = NEIGHBOURS.map(([dx, dy]) => neighbour(dx, dy));
  const mine = priority(here);
  const influences = new Map<number, number>();
  const edgeInfluences = (i: number): boolean => {
    const id = ids[i];
    return id !== undefined && id !== here && priority(id) > mine;
  };
  for (let i = 0; i < 8; i++) {
    if (!edgeInfluences(i)) continue;
    if (i % 2 === 0 && (edgeInfluences((i + 7) % 8) || edgeInfluences((i + 1) % 8))) continue;
    const id = ids[i]!;
    influences.set(id, (influences.get(id) ?? 0) | (1 << i));
  }
  return new Map([...influences].sort((a, b) => priority(a[0]) - priority(b[0]) || a[0] - b[0]));
}

/**
 * The reference's mask for each edge configuration, keyed by the edge bits
 * (neighbours 1, 3, 5, 7): one mask covers any combination of edges. Ids
 * 0-15 are four variants for a single edge, chosen per tile so a long
 * boundary does not repeat one silhouette.
 */
const EDGE_MASKS: Record<number, number | [number, number, number, number]> = {
  0b00001000: [0, 1, 2, 3],       // south-east edge, +y
  0b00000010: [4, 5, 6, 7],       // north-east edge, -x
  0b00100000: [8, 9, 10, 11],     // south-west edge, +x
  0b10000000: [12, 13, 14, 15],   // north-west edge, -y
  0b00100010: 20, 0b10001000: 21,
  0b10100000: 22, 0b10000010: 23, 0b00101000: 24, 0b00001010: 25,
  0b00101010: 26, 0b10101000: 27, 0b10100010: 28, 0b10001010: 29,
  0b10101010: 30,
};
/** The reference's mask for a corner neighbour (0 north, 2 east, 4 south, 6 west). */
const CORNER_MASKS: Record<number, number> = { 2: 16, 4: 17, 0: 18, 6: 19 };

/** The mask columns that draw one terrain's influence bits over tile (x, y). */
export function blendMasksFor(bits: number, x: number, y: number): number[] {
  const columns: number[] = [];
  const edges = EDGE_MASKS[bits & 0b10101010];
  if (Array.isArray(edges)) {
    // The reference varies a single edge by the tile's own coordinates.
    columns.push(edges[(x + y * 3) & 3]);
  } else if (edges !== undefined) {
    columns.push(edges);
  }
  for (const corner of [0, 2, 4, 6]) {
    if (bits & (1 << corner)) columns.push(CORNER_MASKS[corner]);
  }
  return columns;
}

/**
 * Which family of mask shapes two meeting terrains blend with: the tile's
 * own blend type picks the row, the neighbour's the column. The DAT's blend
 * types are 0 grass, 1 farm, 2 beach, 3 water, 4 shallows, 5 road, 6 ice, 7
 * snow; the table is the engine's, as openage documents it.
 */
const BLEND_MODE: number[][] = [
  [2, 3, 2, 1, 1, 6, 5, 4],
  [3, 3, 3, 1, 1, 6, 5, 4],
  [2, 3, 2, 1, 1, 6, 1, 4],
  [1, 1, 1, 0, 7, 6, 5, 4],
  [1, 1, 1, 7, 7, 6, 5, 4],
  [6, 6, 6, 6, 6, 6, 5, 4],
  [5, 5, 1, 5, 5, 5, 5, 4],
  [4, 3, 4, 4, 4, 4, 4, 4],
];
export function blendModeFor(here: number, there: number): number {
  return BLEND_MODE[Math.min(7, Math.max(0, here))][Math.min(7, Math.max(0, there))];
}

/**
 * How many tiles one span of a farm texture covers.
 *
 * `terrain_dimensions` is 6x6 for the grown farm (`g_fm1`) and 3x3 for the one
 * being built (`g_fc1`), and both sheets carry the same forty furrows across
 * their span. Reading that field as tiles-per-span therefore halved a farm's
 * furrow pitch the moment it finished building — the same ground re-ploughed
 * finer as the crop came up. It says how the sheet is cut into frames, not how
 * much ground a frame covers, and which frame a tile draws is engine behaviour
 * the DAT never states (issue #22).
 *
 * The reference settles the scale: a farm there shows about twelve furrows
 * across its three tiles, reported by the owner of the game. Twelve over three
 * tiles against forty to the span is ten tiles to the span, and applying it to
 * both sheets keeps the pitch steady through construction. Recorded as the
 * owner's observation in `docs/ledger.md`, because the owned files do not
 * answer it.
 */
export const FARM_TILES_PER_SPAN = 10;
const FARM_SLOTS = new Set(['farm', 'farm-construction']);

/**
 * Farms are terrain in AoE2DE, not sprites: the DAT points at terrain slots
 * (`Farm1`, `Farm Cnst1`) and there is no farm SLD to import. Draw one as its
 * own patch of the isometric grid so it sits flat on the ground like the real
 * game.
 *
 * `at` is the patch's north corner in world tiles, so the texture is sampled by
 * absolute position exactly as the ground beneath it is. Sampling in
 * patch-local coordinates instead gave every farm on the map the identical
 * corner of the sheet, which is what brought all thirty-six authored frames
 * down to one arrangement.
 */
export function createTerrainPatch(
  assets: ContentAssets | undefined, slot: string, half: number,
  at: { x: number; y: number } = { x: 0, y: 0 },
): THREE.Mesh | undefined {
  const terrain = assets?.terrain?.[slot];
  const texture = terrain && assets?.textures.get(terrain.image);
  if (!terrain || !texture) return undefined;
  const farm = FARM_SLOTS.has(slot);
  const [spanX, spanY] = farm ? [FARM_TILES_PER_SPAN, FARM_TILES_PER_SPAN] : terrain.dimensions;
  const positions: number[] = [];
  const uvs: number[] = [];
  const uv1s: number[] = [];
  const tiles = Math.max(1, Math.round(half * 2));
  // A farm out-ranks the ground it sits in (the DAT gives it 186 against
  // grass's 111), so in the reference it bleeds outward through the same
  // masks a terrain edge uses rather than stopping at its own footprint. The
  // patch therefore draws one tile wider than the farm, with the ring masked
  // toward the farm and the farm's own tiles left solid -- one mesh and one
  // material, which is what the solid column in the mask atlas is for.
  const blends = assets?.blends;
  const ring = blends ? 1 : 0;
  const solidColumn = blends?.solid ?? 0;
  const mu = (column: number, t: number): number => blends ? maskU(blends, column, t) : t;
  for (let y = -ring; y < tiles + ring; y++) {
    for (let x = -ring; x < tiles + ring; x++) {
      const outside = x < 0 || y < 0 || x >= tiles || y >= tiles;
      // A ring tile fades toward whichever side of it the farm lies on; a
      // diagonal one touches the farm only at a corner and is left out.
      let column = solidColumn;
      if (outside) {
        const towards = x < 0 ? '+x' : x >= tiles ? '-x' : y < 0 ? '+y' : '-y';
        const offAxis = (x < 0 || x >= tiles) && (y < 0 || y >= tiles);
        const variants = blends?.edges[towards];
        if (offAxis || !variants?.length) continue;
        const hash = (Math.imul(x + 97, 73_856_093) ^ Math.imul(y + 131, 19_349_663)) >>> 0;
        column = variants[hash % variants.length];
      }
      // Position is patch-local (the mesh is placed at its north corner);
      // the texture coordinate is absolute, so neighbouring farms show
      // neighbouring ground rather than the same corner twice.
      // Farm sheets are laid the way the reference lays them: ten tiles to the
      // span. Under the mirrored projection they had to be turned a quarter
      // turn to plough the way the reference ploughs; with the handedness
      // AoE2's own the sheet lies as authored.
      const uv = (px: number, py: number) => ({ u: (at.x + px) / spanX, v: (at.y + py) / spanY });
      // The mask's four points are the tile's four corners -- north, west,
      // south, east, since +x runs down-left; the texture is flipped on
      // load, so the north corner takes v = 1.
      const mask: [number, number][] = [[0.5, 1], [0, 0.5], [0.5, 0], [1, 0.5]];
      const corners = [
        { p: worldToIso(x, y), ...uv(x, y) },
        { p: worldToIso(x + 1, y), ...uv(x + 1, y) },
        { p: worldToIso(x + 1, y + 1), ...uv(x + 1, y + 1) },
        { p: worldToIso(x, y + 1), ...uv(x, y + 1) },
      ];
      for (const [a, b, c] of [[0, 1, 2], [0, 2, 3]] as const) {
        for (const index of [a, b, c]) {
          positions.push(corners[index].p.x, corners[index].p.y, 0);
          uvs.push(corners[index].u, corners[index].v);
          uv1s.push(mu(column, mask[index][0]), mask[index][1]);
        }
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('uv1', new THREE.Float32BufferAttribute(uv1s, 2));
  const maskTexture = blends && (blends.modes[terrain.blendType] ?? blends.modes[0]);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    ...(maskTexture ? { alphaMap: maskTexture } : {}),
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
  /** One texel per tile, red seen now and green ever seen, 0 or 255. */
  texture: THREE.DataTexture;
  update(state: ReadonlyGameState): void;
  dispose(): void;
}

/**
 * How dark explored-but-unseen ground and never-seen ground are, as the
 * opacity of a black overlay. Explored land is the DAT-side
 * `colorcorrection.json` Default profile's `fog_seen_land_mult` of 0.5: the
 * ground at half brightness. Never-seen ground is black outright -- with the
 * reference's "Animate Fog" option off nothing of the ground shows through,
 * and 0.97 let the sand's texture read faintly through the dark (issue #41).
 *
 * Exported so the fog tests can state the edge in terms of the two levels
 * rather than repeating the numbers.
 */
export const FOG_EXPLORED = 0.5;
export const FOG_UNSEEN = 1;
/**
 * Where across a tile the fog edge falls and how soft it is, as fractions of
 * the ramp between one tile's centre and the next. The renderer filters the
 * visibility texture, which is a ramp about a tile wide; snapping it at its
 * midpoint puts the edge on the tile boundary along a straight run and cuts
 * across the corner tiles of a staircase, so a circle of seen tiles reads as a
 * circle rather than as the diamonds it is made of (issue #41). The width
 * either side of the midpoint is the only thing here that is not geometry:
 * AoE2DE shapes its own `g_VisibilityTexture` ramp with `g_fogFadeAmount`,
 * which is the one fog constant `colorcorrection.json` does not set, so 0.075
 * of a tile is an approximation -- it was 0.15 and read as a gradient on a
 * real screen -- see docs/ledger.md.
 */
export const FOG_EDGE_INNER = 0.425;
export const FOG_EDGE_OUTER = 0.575;

/** `smoothstep`, as the shader has it, so the test can follow the same curve. */
const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/**
 * The fog's darkness at a point whose bilinear visibility reads `sight` (how
 * much of the surrounding ground is seen right now) and `explored` (how much
 * has ever been seen). Mirrors the material's opacity node exactly -- keep
 * the two together -- so the shape of the edge can be tested without a GPU.
 */
export function fogAlpha(sight: number, explored: number): number {
  const seen = smoothstep(FOG_EDGE_INNER, FOG_EDGE_OUTER, sight);
  const known = smoothstep(FOG_EDGE_INNER, FOG_EDGE_OUTER, explored);
  return FOG_UNSEEN * (1 - known) + FOG_EXPLORED * known * (1 - seen);
}

/**
 * Cubic B-spline sampling of a texture whose size is known, as four bilinear
 * taps (the trick from GPU Gems 2 ch. 20, which is what three's own
 * `textureBicubic` does under a mip chain this texture does not have). Bilinear
 * alone joins the tile centres with straight ramps, so the snapped edge is a
 * polygon with a facet a tile long; the spline bends the ramp through the
 * corners and the edge comes out as a curve.
 */
function bicubic(map: ReturnType<typeof textureNode>, width: number, height: number) {
  const scaled = uv().mul(vec2(width, height)).add(0.5);
  const cell = floor(scaled);
  const t = fract(scaled);
  // The B-spline's four weights, paired into two bilinear taps per axis.
  const w0 = t.oneMinus().pow(3).div(6);
  const w1 = t.pow(3).mul(3).sub(t.pow(2).mul(6)).add(4).div(6);
  const w2 = t.pow(3).mul(-3).add(t.pow(2).mul(3)).add(t.mul(3)).add(1).div(6);
  const w3 = t.pow(3).div(6);
  const g0 = w0.add(w1);
  const g1 = w2.add(w3);
  const h0 = w1.div(g0).sub(1);
  const h1 = w3.div(g1).add(1);
  const texel = vec2(1 / width, 1 / height);
  const at = (dx: typeof h0.x, dy: typeof h0.y) =>
    map.sample(vec2(cell.x.add(dx), cell.y.add(dy)).sub(0.5).mul(texel));
  return g0.y.mul(g0.x.mul(at(h0.x, h0.y)).add(g1.x.mul(at(h1.x, h0.y))))
    .add(g1.y.mul(g0.x.mul(at(h0.x, h1.y)).add(g1.x.mul(at(h1.x, h1.y)))));
}

/**
 * Fog overlay: a black quad-grid over the ground whose opacity comes from a
 * visibility texture, one texel per tile, filtered across the tiles and
 * snapped at the edge. That is the reference's own mechanism -- AoE2DE's
 * terrain shader reads `g_VisibilityTexture` through a bilinear sampler and
 * shapes the result -- and it is what makes the seen area a rounded shape
 * rather than a staircase of diamonds or a tile-wide gradient. The mesh
 * follows the ground's elevation like the ground itself does, so the fog sits
 * on a hill rather than under it.
 */
export function createFog(state: ReadonlyGameState, player: PlayerId = 1): FogLayer {
  const { width, height } = state;
  const size = width * height;
  const positions = new Float32Array(size * 6 * 3);
  const uvs = new Float32Array(size * 6 * 2);
  let offset = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const raised = (px: number, py: number) => {
        const iso = worldToIso(px, py);
        iso.y += cornerElevation(state, px, py) * ELEVATION_PIXELS;
        // The texel for tile (x, y) is centred at ((x + 0.5) / width, ...), so
        // a corner's UV lands exactly between the up-to-four tiles that meet
        // there and the sampler averages them; clamping at the map's border
        // averages only the tiles that exist rather than a dark rim beyond.
        return { x: iso.x, y: iso.y, u: px / width, v: py / height };
      };
      const north = raised(x, y);
      const west = raised(x + 1, y);
      const south = raised(x + 1, y + 1);
      const east = raised(x, y + 1);
      for (const p of [north, west, south, north, south, east]) {
        positions[offset * 3] = p.x;
        positions[offset * 3 + 1] = p.y;
        positions[offset * 3 + 2] = 0;
        uvs[offset * 2] = p.u;
        uvs[offset * 2 + 1] = p.v;
        offset++;
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

  // Two bytes a tile: red is seen now, green is ever seen. Both are filtered,
  // so the explored/unseen edge is shaped exactly like the seen/explored one.
  const flags = new Uint8Array(size * 2);
  const visibilityTexture = new THREE.DataTexture(flags, width, height, THREE.RGFormat);
  visibilityTexture.magFilter = THREE.LinearFilter;
  visibilityTexture.minFilter = THREE.LinearFilter;
  visibilityTexture.generateMipmaps = false;
  // A row is two bytes a tile, so an odd width is not a multiple of four.
  visibilityTexture.unpackAlignment = 1;

  const material = new THREE.MeshBasicNodeMaterial({
    color: 0x000000, transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide,
  });
  const sample = bicubic(textureNode(visibilityTexture), width, height);
  // The same curve as `fogAlpha` above; change both or neither.
  const seen = smoothstepNode(FOG_EDGE_INNER, FOG_EDGE_OUTER, sample.r);
  const known = smoothstepNode(FOG_EDGE_INNER, FOG_EDGE_OUTER, sample.g);
  material.opacityNode = known.oneMinus().mul(FOG_UNSEEN)
    .add(known.mul(seen.oneMinus()).mul(FOG_EXPLORED));

  const mesh = new THREE.Mesh(geometry, material);
  // This is ground fog. Bodies are shown as whole sprites according to their
  // anchor's authoritative visibility; a ground contour must not slice a crown.
  mesh.renderOrder = GROUND_FOG_ORDER;

  const update = (current: ReadonlyGameState) => {
    const visibility = current.visibility[player];
    for (let index = 0, out = 0; index < size; index++, out += 2) {
      flags[out] = visibility.visible[index] ? 255 : 0;
      flags[out + 1] = visibility.explored[index] ? 255 : 0;
    }
    visibilityTexture.needsUpdate = true;
  };
  update(state);
  return { mesh, texture: visibilityTexture, update, dispose: () => visibilityTexture.dispose() };
}
