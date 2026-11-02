import { existsSync, readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { createGame } from '../sim/game';
import { rampLut, type ContentAssets } from './assets';
import { worldToIso } from './iso';
import { SpriteResidency } from './sprite-residency';
import {
  PLAYER_COLORS, createEntityView, playerColorHex, updateEntityView, refreshEntityTextures, dimFogSnapshot,
  updateOcclusion, type EntityView,
} from './sprites';
import { fakeAssets, annexedAssets } from './test-helpers/sprite-assets';

describe('the colours a player is drawn in', () => {
  it('takes them from the imported palette, not the open-content pair', () => {
    // The minimap used to read the fallback (a soft `#1a6cff` and `#e02b2b`)
    // while the manifest carried each player's own `minimapColor`. The DAT's
    // are the pure primaries, which is what AoE2 draws.
    const path = 'public/imported/aoe2/manifest.json';
    if (!existsSync(path)) return;
    const manifest = JSON.parse(readFileSync(path, 'utf8')) as {
      playerColors: { players: Record<string, { minimapColor: [number, number, number] }> };
    };
    const assets = { playerColors: manifest.playerColors } as unknown as ContentAssets;
    expect(playerColorHex(assets, 1)).toBe('#0000ff');
    expect(playerColorHex(assets, 2)).toBe('#ff0000');
    // ...and they really are different from what the fallback would give.
    expect(playerColorHex(assets, 1)).not.toBe(`#${PLAYER_COLORS[1].toString(16)}`);
    expect(playerColorHex(assets, 2)).not.toBe(`#${PLAYER_COLORS[2].toString(16)}`);
  });
});

describe('player colour through the imported ramp', () => {
  it('resolves a sprite grey to a shade of the player block', () => {
    // The grey player's block is an identity ramp; inverting it is what makes
    // every other player's shade land where the art's own shading put it.
    const identity = rampLut([[28, 28, 28], [145, 145, 145], [255, 255, 255]], [28, 145, 255]);
    for (const grey of [28, 90, 145, 200, 255]) {
      expect(identity[grey * 4]).toBe(grey);
    }
    // Below the palette's darkest shade there is nothing darker to reach for.
    expect(identity[0]).toBe(28);
    const blue = rampLut([[0, 0, 64], [0, 0, 160], [128, 128, 255]], [32, 128, 224]);
    expect([...blue.slice(128 * 4, 128 * 4 + 3)]).toEqual([0, 0, 160]);
    expect([...blue.slice(224 * 4, 224 * 4 + 3)]).toEqual([128, 128, 255]);
  });

  it('reports the DAT minimap colour rather than a hand-picked tint', () => {
    const assets = fakeAssets();
    expect(playerColorHex(assets, 1)).toBe('#0000ff');
    // Gaia owns no colour, and an unimported player falls back to the open set.
    expect(playerColorHex(assets, 0)).toBeUndefined();
    expect(playerColorHex(undefined, 1)).toBe(`#${PLAYER_COLORS[1].toString(16)}`);
  });

  it('draws the colour piece through the ramp shader, untinted', () => {
    const assets = fakeAssets();
    const state = createGame();
    const villager = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
    const view = createEntityView(assets, villager);
    updateEntityView(view, assets, state, villager, 0);

    expect(view.color.mesh.visible).toBe(true);
    // The sheet reaches the shader as a bound node, not as material.map: a
    // stale node would silently keep drawing the previous animation's cloth.
    expect(view.color.mapNode?.value).toBe(assets.textures.get('villager/idle-playercolor.png'));
    const material = view.color.mesh.material as THREE.MeshBasicNodeMaterial;
    expect(material.colorNode).toBeDefined();
    // White: the ramp decides the colour, so any tint here would multiply it.
    expect(material.color.getHexString()).toBe('ffffff');
  });

  it('colours the annexes a building keeps its player colour in', () => {
    // The town center's own art carries no player-colour layer, so a renderer
    // that only masks the body draws it grey.
    const assets = annexedAssets();
    const state = createGame();
    const tc = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
    const view = createEntityView(assets, tc);
    updateEntityView(view, assets, state, tc, 0);

    expect(view.color.mesh.visible).toBe(false);
    expect(view.annexColors).toHaveLength(1);
    expect(view.annexColors[0].mesh.visible).toBe(true);
    expect(view.annexColors[0].mapNode?.value)
      .toBe(assets.textures.get('tc/annex0-idle-playercolor.png'));
    // Over its own annex, and under the next annex in the display order.
    expect(view.annexColors[0].mesh.renderOrder).toBeGreaterThan(view.annexes[0].mesh.renderOrder);
  });

  it('draws no player colour on an aged annex whose own art has none (#294)', () => {
    const assets = annexedAssets();
    const annex = assets.entities['town-center'].annexes![0];
    annex.animations['annex0-idle-imperial'] = annex.animations['annex0-idle'];
    annex.atlases['annex0-idle-imperial'] = { ...annex.atlases['annex0-idle'], image: 'tc/annex0-idle-imperial.png' };
    assets.textures.set('tc/annex0-idle-imperial.png', assets.textures.get('tc/annex0-idle.png')!);
    const state = createGame();
    state.players[1].age = 4;
    const tc = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
    const view = createEntityView(assets, tc);
    updateEntityView(view, assets, state, tc, 0);
    expect(view.annexes[0].textureImage).toBe('tc/annex0-idle-imperial.png');
    expect(view.annexColors[0].mesh.visible).toBe(false); // not the Dark Age mask
  });

  it('hides annex colour while a building is still going up', () => {
    const assets = annexedAssets();
    const state = createGame();
    const tc = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
    const view = createEntityView(assets, tc);
    updateEntityView(view, assets, state, { ...tc, buildProgress: 0.5 }, 0);
    expect(view.annexes[0].mesh.visible).toBe(false);
    expect(view.annexColors[0].mesh.visible).toBe(false);
  });

  it('draws annex shadows when the annex atlas includes a shadow layer (#288)', () => {
    // The East-Asian variant TC's annexes have shadow atlases in the
    // manifest as annex${i}-${name}-shadow, which must be applied like the
    // body shadow: visible, black-tinted, and below all sprites.
    const assets = annexedAssets();
    const frames = [{ x: 0, y: 0, w: 4, h: 4, cx: 2, cy: 2 }];
    const shadowTexture = new THREE.DataTexture(new Uint8Array(4 * 4 * 4).fill(128), 4, 4);
    shadowTexture.needsUpdate = true;
    assets.textures.set('tc/annex0-idle-shadow.png', shadowTexture);
    const annex = assets.entities['town-center'].annexes![0];
    annex.atlases['annex0-idle-shadow'] = {
      image: 'tc/annex0-idle-shadow.png',
      size: [4, 4],
      framesInFile: 1,
      frames,
    };
    assets.shadows = { profile: 'fixture', strength: 0.8, color: [0, 0, 0] };

    const state = createGame();
    const tc = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
    const view = createEntityView(assets, tc);
    updateEntityView(view, assets, state, tc, 0);

    expect(view.annexShadows).toHaveLength(1);
    expect(view.annexShadows![0].mesh.visible).toBe(true);
    expect((view.annexShadows![0].mesh.material as THREE.MeshBasicMaterial).map)
      .toBe(shadowTexture);
    // Shadow renders below all bodies (ground layer), below annex body
    expect(view.annexShadows![0].mesh.renderOrder).toBeLessThan(view.annexes[0].mesh.renderOrder);
    // Shadow opacity matches configured shadow strength
    expect((view.annexShadows![0].mesh.material as THREE.MeshBasicMaterial).opacity).toBe(0.8);
  });

  it('binds a separately imported age cast-shadow to the main shadow piece (#288)', () => {
    const assets = annexedAssets();
    const imported = assets.entities['town-center'];
    imported.animations['idle-feudal'] = imported.animations.idle;
    imported.atlases['idle-feudal'] = imported.atlases.idle;
    // The converter replaces idle-feudal-shadow, not idle-feudal body art.
    const texture = new THREE.DataTexture(new Uint8Array(8 * 6 * 4).fill(128), 8, 6);
    texture.needsUpdate = true;
    assets.textures.set('cast-shadow.png', texture);
    imported.atlases['idle-feudal-shadow'] = {
      image: 'cast-shadow.png', size: [8, 6], scale: 2, framesInFile: 1,
      frames: [{ x: 0, y: 0, w: 8, h: 6, cx: 5, cy: 4 }],
    };
    const annex = imported.annexes![0];
    annex.atlases['annex0-idle-shadow'] = annex.atlases['annex0-idle'];
    const state = createGame();
    const tc = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
    const view = createEntityView(assets, tc);
    updateEntityView(view, assets, state, tc, 0);
    expect(view.shadow.mesh.visible).toBe(false); // no borrowing later-age shadow
    state.players[1].age = 1;
    updateEntityView(view, assets, state, tc, 1);
    const origin = worldToIso(tc.position.x, tc.position.y);
    expect(view.animationState).toBe('town-center/idle-feudal');
    expect(view.shadow.mesh.visible).toBe(true);
    expect((view.shadow.mesh.material as THREE.MeshBasicMaterial).map).toBe(texture);
    expect(view.shadow.mesh.scale.toArray()).toEqual([4, 3, 1]);
    expect(view.shadow.mesh.position.x).toBe(origin.x - 0.5);
    expect(view.shadow.mesh.position.y).toBe(origin.y + 0.5);
    expect(view.shadow.mesh.renderOrder).toBeLessThan(view.body.mesh.renderOrder);
    expect(view.body.textureImage).toBe('tc/idle.png');
    expect(view.annexShadows![0].mesh.visible).toBe(true);
    tc.buildProgress = 0.5;
    updateEntityView(view, assets, state, tc, 2);
    expect(view.shadow.mesh.visible).toBe(false);
    delete tc.buildProgress; tc.dead = true;
    updateEntityView(view, assets, state, tc, 3);
    expect(view.shadow.mesh.visible).toBe(false);
  });

  it('hides annex shadow when the annex has no shadow atlas', () => {
    // Fallback: if an annex lacks its own shadow layer in the manifest, do not show one.
    const assets = annexedAssets();
    // Deliberately omit the shadow atlas
    const state = createGame();
    const tc = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
    const view = createEntityView(assets, tc);
    updateEntityView(view, assets, state, tc, 0);

    expect(view.annexShadows).toHaveLength(1);
    expect(view.annexShadows![0].mesh.visible).toBe(false);
  });

  it.each(['construction', 'death', 'missing-death', 'layers'] as const)('retires annex shadows on %s, including pending pages (#288)', transition => {
    const assets = annexedAssets();
    const imported = assets.entities['town-center'];
    const annex = imported.annexes![0];
    const image = 'tc/annex0-idle-shadow.png';
    annex.atlases['annex0-idle-shadow'] = { ...annex.atlases['annex0-idle'], image };
    const state = createGame();
    const tc = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
    const view = createEntityView(assets, tc);
    updateEntityView(view, assets, state, tc, 0);
    expect(view.annexShadows![0].pendingTexture).toBe(image);
    if (transition === 'construction') tc.buildProgress = 0.5;
    if (transition === 'missing-death') tc.dead = true;
    if (transition === 'death') {
      tc.dead = true;
      imported.animations.death = imported.animations.idle;
      imported.atlases.death = imported.atlases.idle;
    }
    if (transition === 'layers') {
      delete imported.annexes; // replacement art no longer names TC annexes
      imported.animationLayers = { idle: [{ animation: 'idle', x: 0, y: 0 }] };
    }
    updateEntityView(view, assets, state, tc, 1);
    assets.textures.set(image, assets.textures.get('tc/idle.png')!);
    refreshEntityTextures(view, assets);
    expect(view.annexShadows![0].pendingTexture).toBeUndefined();
    expect(view.annexShadows![0].mesh.visible).toBe(false);
  });

  it('leaves all ground-shadow RGB unchanged in fog (#288)', () => {
    const assets = annexedAssets();
    const state = createGame();
    const tc = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
    const view = createEntityView(assets, tc);
    const shadows = [view.shadow, ...view.annexShadows!];
    // Nonblack catches double dimming that the owned Default black conceals.
    for (const p of shadows) (p.mesh.material as THREE.MeshBasicMaterial).color.setRGB(0.2, 0.3, 0.4);
    view.layerShadows = [view.annexShadows![0]];
    dimFogSnapshot(view);
    for (const p of shadows) expect((p.mesh.material as THREE.MeshBasicMaterial).color.toArray()).toEqual([0.2, 0.3, 0.4]);
  });

  it('shows a unit its contour only while something taller hides it', () => {
    const assets = fakeAssets();
    const frames = [{ x: 0, y: 0, w: 4, h: 4, cx: 2, cy: 2 }];
    const texture = new THREE.DataTexture(new Uint8Array(4 * 4 * 4), 4, 4);
    texture.needsUpdate = true;
    assets.textures.set('villager/idle-outline.png', texture);
    assets.entities['villager'].atlases['idle-outline'] =
      { image: 'villager/idle-outline.png', size: [4, 4], framesInFile: 1, frames };

    const state = createGame();
    const villager = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
    const house = state.entities.find(e => e.kind === 'town-center')!;
    const views = new Map<string, EntityView>();
    for (const entity of [villager, house]) {
      const view = createEntityView(assets, entity);
      updateEntityView(view, assets, state, entity, 0);
      views.set(`e${entity.id}`, view);
    }
    const villagerView = views.get(`e${villager.id}`)!;
    expect(villagerView.outline.mesh.visible).toBe(false);

    // Nothing covers it where it stands, and the town center sorts behind it.
    updateOcclusion(views, state);
    expect(villagerView.outline.mesh.visible).toBe(false);

    // Put a wide occluder in front of the villager, sorting later.
    const occluder = views.get(`e${house.id}`)!;
    occluder.body.mesh.visible = true;
    occluder.body.mesh.position.copy(villagerView.body.mesh.position);
    occluder.body.mesh.scale.set(400, 400, 1);
    house.position = { x: villager.position.x + 2, y: villager.position.y + 2 };
    updateOcclusion(views, state);
    expect(villagerView.outline.mesh.visible).toBe(true);
    expect((villagerView.outline.mesh.material as THREE.MeshBasicMaterial).color.getHex())
      .toBe(0x0000ff);

    // Switch to art with no contour, then let the old page expire (#172).
    let now = 0;
    assets.spriteResidency = new SpriteResidency(assets.textures, () => now);
    assets.spriteResidency.add('villager/idle-outline.png', texture);
    assets.entities.villager.animations.walk = assets.entities.villager.animations.idle;
    assets.entities.villager.atlases.walk = assets.entities.villager.atlases.idle;
    villager.activity = 'moving';
    updateEntityView(villagerView, assets, state, villager, 1);
    expect(villagerView.animationState).toBe('villager/walk');
    now = 121_000; assets.spriteResidency.sweep();
    expect(texture.image).toBeNull();
    updateOcclusion(views, state);
    expect(villagerView.outline.mesh.visible).toBe(false);

    // Returning to a valid animation waits for its page instead of reviving
    // the disposed binding. An intentionally empty frame stays hidden too.
    villager.activity = 'idle';
    updateEntityView(villagerView, assets, state, villager, 2);
    updateOcclusion(views, state);
    expect(villagerView.outline.pendingTexture).toBe('villager/idle-outline.png');
    expect(villagerView.outline.mesh.visible).toBe(false);
    assets.textures.set('villager/idle-outline.png', new THREE.DataTexture(new Uint8Array(64), 4, 4));
    updateEntityView(villagerView, assets, state, villager, 3);
    updateOcclusion(views, state);
    expect(villagerView.outline.mesh.visible).toBe(true);
    frames[0].w = 0;
    updateEntityView(villagerView, assets, state, villager, 4);
    updateOcclusion(views, state);
    expect(villagerView.outline.mesh.visible).toBe(false);
  });

  it('draws current composite contours, retiring missing, empty and pending masks through page expiry', () => {
    const assets = fakeAssets();
    const sail = { image: 'ship/sail.png', size: [4, 4] as [number, number], framesInFile: 1,
      frames: [{ x: 0, y: 0, w: 4, h: 4, cx: 2, cy: 2 }] };
    const mask = { ...sail, image: 'ship/sail-outline.png', frames: sail.frames.map(f => ({ ...f })) };
    const texture = new THREE.DataTexture(new Uint8Array(64).fill(255), 4, 4);
    assets.textures.set(sail.image, new THREE.DataTexture(new Uint8Array(64).fill(255), 4, 4));
    assets.textures.set(mask.image, texture);
    assets.entities.galley = { ...assets.entities.villager,
      animations: { ...assets.entities.villager.animations, sail: { frames: 1, directions: 1, frameSeconds: 1, mirroringMode: 0 } },
      atlases: { ...assets.entities.villager.atlases, sail, 'sail-outline': mask },
      animationLayers: { idle: [{ animation: 'idle', x: 0, y: 0 }, { animation: 'sail', x: 5, y: -9 }] } };
    const state = createGame();
    const ship = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
    ship.kind = 'galley';
    const house = state.entities.find(e => e.kind === 'town-center')!;
    house.position = { x: ship.position.x + 2, y: ship.position.y + 2 };
    const view = createEntityView(assets, ship), occluder = createEntityView(assets, house);
    updateEntityView(view, assets, state, ship, 0);
    occluder.body.mesh.visible = true;
    occluder.body.mesh.position.copy(view.body.mesh.position);
    occluder.body.mesh.scale.set(400, 400, 1);
    const views = new Map([[`e${ship.id}`, view], [`e${house.id}`, occluder]]);
    const contour = view.layerOutlines![0];
    updateOcclusion(views, state);
    expect(contour.mesh.visible).toBe(true);
    expect((contour.mesh.material as THREE.MeshBasicMaterial).color.getHex()).toBe(0x0000ff);
    expect(contour.mesh.renderOrder).toBeGreaterThan(occluder.body.mesh.renderOrder);
    expect(contour.mesh.position.x).toBe(view.annexes[0].mesh.position.x);
    expect(contour.mesh.position.y).toBe(view.annexes[0].mesh.position.y);
    occluder.body.mesh.visible = false;
    updateOcclusion(views, state);
    expect(contour.mesh.visible).toBe(false);
    occluder.body.mesh.visible = true;
    let now = 0;
    assets.spriteResidency = new SpriteResidency(assets.textures, () => now);
    assets.spriteResidency.add(mask.image, texture);
    delete assets.entities.galley.atlases['sail-outline'];
    updateEntityView(view, assets, state, ship, 1);
    now = 121_000; assets.spriteResidency.sweep();
    updateOcclusion(views, state);
    expect(contour.textureImage).toBeUndefined();
    expect(contour.mesh.visible).toBe(false);
    assets.entities.galley.atlases['sail-outline'] = mask;
    updateEntityView(view, assets, state, ship, 2);
    updateOcclusion(views, state);
    expect(contour.pendingTexture).toBe(mask.image);
    expect(contour.mesh.visible).toBe(false);
    assets.textures.set(mask.image, new THREE.DataTexture(new Uint8Array(64).fill(255), 4, 4));
    updateEntityView(view, assets, state, ship, 3);
    updateOcclusion(views, state);
    expect(contour.mesh.visible).toBe(true);
    mask.frames[0].w = 0;
    updateEntityView(view, assets, state, ship, 4);
    updateOcclusion(views, state);
    expect(contour.mesh.visible).toBe(false);
    mask.frames[0].w = 4;
    assets.entities.galley.animationLayers!.idle = [{ animation: 'idle', x: 0, y: 0 }];
    updateEntityView(view, assets, state, ship, 5);
    updateOcclusion(views, state);
    expect(contour.textureImage).toBeUndefined();
    expect(contour.mesh.visible).toBe(false);
  });

  it('records the owner so a view can be rebuilt when a sheep changes hands', () => {
    // The ramp is bound into the material when the view is built, so a
    // captured animal needs a new view rather than a repaint.
    const assets = fakeAssets();
    const state = createGame();
    const villager = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
    expect(createEntityView(assets, villager).owner).toBe(1);
    expect(createEntityView(assets, { ...villager, owner: 0 }).owner).toBe(0);
    expect(createEntityView(assets, { ...villager, owner: 0 }).color.mapNode).toBeUndefined();
  });

  it('falls back to the flat player colour when no ramp was imported', () => {
    const assets = { ...fakeAssets(), playerRamps: new Map<number, THREE.DataTexture>() };
    const state = createGame();
    const villager = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
    const view = createEntityView(assets, villager);
    updateEntityView(view, assets, state, villager, 0);
    expect(view.color.mapNode).toBeUndefined();
    const material = view.color.mesh.material as THREE.MeshBasicMaterial;
    expect(material.color.getHex()).toBe(PLAYER_COLORS[1]);
  });
});
