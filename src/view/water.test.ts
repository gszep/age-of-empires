import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { createGame } from '../sim/game';
import type { ContentAssets, WaterPreset } from './assets';
import { createWaterMaterial, surfaceOpacity, surfaceRepeatTiles, waterPresetFor } from './water';

const preset = (name: string): WaterPreset => ({ name } as WaterPreset);
const assets = {
  water: { 0: preset('Default'), 3: preset('Calm'), 6: preset('Dimmed') },
} as unknown as ContentAssets;

describe('the water preset a board takes', () => {
  it('is the engine default on a sea and a pond preset on Arabia', () => {
    // Islands names no water_definition, so its sea is preset 0; Arabia's
    // WATER_POND rolls Calm or Dimmed (includes/water_preset.inc, 65/35).
    expect(waterPresetFor(createGame(1, undefined, undefined, 'islands'), assets)?.name).toBe('Default');
    const seen = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const name = waterPresetFor(createGame(seed), assets)?.name;
      expect(['Calm', 'Dimmed']).toContain(name);
      seen.add(name!);
    }
    expect(seen.size).toBe(2);
  });

  it('holds for the match and is nothing without owned water', () => {
    const state = createGame(9);
    expect(waterPresetFor(state, assets)).toBe(waterPresetFor(createGame(9), assets));
    expect(waterPresetFor(state, { water: undefined } as unknown as ContentAssets)).toBeUndefined();
  });
});

describe('the surface over a water tile', () => {
  const preset: WaterPreset = {
    name: 'Default', normal: 'water/surface.png', sky: 'water/sky.png', seaFloor: 'water/floor.png',
    mapScale: 0.0045, waveRepeatLength: 20, waveAmplitude: 0.01, waveAnimationSpeed: 2,
    seaFloorScale: 8, seaFloorIntensity: 0.1, skyIntensity: 2, skyRotation: 178.5, skyScale: -0.35,
    skyColor: [1, 1.5, 1.25], waterColor: [1, 1, 1], sunColor: [1, 1, 1], sunDirection: [0.7, -0.68, 0.45],
    specularPower: 1600, specularIntensity: 0.7,
    types: { shallow: { opacity: 32, reflectivity: 144 }, normal: { opacity: 32, reflectivity: 144 }, walkable: { opacity: 24, reflectivity: 64 } },
  } as unknown as WaterPreset;

  it('repeats every 10.8 tiles on a 120-tile board and scales with the board, as the shader normalises by the map', () => {
    // wave_repeat_length * map_scale * g_mapWidth: the position the shader
    // divides is the map-normalised one (Water_vs), so a bigger board has
    // a longer ripple. Calibrated against the reference (docs/ledger.md).
    expect(surfaceRepeatTiles(preset, 120)).toBeCloseTo(10.8, 6);
    expect(surfaceRepeatTiles(preset, 200)).toBeCloseTo(18, 6);
  });

  it('weighs the body by two layers of the class opacity, and falls back to the normal class', () => {
    // 1 - (1 - 32/255)^2: the 0.235 the reference's sea sits above its
    // texture by, in both zones (water.ts header).
    expect(surfaceOpacity(preset, 'shallow')).toBeCloseTo(0.2352, 3);
    expect(surfaceOpacity(preset, 'walkable')).toBeCloseTo(1 - (1 - 24 / 255) ** 2, 6);
    expect(surfaceOpacity(preset, 'ocean')).toBe(surfaceOpacity(preset, 'normal'));
    expect(surfaceOpacity(preset, null)).toBe(surfaceOpacity(preset, 'normal'));
  });

  it('builds its node graph from the preset and the board', () => {
    const textures = new Map<string, THREE.Texture>();
    for (const name of [preset.normal, preset.sky, preset.seaFloor, 'tile']) textures.set(name, new THREE.Texture());
    const material = createWaterMaterial({ textures } as unknown as ContentAssets, preset, {
      span: 10, board: [120, 120], tile: textures.get('tile')!,
    });
    expect(material.colorNode).toBeTruthy();
    expect(material.transparent).toBe(false);
    const masked = createWaterMaterial({ textures } as unknown as ContentAssets, preset, {
      span: 10, board: [120, 120], tile: textures.get('tile')!, masked: new THREE.Texture(),
    });
    expect(masked.transparent).toBe(true);
    expect(masked.opacityNode).toBeTruthy();
    expect(() => createWaterMaterial({ textures: new Map() } as unknown as ContentAssets, preset, {
      span: 10, board: [120, 120], tile: textures.get('tile')!,
    })).toThrow(/no textures/);
  });
});
