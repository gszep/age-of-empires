import * as THREE from 'three/webgpu';
import { TILE_W, TILE_H, worldToIso } from './iso';
import type { ContentAssets, ImportedTerrain } from './assets';
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

export function createGround(state: GameState, assets?: ContentAssets): THREE.Group {
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
  for (let y = 0; y < state.height; y++) {
    for (let x = 0; x < state.width; x++) {
      const terrain = state.terrain[y * state.width + x] ?? 0;
      const category = index.get(terrain) ?? 0;
      const slot = byId.get(classes[category].id)?.slot;
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
  // Terrain-to-terrain edges. Where a tile's neighbour carries a terrain the
  // DAT gives a higher `blend_priority`, that neighbour is drawn over this
  // tile through one of the owned masks, which is what fades a boundary
  // instead of stopping it at the tile edge. A tile with two such neighbours
  // takes two blends; the masks compose, so nothing has to know what a
  // combined mask would mean.
  const blends = assets?.blends;
  const priority = (id: number): number => byId.get(id)?.slot.blendPriority ?? 0;
  const DIRECTIONS: { key: string; dx: number; dy: number }[] = [
    { key: '+x', dx: 1, dy: 0 }, { key: '+y', dx: 0, dy: 1 },
    { key: '-x', dx: -1, dy: 0 }, { key: '-y', dx: 0, dy: -1 },
  ];
  /** Blend quads per overlying terrain id. */
  const overlays = new Map<number, { positions: number[]; uvs: number[]; uv1s: number[]; colors: number[] }>();
  if (blends) {
    const at = (x: number, y: number): number | undefined =>
      x < 0 || y < 0 || x >= state.width || y >= state.height
        ? undefined : state.terrain[y * state.width + x] ?? 0;
    for (let y = 0; y < state.height; y++) {
      for (let x = 0; x < state.width; x++) {
        const here = at(x, y)!;
        for (const direction of DIRECTIONS) {
          const there = at(x + direction.dx, y + direction.dy);
          if (there === undefined || there === here) continue;
          if (priority(there) <= priority(here)) continue;
          const variants = blends.edges[direction.key];
          if (!variants?.length) continue;
          const slot = byId.get(there)?.slot;
          const texture = slot && assets?.textures.get(slot.image);
          if (!texture) continue;
          // A variant per tile and direction, so a long edge does not repeat
          // one silhouette; hashed rather than random so two runs agree.
          const hash = (Math.imul(x + 1, 73_856_093) ^ Math.imul(y + 1, 19_349_663)
            ^ Math.imul(direction.dx * 3 + direction.dy * 7 + 11, 83_492_791)) >>> 0;
          const column = variants[hash % variants.length];
          let bucket = overlays.get(there);
          if (!bucket) {
            bucket = { positions: [], uvs: [], uv1s: [], colors: [] };
            overlays.set(there, bucket);
          }
          const [spanX, spanY] = slot!.dimensions;
          const width = blends.masksPerMode;
          // The mask is one diamond in a row of them: its four points are the
          // tile's four corners, so the column is a scale and an offset on u.
          const mu = (t: number): number => (column + t) / width;
          const point = (px: number, py: number, u1: number, v1: number) => {
            const iso = worldToIso(px, py);
            iso.y += cornerElevation(state, px, py) * ELEVATION_PIXELS;
            const shade = shadeAt(px, py);
            bucket!.positions.push(iso.x, iso.y, 0);
            bucket!.uvs.push(px / spanX, py / spanY);
            bucket!.uv1s.push(mu(u1), v1);
            bucket!.colors.push(shade, shade, shade);
          };
          // North, east, south, west of the tile against the mask's own top,
          // right, bottom and left points. The texture is flipped on load, so
          // v runs up from the bottom and the north corner takes v = 1.
          const corners: [number, number, number, number][] = [
            [x, y, 0.5, 1], [x + 1, y, 1, 0.5], [x + 1, y + 1, 0.5, 0], [x, y + 1, 0, 0.5],
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

  const group = new THREE.Group();
  classes.forEach((entry, i) => {
    if (!buckets[i].positions.length) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(buckets[i].positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(buckets[i].uvs, 2));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(buckets[i].colors, 3));
    const slot = byId.get(entry.id)?.slot;
    const texture = slot && assets?.textures.get(slot.image);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
      ...(texture ? { map: texture } : { color: entry.fallback }),
      vertexColors: true, side: THREE.DoubleSide,
    }));
    mesh.renderOrder = 0;
    mesh.name = `terrain-${entry.key}`;
    group.add(mesh);
  });

  for (const [id, bucket] of [...overlays].sort((a, b) => a[0] - b[0])) {
    if (!bucket.positions.length) continue;
    const slot = byId.get(id)!.slot;
    const texture = assets!.textures.get(slot.image)!;
    const mask = blends!.modes[slot.blendType] ?? blends!.modes[0];
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(bucket.positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(bucket.uvs, 2));
    geometry.setAttribute('uv1', new THREE.Float32BufferAttribute(bucket.uv1s, 2));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(bucket.colors, 3));
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
      map: texture, alphaMap: mask, transparent: true, depthWrite: false,
      vertexColors: true, side: THREE.DoubleSide,
    }));
    // Above every base terrain, below anything standing on the ground.
    mesh.renderOrder = 1;
    mesh.name = `blend-${byId.get(id)!.key}`;
    group.add(mesh);
  }
  return group;
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
 * owner's observation in `docs/status.md`, because the owned files do not
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
  const turned = farm;
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
  const columns = blends?.masksPerMode ?? 1;
  const solidColumn = blends?.solid ?? 0;
  const maskU = (column: number, t: number): number => (column + t) / columns;
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
      // span, and turned a quarter turn, because the furrows in `g_fm1` run
      // along the world axis the game ploughs across. A rotation rather than a
      // transpose -- (u, v) = (y, -x) -- so the art is not mirrored with it.
      // Both farm spans are square, so the furrow count across a farm is the
      // same either way round.
      const uv = turned
        ? (px: number, py: number) => ({ u: (at.y + py) / spanY, v: -(at.x + px) / spanX })
        : (px: number, py: number) => ({ u: (at.x + px) / spanX, v: (at.y + py) / spanY });
      // The mask's four points are the tile's four corners; the texture is
      // flipped on load, so the north corner takes v = 1.
      const mask: [number, number][] = [[0.5, 1], [1, 0.5], [0.5, 0], [0, 0.5]];
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
          uv1s.push(maskU(column, mask[index][0]), mask[index][1]);
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
  update(state: GameState): void;
}

