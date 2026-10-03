import type { Command, GameState } from '../sim/types';
import type { MatchSetup } from '../match-setup';

/** v3: authoritative match population ceiling; older clients ignore it and must not simulate these matches. */
export const SHARED_VERSION = 3;
export const SHARED_SPEEDS = [1, 1.5, 1.7, 2, 5, 10];
export interface MatchSettings { paused: boolean; speed: number; generation: number }
export type HostMessage =
  | { type: 'snapshot'; state: GameState; settings: MatchSettings; setup?: MatchSetup }
  | { type: 'tick'; tick: number; commands: Command[]; hash?: string; settings: MatchSettings }
  | { type: 'settings'; settings: MatchSettings }
  | { type: 'error'; reason: string };
