import { existsSync, readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { createGame } from '../sim/game';
import type { Entity, GameState } from '../sim/types';
import type { AnimationInfo, Atlas, ContentAssets } from './assets';
import { worldToIso } from './iso';
import { ELEVATION_PIXELS } from './world';
import {
  chooseAnimation, createEntityView, createFlagView, gateBoxKey, updateEntityView, refreshEntityTextures,
  updateFlagView, wallShape, WALL_JOINT, WALL_POST, WALL_RUN_X, WALL_RUN_Y, type EntityView,
} from './sprites';
import { fakeAssets, annexedAssets, atlas, addTextures } from './test-helpers/sprite-assets';

describe('TC mixed cast-shadow/body deltas (#199)', () => {
  function fixture() {
    const assets = annexedAssets(), tcArt = assets.entities['town-center'];
    const idle = tcArt.animations.idle;
    const atlas = (image: string): Atlas => ({ image, size: [16, 12], scale: 2, framesInFile: 1,
      frames: [{ x: 0, y: 0, w: 16, h: 12, cx: 5, cy: 7 }] });
    tcArt.animationLayers = {};
    for (const age of ['feudal', 'castle', 'imperial']) {
      const name = `idle-${age}`, lower = `${name}-cast-body`;
      tcArt.animations[name] = tcArt.animations[lower] = idle;
      for (const key of [name, lower, `${name}-shadow`, `${lower}-shadow`, `${lower}-playercolor`, `${lower}-damage`]) {
        tcArt.atlases[key] = atlas(key);
        assets.textures.set(key, new THREE.Texture());
      }
      tcArt.animationLayers[name] = [{ animation: name, x: 0, y: 0 },
        { animation: lower, x: 0, y: 0, belowBody: true, shadow: false }];
    }
    const state = createGame(199);
    const tc = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
    state.elevation[Math.floor(tc.position.y) * state.width + Math.floor(tc.position.x)] = 2;
    return { assets, tcArt, state, tc, view: createEntityView(assets, tc) };
  }

  it('draws both colour sources, all annexes and exactly one cast shadow in every age', () => {
    const { assets, state, tc, view } = fixture();
    expect(view.annexes).toHaveLength(2); // annex + extra graphic, not one replacing the other
    updateEntityView(view, assets, state, tc, 0);
    expect(view.annexes[0].mesh.visible).toBe(true);
    expect(view.annexes[1].mesh.visible).toBe(false);
    for (const [index, age] of ['feudal', 'castle', 'imperial'].entries()) {
      state.players[1].age = index + 1;
      updateEntityView(view, assets, state, tc, index + 1);
      const lower = view.annexes[1], color = view.annexColors[1];
      expect(lower.textureImage).toBe(`idle-${age}-cast-body`);
      expect(view.body.textureImage).toBe(`idle-${age}`);
      expect(view.annexes[0].textureImage).toBe('tc/annex0-idle.png');
      expect([lower, color, view.body, view.annexes[0], view.annexColors[0], view.shadow]
        .every(p => p.mesh.visible)).toBe(true);
      expect(lower.mesh.scale.toArray()).toEqual([8, 6, 1]);
      const origin = worldToIso(tc.position.x, tc.position.y);
      expect(lower.mesh.position.toArray()).toEqual([origin.x + 1.5, origin.y + .5 + 2 * ELEVATION_PIXELS, 0]);
      expect(lower.mesh.position).toEqual(view.body.mesh.position);
      expect(view.shadow.mesh.renderOrder).toBeLessThan(lower.mesh.renderOrder);
      expect(lower.mesh.renderOrder).toBeLessThan(color.mesh.renderOrder);
      expect(color.mesh.renderOrder).toBeLessThan(view.body.mesh.renderOrder);
      expect(view.body.mesh.renderOrder).toBeLessThan(view.annexes[0].mesh.renderOrder);
      expect(view.shadow.textureImage).toBe(`idle-${age}-shadow`);
      expect(view.layerShadows!.every(p => !p.mesh.visible)).toBe(true); // no double darkening
    }
  });

  it('uses the existing building soot rule on the extra body, without painting over the TC back', () => {
    const { assets, state, tc, view } = fixture();
    state.players[1].age = 1;
    tc.hp = tc.maxHp / 4;
    updateEntityView(view, assets, state, tc, 0);
    const soot = view.layerDamage![1];
    expect(soot.mesh.visible).toBe(true);
    expect(soot.textureImage).toBe('idle-feudal-cast-body-damage');
    expect((soot.mesh.material as THREE.MeshBasicMaterial).opacity).toBe(.75);
    expect((soot.mesh.material as THREE.MeshBasicMaterial).color.getHex()).toBe(0);
    expect(soot.mesh.position).toEqual(view.annexes[1].mesh.position);
    expect(soot.mesh.renderOrder).toBeGreaterThan(view.annexColors[1].mesh.renderOrder);
    expect(soot.mesh.renderOrder).toBeLessThan(view.body.mesh.renderOrder);
    tc.hp = tc.maxHp;
    updateEntityView(view, assets, state, tc, 1);
    expect(soot.mesh.visible).toBe(false);
    expect(soot.pendingTexture).toBeUndefined();
  });

  it.each(['construction', 'death', 'dark-age'] as const)('retires pending lower-body pages on %s without fog resurrection', transition => {
    const { assets, state, tc, view, tcArt } = fixture();
    state.players[1].age = 1;
    tc.hp = tc.maxHp / 2;
    const image = 'idle-feudal-cast-body', texture = assets.textures.get(image)!;
    assets.textures.delete(image);
    const sootImage = image + '-damage', sootTexture = assets.textures.get(sootImage)!;
    assets.textures.delete(sootImage);
    updateEntityView(view, assets, state, tc, 0);
    const lower = view.annexes[1];
    expect(lower.pendingTexture).toBe(image);
    expect(view.layerDamage![1].pendingTexture).toBe(sootImage);
    if (transition === 'construction') {
      tc.buildProgress = .5;
      tcArt.animations.construction = tcArt.animations.idle;
      tcArt.atlases.construction = tcArt.atlases.idle;
    } else if (transition === 'death') tc.dead = true;
    else state.players[1].age = 0;
    updateEntityView(view, assets, state, tc, 1);
    assets.textures.set(image, texture);
    assets.textures.set(sootImage, sootTexture);
    refreshEntityTextures(view, assets);
    expect(lower.pendingTexture).toBeUndefined();
    expect(lower.mesh.visible).toBe(false);
    expect(view.annexColors[1].mesh.visible).toBe(false);
    expect(view.layerDamage![1].mesh.visible).toBe(false);
    expect(view.layerDamage![1].pendingTexture).toBeUndefined();
    expect(view.shadow.mesh.visible).toBe(false);
    if (transition === 'dark-age') expect(view.annexes[0].mesh.visible).toBe(true);
  });
});

describe("the Enhanced Graphics Pack's x2 art", () => {
  /** The villager's idle at x2: an 8x8 frame with its hotspot at (4, 6), on
   * the second of two pages, beside the x1 sheet's 4x4 at (2, 3). */
  function x1Assets(): ContentAssets {
    const assets = fakeAssets();
    assets.entities.villager.atlases.idle.frames = [{ x: 0, y: 0, w: 4, h: 4, cx: 2, cy: 3 }];
    return assets;
  }
  function x2Assets(): ContentAssets {
    const assets = x1Assets();
    addTextures(assets.textures, ['villager/idle-p1.png', 'villager/idle-playercolor-p1.png'], 16, 16);
    const paged = (image: string): Atlas => ({
      image, size: [8, 8], framesInFile: 1, scale: 2,
      frames: [{ x: 4, y: 4, w: 8, h: 8, cx: 4, cy: 6, page: 1 }],
      pages: [{ image, size: [8, 8] }, { image: image.replace('.png', '-p1.png'), size: [16, 16] }],
    });
    assets.entities.villager.atlases = {
      idle: paged('villager/idle.png'), 'idle-playercolor': paged('villager/idle-playercolor.png'),
    };
    return assets;
  }

  it('draws at half size, anchored where the x1 frame anchors', () => {
    const state = createGame();
    const villager = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
    const x1 = createEntityView(x1Assets(), villager);
    updateEntityView(x1, x1Assets(), state, villager, 0);
    const x2 = createEntityView(x2Assets(), villager);
    updateEntityView(x2, x2Assets(), state, villager, 0);
    expect(x2.body.mesh.scale.x).toBe(4);
    expect(x2.body.mesh.scale.y).toBe(4);
    expect(x2.body.mesh.position.x).toBe(x1.body.mesh.position.x);
    expect(x2.body.mesh.position.y).toBe(x1.body.mesh.position.y);
  });

  it('samples the page the frame is on, in that page\'s pixels', () => {
    const state = createGame();
    const villager = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
    const assets = x2Assets();
    const view = createEntityView(assets, villager);
    updateEntityView(view, assets, state, villager, 0);
    expect((view.body.mesh.material as THREE.MeshBasicMaterial).map).toBe(assets.textures.get('villager/idle-p1.png'));
    expect(view.color?.mapNode?.value).toBe(assets.textures.get('villager/idle-playercolor-p1.png'));
    // The frame's box on a 16x16 page, half a texel in: (4..12)/16.
    const uv = view.body.mesh.geometry.getAttribute('uv') as THREE.BufferAttribute;
    expect(uv.getX(0)).toBeCloseTo(4 / 16 + 0.5 / 16);
    expect(uv.getX(1)).toBeCloseTo(12 / 16 - 0.5 / 16);
    expect(uv.getY(0)).toBeCloseTo(1 - 4 / 16 - 0.5 / 16);
    expect(uv.getY(2)).toBeCloseTo(1 - 12 / 16 + 0.5 / 16);
  });
});

describe('what a building wears in each age', () => {
  /** A barracks with Dark and Castle art but nothing for the Feudal Age. */
  function agedAssets(present: string[]): ContentAssets {
    const assets = fakeAssets();
    const frames = [{ x: 0, y: 0, w: 4, h: 4, cx: 2, cy: 2 }];
    const atlas = (image: string): Atlas => ({ image, size: [4, 4], framesInFile: 1, frames });
    const still = { frames: 1, directions: 1, frameSeconds: 0, mirroringMode: 0 };
    const animations: Record<string, typeof still> = {};
    const atlases: Record<string, Atlas> = {};
    for (const name of present) {
      const image = `barracks/${name}.png`;
      const texture = new THREE.DataTexture(new Uint8Array(4 * 4 * 4), 4, 4);
      texture.needsUpdate = true;
      assets.textures.set(image, texture);
      animations[name] = still;
      atlases[name] = atlas(image);
    }
    assets.entities['barracks'] = { category: 'building', animations, atlases };
    return assets;
  }

  const barracksOf = (state: GameState): Entity => {
    const rules = state.rules.buildings.barracks;
    const entity: Entity = {
      id: state.nextId++, kind: 'barracks', owner: 1, position: { x: 30.5, y: 30.5 },
      hp: rules.hp, maxHp: rules.hp, radius: rules.radius,
      activity: 'idle', order: { kind: 'idle' },
    };
    state.entities.push(entity);
    return entity;
  };

  it('names the age its owner has reached', () => {
    // Ageing up in AoE2 replaces the building with the next age's unit, so
    // what it draws is a question about the owner's age (issue #13).
    const state = createGame(70);
    const barracks = barracksOf(state);
    state.players[1].age = 0;
    expect(chooseAnimation(state, barracks).name).toBe('idle');
    state.players[1].age = 1;
    expect(chooseAnimation(state, barracks).name).toBe('idle-feudal');
    state.players[1].age = 2;
    expect(chooseAnimation(state, barracks).name).toBe('idle-castle');
    state.players[1].age = 3;
    expect(chooseAnimation(state, barracks).name).toBe('idle-imperial');
  });

  it('falls back through the older ages, not straight to the base art', () => {
    // Not every building is restyled in every age — a market first exists in
    // the Feudal Age and changes only in the Castle — so a missing variant has
    // to drop to the newest one that exists, and only then to `idle`.
    const state = createGame(71);
    const barracks = barracksOf(state);

    const sparse = agedAssets(['idle', 'idle-castle']);
    state.players[1].age = 1;
    const a = createEntityView(sparse, barracks);
    updateEntityView(a, sparse, state, barracks, 0);
    expect(a.animationState).toBe('barracks/idle');
    state.players[1].age = 2;
    updateEntityView(a, sparse, state, barracks, 1);
    expect(a.animationState).toBe('barracks/idle-castle');

    // Feudal art but no Castle art: the Castle Age keeps wearing the Feudal.
    const older = agedAssets(['idle', 'idle-feudal']);
    state.players[1].age = 2;
    const b = createEntityView(older, barracks);
    updateEntityView(b, older, state, barracks, 0);
    expect(b.animationState).toBe('barracks/idle-feudal');
  });

  it('falls as the age it stands in, and leaves that age\'s rubble', () => {
    // A razed Feudal house played the Dark Age collapse whatever the age
    // (issue #61). The variant the age technology upgrades a building into
    // carries its own dying graphic and rubble unit, so both follow the
    // owner's age -- and fall back through the older ages exactly as the
    // standing art does, because an age that reuses the previous sheet is
    // not imported twice.
    const state = createGame(72);
    const barracks = barracksOf(state);
    const assets = agedAssets(['idle', 'idle-feudal', 'death', 'death-feudal', 'decay', 'decay-feudal']);
    assets.entities['barracks'].animations['death'] = { frames: 2, directions: 1, frameSeconds: 1, mirroringMode: 0 };
    assets.entities['barracks'].animations['death-feudal'] = { frames: 2, directions: 1, frameSeconds: 1, mirroringMode: 0 };
    barracks.dead = true;
    barracks.activity = 'dying';

    state.players[1].age = 1;
    expect(chooseAnimation(state, barracks).name).toBe('death-feudal');
    const feudal = createEntityView(assets, barracks);
    updateEntityView(feudal, assets, state, barracks, 10);
    expect(feudal.animationState).toBe('barracks/death-feudal');
    updateEntityView(feudal, assets, state, barracks, 12.5);
    expect(feudal.animationState).toBe('barracks/decay-feudal');

    // Castle Age with no Castle collapse: the Feudal one, not the Dark Age one.
    state.players[1].age = 2;
    expect(chooseAnimation(state, barracks).name).toBe('death-castle');
    const castle = createEntityView(assets, barracks);
    updateEntityView(castle, assets, state, barracks, 20);
    expect(castle.animationState).toBe('barracks/death-feudal');
    updateEntityView(castle, assets, state, barracks, 22.5);
    expect(castle.animationState).toBe('barracks/decay-feudal');

    // And in the Dark Age, the Dark Age art.
    state.players[1].age = 0;
    const dark = createEntityView(assets, barracks);
    updateEntityView(dark, assets, state, barracks, 30);
    expect(dark.animationState).toBe('barracks/death');
    updateEntityView(dark, assets, state, barracks, 32.5);
    expect(dark.animationState).toBe('barracks/decay');
  });

  /**
   * A house as the DAT gives it: three models in every age, and no frame
   * duration, because they are alternatives rather than a sequence.
   */
  function houseAssets(): ContentAssets {
    const assets = fakeAssets();
    const frames = [
      { x: 0, y: 0, w: 4, h: 4, cx: 2, cy: 2 },
      { x: 4, y: 0, w: 4, h: 4, cx: 2, cy: 2 },
      { x: 8, y: 0, w: 4, h: 4, cx: 2, cy: 2 },
    ];
    const animations: Record<string, AnimationInfo> = {};
    const atlases: Record<string, Atlas> = {};
    for (const name of ['idle', 'idle-feudal']) {
      const image = `house/${name}.png`;
      const texture = new THREE.DataTexture(new Uint8Array(12 * 4 * 4), 12, 4);
      texture.needsUpdate = true;
      assets.textures.set(image, texture);
      animations[name] = { frames: 3, directions: 1, frameSeconds: 0, mirroringMode: 0 };
      atlases[name] = { image, size: [12, 4], framesInFile: 3, frames };
    }
    assets.entities['house'] = { category: 'building', animations, atlases };
    return assets;
  }

  const houseOf = (state: GameState, x: number): Entity => {
    const rules = state.rules.buildings.house;
    const entity: Entity = {
      id: state.nextId++, kind: 'house', owner: 1, position: { x, y: 30.5 },
      hp: rules.hp, maxHp: rules.hp, radius: rules.radius,
      activity: 'idle', order: { kind: 'idle' },
    };
    state.entities.push(entity);
    return entity;
  };

  it('keeps one of the three house models for the life of the house', () => {
    // Issue #20: the rule that picks a variation was keyed on the literal name
    // `idle`, so a Feudal house drawing `idle-feudal` fell through to the
    // animation path -- where a zero frame time takes the 0.1s default -- and
    // cycled all three models three times a second.
    const assets = houseAssets();
    const state = createGame(72);
    const house = houseOf(state, 30.5);
    const view = createEntityView(assets, house);

    for (const age of [0, 1]) {
      state.players[1].age = age;
      updateEntityView(view, assets, state, house, 0);
      const first = view.frameIndex;
      expect(first).toBeLessThan(3);
      for (const time of [0.1, 0.35, 5]) {
        updateEntityView(view, assets, state, house, time);
        expect(view.frameIndex).toBe(first);
      }
    }
  });

  it('does not give every house on the street the same model', () => {
    const assets = houseAssets();
    const state = createGame(73);
    state.players[1].age = 1;
    const drawn = new Set<number | undefined>();
    for (let i = 0; i < 6; i++) {
      const house = houseOf(state, 30.5 + i);
      const view = createEntityView(assets, house);
      updateEntityView(view, assets, state, house, 0);
      drawn.add(view.frameIndex);
    }
    expect(drawn.size).toBeGreaterThan(1);
  });

  it('still reads a foundation\'s frames as the stages of going up', () => {
    // The variation rule sits behind the construction rule for this reason:
    // a palisade foundation also has three frames and no frame duration, and
    // they are stages, not alternatives.
    const assets = houseAssets();
    const state = createGame(74);
    const house = houseOf(state, 30.5);
    assets.entities['house'].animations['construction'] =
      { frames: 3, directions: 1, frameSeconds: 0, mirroringMode: 0 };
    assets.entities['house'].atlases['construction'] =
      assets.entities['house'].atlases['idle'];
    const view = createEntityView(assets, house);
    house.buildProgress = 0;
    updateEntityView(view, assets, state, house, 0);
    expect(view.frameIndex).toBe(0);
    house.buildProgress = 0.9;
    updateEntityView(view, assets, state, house, 1);
    expect(view.frameIndex).toBe(2);
  });
});

describe('a building on fire', () => {
  /** A barracks with a soot layer and the DAT's three stages of flames. */
  function burningAssets(): ContentAssets {
    const assets = fakeAssets();
    const frames = [{ x: 0, y: 0, w: 4, h: 4, cx: 2, cy: 2 }];
    const atlas = (image: string): Atlas => ({ image, size: [4, 4], framesInFile: 1, frames });
    addTextures(assets.textures, ['barracks/idle.png', 'barracks/idle-damage.png', 'particles/fire_small_left.png']);
    const still = { frames: 1, directions: 1, frameSeconds: 0, mirroringMode: 0 };
    assets.entities['barracks'] = {
      category: 'building',
      animations: { idle: still },
      atlases: { idle: atlas('barracks/idle.png'), 'idle-damage': atlas('barracks/idle-damage.png') },
      damageStages: {
        idle: [
          { percent: 25, flames: [{ effect: 'fire_small_left', offset: [10, -20] }] },
          { percent: 50, flames: [{ effect: 'fire_small_left', offset: [10, -20] }, { effect: 'fire_small_left', offset: [-30, 5] }] },
          { percent: 75, flames: [{ effect: 'fire_small_left', offset: [0, 0] }, { effect: 'fire_small_left', offset: [1, 1] }, { effect: 'fire_small_left', offset: [2, 2] }] },
        ],
      },
    };
    assets.particles = {
      fire_small_left: {
        atlas: { image: 'particles/fire_small_left.png', size: [4, 4], framesInFile: 1, frames },
        loop: true, cycleSeconds: [2.9, 3.1], fadeInSeconds: 0.75, fadeOutSeconds: 0.75,
      },
    };
    return assets;
  }

  const barracksOf = (state: GameState): Entity => {
    const entity: Entity = {
      id: state.nextId++, kind: 'barracks', owner: 1, position: { x: 30.5, y: 30.5 },
      hp: 1200, maxHp: 1200, radius: 1.5, activity: 'idle', order: { kind: 'idle' },
    };
    state.entities.push(entity);
    return entity;
  };
  const lit = (view: EntityView) => view.flames.filter(piece => piece.mesh.visible).length;
  const soot = (view: EntityView) => view.damage!.mesh.visible
    ? (view.damage!.mesh.material as THREE.MeshBasicMaterial).opacity : 0;

  it('blackens by the hit points lost and lights the stage the DAT names', () => {
    // Issue #73: the SLD damage layer is soot drawn at the fraction lost;
    // `damage_graphics` light flames past 25, 50 and 75 percent lost.
    const assets = burningAssets();
    const state = createGame(75);
    const barracks = barracksOf(state);
    const view = createEntityView(assets, barracks);

    updateEntityView(view, assets, state, barracks, 0);
    expect(soot(view)).toBe(0);
    expect(lit(view)).toBe(0);

    barracks.hp = 840;   // 30% lost
    updateEntityView(view, assets, state, barracks, 1);
    expect(soot(view)).toBeCloseTo(0.3, 6);
    expect(lit(view)).toBe(1);
    // The flame sits where the DAT puts it: its offset from the hotspot in
    // sprite pixels, y down, so -20 is twenty pixels up the screen.
    const at = view.flames[0].mesh.position;
    const iso = worldToIso(barracks.position.x, barracks.position.y);
    expect(at.x - iso.x).toBeCloseTo(10, 6);
    expect(at.y - iso.y).toBeCloseTo(20, 6);

    barracks.hp = 500;   // 58% lost
    updateEntityView(view, assets, state, barracks, 2);
    expect(lit(view)).toBe(2);
    barracks.hp = 100;   // 92% lost
    updateEntityView(view, assets, state, barracks, 3);
    expect(lit(view)).toBe(3);
    expect(soot(view)).toBeCloseTo(1 - 100 / 1200, 6);
  });

  it('fades a new stage in over the effect\'s own seconds', () => {
    const assets = burningAssets();
    const state = createGame(76);
    const barracks = barracksOf(state);
    const view = createEntityView(assets, barracks);
    barracks.hp = 840;
    updateEntityView(view, assets, state, barracks, 10);
    const opacity = () => (view.flames[0].mesh.material as THREE.MeshBasicMaterial).opacity;
    expect(opacity()).toBe(0);
    updateEntityView(view, assets, state, barracks, 10.375);
    expect(opacity()).toBeCloseTo(0.5, 6);
    updateEntityView(view, assets, state, barracks, 11);
    expect(opacity()).toBe(1);
  });

  it('shows nothing on a foundation, a corpse, or after repair', () => {
    const assets = burningAssets();
    const state = createGame(77);
    const barracks = barracksOf(state);
    const view = createEntityView(assets, barracks);
    barracks.hp = 300;
    barracks.buildProgress = 0.25;
    updateEntityView(view, assets, state, barracks, 0);
    expect(lit(view)).toBe(0);
    expect(soot(view)).toBe(0);
    barracks.buildProgress = undefined;
    updateEntityView(view, assets, state, barracks, 1);
    expect(lit(view)).toBe(3);
    barracks.hp = 1200;
    updateEntityView(view, assets, state, barracks, 2);
    expect(lit(view)).toBe(0);
    expect(soot(view)).toBe(0);
    barracks.hp = 300;
    barracks.dead = true;
    updateEntityView(view, assets, state, barracks, 3);
    expect(lit(view)).toBe(0);
  });
});

describe('garrison flag overlays (#137)', () => {
  it('uses owned age offsets and x2 scale, colours the flag, and hides it when empty or dead', () => {
    const assets = annexedAssets();
    const state = createGame();
    const tc = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
    const worker = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
    const source = assets.entities['town-center'];
    source.animations.flag = { frames: 1, directions: 1, frameSeconds: 0.1, mirroringMode: 0 };
    const atlas: Atlas = { image: 'flag.png', scale: 2, size: [8, 8], framesInFile: 1,
      frames: [{ x: 0, y: 0, w: 8, h: 8, cx: 4, cy: 4 }] };
    source.atlases.flag = atlas;
    source.atlases['flag-playercolor'] = { ...atlas, image: 'flag-color.png' };
    assets.textures.set('flag.png', new THREE.Texture());
    assets.textures.set('flag-color.png', new THREE.Texture());
    source.garrisonFlags = { idle: [{ animation: 'flag', x: 12, y: -40 }],
      'idle-feudal': [{ animation: 'flag', x: -7, y: -80 }, { animation: 'flag', x: 21, y: -65 }] };
    tc.garrison = [worker];
    const view = createEntityView(assets, tc);
    const before = JSON.stringify(state);
    updateEntityView(view, assets, state, tc, 0);
    const iso = worldToIso(tc.position.x, tc.position.y);
    expect(view.garrisonFlags![0].mesh.visible).toBe(true);
    expect(view.garrisonFlags![0].mesh.scale.x).toBe(4);
    expect(view.garrisonFlags![0].mesh.position.x).toBe(iso.x + 12);
    expect(view.garrisonFlags![0].mesh.position.y).toBe(iso.y + 40);
    expect(view.garrisonColors![0].mesh.visible).toBe(true);
    expect(JSON.stringify(state)).toBe(before);
    state.players[1].age = 1;
    updateEntityView(view, assets, state, tc, 1);
    expect(view.garrisonFlags!.filter(p => p.mesh.visible)).toHaveLength(2);
    expect(view.garrisonFlags![0].mesh.position.y).toBe(iso.y + 80);
    tc.garrison = undefined;
    updateEntityView(view, assets, state, tc, 2);
    expect(view.garrisonFlags!.every(p => !p.mesh.visible)).toBe(true);
    expect(view.garrisonColors!.every(p => !p.mesh.visible)).toBe(true);
    // A remembered occupancy flag is independent of the unseen live count.
    updateEntityView(view, assets, state, tc, 0, true);
    expect(view.garrisonFlags!.filter(p => p.mesh.visible)).toHaveLength(2);
    tc.dead = true;
    updateEntityView(view, assets, state, tc, 3, true);
    expect(view.garrisonFlags!.every(p => !p.mesh.visible)).toBe(true);
  });

  it.each([true, false])('shows stored relic occupancy with imported assets=%s (#291)', imported => {
    const assets = annexedAssets();
    const state = createGame();
    const relic: Entity = { id: state.nextId++, kind: 'relic', owner: 0, position: { x: 40, y: 40 },
      hp: 100, maxHp: 100, radius: .5, activity: 'idle', order: { kind: 'idle' } };
    const monastery: Entity = { ...relic, id: state.nextId++, kind: 'monastery', owner: 1,
      radius: 1.5, relics: [relic] };
    state.entities.push(monastery);
    // A real monastery asset entry, not the TC-only annex fixture.
    const source = assets.entities.monastery = { ...assets.entities['town-center'], annexes: undefined };
    source.animations.flag = { frames: 1, directions: 1, frameSeconds: 0.1, mirroringMode: 0 };
    const atlas: Atlas = { image: 'flag.png', scale: 2, size: [8, 8], framesInFile: 1,
      frames: [{ x: 0, y: 0, w: 8, h: 8, cx: 4, cy: 4 }] };
    source.atlases.flag = atlas;
    source.atlases['flag-playercolor'] = { ...atlas, image: 'flag-color.png' };
    assets.textures.set('flag.png', new THREE.Texture());
    assets.textures.set('flag-color.png', new THREE.Texture());
    source.garrisonFlags = { idle: [{ animation: 'flag', x: -74, y: -221 }] };
    const content = imported ? assets : undefined;
    const view = createEntityView(content, monastery);
    const before = JSON.stringify(state);
    updateEntityView(view, content, state, monastery, 0);
    expect(view.garrisonFlags?.filter(p => p.mesh.visible)).toHaveLength(1);
    expect(JSON.stringify(state)).toBe(before);
    if (imported) {
      const iso = worldToIso(monastery.position.x, monastery.position.y);
      expect(view.garrisonFlags![0].mesh.position.x).toBe(iso.x - 74);
      expect(view.garrisonFlags![0].mesh.position.y).toBe(iso.y + 221);
      expect(view.garrisonColors![0].mesh.visible).toBe(true);
    }
    // Explicit fog memory must override even live stored relics.
    updateEntityView(view, content, state, monastery, 0, false);
    expect(view.garrisonFlags!.every(p => !p.mesh.visible)).toBe(true);
    monastery.relics = [];
    updateEntityView(view, content, state, monastery, 1, true);
    expect(view.garrisonFlags!.filter(p => p.mesh.visible)).toHaveLength(1);
    updateEntityView(view, content, state, monastery, 2);
    expect(view.garrisonFlags!.every(p => !p.mesh.visible)).toBe(true);
    expect(view.garrisonColors!.every(p => !p.mesh.visible)).toBe(true);
    monastery.relics = [relic];
    monastery.buildProgress = .5;
    updateEntityView(view, content, state, monastery, 3);
    expect(view.garrisonFlags!.every(p => !p.mesh.visible)).toBe(true);
    monastery.buildProgress = undefined;
    monastery.dead = true;
    updateEntityView(view, content, state, monastery, 4);
    expect(view.garrisonFlags!.every(p => !p.mesh.visible)).toBe(true);
    const monk: Entity = { ...monastery, kind: 'monk', dead: false };
    const monkView = createEntityView(undefined, monk);
    updateEntityView(monkView, undefined, state, monk, 0);
    expect(monkView.garrisonFlags ?? []).toHaveLength(0);
  });
});

describe('wall connection shapes', () => {
  const wallAt = (state: GameState, x: number, y: number) => {
    const rules = state.rules.buildings['palisade-wall'];
    const entity: Entity = {
      id: state.nextId++, kind: 'palisade-wall', owner: 1, position: { x, y },
      hp: rules.hp, maxHp: rules.hp, radius: rules.radius,
      activity: 'idle', order: { kind: 'idle' },
    };
    state.entities.push(entity);
    return entity;
  };

  it('draws a lone post, a straight run, and a corner differently', () => {
    const state = createGame(61);
    const alone = wallAt(state, 20.5, 4.5);
    const post = wallShape(state, alone);

    const state2 = createGame(61);
    const middle = wallAt(state2, 20.5, 4.5);
    wallAt(state2, 21.5, 4.5);
    wallAt(state2, 19.5, 4.5);
    const straight = wallShape(state2, middle);

    const state3 = createGame(61);
    const bend = wallAt(state3, 20.5, 4.5);
    wallAt(state3, 21.5, 4.5);
    wallAt(state3, 20.5, 5.5);
    const corner = wallShape(state3, bend);

    for (const shape of [post, straight, corner]) {
      expect(shape).toBeGreaterThanOrEqual(0);
      expect(shape).toBeLessThan(5);
    }
    expect(new Set([post, straight, corner]).size).toBe(3);
  });

  it('indexes frames the imported palisade actually has', () => {
    // The renderer clamps the shape to the atlas (`Math.min(framesInFile - 1,
    // ...)`), so a mapping that ran off the end would quietly collapse the
    // corner and the post onto the same picture rather than fail. Which delta
    // means what is a measurement -- each was composited into the arrangement
    // it has to serve -- and this asserts the numbers still land somewhere.
    const path = 'public/imported/aoe2/manifest.json';
    if (!existsSync(path)) return; // open-content checkout: nothing to check
    const manifest = JSON.parse(readFileSync(path, 'utf8')) as {
      entities: Record<string, { atlases: Record<string, { framesInFile: number }> }>;
    };
    const frames = manifest.entities['palisade-wall'].atlases['idle'].framesInFile;
    const shapes = [WALL_RUN_X, WALL_RUN_Y, WALL_JOINT, WALL_POST];
    for (const shape of shapes) expect(shape).toBeLessThan(frames);
    expect(new Set(shapes).size).toBe(shapes.length);
  });

  it('reads the two axes as different runs, and joins only its own walls', () => {
    const east = createGame(62);
    const alongX = wallAt(east, 20.5, 4.5);
    wallAt(east, 21.5, 4.5);
    wallAt(east, 19.5, 4.5);

    const south = createGame(62);
    const alongY = wallAt(south, 20.5, 4.5);
    wallAt(south, 20.5, 5.5);
    wallAt(south, 20.5, 3.5);
    expect(wallShape(east, alongX)).not.toBe(wallShape(south, alongY));

    // A neighbour belonging to somebody else is a wall to walk round, not to
    // join: AoE2 does not connect a palisade to an enemy's.
    const mixed = createGame(63);
    const mine = wallAt(mixed, 20.5, 4.5);
    const theirs = wallAt(mixed, 21.5, 4.5);
    theirs.owner = 2;
    expect(wallShape(mixed, mine)).toBe(wallShape(createGame(63), wallAt(createGame(63), 20.5, 4.5)));
  });
});

describe('gates', () => {
  const gateAt = (state: GameState, x: number, y: number, along: 'x' | 'y'): Entity => {
    const rules = state.rules.buildings['palisade-gate'];
    const entity: Entity = {
      id: state.nextId++, kind: 'palisade-gate', owner: 1, position: { x, y },
      hp: rules.hp, maxHp: rules.hp, radius: rules.radius,
      footprint: along === 'x' ? { x: 1, y: 0.5 } : { x: 0.5, y: 1 },
      activity: 'idle', order: { kind: 'idle' },
    };
    state.entities.push(entity);
    return entity;
  };

  it('draws the gate unit whose stakes run the way the wall does', () => {
    // Issue #15. The projection has AoE2's own handedness (+x down-left),
    // so the unit that obstructs 2x1 along x (789, `..._ne_closed`, stakes
    // down-left) is also the one whose art lies along an x run; while the
    // projection was mirrored the two questions had different answers.
    const state = createGame(64);
    expect(chooseAnimation(state, gateAt(state, 20, 4.5, 'x')).key).toBe('palisade-gate');
    expect(chooseAnimation(state, gateAt(state, 24.5, 8, 'y')).key).toBe('palisade-gate-y');
    expect(gateBoxKey(gateAt(state, 20, 4.5, 'x'))).toBe('palisade-gate');
    expect(gateBoxKey(gateAt(state, 24.5, 8, 'y'))).toBe('palisade-gate-y');
  });

  it('draws only the authoritative gate state, regardless of nearby units', () => {
    const state = createGame(65);
    // Somewhere nobody starts, so only the units this test places are near.
    const gate = gateAt(state, 26, 26.5, 'x');
    expect(chooseAnimation(state, gate).name).toBe('idle');

    const mine = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
    mine.position = { x: 26.5, y: 26.5 };
    expect(chooseAnimation(state, gate).name).toBe('idle');
    gate.gateState = 'open';
    expect(chooseAnimation(state, gate).name).toBe('open');

    mine.position = { x: 40, y: 40 };
    const theirs = state.entities.find(e => e.owner === 2 && e.kind === 'villager')!;
    theirs.position = { x: 26.5, y: 26.5 };
    expect(chooseAnimation(state, gate).name).toBe('open');
    gate.gateState = 'blocked';
    expect(chooseAnimation(state, gate).name).toBe('idle');
  });

  it('is a foundation before it is a gate, however close its owner stands', () => {
    const state = createGame(66);
    const gate = gateAt(state, 26, 26.5, 'x');
    gate.buildProgress = 0.4;
    const mine = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
    mine.position = { x: 26.5, y: 26.5 };
    expect(chooseAnimation(state, gate).name).toBe('construction');
  });

  it('counts as part of the run the walls beside it draw', () => {
    const state = createGame(67);
    // A wall at (24.5, 30.5) with a gate covering (25, 26) of the same row.
    const wall = {
      id: state.nextId++, kind: 'palisade-wall' as const, owner: 1 as const,
      position: { x: 24.5, y: 30.5 }, hp: 1, maxHp: 1, radius: 0.5,
      activity: 'idle' as const, order: { kind: 'idle' as const },
    };
    state.entities.push(wall);
    expect(wallShape(state, wall)).toBe(WALL_POST);
    gateAt(state, 26, 30.5, 'x');
    expect(wallShape(state, wall)).toBe(WALL_RUN_X);
  });
});

describe('the gather-point flag', () => {
  function flagAssets(): ContentAssets {
    const assets = fakeAssets();
    const frames = [
      { x: 0, y: 0, w: 4, h: 4, cx: 2, cy: 2 },
      { x: 4, y: 0, w: 4, h: 4, cx: 2, cy: 2 },
    ];
    addTextures(assets.textures, ['rally-flag/idle.png', 'rally-flag/idle-playercolor.png'], 8, 4);
    const atlas = (image: string): Atlas => ({ image, size: [8, 4], framesInFile: 2, frames });
    assets.entities['rally-flag'] = {
      category: 'effect',
      animations: { idle: { frames: 2, directions: 1, frameSeconds: 0.1, mirroringMode: 0 } },
      atlases: {
        idle: atlas('rally-flag/idle.png'),
        'idle-playercolor': atlas('rally-flag/idle-playercolor.png'),
      },
    };
    return assets;
  }

  it('waves the owner\'s flag where the rally point is', () => {
    const assets = flagAssets();
    const view = createFlagView(assets, 1);
    updateFlagView(view, assets, 1, { x: 4, y: 6 }, 0);
    expect(view.group.visible).toBe(true);
    expect(view.body.mesh.visible).toBe(true);
    // Player colour on the cloth, through the same ramp a unit gets.
    expect(view.color.mapNode?.value).toBe(assets.textures.get('rally-flag/idle-playercolor.png'));
    // Over every sprite: a building between the camera and the flag must not
    // swallow the marker.
    expect(view.body.mesh.renderOrder).toBeGreaterThan(4000);
    const first = view.body.mesh.geometry.getAttribute('uv').getX(0);
    updateFlagView(view, assets, 1, { x: 4, y: 6 }, 0.15);
    expect(view.body.mesh.geometry.getAttribute('uv').getX(0)).not.toBe(first);
  });

  it('draws nothing without the imported flag', () => {
    const assets = fakeAssets();
    const view = createFlagView(assets, 1);
    updateFlagView(view, assets, 1, { x: 4, y: 6 }, 0);
    expect(view.group.visible).toBe(false);
  });
});
