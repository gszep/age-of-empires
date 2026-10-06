/**
 * The aesthetic scatter: the bushes, flowers, dead plants, cacti, stumps and
 * skeletons `Arabia.rms` strews over a board once everything that matters is
 * placed. In the reference they are gaia objects with no collision box and
 * no obstruction class (a cactus has a half-tile box and still no height),
 * so nothing walks round them and nothing gathers them -- they are picture.
 * Here they are picture only: placed by the view from the match seed and the
 * board, drawn as static sprites, and never in `state.entities`, so the
 * simulation, the observation and every checksum are untouched by them.
 *
 * The passes are the script's own `AESTHETIC_FLAT`, `AESTHETIC_GROUPED` and
 * `AESTHETIC_SCATTER` (`<OBJECTS_GENERATION>`, under `AESTHETICS`): pairs
 * three tiles across at twenty tiles' spacing on the biome's `BASE_BLEND_A`
 * ground, pairs at twenty-eight tiles' spacing anywhere, singles at
 * forty-two, all sixteen or twenty-four tiles from a player and four from a
 * wood. Which object each pass strews is the biome's, from `MAP_CONSTANTS`.
 */
import * as THREE from 'three/webgpu';
import { groundLayerOrder, spriteLayerOrder } from './render-order';
import { ARABIA_BIOMES_LEGACY, selectArabiaBiome, TERRAIN_BEACH, isOpenWater, type BiomeSpec } from '../sim/mapgen';
import { random01, seedFrom } from '../sim/random';
import { isBuilding } from '../sim/data';
import { rulesForPlayer } from '../sim/civilizations';
import type { GameState, ReadonlyGameState, PlayerId } from '../sim/types';
import { atlasPage, spriteTexture, type Atlas, type ContentAssets, type ImportedTerrain } from './assets';
import { isoDepth, worldToIso } from './iso';
import { elevationAt, ELEVATION_PIXELS, FOG_EXPLORED } from './world';

interface Pass {
  /** Which of the biome's three objects. */
  which: 'flat' | 'grouped' | 'scatter';
  /** Objects per group, and the loose radius they spread over. */
  count: number;
  radius: number;
  /** `temp_min_distance_group_placement`: tiles between groups of this pass. */
  spacing: number;
  /** `min_distance_to_players`. */
  fromPlayers: number;
  /** `layer_to_place_on`: only on the biome's BLEND_A ground. */
  onBlendA?: boolean;
}

const PASSES: Pass[] = [
  { which: 'flat', count: 2, radius: 3, spacing: 20, fromPlayers: 16, onBlendA: true },
  { which: 'grouped', count: 2, radius: 3, spacing: 28, fromPlayers: 16 },
  { which: 'scatter', count: 1, radius: 0, spacing: 42, fromPlayers: 24 },
];
/** `avoid_forest_zone 4`. */
const FROM_WOOD = 4;
/** `actor_area_radius` 6 / 4: the ground one group keeps the others off. */
const FROM_OTHERS = 5;

/** The biome a dealt board is dressed in, from its most common ground. */
export function biomeOf(state: ReadonlyGameState): BiomeSpec | undefined {
  // Several new biomes share base100: frequency cannot identify them. The
  // marker is Arabia-only, and matchSeed is the immutable pre-generation seed.
  if (state.mapgenVersion === 1) return selectArabiaBiome({ seed: seedFrom(state.matchSeed ^ 0x5ee_d1) });
  const counts = new Map<number, number>();
  for (const id of state.terrain) counts.set(id, (counts.get(id) ?? 0) + 1);
  const ranked = [...counts].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  for (const id of ranked) {
    const biome = ARABIA_BIOMES_LEGACY.find(b => b.base === id);
    if (biome) return biome;
  }
  return undefined;
}

/**
 * The scatter's placements for a board: object key and world position, in a
 * fixed order from the match seed. Exposed for tests; `createScatter` draws
 * them.
 */
