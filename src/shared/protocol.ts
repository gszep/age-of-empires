import type { Command, GameState } from '../sim/types';
import type { MatchSetup } from '../match-setup';

/** v4: opt-in Wonder countdown/win state; older simulators must not join these matches. */
export const SHARED_VERSION = 4;
export const SHARED_SPEEDS = [1, 1.5, 1.7, 2, 5, 10];
/** Native Normal; existing persisted indices retain their original multiplier. */
export const DEFAULT_GAME_SPEED = 2;
export interface MatchSettings { paused: boolean; speed: number; generation: number }
export type HostMessage =
  | { type: 'snapshot'; state: GameState; settings: MatchSettings; setup?: MatchSetup }
  | { type: 'tick'; tick: number; commands: Command[]; hash?: string; settings: MatchSettings }
  | { type: 'settings'; settings: MatchSettings }
  | { type: 'error'; reason: string };
