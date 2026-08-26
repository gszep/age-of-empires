import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { applyCommand, createGame, stepGame } from '../sim/game';
import type { GameState } from '../sim/types';
import { RAMP_LEVELS, rampLut, type Atlas, type ContentAssets } from './assets';
import {
  PLAYER_COLORS, chooseAnimation, createEntityView, createFlagView, playerColorHex, treeIsFelled,
  updateEntityView, updateFlagView, updateOcclusion, type EntityView,
} from './sprites';

const run = (state: GameState, ticks: number) => {
  for (let i = 0; i < ticks; i++) stepGame(state);
};

const treeOf = (state: GameState) =>
  state.entities.find(e => e.kind === 'resource' && e.resourceKind === 'wood')!;

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

/**
 * A minimal imported-content stand-in: one villager animation with its
 * player-colour sheet, and a two-step ramp whose middle entry is the hue.
 */
function fakeAssets(): ContentAssets {
  const frames = [{ x: 0, y: 0, w: 4, h: 4, cx: 2, cy: 2 }];
  const atlas = (image: string): Atlas => ({ image, size: [4, 4], framesInFile: 1, frames });
  const textures = new Map<string, THREE.Texture>();
  for (const image of ['villager/idle.png', 'villager/idle-playercolor.png']) {
    const texture = new THREE.DataTexture(new Uint8Array(4 * 4 * 4), 4, 4);
    texture.needsUpdate = true;
    textures.set(image, texture);
  }
  const ramp: [number, number, number][] = [[0, 0, 64], [0, 0, 160], [128, 128, 255]];
  const shadeLevels = [32, 128, 224];
  const playerRamps = new Map<number, THREE.DataTexture>();
  playerRamps.set(1, new THREE.DataTexture(rampLut(ramp, shadeLevels), RAMP_LEVELS, 1));
  return {
    entities: {
      villager: {
        category: 'unit',
        animations: { idle: { frames: 1, directions: 1, frameSeconds: 0.1, mirroringMode: 0 } },
        atlases: { idle: atlas('villager/idle.png'), 'idle-playercolor': atlas('villager/idle-playercolor.png') },
      },
    },
    terrain: {},
    textures,
    playerColors: {
      palette: 'original.pal',
      shadeLevels,
      players: {
        1: {
          name: 'blue', colorBase: 16,
          minimapColor: [0, 0, 255], outlineColor: [0, 0, 255], ramp,
        },
      },
    },
    playerRamps,
  };
}

/** The town center's shape: a body with no colour layer, colour only on annexes. */
function annexedAssets(): ContentAssets {
  const assets = fakeAssets();
  const frames = [{ x: 0, y: 0, w: 4, h: 4, cx: 2, cy: 2 }];
  const atlas = (image: string): Atlas => ({ image, size: [4, 4], framesInFile: 1, frames });
  for (const image of ['tc/idle.png', 'tc/annex0-idle.png', 'tc/annex0-idle-playercolor.png']) {
    const texture = new THREE.DataTexture(new Uint8Array(4 * 4 * 4), 4, 4);
    texture.needsUpdate = true;
    assets.textures.set(image, texture);
  }
  const idle = { frames: 1, directions: 1, frameSeconds: 0.1, mirroringMode: 0 };
  assets.entities['town-center'] = {
    category: 'building',
    animations: { idle },
    atlases: { idle: atlas('tc/idle.png') },
    annexes: [{
      unitId: 618,
      misplacement: [1, -1],
      animations: { 'annex0-idle': idle },
      atlases: {
        'annex0-idle': atlas('tc/annex0-idle.png'),
        'annex0-idle-playercolor': atlas('tc/annex0-idle-playercolor.png'),
      },
    }],
  };
  return assets;
}

describe('the gather-point flag', () => {
  function flagAssets(): ContentAssets {
    const assets = fakeAssets();
    const frames = [
      { x: 0, y: 0, w: 4, h: 4, cx: 2, cy: 2 },
      { x: 4, y: 0, w: 4, h: 4, cx: 2, cy: 2 },
    ];
    for (const image of ['rally-flag/idle.png', 'rally-flag/idle-playercolor.png']) {
      const texture = new THREE.DataTexture(new Uint8Array(8 * 4 * 4), 8, 4);
      texture.needsUpdate = true;
      assets.textures.set(image, texture);
    }
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
    expect(view.annexColors[0].mesh.renderOrder).toBe(view.annexes[0].mesh.renderOrder + 1);
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
