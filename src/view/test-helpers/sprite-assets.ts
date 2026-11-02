import * as THREE from 'three/webgpu';
import { stepGame } from '../../sim/game';
import type { GameState } from '../../sim/types';
import { RAMP_LEVELS, rampLut, type Atlas, type ContentAssets } from '../assets';

/** Shared fixtures for the sprite view tests. */
export const run = (state: GameState, ticks: number) => {
  for (let i = 0; i < ticks; i++) stepGame(state);
};

export const treeOf = (state: GameState) =>
  state.entities.find(e => e.kind === 'resource' && e.resourceKind === 'wood')!;

/** A one-frame 4x4 atlas for the named image. */
export const atlas = (image: string): Atlas =>
  ({ image, size: [4, 4], framesInFile: 1, frames: [{ x: 0, y: 0, w: 4, h: 4, cx: 2, cy: 2 }] });

/** Blank uploaded textures for the named images. */
export function addTextures(textures: Map<string, THREE.Texture>, images: string[], width = 4, height = 4): void {
  for (const image of images) {
    const texture = new THREE.DataTexture(new Uint8Array(width * height * 4), width, height);
    texture.needsUpdate = true;
    textures.set(image, texture);
  }
}

export function fakeAssets(): ContentAssets {
  const textures = new Map<string, THREE.Texture>();
  addTextures(textures, ['villager/idle.png', 'villager/idle-playercolor.png']);
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
    skins: new Map(),
    ages: [],
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
export function annexedAssets(): ContentAssets {
  const assets = fakeAssets();
  addTextures(assets.textures, ['tc/idle.png', 'tc/annex0-idle.png', 'tc/annex0-idle-playercolor.png']);
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
