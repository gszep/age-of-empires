import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { applyCommand, createGame, stepGame } from '../sim/game';
import type { Entity, GameState } from '../sim/types';
import type { Atlas, ContentAssets } from './assets';
import { worldToIso } from './iso';
import { ELEVATION_PIXELS } from './world';
import {
  chooseAnimation, createEntityView, decayFraction, farmTerrainSlot, treeIsFelled, updateEntityView,
} from './sprites';
import { run, treeOf, fakeAssets, atlas, addTextures } from './test-helpers/sprite-assets';

describe('surveyed elevation', () => {
  it('raises fallback entities onto their terrain level', () => {
    const state = createGame();
    const entity = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
    state.elevation[Math.floor(entity.position.y) * state.width + Math.floor(entity.position.x)] = 3;
    const view = createEntityView(undefined, entity);
    updateEntityView(view, undefined, state, entity, 0);
    const flat = worldToIso(entity.position.x, entity.position.y);
    expect(view.body.mesh.position.y - view.body.mesh.scale.y / 2)
      .toBeCloseTo(flat.y + 3 * ELEVATION_PIXELS);
  });
});

describe('farm placement terrain families (#116)', () => {
  it('refreshes a moved preview’s blend family and disposes the old patch', () => {
    const state = createGame(116), assets = fakeAssets();
    state.width = state.height = 16;
    state.terrain = Array.from({ length: 256 }, (_, i) => i % 16 >= 6 ? 24 : 0);
    state.elevation = new Array(256).fill(0);
    const slot = (terrainId: number, blendType: number, image: string) => ({ terrainId, blendType, image,
      texture: image, name: image, blendPriority: 100, dimensions: [10,10] as [number,number], minimapColor: [0,0,0] as [number,number,number] });
    assets.terrain = { ground: slot(0,0,'grass'), road: slot(24,5,'road'), farm: slot(7,1,'farm') };
    assets.textures.set('farm',new THREE.Texture());
    const farmland = new THREE.Texture(), road = new THREE.Texture();
    assets.blends = { tile: [97,49], modes: [], edges: {}, masksPerMode: 32, gutter: 2, solid: 31,
      native: { tile: [64,64], gutter: 2, masksPerMode: 32, modes: { 3: farmland, 6: road } } };
    const entity: Entity = { id: state.nextId++, kind: 'farm', owner: 1, position: { x: 3.5, y: 3.5 },
      hp: 100, maxHp: 100, radius: 1.5, activity: 'idle', order: { kind: 'idle' } };
    const view = createEntityView(assets,entity);
    updateEntityView(view,assets,state,entity,0);
    const previous = view.patch!;
    expect((previous.material as THREE.MeshBasicMaterial).alphaMap).toBe(farmland);
    let disposed = false; previous.geometry.addEventListener('dispose',() => { disposed = true; });
    entity.position.x = 8.5;
    updateEntityView(view,assets,state,entity,0);
    expect(disposed).toBe(true);
    expect(view.patch).not.toBe(previous);
    expect((view.patch!.material as THREE.MeshBasicMaterial).alphaMap).toBe(road);
  });
});

describe('farm construction stages (#296)', () => {
  const slot = (terrainId: number, image: string) => ({ terrainId, blendType: 1, image, texture: image, name: image,
    blendPriority: 180, dimensions: [3, 3] as [number, number], minimapColor: [0, 0, 0] as [number, number, number] });
  const farmAt = (buildProgress?: number): Entity => ({ id: 1, kind: 'farm', owner: 1, position: { x: 3.5, y: 3.5 },
    hp: 100, maxHp: 100, radius: 1.5, activity: 'idle', order: { kind: 'idle' }, buildProgress });

  it('steps through the three DAT construction terrains, then the grown farm', () => {
    const state = createGame(296), assets = fakeAssets();
    assets.terrain = {
      farm: slot(7, 'g_fm1'), 'farm-construction': slot(29, 'g_fc1'),
      'farm-construction-2': slot(30, 'g_fc2'), 'farm-construction-3': slot(31, 'g_fc3'),
    };
    for (const image of ['g_fm1', 'g_fc1', 'g_fc2', 'g_fc3']) assets.textures.set(image, new THREE.Texture());
    const entity = farmAt(0), view = createEntityView(assets, entity);
    const seen: (string | undefined)[] = [];
    for (const progress of [0, .32, .34, .65, .67, .99, undefined]) {
      entity.buildProgress = progress;
      updateEntityView(view, assets, state, entity, 0);
      expect(view.patch).toBeDefined();
      seen.push(view.patchSlot);
    }
    expect(seen).toEqual(['farm-construction', 'farm-construction', 'farm-construction-2', 'farm-construction-2',
      'farm-construction-3', 'farm-construction-3', 'farm']);
  });

  it('keeps the first construction terrain for imports without the later stages', () => {
    expect(farmTerrainSlot(farmAt(.9), { 'farm-construction': slot(29, 'g_fc1') })).toBe('farm-construction');
    expect(farmTerrainSlot(farmAt(.9), undefined)).toBe('farm-construction');
    expect(farmTerrainSlot(farmAt(), undefined)).toBe('farm');
  });
});

