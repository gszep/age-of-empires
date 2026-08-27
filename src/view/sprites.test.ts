import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { applyCommand, createGame, stepGame } from '../sim/game';
import type { Entity, GameState } from '../sim/types';
import { RAMP_LEVELS, rampLut, type Atlas, type ContentAssets } from './assets';
import {
  PLAYER_COLORS, chooseAnimation, createEntityView, createFlagView, decayFraction, playerColorHex,
  treeIsFelled, updateEntityView, updateFlagView, updateOcclusion, wallShape, type EntityView,
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

describe('what a death leaves behind', () => {
  /** A villager and an oak with the DAT's death-then-decay chain. */
  function corpseAssets(): ContentAssets {
    const assets = fakeAssets();
    const frames = [{ x: 0, y: 0, w: 4, h: 4, cx: 2, cy: 2 }];
    const atlas = (image: string): Atlas => ({ image, size: [4, 4], framesInFile: 1, frames });
    for (const image of ['villager/death.png', 'villager/decay.png',
                         'tree-oak/idle.png', 'tree-oak/death.png', 'tree-oak/decay.png']) {
      const texture = new THREE.DataTexture(new Uint8Array(4 * 4 * 4), 4, 4);
      texture.needsUpdate = true;
      assets.textures.set(image, texture);
    }
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

  it('draws the gate unit that lies along the wall it is in', () => {
    const state = createGame(64);
    expect(chooseAnimation(state, gateAt(state, 20, 4.5, 'x')).key).toBe('palisade-gate');
    expect(chooseAnimation(state, gateAt(state, 24.5, 8, 'y')).key).toBe('palisade-gate-y');
  });

  it('swings open for its owner and stays shut for everybody else', () => {
    const state = createGame(65);
    // Somewhere nobody starts, so only the units this test places are near.
    const gate = gateAt(state, 26, 26.5, 'x');
    expect(chooseAnimation(state, gate).name).toBe('idle');

    const mine = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
    mine.position = { x: 26.5, y: 26.5 };
    expect(chooseAnimation(state, gate).name).toBe('open');

    mine.position = { x: 40, y: 40 };
    const theirs = state.entities.find(e => e.owner === 2 && e.kind === 'villager')!;
    theirs.position = { x: 26.5, y: 26.5 };
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
    expect(wallShape(state, wall)).toBe(4);
    gateAt(state, 26, 30.5, 'x');
    expect(wallShape(state, wall)).toBe(1);
  });
});

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
