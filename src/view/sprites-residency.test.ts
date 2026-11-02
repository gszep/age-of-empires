import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { createGame } from '../sim/game';
import type { Entity } from '../sim/types';
import type { Atlas } from './assets';
import { worldToIso } from './iso';
import { SpriteResidency } from './sprite-residency';
import { createFog, ELEVATION_PIXELS } from './world';
import { createEntityView, updateEntityView, refreshEntityTextures, dimFogSnapshot } from './sprites';
import { treeOf, fakeAssets } from './test-helpers/sprite-assets';

describe('late textures on frozen fog snapshots (#88)', () => {
  it.each([false, true])('finishes the tree mask without changing the frozen pose (body already loaded: %s)', bodyLoaded => {
    const state = createGame();
    const tree = treeOf(state);
    state.elevation[Math.floor(tree.position.y) * state.width + Math.floor(tree.position.x)] = 3;
    const assets = fakeAssets();
    const still = { frames: 1, directions: 1, frameSeconds: 0, mirroringMode: 0 };
    const atlas = (image: string): Atlas => ({ image, size: [16, 12], framesInFile: 1, scale: 2,
      frames: [{ x: 0, y: 0, w: 16, h: 12, cx: 10, cy: 7 }] });
    assets.entities['tree-oak'] = { category: 'resource', animations: { idle: still },
      atlases: { idle: atlas('tree.png'), 'idle-shadow': atlas('tree-shadow.png') } };
    const body = new THREE.Texture(), shadow = new THREE.Texture();
    if (bodyLoaded) assets.textures.set('tree.png', body);
    const view = createEntityView(assets, tree);
    updateEntityView(view, assets, state, tree, 0);
    expect(view.body.mesh.visible).toBe(bodyLoaded);
    expect(view.shadow.mesh.visible).toBe(false);
    const position = view.shadow.mesh.position.clone();
    const size = view.shadow.mesh.scale.clone();
    const uv = [...view.shadow.mesh.geometry.getAttribute('uv').array];
    const flat = worldToIso(tree.position.x, tree.position.y);
    expect(position.y).toBeCloseTo(flat.y + 0.5 + 3 * ELEVATION_PIXELS);
    dimFogSnapshot(view);
    // The real tree changes unseen; loading pixels must not reveal the chop.
    tree.amount = tree.amount! - 1;
    assets.textures.set('tree.png', body);
    assets.textures.set('tree-shadow.png', shadow);
    refreshEntityTextures(view, assets);
    expect(view.body.mesh.visible).toBe(true);
    expect(view.shadow.mesh.visible).toBe(true);
    expect((view.shadow.mesh.material as THREE.MeshBasicMaterial).map).toBe(shadow);
    expect((view.shadow.mesh.material as THREE.MeshBasicMaterial).color.getHex()).toBe(0);
    expect(view.shadow.mesh.position).toEqual(position);
    expect(view.shadow.mesh.scale).toEqual(size);
    expect([...view.shadow.mesh.geometry.getAttribute('uv').array]).toEqual(uv);
    expect(view.animationState).toBe('tree-oak/idle');
    expect(view.animationStartedAt).toBe(0);
    expect(view.shadow.pendingTexture).toBeUndefined();
    expect((view.body.mesh.material as THREE.MeshBasicMaterial).color.r).toBe(0.5);
    expect((view.body.mesh.material as THREE.MeshBasicMaterial).opacity).toBe(1);
    // Frozen views must keep touching already-bound pages (#152), and rebind
    // an evicted page without consulting the changed live tree.
    let now = 0;
    assets.spriteResidency = new SpriteResidency(assets.textures, () => now);
    body.image = { width: 16, height: 12 };
    shadow.image = { width: 16, height: 12 };
    assets.spriteResidency.add('tree.png', body);
    assets.spriteResidency.add('tree-shadow.png', shadow);
    now = 130_000;
    refreshEntityTextures(view, assets);
    assets.spriteResidency.sweep();
    expect(assets.spriteResidency.stats.evictions).toBe(0);
    now += 130_000;
    assets.spriteResidency.sweep();
    expect(assets.spriteResidency.stats.evictions).toBe(2);
    refreshEntityTextures(view, assets);
    expect(view.body.mesh.visible).toBe(false);
    const replacement = new THREE.Texture();
    assets.textures.set('tree.png', replacement);
    assets.textures.set('tree-shadow.png', new THREE.Texture());
    refreshEntityTextures(view, assets);
    expect((view.body.mesh.material as THREE.MeshBasicMaterial).map).toBe(replacement);
    expect(view.body.mesh.visible).toBe(true);
    expect((view.body.mesh.material as THREE.MeshBasicMaterial).color.r).toBe(0.5);
    expect(view.animationState).toBe('tree-oak/idle');
    expect(view.shadow.mesh.position).toEqual(position);
  });

  it('does not turn an intentionally empty shadow frame into a rectangle', () => {
    const state = createGame();
    const assets = fakeAssets();
    assets.entities.villager.atlases['idle-shadow'] = { image: 'empty-shadow.png', size: [4, 4], framesInFile: 1,
      frames: [{ x: 0, y: 0, w: 4, h: 4, cx: 0, cy: 0 }] };
    const villager = state.entities.find(e => e.kind === 'villager' && e.owner === 1)!;
    const view = createEntityView(assets, villager);
    updateEntityView(view, assets, state, villager, 0);
    expect(view.body.mesh.visible).toBe(false); // no partial first pose
    assets.entities.villager.atlases['idle-shadow'].frames[0].w = 0;
    assets.entities.villager.atlases['idle-shadow'].frames[0].h = 0;
    updateEntityView(view, assets, state, villager, 0);
    expect(view.body.mesh.visible).toBe(true); // empty layers never block a pose
    assets.textures.set('empty-shadow.png', new THREE.Texture());
    refreshEntityTextures(view, assets);
    expect(view.shadow.mesh.visible).toBe(false);
    expect(view.shadow.pendingTexture).toBeUndefined();
  });

  it.each([120, 392])('keeps ground passes under fog and whole bodies above it on a %i-tile board', size => {
    const state = createGame();
    state.width = state.height = size;
    state.elevation = new Array(size * size).fill(0);
    const assets = fakeAssets();
    assets.shadows = { profile: 'fixture', strength: 0.8, color: [0, 0, 0] };
    assets.entities.villager.atlases['idle-shadow'] = assets.entities.villager.atlases.idle;
    const villager = state.entities.find(e => e.kind === 'villager' && e.owner === 1)!;
    villager.position = { x: size - 1.5, y: size - 1.5 };
    const view = createEntityView(assets, villager);
    updateEntityView(view, assets, state, villager, 0);
    const fog = createFog(state);
    expect(view.shadow.mesh.renderOrder).toBeLessThan(fog.mesh.renderOrder);
    expect(view.body.mesh.renderOrder).toBeGreaterThan(fog.mesh.renderOrder);
    expect((view.shadow.mesh.material as THREE.MeshBasicMaterial).opacity).toBe(0.8);
    assets.terrain.farm = { terrainId: 7, blendPriority: 1, blendType: 0, name: 'farm', texture: 'farm',
      image: 'farm.png', dimensions: [3, 3], minimapColor: [0, 0, 0] };
    assets.textures.set('farm.png', new THREE.Texture());
    const farm: Entity = { ...villager, kind: 'farm', radius: 1.5 };
    const farmView = createEntityView(assets, farm);
    updateEntityView(farmView, assets, state, farm, 0);
    expect(farmView.patch).toBeDefined();
    expect(farmView.patch!.renderOrder).toBeLessThan(fog.mesh.renderOrder);
    fog.mesh.geometry.dispose(); fog.dispose();
  });
});

