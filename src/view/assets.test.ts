import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  PLAYER_COLOR_BLEND, RAMP_LEVELS, luminance, ownedIconUrl, rampLut, tintIconPixels,
  type PlayerColors, type UiAssets,
} from './assets';

const UI_MANIFEST = 'public/imported/aoe2/ui/manifest.json';

describe('a portrait in its owner\'s colour', () => {
  // A two-step ramp whose darkest shade is navy and lightest a pale blue,
  // standing for greys 32, 128 and 224.
  const ramp: [number, number, number][] = [[0, 0, 64], [0, 0, 160], [128, 128, 255]];
  const shadeLevels = [32, 128, 224];
  const lut = rampLut(ramp, shadeLevels);
  const colors: PlayerColors = {
    palette: 'test', shadeLevels,
    players: { 1: { name: 'blue', colorBase: 16, minimapColor: [0, 0, 255], outlineColor: [0, 0, 255], ramp } },
  };

  it('keeps an unweighted pixel and colours a weighted one by its shading', () => {
    // The importer ships the icon opaque and the owner's weight beside it as
    // a grey mask: white where the owner's colour is all of the pixel, and
    // the picture's RGB there is the shading that colour takes (issue #77).
    const data = new Uint8ClampedArray([
      200, 100, 50, 255,   // the face: untouched
      128, 128, 128, 255,  // mid-grey cloth: the ramp's middle shade
      224, 224, 224, 255,  // a highlight: the lightest shade
      0, 0, 0, 255,        // a fold in shadow: clamped to the darkest
    ]);
    const mask = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255]);
    tintIconPixels(data, mask, lut);
    expect(Array.from(data.slice(0, 4))).toEqual([200, 100, 50, 255]);
    expect(Array.from(data.slice(4, 8))).toEqual([0, 0, 160, 255]);
    expect(Array.from(data.slice(8, 12))).toEqual([128, 128, 255, 255]);
    expect(Array.from(data.slice(12, 16))).toEqual([0, 0, 64, 255]);
  });

  it('blends a half-weighted pixel half way, and reads colour as luminance', () => {
    const data = new Uint8ClampedArray([100, 200, 100, 255]);
    const mask = new Uint8ClampedArray([128, 128, 128, 255]);
    const grey = luminance(100, 200, 100);
    const shade = [lut[grey * 4], lut[grey * 4 + 1], lut[grey * 4 + 2]];
    tintIconPixels(data, mask, lut);
    const weight = 128 / 255;
    expect(data[0]).toBe(Math.round(100 * (1 - weight) + shade[0] * weight));
    expect(data[1]).toBe(Math.round(200 * (1 - weight) + shade[1] * weight));
    expect(data[2]).toBe(Math.round(100 * (1 - weight) + shade[2] * weight));
    expect(data[3]).toBe(255);
    expect(lut.length).toBe(RAMP_LEVELS * 4);
  });

  it('colours only what the material says is player-coloured', () => {
    const ui: UiAssets = {
      base: '/ui/', layouts: {},
      materials: {
        Cloth: { type: 'Atlas', blend: PLAYER_COLOR_BLEND, texture: 'cloth.png', playerColorMask: 'cloth-playercolor.png' },
        Stone: { type: 'Atlas', blend: 'InverseAlpha', texture: 'stone.png' },
      },
      icons: { Units: { '001': 'Cloth' }, Techs: { '002': 'Stone' } },
    };
    // Without a canvas the plain icon stands, for every owner.
    expect(ownedIconUrl(ui, colors, 'Units', 1, 1)).toBe('/ui/cloth.png');
    expect(ownedIconUrl(ui, colors, 'Techs', 2, 1)).toBe('/ui/stone.png');
    expect(ownedIconUrl(ui, undefined, 'Units', 1, 1)).toBe('/ui/cloth.png');
    expect(ownedIconUrl(ui, colors, 'Units', 1, 7)).toBe('/ui/cloth.png');
    expect(ownedIconUrl(ui, colors, 'Units', 9, 1)).toBeUndefined();
  });

  it.skipIf(!existsSync(UI_MANIFEST))('finds every unit and building icon declared player-coloured', () => {
    // The blend is the reference's own statement, per material; every
    // portrait the selection panel and the grid can show carries it, the
    // technologies' included (an upgrade's icon is the unit it makes).
    const ui = JSON.parse(readFileSync(UI_MANIFEST, 'utf8')) as UiAssets;
    for (const category of ['Units', 'Buildings', 'Techs']) {
      const materials = Object.values(ui.icons[category]);
      expect(materials.length).toBeGreaterThan(10);
      for (const material of materials) {
        expect(ui.materials[material]?.blend).toBe(PLAYER_COLOR_BLEND);
        expect(ui.materials[material]?.playerColorMask).toMatch(/-playercolor\.png$/);
      }
    }
  });
});
