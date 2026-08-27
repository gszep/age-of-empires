/**
 * Feedback cues the game raises for itself: an alert when something of yours is
 * being hit, a chime when a technology lands, the sound of a spent farm.
 *
 * These are read out of observed state rather than raised from inside the
 * simulation, which never knows about audio. That keeps the sound layer on the
 * view's side of the boundary and makes it testable in Node: the watcher takes
 * the state it can already see and answers with the aliases to play.
 */
import { isBuilding } from '../sim/data';
import type { TechKey } from '../sim/data';
import type { GameState, PlayerId } from '../sim/types';

/** Alert names, matching the aliases `sounds.json` gives these events. */
export type Cue =
  | 'under_attack' | 'under_attack_town' | 'pop_capped' | 'farm_depleted'
  | 'age_up' | 'tech_researched' | 'victory' | 'defeat';

export interface CueWatcher {
  /** Hit points seen last poll, per owned entity. */
  hp: Map<number, number>;
  /** Farms seen with food left, so their emptying can be noticed. */
  farms: Set<number>;
  researched: number;
  capped: boolean;
  ended: boolean;
  /** Game seconds of the last attack alert; AoE2 does not repeat them. */
  alertedAt: number;
  started: boolean;
}

/**
 * How long an attack alert stays quiet after sounding. AoE2 keeps a long gap
 * so a sustained fight does not become a siren; ten seconds is that shape.
 */
export const ALERT_INTERVAL = 10;

export const createCueWatcher = (): CueWatcher => ({
  hp: new Map(),
  farms: new Set(),
  researched: 0,
  capped: false,
  ended: false,
  alertedAt: -Infinity,
  started: false,
});

/**
 * Cues to play for what changed since the last poll. The first poll only
 * records the world: a match resumed from a snapshot must not alert for every
 * unit that was already damaged.
 */
export function pollCues(
  watcher: CueWatcher, state: GameState, player: PlayerId, seconds: number,
): Cue[] {
  const cues: Cue[] = [];
  const hp = new Map<number, number>();
  const farms = new Set<number>();
  let attacked: 'under_attack' | 'under_attack_town' | undefined;

  for (const entity of state.entities) {
    if (entity.owner !== player) continue;
    if (!entity.dead) {
      hp.set(entity.id, entity.hp);
      const previous = watcher.hp.get(entity.id);
      if (previous !== undefined && entity.hp < previous) {
        // A building being hit is the one worth interrupting for.
        if (isBuilding(entity.kind)) attacked = 'under_attack_town';
        else attacked ??= 'under_attack';
      }
    }
    if (entity.kind === 'farm' && (entity.amount ?? 0) > 0 && !entity.dead) farms.add(entity.id);
  }
  for (const id of watcher.farms) {
    if (!farms.has(id)) cues.push('farm_depleted');
  }

  if (watcher.started && attacked && seconds - watcher.alertedAt >= ALERT_INTERVAL) {
    cues.push(attacked);
    watcher.alertedAt = seconds;
  }

  const self = state.players[player];
  if (watcher.started) {
    for (const key of self.researched.slice(watcher.researched)) {
      cues.push(state.rules.technologies[key as TechKey]?.grantsAge !== undefined
        ? 'age_up' : 'tech_researched');
    }
    const capped = self.populationCap > 0 && self.population >= self.populationCap;
    if (capped && !watcher.capped) cues.push('pop_capped');
    watcher.capped = capped;
    if (state.winner && !watcher.ended) cues.push(state.winner === player ? 'victory' : 'defeat');
  } else {
    watcher.capped = self.populationCap > 0 && self.population >= self.populationCap;
  }

  watcher.hp = hp;
  watcher.farms = farms;
  watcher.researched = self.researched.length;
  watcher.ended = state.winner !== undefined;
  watcher.started = true;
  return cues;
}