/**
 * A minimal imported-content stand-in: one villager animation with its
 * player-colour sheet, and a two-step ramp whose middle entry is the hue.
 */

describe('cold unit frames (#287)', () => {
  it('keeps the complete old pose moving until every new page is ready, then swaps geometry and colour together', () => {
    const state = createGame(), assets = fakeAssets();
    const entity = state.entities.find(e => e.kind === 'villager' && e.owner === 1)!;
    const art = assets.entities.villager;
    art.animations.walk = { ...art.animations.idle };
    art.atlases.walk = { image: 'walk', size: [8, 8], framesInFile: 1,
      frames: [{ x: 0, y: 0, w: 8, h: 8, cx: 4, cy: 4 }] };
    art.atlases['walk-playercolor'] = { ...art.atlases.walk, image: 'walk-color' };
    const requested = new Set<string>();
    assets.loadTexture = image => { requested.add(image); };
    let now = 0;
    assets.spriteResidency = new SpriteResidency(assets.textures, () => now);
    for (const [image, texture] of assets.textures) assets.spriteResidency.add(image, texture);
    const view = createEntityView(assets, entity);
    updateEntityView(view, assets, state, entity, 0);
    const before = view.body.mesh.position.clone(), order = view.body.mesh.renderOrder;
    const from = worldToIso(entity.position.x, entity.position.y);
    entity.activity = 'moving'; entity.position.x += 1;
    const to = worldToIso(entity.position.x, entity.position.y);
    now = 130_000;
    updateEntityView(view, assets, state, entity, 1);
    assets.spriteResidency.sweep();
    expect(assets.spriteResidency.stats.evictions).toBe(0);
    expect([...requested].sort()).toEqual(['walk', 'walk-color']);
    expect(view.body.mesh.visible && view.color.mesh.visible).toBe(true);
    expect(view.body.mesh.position.x - before.x).toBeCloseTo(to.x - from.x);
    expect(view.body.mesh.position.y - before.y).toBeCloseTo(to.y - from.y);
    expect(view.body.mesh.renderOrder).not.toBe(order);
    assets.textures.set('walk', new THREE.Texture());
    updateEntityView(view, assets, state, entity, 2);
    expect(view.body.textureImage).toBe('villager/idle.png');
    expect(view.body.mesh.scale.x).toBe(4);
    assets.textures.set('walk-color', new THREE.Texture());
    updateEntityView(view, assets, state, entity, 3);
    expect(view.body.textureImage).toBe('walk');
    expect(view.color.textureImage).toBe('walk-color');
    expect(view.body.mesh.scale.x).toBe(8);
    expect(view.body.mesh.visible && view.color.mesh.visible).toBe(true);
  });

  it('waits for colour on first appearance and retains the frame across a cold atlas-page boundary', () => {
    const state = createGame(), assets = fakeAssets();
    const entity = state.entities.find(e => e.kind === 'villager' && e.owner === 1)!;
    const art = assets.entities.villager, color = assets.textures.get('villager/idle-playercolor.png')!;
    assets.textures.delete('villager/idle-playercolor.png');
    const view = createEntityView(assets, entity);
    updateEntityView(view, assets, state, entity, 0);
    expect(view.body.mesh.visible || view.color.mesh.visible).toBe(false);
    assets.textures.set('villager/idle-playercolor.png', color);
    updateEntityView(view, assets, state, entity, 0);
    expect(view.body.mesh.visible && view.color.mesh.visible).toBe(true);
    art.animations.idle.frames = 2;
    const atlas = art.atlases.idle;
    atlas.framesInFile = 2;
    atlas.pages = [{ image: atlas.image, size: atlas.size }, { image: 'second-page', size: [4, 4] }];
    atlas.frames = [atlas.frames[0], { ...atlas.frames[0], page: 1 }];
    updateEntityView(view, assets, state, entity, .1);
    expect(view.frameIndex).toBe(0);
    expect(view.body.mesh.visible).toBe(true);
    assets.textures.set('second-page', new THREE.Texture());
    updateEntityView(view, assets, state, entity, .1);
    expect(view.frameIndex).toBe(1);
    expect(view.body.textureImage).toBe('second-page');
  });

  it('retains a complete pose across an in-place elite kind change, then binds all upgraded layers (#303)', () => {
    const state = createGame(), assets = fakeAssets();
    const entity = state.entities.find(e => e.kind === 'villager' && e.owner === 1)!;
    assets.civilizationForOwner = () => 'saracens';
    const layers = ['idle', 'idle-playercolor', 'idle-shadow', 'idle-outline'];
    const image = (kind: string, layer: string) => `civilizations/byzantines/${kind}/${layer}.png`;
    for (const kind of ['dat-unit-282', 'dat-unit-556']) {
      assets.entities[`civilizations/saracens/${kind}`] = {
        category: 'unit', animations: { ...assets.entities.villager.animations },
        atlases: Object.fromEntries(layers.map(layer => [layer,
          { ...assets.entities.villager.atlases.idle, image: image(kind, layer) }])),
      };
    }
    for (const layer of layers) assets.textures.set(image('dat-unit-282', layer), new THREE.Texture());
    const requested = new Set<string>();
    assets.loadTexture = path => { requested.add(path); };
    entity.kind = 'dat-unit-282';
    const view = createEntityView(assets, entity);
    const pieces = [view.body, view.color, view.shadow, view.outline];
    updateEntityView(view, assets, state, entity, 0);
    expect(pieces.map(p => p.textureImage)).toEqual(layers.map(layer => image('dat-unit-282', layer)));
    // Paid research promotes the same entity id; its view is not rebuilt.
    entity.kind = 'dat-unit-556';
    updateEntityView(view, assets, state, entity, 1);
    expect(view.animationState).toBe('civilizations/saracens/dat-unit-556/idle');
    expect([...requested].sort()).toEqual(layers.slice(0, 3).map(layer => image('dat-unit-556', layer)).sort());
    // Neither the chosen animation key nor pendingTexture proves the new pose
    // is drawn: #287 deliberately retains the loaded, complete old pose.
    expect(pieces.map(p => p.textureImage)).toEqual(layers.map(layer => image('dat-unit-282', layer)));
    expect(pieces.every(p => !p.pendingTexture)).toBe(true);
    for (const layer of layers.slice(0, 2)) assets.textures.set(image('dat-unit-556', layer), new THREE.Texture());
    updateEntityView(view, assets, state, entity, 2);
    expect(view.body.textureImage).toBe(image('dat-unit-282', 'idle'));
    expect(pieces.slice(0, 3).every(p => p.mesh.visible)).toBe(true);
    assets.textures.set(image('dat-unit-556', 'idle-shadow'), new THREE.Texture());
    updateEntityView(view, assets, state, entity, 3);
    expect(pieces.map(p => p.textureImage)).toEqual(layers.map(layer => image('dat-unit-556', layer)));
    expect(pieces.slice(0, 3).every(p => p.mesh.visible)).toBe(true);
    // The optional contour loads independently, without holding up the body.
    expect(view.outline.pendingTexture).toBe(image('dat-unit-556', 'idle-outline'));
    assets.textures.set(image('dat-unit-556', 'idle-outline'), new THREE.Texture());
    updateEntityView(view, assets, state, entity, 4);
    expect(pieces.every(p => !p.pendingTexture)).toBe(true);
    for (const [index, piece] of pieces.entries()) {
      const bound = piece.mapNode?.value ?? (piece.mesh.material as THREE.MeshBasicMaterial).map;
      expect(bound).toBe(assets.textures.get(image('dat-unit-556', layers[index])));
    }
  });
});