export function scatterPlacements(state: ReadonlyGameState): { key: string; x: number; y: number }[] {
  const biome = biomeOf(state);
  if (!biome?.aesthetics) return [];
  const { width, height } = state;
  const rng = { seed: seedFrom((state.matchSeed ?? state.seed) ^ 0xae57) };
  const at = (x: number, y: number) => y * width + x;
  const wood = new Uint8Array(width * height);
  for (const e of state.entities) {
    if (e.kind === 'resource' && e.resourceKind === 'wood') wood[at(Math.floor(e.position.x), Math.floor(e.position.y))] = 1;
  }
  const starts = state.entities.filter(e => e.kind === 'town-center').map(e => e.position);
  const nearWood = (x: number, y: number): boolean => {
    for (let dy = -FROM_WOOD; dy <= FROM_WOOD; dy++) {
      for (let dx = -FROM_WOOD; dx <= FROM_WOOD; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        if (wood[at(nx, ny)]) return true;
      }
    }
    return false;
  };
  const dry = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    const id = state.terrain[at(x, y)];
    return !isOpenWater(id) && id !== TERRAIN_BEACH;
  };
  // Every tile once, in the stream's order: the script's own candidate scan.
  const order = Array.from({ length: width * height }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random01(rng) * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const groups: { x: number; y: number; spacing: number }[] = [];
  const placed: { key: string; x: number; y: number }[] = [];
  for (const pass of PASSES) {
    const key = biome.aesthetics[pass.which];
    for (const tile of order) {
      const x = tile % width;
      const y = Math.floor(tile / width);
      if (!dry(x, y) || nearWood(x, y)) continue;
      if (pass.onBlendA && state.terrain[tile] !== biome.blendA) continue;
      if (x < 2 || y < 2 || x >= width - 2 || y >= height - 2) continue;
      if (starts.some(s => Math.hypot(x + 0.5 - s.x, y + 0.5 - s.y) < pass.fromPlayers)) continue;
      if (groups.some(g => Math.hypot(g.x - x, g.y - y) < Math.max(FROM_OTHERS, g.spacing === pass.spacing ? pass.spacing : 0))) continue;
      groups.push({ x, y, spacing: pass.spacing });
      let count = 0;
      for (let attempt = 0; attempt < 12 && count < pass.count; attempt++) {
        const ox = x + Math.round((random01(rng) * 2 - 1) * pass.radius);
        const oy = y + Math.round((random01(rng) * 2 - 1) * pass.radius);
        if (!dry(ox, oy) || nearWood(ox, oy)) continue;
        if (starts.some(s => Math.hypot(ox + 0.5 - s.x, oy + 0.5 - s.y) < pass.fromPlayers)) continue;
        if (placed.some(p => Math.floor(p.x) === ox && Math.floor(p.y) === oy)) continue;
        placed.push({ key, x: ox + 0.3 + random01(rng) * 0.4, y: oy + 0.3 + random01(rng) * 0.4 });
        count++;
      }
    }
  }
  return placed;
}

/** DAT terrain plants, independent of RMS aesthetic passes and simulation RNG.
 * Density/1000 and uncentered sub-tile jitter are inferred placement policy;
 * masked-density engine semantics remain recorded separately in the ledger. */
export function terrainPlantPlacements(state: ReadonlyGameState, terrain: Record<string, ImportedTerrain>): { key: string; x: number; y: number; terrainId: number }[] {
  const byId = new Map(Object.values(terrain).map(slot => [slot.terrainId, slot]));
  const placed: { key: string; x: number; y: number; terrainId: number }[] = [];
  for (let tile = 0; tile < state.terrain.length; tile++) {
    for (const row of byId.get(state.terrain[tile])?.scatter ?? []) {
      if (!row.key || row.density <= 0) continue;
      const rng = { seed: seedFrom((state.matchSeed ?? state.seed) ^ Math.imul(tile + 1, 73856093) ^ Math.imul(row.unitId, 19349663)) };
      if (random01(rng) >= Math.min(row.density / 1000, 1)) continue;
      placed.push({ key: row.key, terrainId: state.terrain[tile], x: tile % state.width + (row.centered ? 0.5 : random01(rng)),
        y: Math.floor(tile / state.width) + (row.centered ? 0.5 : random01(rng)) });
    }
  }
  return placed;
}