/** Per-tile fog quad-grid: unexplored is black, explored-not-visible dimmed. */
/**
 * How dark explored-but-unseen ground and never-seen ground are.
 *
 * Exported so the fog tests can state the gradient in terms of the two levels
 * rather than repeating the numbers.
 */
export const FOG_EXPLORED = 0.45;
export const FOG_UNSEEN = 0.97;

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
  // The RGB stays 0 for the life of the mesh, so only alpha is written per
  // frame — three quarters of the writes on a board this size, saved.
  const colorAttribute = new THREE.BufferAttribute(new Float32Array(size * 6 * 4), 4);
  geometry.setAttribute('color', colorAttribute);
  void alphas;
  // One alpha per tile *corner*, reused between frames. Shading a tile flat
  // made every fog boundary a hard diamond edge, because both triangles of a
  // tile carried its own single value; averaging the up-to-four tiles that
  // meet at a corner lets the GPU interpolate across the quad instead, which
  // is the gradient the reference shows. Same trick as `cornerElevation`.
  const cornerAlphas = new Float32Array((state.width + 1) * (state.height + 1));
  const tileAlphas = new Float32Array(size);
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide }),
  );
  mesh.renderOrder = 5000;

  const update = (current: GameState) => {
    const visibility = current.visibility[1];
    const colors = colorAttribute.array as Float32Array;
    const { width, height } = current;
    // One alpha per tile first, in a single linear pass: the corner average
    // below then reads four floats instead of eight typed-array probes, and
    // this runs every frame on boards up to 392x392.
    for (let index = 0; index < size; index++) {
      tileAlphas[index] = visibility.visible[index] ? 0
        : visibility.explored[index] ? FOG_EXPLORED : FOG_UNSEEN;
    }
    // Corners next, each the mean of the tiles meeting there. The interior is
    // always four tiles, so it is done without the bounds tests; the border
    // rows and columns, where a corner has only two tiles or one, are clamped
    // afterwards. Counting the void beyond the map as unseen instead would
    // draw a dark rim round the whole board.
    const stride = width + 1;
    for (let cy = 1; cy < height; cy++) {
      const above = (cy - 1) * width;
      const here = cy * width;
      let out = cy * stride + 1;
      for (let cx = 1; cx < width; cx++, out++) {
        cornerAlphas[out] = (tileAlphas[above + cx - 1] + tileAlphas[above + cx]
          + tileAlphas[here + cx - 1] + tileAlphas[here + cx]) * 0.25;
      }
    }
    // Border corners: clamp the missing neighbours onto the tiles that exist.
    const edge = (cx: number, cy: number): number => {
      const x0 = cx > 0 ? cx - 1 : 0;
      const x1 = cx < width ? cx : width - 1;
      const y0 = cy > 0 ? cy - 1 : 0;
      const y1 = cy < height ? cy : height - 1;
      return (tileAlphas[y0 * width + x0] + tileAlphas[y0 * width + x1]
        + tileAlphas[y1 * width + x0] + tileAlphas[y1 * width + x1]) * 0.25;
    };
    for (let cx = 0; cx <= width; cx++) {
      cornerAlphas[cx] = edge(cx, 0);
      cornerAlphas[height * stride + cx] = edge(cx, height);
    }
    for (let cy = 1; cy < height; cy++) {
      cornerAlphas[cy * stride] = edge(0, cy);
      cornerAlphas[cy * stride + width] = edge(width, cy);
    }
    // The six vertices are north, east, south, north, south, west — the same
    // order the positions were built in, so each takes its own corner.
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const north = cornerAlphas[y * stride + x];
        const east = cornerAlphas[y * stride + x + 1];
        const south = cornerAlphas[(y + 1) * stride + x + 1];
        const west = cornerAlphas[(y + 1) * stride + x];
        let base = ((y * width + x) * 6) * 4 + 3;
        colors[base] = north; base += 4;
        colors[base] = east; base += 4;
        colors[base] = south; base += 4;
        colors[base] = north; base += 4;
        colors[base] = south; base += 4;
        colors[base] = west;
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
