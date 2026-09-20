import { checksumText } from '../sim/checksum';
import type { GameState } from '../sim/types';

/** JSON transport drops undefined properties. Their later insertion order is
 * not game state. Sort object fields, but retain simulation-significant array
 * order. Keep this separate from v1 replay checksums for compatibility. */
export function synchronizationHash(state: GameState): string {
  const { rules, ...dynamic } = state;
  return checksumText(JSON.stringify(ordered({ rulesOrigin: rules.origin, ...dynamic })));
}

function ordered(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    // Terrain, elevation and fog contain tens of thousands of primitive cells.
    // Native JSON encoding needs no per-cell replacer or copied array for them.
    return value.some(item => item !== null && typeof item === 'object') ? value.map(ordered) : value;
  }
  const object = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(object).sort()) sorted[key] = ordered(object[key]);
  return sorted;
}
