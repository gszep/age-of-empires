import type { GameState } from './types';

/** Canonical snapshot of all dynamic authoritative state. */
export function canonicalSnapshot(state: GameState): string {
  // Rules are immutable match input and identified separately in replay files;
  // everything else, including RNG seed, paths, cooldowns, queues, and fog
  // memory, participates in snapshots and synchronization checksums.
  const { rules, ...dynamicState } = state;
  return JSON.stringify({ rulesOrigin: rules.origin, ...dynamicState });
}

/** FNV-1a over a canonical authoritative snapshot. */
export function checksumState(state: GameState): string {
  const canonical = canonicalSnapshot(state);
  let hash = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
