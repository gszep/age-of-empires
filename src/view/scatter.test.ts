import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { createGame } from '../sim/game';
import { TERRAIN_BEACH, TERRAIN_WATER, TERRAIN_WATER_MEDIUM } from '../sim/mapgen';
import { biomeOf, scatterPlacements, createScatter, fillScatter } from './scatter';
import type { ContentAssets } from './assets';

describe('the aesthetic scatter', () => {
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
