import type { Command, GameState } from '../sim/types';
import type { MatchSetup } from '../match-setup';

/** v8: eleven-biome Arabia generation. Older peers must reload before restart. */
export const SHARED_VERSION = 8;
/** Persisted format is separate from client admission. The host also reads v4
 * checkpoints without adding the new research-rule marker to their state. */
export const SHARED_CHECKPOINT_VERSION = 5;
export const SHARED_SPEEDS = [1, 1.5, 1.7, 2, 5, 10];
/** Native Normal; existing persisted indices retain their original multiplier. */
export const DEFAULT_GAME_SPEED = 2;
export interface MatchSettings { paused: boolean; speed: number; generation: number }
export type HostMessage =
  | { type: 'snapshot'; state: GameState; settings: MatchSettings; setup?: MatchSetup }
  | { type: 'tick'; tick: number; commands: Command[]; hash?: string; settings: MatchSettings }
  | { type: 'settings'; settings: MatchSettings }
  | { type: 'error'; reason: string };
