import { describe, expect, it } from 'vitest';
import { createGame } from '../sim/game';
import type { ContentAssets, WaterPreset } from './assets';
import { waterPresetFor } from './water';

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