describe('naval composite sprites (#97)', () => {
  it('draws offset hull/sails, grows layers on upgrade, and leaves no sails when an unanimated body is removed', () => {
    const state = createGame();
    const entity: Entity = { id: state.nextId++, kind: 'galley', owner: 1, position: { x: 20, y: 20 },
      hp: 110, maxHp: 110, radius: 0.5, order: { kind: 'idle' }, activity: 'idle' };
    const assets = fakeAssets();
    const anim = { frames: 1, directions: 1, frameSeconds: 0, mirroringMode: 0 };
    const atlas = (image: string): Atlas => ({ image, size: [16, 16], framesInFile: 1,
      frames: [{ x: 0, y: 0, w: 16, h: 16, cx: 8, cy: 8 }] });
    for (const key of ['hull', 'sail', 'extra']) assets.textures.set(key, new THREE.Texture());
    const imported = { category: 'unit', animations: { idle: anim, sail: anim, extra: anim },
      atlases: { idle: atlas('hull'), sail: atlas('sail'), extra: atlas('extra') },
      animationLayers: { idle: [{ animation: 'idle', x: 0, y: 0 }, { animation: 'sail', x: 4, y: -13 }] } };
    assets.entities.galley = imported;
    assets.entities.galleon = { ...imported, animationLayers: { idle: [...imported.animationLayers.idle,
      { animation: 'extra', x: -7, y: -23 }] } };
    const view = createEntityView(assets, entity);
    const sailTexture = assets.textures.get('sail')!;
    assets.textures.delete('sail');
    updateEntityView(view, assets, state, entity, 0);
    expect(view.body.mesh.visible || view.annexes[0].mesh.visible).toBe(false);
    assets.textures.set('sail', sailTexture);
    updateEntityView(view, assets, state, entity, 0);
    expect(view.annexes[0].mesh.visible).toBe(true);
    expect(view.annexes[0].mesh.position.x - view.body.mesh.position.x).toBe(4);
    expect(view.annexes[0].mesh.position.y - view.body.mesh.position.y).toBe(13);
    entity.kind = 'galleon';
    updateEntityView(view, assets, state, entity, 1);
    expect(view.annexes).toHaveLength(2);
    expect(view.annexes[1].mesh.visible).toBe(true);
    entity.dead = true;
    updateEntityView(view, assets, state, entity, 2);
    expect(view.body.mesh.visible).toBe(false);
    expect(view.annexes.every(p => !p.mesh.visible)).toBe(true);
  });
});

