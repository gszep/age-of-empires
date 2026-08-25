import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FALLBACK_RULES, rulesFromManifest, type ContentManifest } from '../sim/data';
import type { BuildingKind } from '../sim/types';
import { isoToWorld, snapPlacement, worldToIso } from './iso';

const MANIFEST_PATH = 'public/imported/aoe2/manifest.json';
const importedRules = existsSync(MANIFEST_PATH)
  ? rulesFromManifest(JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as ContentManifest)
  : undefined;

describe('dimetric projection', () => {
  it('round-trips world coordinates through screen space', () => {
    for (const point of [{ x: 0, y: 0 }, { x: 8.25, y: 3.5 }, { x: 31, y: 17 }]) {
      const iso = worldToIso(point.x, point.y);
      const back = isoToWorld(iso.x, iso.y);
      expect(back.x).toBeCloseTo(point.x, 9);
      expect(back.y).toBeCloseTo(point.y, 9);
    }
  });
});

describe('placement snapping', () => {
  it('centres odd-sided buildings on a tile and even-sided on a corner', () => {
    // side 3 (half 1.5) sits on a tile centre; side 2 (half 1) on a corner.
    expect(snapPlacement({ x: 8.3, y: 4.9 }, 1.5)).toEqual({ x: 8.5, y: 4.5 });
    expect(snapPlacement({ x: 8.3, y: 4.9 }, 1)).toEqual({ x: 8, y: 5 });
  });

  it('lands every building footprint edge on a tile boundary', () => {
    // The footprint is the square placementLegal tests, so fractional edges
    // would leave the preview covering tiles the check does not.
    const rules = importedRules ?? FALLBACK_RULES;
    for (const kind of Object.keys(rules.buildings) as BuildingKind[]) {
      const half = rules.buildings[kind].radius;
      for (const raw of [{ x: 8.3, y: 4.9 }, { x: 0.1, y: 17.8 }, { x: 12.5, y: 9 }]) {
        const centre = snapPlacement(raw, half);
        for (const edge of [centre.x - half, centre.x + half, centre.y - half, centre.y + half]) {
          expect(Number.isInteger(edge), `${kind} edge ${edge} from centre ${centre.x},${centre.y}`).toBe(true);
        }
      }
    }
  });

  it('keeps the snapped centre within half a tile of the cursor', () => {
    for (const half of [0.5, 1, 1.5, 2]) {
      const snapped = snapPlacement({ x: 10.4, y: 6.6 }, half);
      expect(Math.abs(snapped.x - 10.4)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(snapped.y - 6.6)).toBeLessThanOrEqual(0.5);
    }
  });
});
