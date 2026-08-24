/**
 * Dev-only match persistence across page reloads.
 *
 * Simulation, protocol, and `main.ts` edits cannot be hot-swapped (patching
 * tick logic into an already-ticked GameState risks diverging from a
 * deterministic replay), so they fall back to a full reload and would restart
 * the match being used to reproduce a bug. Snapshotting the state into
 * sessionStorage keeps that match across the reload.
 *
 * The same divergence caveat applies to the snapshot itself: a state produced
 * by older tick logic is resumed under newer logic, so it is not equivalent to
 * replaying the seed. That is acceptable for eyeballing a rendering change and
 * never runs in a production build. Use the menu's restart to drop it.
 */
import type { GameRules } from './sim/data';
import type { GameState } from './sim/types';

const KEY = 'open-empires-lab:dev-session';
const VERSION = 1;

interface Snapshot {
  version: number;
  rulesOrigin: string;
  state: Omit<GameState, 'rules'>;
}

export function saveSession(state: GameState): void {
  if (!import.meta.env.DEV) return;
  try {
    const { rules, ...rest } = state;
    const snapshot: Snapshot = { version: VERSION, rulesOrigin: rules.origin, state: rest };
    sessionStorage.setItem(KEY, JSON.stringify(snapshot));
  } catch {
    // Quota exceeded or storage unavailable: a lost snapshot is not an error.
  }
}

/** Restores a snapshot, or undefined when absent, stale, or unreadable. */
export function loadSession(rules: GameRules): GameState | undefined {
  if (!import.meta.env.DEV) return undefined;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return undefined;
    const snapshot = JSON.parse(raw) as Snapshot;
    // Rules are not restored: a re-import must take effect, and a snapshot
    // taken under different content would resume against mismatched entities.
    if (snapshot.version !== VERSION || snapshot.rulesOrigin !== rules.origin) return undefined;
    return { ...snapshot.state, rules };
  } catch {
    return undefined;
  }
}

export function clearSession(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Storage unavailable; nothing to clear.
  }
}
