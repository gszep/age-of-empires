/**
 * AoE2DE dimetric projection at x1 asset scale: one tile is 96x48 screen
 * pixels (calibrated against imported building footprints, for example the
 * 3-tile barracks sprite is 296px wide).
 */
import type { Point } from '../sim/types';

export const TILE_W = 96;
export const TILE_H = 48;

/** World tile coordinates -> screen pixels (y up, as in the Three scene). */
export function worldToIso(x: number, y: number): { x: number; y: number } {
  return { x: (x - y) * (TILE_W / 2), y: -(x + y) * (TILE_H / 2) };
}

/** Screen pixels -> world tile coordinates. */
export function isoToWorld(sx: number, sy: number): Point {
  return {
    x: sx / TILE_W - sy / TILE_H,
    y: -sx / TILE_W - sy / TILE_H,
  };
}

/** Painter depth: larger draws later (in front). */
export const isoDepth = (x: number, y: number): number => x + y;