/** One static sprite per placement, from the object's own idle frames. */
export function createScatter(state: ReadonlyGameState, assets: ContentAssets | undefined): THREE.Group {
  const group = new THREE.Group();
  if (!assets) return group;
  const layers = [...scatterPlacements(state), ...terrainPlantPlacements(state, assets.terrain)].flatMap(placement => {
    const { key, x, y } = placement;
    const atlases = assets.entities[key]?.atlases;
    if (!atlases?.idle) return [];
    // Use the same variant index for body and shadow, with each layer's own
    // frame box and hotspot. A missing/empty mask never invents a shadow.
    const hash = (Math.imul(Math.floor(x * 7), 73_856_093) ^ Math.imul(Math.floor(y * 7), 19_349_663)) >>> 0;
    const index = hash % atlases.idle.frames.length;
    return ['idle-shadow', 'idle'].flatMap(name => {
      const atlas: Atlas | undefined = atlases[name];
      return atlas ? [{ placement, atlas, frame: atlas.frames[index], shadow: name === 'idle-shadow' }] : [];
    });
  });
  for (const { placement, atlas, frame, shadow } of layers) {
    const { key, x, y } = placement;
    if (!frame || frame.w === 0 || frame.h === 0) continue;
    const page = atlasPage(atlas, frame);
    // The page may still be loading (`spriteTexture`): the mesh is built
    // now, hidden, and `fillScatter` shows it once the page lands.
    const texture = spriteTexture(assets, page.image);
    const [atlasWidth, atlasHeight] = page.size;
    const geometry = new THREE.PlaneGeometry(1, 1);
    const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
    const insetX = 0.5 / atlasWidth;
    const insetY = 0.5 / atlasHeight;
    const left = frame.x / atlasWidth + insetX;
    const right = (frame.x + frame.w) / atlasWidth - insetX;
    const top = 1 - frame.y / atlasHeight - insetY;
    const bottom = 1 - (frame.y + frame.h) / atlasHeight + insetY;
    uv.setXY(0, left, top);
    uv.setXY(1, right, top);
    uv.setXY(2, left, bottom);
    uv.setXY(3, right, bottom);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
      map: texture ?? null, transparent: true, depthWrite: false, depthTest: false,
    }));
    mesh.visible = false; // fillScatter applies authoritative tile visibility
    mesh.userData.page = page.image;
    mesh.userData.tile = Math.floor(y) * state.width + Math.floor(x);
    mesh.userData.shadow = shadow;
    if ('terrainId' in placement) mesh.userData.terrainId = placement.terrainId;
    const scale = atlas.scale ?? 1;
    const w = frame.w / scale;
    const h = frame.h / scale;
    mesh.scale.set(w, h, 1);
    const iso = worldToIso(x, y);
    iso.y += elevationAt(state, x, y) * ELEVATION_PIXELS;
    mesh.position.set(iso.x + w / 2 - frame.cx / scale, iso.y - h / 2 + frame.cy / scale, 0);
    // Among the entity bodies, at its own depth, so a villager walks in
    // front of a bush and behind the next one.
    mesh.renderOrder = shadow ? groundLayerOrder(500, isoDepth(x, y)) : spriteLayerOrder(isoDepth(x, y));
    mesh.name = `scatter-${key}${shadow ? '-shadow' : ''}`;
    group.add(mesh);
  }
  return group;
}

/** Whole scenery sprites obey their anchor tile's visibility, just like
 * resource entities. Ground fog no longer doubles as a screen-space cutout. */
export function fillScatter(
  group: THREE.Group, assets: ContentAssets | undefined, state: ReadonlyGameState,
  player: PlayerId = 1, reveal = false,
): void {
  if (!assets) return;
  const visibility = state.visibility[player];
  // Cover plants under known foundations/farms without leaking unseen enemy
  // construction or demolition through a change in remembered decoration.
  const covered = new Set<number>();
  const cover = (x: number, y: number, rx: number, ry: number) => {
    for (let ty = Math.max(0, Math.floor(y - ry)); ty < Math.min(state.height, Math.ceil(y + ry)); ty++) {
      for (let tx = Math.max(0, Math.floor(x - rx)); tx < Math.min(state.width, Math.ceil(x + rx)); tx++) covered.add(ty * state.width + tx);
    }
  };
  for (const entity of state.entities) {
    if (!isBuilding(entity.kind) || entity.dead) continue;
    const { x, y } = entity.position;
    if (!reveal && entity.owner !== player && !visibility.visible[Math.floor(y) * state.width + Math.floor(x)]) continue;
    cover(x, y, entity.footprint?.x ?? entity.radius, entity.footprint?.y ?? entity.radius);
  }
  if (!reveal) for (const remembered of Object.values(visibility.memory)) {
    if (!isBuilding(remembered.kind) || visibility.visible[Math.floor(remembered.y) * state.width + Math.floor(remembered.x)]) continue;
    const radius = rulesForPlayer(state, remembered.owner).buildings[remembered.kind].radius;
    cover(remembered.x, remembered.y, radius, radius);
  }
  for (const child of group.children) {
    const tile = child.userData.tile as number;
    if (!reveal && !visibility.explored[tile]) { child.visible = false; continue; }
    if (child.userData.terrainId !== undefined && (covered.has(tile)
      || child.userData.terrainId !== state.terrain[tile])) { child.visible = false; continue; }
    const texture = spriteTexture(assets, child.userData.page as string);
    if (!texture) { child.visible = false; continue; }
    const material = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
    if (material.map !== texture) { material.map = texture; material.needsUpdate = true; }
    if (child.userData.shadow) {
      // Like entity shadows, these already receive ground fog. The owned mask
      // contains its soft coverage; do not attenuate or dim it a second time.
      material.opacity = assets.shadows?.strength ?? 1;
      material.color.setRGB(...(assets.shadows?.color ?? [0, 0, 0]));
    } else material.color.setScalar(reveal || visibility.visible[tile] ? 1 : 1 - FOG_EXPLORED);
    child.visible = true;
  }
}
