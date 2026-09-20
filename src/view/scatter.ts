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
import { ARABIA_BIOMES, TERRAIN_BEACH, isOpenWater, type BiomeSpec } from '../sim/mapgen';
import { random01, seedFrom } from '../sim/random';
import type { GameState, ReadonlyGameState } from '../sim/types';
import { atlasPage, spriteTexture, type Atlas, type ContentAssets } from './assets';
import { isoDepth, worldToIso } from './iso';
import { elevationAt, ELEVATION_PIXELS } from './world';

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
  const counts = new Map<number, number>();
  for (const id of state.terrain) counts.set(id, (counts.get(id) ?? 0) + 1);
  const ranked = [...counts].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  for (const id of ranked) {
    const biome = ARABIA_BIOMES.find(b => b.base === id);
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

/** One static sprite per placement, from the object's own idle frames. */
export function createScatter(state: ReadonlyGameState, assets: ContentAssets | undefined): THREE.Group {
  const group = new THREE.Group();
  if (!assets) return group;
  for (const { key, x, y } of scatterPlacements(state)) {
    const atlas: Atlas | undefined = assets.entities[key]?.atlases['idle'];
    if (!atlas) continue;
    // The idle sheet holds the object's variants; pick one by where it stands.
    const hash = (Math.imul(Math.floor(x * 7), 73_856_093) ^ Math.imul(Math.floor(y * 7), 19_349_663)) >>> 0;
    const frame = atlas.frames[hash % atlas.frames.length];
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
    mesh.visible = Boolean(texture);
    mesh.userData.page = page.image;
    const scale = atlas.scale ?? 1;
    const w = frame.w / scale;
    const h = frame.h / scale;
    mesh.scale.set(w, h, 1);
    const iso = worldToIso(x, y);
    iso.y += elevationAt(state, x, y) * ELEVATION_PIXELS;
    mesh.position.set(iso.x + w / 2 - frame.cx / scale, iso.y - h / 2 + frame.cy / scale, 0);
    // Among the entity bodies, at its own depth, so a villager walks in
    // front of a bush and behind the next one.
    mesh.renderOrder = 1000 + isoDepth(x, y) * 10;
    mesh.name = `scatter-${key}`;
    group.add(mesh);
  }
  return group;
}

/** Show each scatter sprite whose page has landed since it was built. */
export function fillScatter(group: THREE.Group, assets: ContentAssets | undefined): void {
  if (!assets) return;
  for (const child of group.children) {
    if (child.visible) continue;
    const texture = assets.textures.get(child.userData.page as string);
    if (!texture) continue;
    const material = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
    material.map = texture;
    material.needsUpdate = true;
    child.visible = true;
  }
}