describe('second attack duration', () => {
  it('keeps the chosen second clip visible after the shorter primary clip would have ended', () => {
    const state = createGame(270); state.rules = structuredClone(state.rules);
    state.rules.units.militia.attackReleaseSeconds = .1;
    state.rules.units.militia.secondAttackReleaseSeconds = .1;
    state.rules.units.militia.attackReloadSeconds = 2;
    const entity: Entity = { id: state.nextId++, kind: 'militia', owner: 1,
      position: { x: 20, y: 20 }, hp: 40, maxHp: 40, radius: .2,
      activity: 'attacking', order: { kind: 'idle' }, attackAnimation: 1, attackCooldown: 30 };
    const assets = fakeAssets();
    const animation = (frames: number) => ({ frames, directions: 1, frameSeconds: .1, mirroringMode: 0 });
    const atlas = (image: string, count: number): Atlas => ({ image, size: [16, 16], framesInFile: count,
      frames: Array.from({ length: count }, () => ({ x: 0, y: 0, w: 16, h: 16, cx: 8, cy: 8 })) });
    for (const name of ['idle', 'attack', 'attack-2']) assets.textures.set(name, new THREE.DataTexture(new Uint8Array(16 * 16 * 4), 16, 16));
    assets.entities.militia = { category: 'unit', animations: { idle: animation(1), attack: animation(2), 'attack-2': animation(10) },
      atlases: { idle: atlas('idle', 1), attack: atlas('attack', 2), 'attack-2': atlas('attack-2', 10) } };
    const view = createEntityView(assets, entity); updateEntityView(view, assets, state, entity, 10);
    expect(view.animationState).toBe('militia/attack-2');
    expect(view.body.textureImage).toBe('attack-2'); expect(view.frameIndex).toBe(5);
  });
});

describe('specialist death feedback', () => {
  it('replaces the petard body with its death particle on the saved simulation clock', () => {
    const assets = fakeAssets();
    const frames = [{ x: 0, y: 0, w: 4, h: 4, cx: 2, cy: 2 }, { x: 4, y: 0, w: 8, h: 4, cx: 4, cy: 2 }];
    const atlas: Atlas = { image: 'explosion', size: [12, 4], framesInFile: 2, frames };
    assets.textures.set('explosion', new THREE.DataTexture(new Uint8Array(12 * 4 * 4), 12, 4));
    assets.entities.petard = { category: 'unit', deathEffect: 'impact_petard',
      animations: { idle: { frames: 1, directions: 1, frameSeconds: 0, mirroringMode: 0 } },
      atlases: { idle: atlas } };
    assets.particles = { impact_petard: { atlas, loop: false, cycleSeconds: [1.5, 1.5], fadeInSeconds: 0, fadeOutSeconds: 0 } };
    const state = createGame(440);
    state.rules = structuredClone(state.rules);
    state.rules.units.petard.deathSeconds = 1.5;
    const entity: Entity = { id: state.nextId++, kind: 'petard', owner: 1, position: { x: 20, y: 20 },
      hp: 0, maxHp: 50, radius: 0.2, order: { kind: 'idle' }, activity: 'dying', dead: true, decayTicks: 15 };
    const view = createEntityView(assets, entity);
    updateEntityView(view, assets, state, entity, 999);
    expect(view.body.mesh.visible).toBe(true);
    expect(view.body.mesh.scale.x).toBe(8);
    expect(view.color.mesh.visible).toBe(false);
    entity.decayTicks = 0;
    updateEntityView(view, assets, state, entity, 1000);
    expect(view.body.mesh.visible).toBe(false);
  });
});

describe('tree chopping stages', () => {
  it('stands until the first wood is taken', () => {
    const state = createGame();
    const tree = treeOf(state);
    expect(treeIsFelled(state, tree)).toBe(false);
    expect(chooseAnimation(state, tree).name).toBe('idle');
  });

  it('drops to the felled trunk once a villager has cut into it', () => {
    const state = createGame();
    const tree = treeOf(state);
    const villager = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
    villager.position = { x: tree.position.x + 1, y: tree.position.y };
    applyCommand(state, {
      kind: 'order', player: 1, entityIds: [villager.id],
      target: tree.position, targetId: tree.id,
    });
    const full = tree.amount!;

    // One unit of wood is enough: the trunk comes down on the first chop.
    let ticks = 0;
    while (ticks < 2000 && tree.amount === full) { stepGame(state); ticks++; }
    expect(tree.amount).toBeLessThan(full);
    expect(treeIsFelled(state, tree)).toBe(true);
    expect(chooseAnimation(state, tree).name).toBe('death');
  });

  it('stays felled for the rest of its wood rather than flicking back', () => {
    const state = createGame();
    const tree = treeOf(state);
    const villager = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
    villager.position = { x: tree.position.x + 1, y: tree.position.y };
    applyCommand(state, {
      kind: 'order', player: 1, entityIds: [villager.id],
      target: tree.position, targetId: tree.id,
    });
    const full = tree.amount!;
    while (tree.amount === full) stepGame(state);

    // Sample across the rest of the harvest; it must never stand back up.
    for (let i = 0; i < 20 && (tree.amount ?? 0) > 0; i++) {
      run(state, 40);
      if ((tree.amount ?? 0) > 0) expect(chooseAnimation(state, tree).name).toBe('death');
    }
  });

  it('leaves other resource kinds looking untouched as they deplete', () => {
    const state = createGame();
    const berries = state.entities.find(e => e.kind === 'resource' && e.resourceKind === 'food')!;
    berries.amount = 1;
    // Only wood has a felled stage; a half-eaten bush keeps its idle art.
    expect(treeIsFelled(state, berries)).toBe(false);
    expect(chooseAnimation(state, berries).name).toBe('idle');
  });
});

