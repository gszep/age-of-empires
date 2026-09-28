import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { createGame } from '../sim/game';
import { TERRAIN_BEACH, TERRAIN_WATER, TERRAIN_WATER_MEDIUM } from '../sim/mapgen';
import { biomeOf, scatterPlacements, terrainPlantPlacements, createScatter, fillScatter } from './scatter';
import type { ContentAssets, ImportedTerrain } from './assets';

describe('the aesthetic scatter', () => {
  const ground = (density = 60): ImportedTerrain => ({ terrainId: 0, name: 'Grass', texture: 'g_grs', image: 'ground.png',
    dimensions: [8, 8], blendPriority: 111, blendType: 0, minimapColor: [51, 149, 39],
    scatter: [{ unitId: 1358, density, maskedDensity: 30, centered: false, key: 'grass' },
      { unitId: 411, density: 1000, maskedDensity: 0, centered: true },
      { unitId: 1366, density: 0, maskedDensity: 0, centered: false, key: 'flower' }] });

  it('uses terrain rows on every map with tile-local randomness and no simulation mutation', () => {
    const state = createGame(55, undefined, undefined, 'islands');
    state.terrain.fill(0);
    const before = JSON.stringify(state);
    const first = terrainPlantPlacements(state, { ground: ground() });
    expect(first.length).toBeGreaterThan(0);
    expect(first.every(p => p.key === 'grass')).toBe(true);
    expect(JSON.stringify(state)).toBe(before);
    expect(terrainPlantPlacements(state, { ground: ground() })).toEqual(first);
    state.seed++;
    expect(terrainPlantPlacements(state, { ground: ground() })).toEqual(first);
    const tile = Math.floor(first[0].y) * state.width + Math.floor(first[0].x);
    state.terrain[tile] = 7;
    expect(terrainPlantPlacements(state, { ground: ground() })).toEqual(first.filter(p => Math.floor(p.y) * state.width + Math.floor(p.x) !== tile));
    expect(terrainPlantPlacements(state, {})).toEqual([]);
  });

  it('hides plants beneath known foundations, retains fog memory, and handles unloaded art', () => {
    const state = createGame(55);
    state.terrain.fill(0);
    const home = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
    state.entities = [home];
    const slot = ground(1000); slot.scatter![0].centered = true;
    const assets: ContentAssets = { entities: { grass: { category: 'decoration', animations: {}, atlases: {
      idle: { image: 'grass.png', size: [4, 4], framesInFile: 1, scale: 2, frames: [{ x: 0, y: 0, w: 4, h: 4, cx: 2, cy: 2 }] },
      'idle-shadow': { image: 'grass-shadow.png', size: [8, 4], framesInFile: 1, scale: 2, frames: [{ x: 0, y: 0, w: 8, h: 4, cx: 4, cy: 2 }] },
    } } }, terrain: { ground: slot }, ages: [], skins: new Map(), textures: new Map(), playerRamps: new Map(),
      shadows: { profile: 'fixture', strength: 0.7, color: [0.1, 0.2, 0.3] } };
    const group = createScatter(state, assets);
    expect(group.children.length).toBe(state.width * state.height * 2);
    const tile = Math.floor(home.position.y) * state.width + Math.floor(home.position.x);
    const plant = group.children.find(c => c.userData.tile === tile && !c.userData.shadow)!;
    const shadow = group.children.find(c => c.userData.tile === tile && c.userData.shadow)! as THREE.Mesh;
    expect(plant.scale.x).toBe(2);
    expect(shadow.scale.x).toBe(4);
    expect(shadow.position.toArray()).toEqual(plant.position.toArray());
    expect(shadow.renderOrder).toBeLessThan(900); // receives ground fog, below bodies
    const visibility = state.visibility[1]; visibility.explored.fill(1); visibility.visible.fill(1);
    fillScatter(group, assets, state);
    expect(group.children.every(c => !c.visible)).toBe(true);
    assets.textures.set('grass.png', new THREE.Texture());
    fillScatter(group, assets, state);
    expect(plant.visible).toBe(false);
    expect(group.children.filter(c => c.userData.shadow).every(c => !c.visible)).toBe(true);
    assets.textures.set('grass-shadow.png', new THREE.Texture());
    expect(group.children.some(c => c.visible)).toBe(true);
    home.owner = 2; visibility.visible.fill(0);
    visibility.memory[home.id] = { id: home.id, kind: home.kind, owner: 2, x: home.position.x, y: home.position.y,
      hp: home.hp, maxHp: home.maxHp, lastSeenAt: state.tick };
    state.entities = [];
    fillScatter(group, assets, state);
    expect(plant.visible).toBe(false);
    expect(shadow.visible).toBe(false);
    delete visibility.memory[home.id]; visibility.visible.fill(1);
    fillScatter(group, assets, state);
    expect(plant.visible).toBe(true);
    expect(shadow.visible).toBe(true);
    expect((shadow.material as THREE.MeshBasicMaterial).opacity).toBe(0.7);
    expect((shadow.material as THREE.MeshBasicMaterial).color.toArray()).toEqual([0.1, 0.2, 0.3]);
    visibility.visible[tile] = 0;
    fillScatter(group, assets, state);
    expect((shadow.material as THREE.MeshBasicMaterial).color.toArray()).toEqual([0.1, 0.2, 0.3]);
    state.terrain[tile] = 7;
    fillScatter(group, assets, state);
    expect(plant.visible).toBe(false);
    expect(shadow.visible).toBe(false);
  });

  it('strews the biome\'s own objects, off the water, the woods and the players', () => {
    for (const seed of [3, 7, 20]) {
      const state = createGame(seed);
      const biome = biomeOf(state)!;
      const placed = scatterPlacements(state);
      expect(placed.length).toBeGreaterThan(20);
      const wanted = new Set(Object.values(biome.aesthetics!));
      const wood = new Set(state.entities
        .filter(e => e.kind === 'resource' && e.resourceKind === 'wood')
        .map(e => `${Math.floor(e.position.x)},${Math.floor(e.position.y)}`));
      const starts = state.entities.filter(e => e.kind === 'town-center');
      for (const { key, x, y } of placed) {
        expect(wanted.has(key), key).toBe(true);
        const id = state.terrain[Math.floor(y) * state.width + Math.floor(x)];
        expect([TERRAIN_WATER, TERRAIN_WATER_MEDIUM, TERRAIN_BEACH]).not.toContain(id);
        for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
          expect(wood.has(`${Math.floor(x) + dx},${Math.floor(y) + dy}`), `a ${key} in the wood at ${x},${y}`).toBe(false);
        }
        for (const s of starts) expect(Math.hypot(x - s.position.x, y - s.position.y)).toBeGreaterThanOrEqual(15);
      }
    }
  });

  it('is the same picture for the same seed and touches no state', () => {
    const a = createGame(11);
    const before = JSON.stringify(a.entities);
    const first = scatterPlacements(a);
    expect(JSON.stringify(a.entities)).toBe(before);
    expect(scatterPlacements(createGame(11))).toEqual(first);
    expect(scatterPlacements(createGame(12))).not.toEqual(first);
  });

  it('does not reveal scenery when ground fog moves beneath whole sprites', () => {
    const state = createGame(3);
    const keys = [...new Set(scatterPlacements(state).map(p => p.key))];
    const assets: ContentAssets = {
      entities: Object.fromEntries(keys.map(key => [key, {
        category: 'scenery', animations: {}, atlases: { idle: { image: 'scatter.png', size: [4, 4], framesInFile: 1,
          frames: [{ x: 0, y: 0, w: 4, h: 4, cx: 2, cy: 2 }] } },
      }])), ages: [], skins: new Map(), terrain: {}, textures: new Map([['scatter.png', new THREE.Texture()]]), playerRamps: new Map(),
    };
    const scatter = createScatter(state, assets);
    expect(scatter.children.length).toBeGreaterThan(0);
    const visibility = state.visibility[1];
    visibility.explored.fill(0); visibility.visible.fill(0);
    fillScatter(scatter, assets, state);
    expect(scatter.children.every(child => !child.visible)).toBe(true);
    const first = scatter.children[0] as THREE.Mesh;
    const tile = first.userData.tile as number;
    visibility.explored[tile] = 1;
    fillScatter(scatter, assets, state);
    expect(first.visible).toBe(true);
    expect((first.material as THREE.MeshBasicMaterial).color.r).toBe(0.5);
    expect((first.material as THREE.MeshBasicMaterial).opacity).toBe(1);
    visibility.visible[tile] = 1;
    fillScatter(scatter, assets, state);
    expect((first.material as THREE.MeshBasicMaterial).color.r).toBe(1);
    visibility.explored[tile] = 0; visibility.visible[tile] = 0;
    fillScatter(scatter, assets, state);
    expect(first.visible).toBe(false);
    fillScatter(scatter, assets, state, 1, true);
    expect(scatter.children.every(child => child.visible)).toBe(true);
  });
});