describe('what a villager wears at a farm', () => {
  /** A builder with both of the build task's graphics, and a farmer. */
  function farmAssets(present: string[]): ContentAssets {
    const assets = fakeAssets();
    const frames = [{ x: 0, y: 0, w: 4, h: 4, cx: 2, cy: 2 }];
    const atlas = (image: string): Atlas => ({ image, size: [4, 4], framesInFile: 1, frames });
    const still = { frames: 1, directions: 1, frameSeconds: 0.1, mirroringMode: 0 };
    for (const key of ['villager-builder', 'villager-farmer', 'villager-forager']) {
      const animations: Record<string, typeof still> = {};
      const atlases: Record<string, Atlas> = {};
      for (const name of present) {
        const image = `${key}/${name}.png`;
        const texture = new THREE.DataTexture(new Uint8Array(4 * 4 * 4), 4, 4);
        texture.needsUpdate = true;
        assets.textures.set(image, texture);
        animations[name] = still;
        atlases[name] = atlas(image);
      }
      assets.entities[key] = { category: 'unit-variant', animations, atlases };
    }
    return assets;
  }

  const stage = (state: GameState) => {
    const villager = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
    const farm: Entity = {
      id: state.nextId++, kind: 'farm', owner: 1, resourceKind: 'food', amount: 175,
      position: { x: villager.position.x + 2, y: villager.position.y },
      hp: 480, maxHp: 480, radius: 1.5, activity: 'idle', order: { kind: 'idle' },
    };
    state.entities.push(farm);
    return { villager, farm };
  };

  it('sows seed while a farm goes up, and hammers at anything else', () => {
    // The DAT's build task carries two graphics: `proceeding` is the hammer
    // and `working` is the farmer's seed-sowing (issue #71).
    const state = createGame(73);
    const { villager, farm } = stage(state);
    farm.buildProgress = 0.2;
    villager.order = { kind: 'build', targetId: farm.id };
    villager.activity = 'building';
    expect(chooseAnimation(state, villager)).toEqual({ key: 'villager-builder', name: 'work-farm' });

    const barracks = state.entities.find(e => e.kind === 'town-center' && e.owner === 1)!;
    villager.order = { kind: 'build', targetId: barracks.id };
    expect(chooseAnimation(state, villager)).toEqual({ key: 'villager-builder', name: 'work' });

    // Content without the sowing sheet still shows a building going up.
    villager.order = { kind: 'build', targetId: farm.id };
    const sparse = farmAssets(['idle', 'work']);
    const view = createEntityView(sparse, villager);
    updateEntityView(view, sparse, state, villager, 0);
    expect(view.animationState).toBe('villager-builder/work');
    const full = farmAssets(['idle', 'work', 'work-farm']);
    const sown = createEntityView(full, villager);
    updateEntityView(sown, full, state, villager, 0);
    expect(sown.animationState).toBe('villager-builder/work-farm');
  });

  it('works a farm as a farmer, not a forager', () => {
    // Farming is its own task unit in the DAT (259, task unit 50) with its
    // own art; food from a bush is the forager's (issue #71).
    const state = createGame(74);
    const { villager, farm } = stage(state);
    villager.order = { kind: 'gather', targetId: farm.id };
    villager.activity = 'gathering';
    expect(chooseAnimation(state, villager)).toEqual({ key: 'villager-farmer', name: 'work' });
    villager.activity = 'moving';
    expect(chooseAnimation(state, villager)).toEqual({ key: 'villager-farmer', name: 'walk' });
    const bush = state.entities.find(e => e.kind === 'resource' && e.resourceKind === 'food')!;
    villager.order = { kind: 'gather', targetId: bush.id };
    villager.activity = 'gathering';
    expect(chooseAnimation(state, villager)).toEqual({ key: 'villager-forager', name: 'work' });
  });
});

describe('what a death leaves behind', () => {
  /** A villager and an oak with the DAT's death-then-decay chain. */
  function corpseAssets(): ContentAssets {
    const assets = fakeAssets();
    const frames = [{ x: 0, y: 0, w: 4, h: 4, cx: 2, cy: 2 }];
    const atlas = (image: string): Atlas => ({ image, size: [4, 4], framesInFile: 1, frames });
    addTextures(assets.textures, ['villager/death.png', 'villager/decay.png', 'tree-oak/idle.png', 'tree-oak/death.png', 'tree-oak/decay.png']);
    const still = { frames: 1, directions: 1, frameSeconds: 0, mirroringMode: 0 };
    Object.assign(assets.entities['villager'].animations, {
      death: { frames: 1, directions: 1, frameSeconds: 1.5, mirroringMode: 0 },
      decay: { frames: 1, directions: 1, frameSeconds: 1, mirroringMode: 0 },
    });
    Object.assign(assets.entities['villager'].atlases, {
      death: atlas('villager/death.png'), decay: atlas('villager/decay.png'),
    });
    assets.entities['tree-oak'] = {
      category: 'resource',
      animations: { idle: still, death: still, decay: still },
      atlases: {
        idle: atlas('tree-oak/idle.png'),
        death: atlas('tree-oak/death.png'),
        decay: atlas('tree-oak/decay.png'),
      },
    };
    return assets;
  }

  it('holds the corpse once the dying graphic has played', () => {
    const assets = corpseAssets();
    const state = createGame();
    const villager = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
    villager.dead = true;
    villager.activity = 'dying';
    const view = createEntityView(assets, villager);

    updateEntityView(view, assets, state, villager, 10);
    expect(view.animationState).toBe('villager/death');
    // Still dying half a second in: the chain waits for the graphic to finish.
    updateEntityView(view, assets, state, villager, 10.5);
    expect(view.animationState).toBe('villager/death');
    updateEntityView(view, assets, state, villager, 11.6);
    expect(view.animationState).toBe('villager/decay');
    // A corpse carries no player colour and casts no shadow.
    expect(view.color.mesh.visible).toBe(false);
    expect(view.shadow.mesh.visible).toBe(false);
  });

  it('resumes a resighted or reloaded corpse at its simulation age, even before any view saw the death', () => {
    const assets = corpseAssets();
    const state = createGame();
    const villager = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
    applyCommand(state, { kind: 'delete', player: 1, entityIds: [villager.id] });
    run(state, 40); // two seconds: past this fixture's 1.5-second dying graphic
    const restored = JSON.parse(JSON.stringify(state));
    const corpse = restored.entities.find((e: Entity) => e.id === villager.id)!;
    const view = createEntityView(assets, corpse);
    updateEntityView(view, assets, restored, corpse, 200);
    expect(view.animationState).toBe('villager/decay');
    const resighted = createEntityView(assets, corpse);
    updateEntityView(resighted, assets, restored, corpse, 500);
    expect(resighted.animationState).toBe(view.animationState);
    expect(resighted.frameIndex).toBe(view.frameIndex);
  });

  it('does not reset a partially played death or advance it while the simulation is paused', () => {
    const assets = corpseAssets();
    assets.entities.villager.animations.death = { frames: 4, directions: 1, frameSeconds: 0.25, mirroringMode: 0 };
    const atlas = assets.entities.villager.atlases.death;
    atlas.frames = Array.from({ length: 4 }, () => ({ ...atlas.frames[0] }));
    atlas.framesInFile = 4;
    const state = createGame();
    const villager = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
    applyCommand(state, { kind: 'delete', player: 1, entityIds: [villager.id] });
    run(state, 10);
    const view = createEntityView(assets, villager);
    updateEntityView(view, assets, state, villager, 100);
    expect(view.frameIndex).toBe(2);
    updateEntityView(view, assets, state, villager, 200);
    expect(view.frameIndex).toBe(2);
  });

  it('leaves nothing at all where a bush ran out', () => {
    // Issue #12: a spent bush briefly drew the generic tree stump, because the
    // spec asked for its `dead_unit_id` (415, STUMP -- the same unit the oak
    // names) and the importer handed it over. The DAT says the bush never gets
    // there: zero hit points and no dying graphic, so it cannot die. With no
    // death and no decay art the right picture is no picture, not the living
    // bush the idle fallback would otherwise draw.
    const assets = corpseAssets();
    const state = createGame();
    const bush = state.entities.find(e => e.kind === 'resource' && e.resourceKind === 'food')!;
    assets.entities['berries'] = {
      category: 'resource',
      animations: { idle: { frames: 1, directions: 1, frameSeconds: 0, mirroringMode: 0 } },
      atlases: { idle: assets.entities['tree-oak'].atlases['idle'] },
    };
    const view = createEntityView(assets, bush);
    updateEntityView(view, assets, state, bush, 0);
    expect(view.animationState).toBe('berries/idle');
    expect(view.body.mesh.visible).toBe(true);

    bush.amount = 0;
    bush.dead = true;
    updateEntityView(view, assets, state, bush, 1);
    expect(view.body.mesh.visible).toBe(false);
  });

  it('leaves a stump where a tree ran out', () => {
    const assets = corpseAssets();
    const state = createGame();
    const tree = treeOf(state);
    // Felled but not spent: still the trunk on the ground.
    tree.amount = 1;
    const view = createEntityView(assets, tree);
    updateEntityView(view, assets, state, tree, 0);
    expect(view.animationState).toBe('tree-oak/death');

    tree.amount = 0;
    tree.dead = true;
    // The felled trunk has no animation to play out, so the stump is immediate.
    updateEntityView(view, assets, state, tree, 1);
    expect(view.animationState).toBe('tree-oak/decay');
  });
});

describe('how far gone a carcass looks', () => {
  const carcassOf = (state: ReturnType<typeof createGame>) => {
    const animal = state.entities.find(e => e.kind === 'sheep')!;
    animal.dead = true;
    animal.hp = 0;
    return animal;
  };

  it('spends the decay art across the food rather than the clock', () => {
    const state = createGame(71);
    const sheep = carcassOf(state);
    const total = state.rules.units.sheep.foodAmount!;

    // Freshly killed and untouched: the first frame, a whole body. This is the
    // report the change answers — it used to reach the last frame, which is
    // 7% of the sprite's pixels, half a minute after the kill.
    sheep.amount = total;
    expect(decayFraction(state, sheep)).toBe(0);
    // Half eaten, half rotted.
    sheep.amount = total / 2;
    expect(decayFraction(state, sheep)).toBeCloseTo(0.5, 6);
    // The last of the food is the last of the carcass.
    sheep.amount = 0;
    expect(decayFraction(state, sheep)).toBe(1);
  });

  it('leaves a corpse with nothing on it to rot on the clock', () => {
    const state = createGame(72);
    // A living animal is not decaying at all, whatever its food.
    const sheep = state.entities.find(e => e.kind === 'sheep')!;
    expect(decayFraction(state, sheep)).toBeUndefined();
    // Nor is a soldier's corpse, which carries no food to measure against.
    const villager = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
    villager.dead = true;
    expect(decayFraction(state, villager)).toBeUndefined();
  });

  it('never asks for a frame outside the sheet, however the food lands', () => {
    const state = createGame(73);
    const sheep = carcassOf(state);
    const total = state.rules.units.sheep.foodAmount!;
    // Over-full and negative both clamp: a frame index off the end of the
    // atlas draws whatever happens to be packed next to it.
    for (const amount of [total * 2, -5, 0.0001, total - 0.0001]) {
      sheep.amount = amount;
      const fraction = decayFraction(state, sheep)!;
      expect(fraction).toBeGreaterThanOrEqual(0);
      expect(fraction).toBeLessThanOrEqual(1);
      expect(Math.min(29, Math.floor(fraction * 30))).toBeLessThan(30);
    }
  });
});
