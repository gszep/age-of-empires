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
import type { GameState, PlayerId, ReadonlyGameState } from '../sim/types';

/** Alert names, matching the aliases `sounds.json` gives these events. */
export type Cue =
  | 'under_attack' | 'under_attack_town' | 'pop_capped' | 'farm_depleted'
  | 'age_up' | 'tech_researched' | 'victory' | 'defeat';

export interface CueWatcher {
  /** Hit points seen last poll, per owned entity. */
  hp: Map<number, number>;
  /** Farms seen with food left, and where they stand, so their emptying can
   * be noticed and the ground they leave behind watched. */
  farms: Map<number, { x: number; y: number }>;
  /**
   * Ground that has just gone fallow, and the game second it did.
   *
   * A farm is not replaced in the same tick it empties: the villager that
   * worked it out finds its node gone on the *next* tick and only then sows
   * again. Announcing the moment the food ran out therefore cried about every
   * automatically re-sown farm, which is the one case the player asked not to
   * be told about (issue #33). Holding the news for a moment lets the new
   * foundation take the ground in silence, and still tells the player when
   * nothing does — a re-sowing that could not be paid for is exactly when they
   * need to know.
   */
  fallow: Map<number, { x: number; y: number; since: number }>;
  researched: number;
  capped: boolean;
  ended: boolean;
  /**
   * Game seconds each owned thing was last seen losing hit points, per entity.
   *
   * Per entity is the whole point. A single timer for the whole player says
   * "something of yours was attacked recently", which gets both halves wrong:
   * a building under sustained attack re-announces itself every time the timer
   * lapses, and a *second* building attacked while the timer is still running
   * is never announced at all. That second half is the worse one -- it is
   * exactly the moment a player needs telling.
   */
  hitAt: Map<number, number>;
  started: boolean;
}

/**
 * How long a thing has to go unhurt before being hit again is news.
 *
 * Nothing in the owned files states it: `sounds.json` names the cue but not
 * its rearm, and the behaviour lives in the closed runtime. Ten seconds is an
 * approximation of AoE2's feel and is recorded as one in `docs/ledger.md`.
 */
export const ALERT_INTERVAL = 10;

/**
 * How long fallow ground is given to be sown again before the player is told
 * about it.
 *
 * Nothing in the owned files states this either — `sounds.json` names the cue
 * and not when it fires. It only has to outlast the single tick between a farm
 * emptying and its villager sowing again; half a second is ten of those and is
 * imperceptible as a delay on the alert itself.
 */
export const RESEED_GRACE = 0.5;

export const createCueWatcher = (): CueWatcher => ({
  hp: new Map(),
  farms: new Map(),
  fallow: new Map(),
  researched: 0,
  capped: false,
  ended: false,
  hitAt: new Map(),
  started: false,
});

/**
 * Cues to play for what changed since the last poll. The first poll only
 * records the world: a match resumed from a snapshot must not alert for every
 * unit that was already damaged.
 */
export function pollCues(
  watcher: CueWatcher, state: ReadonlyGameState, player: PlayerId, seconds: number,
): Cue[] {
  const cues: Cue[] = [];
  const hp = new Map<number, number>();
  const farms = new Map<number, { x: number; y: number }>();
  // Ground a farm of this player's still stands on, counting one being built
  // but not one that has been worked out: a spent farm is what we are
  // watching leave, so it cannot be its own replacement.
  const standing = new Set<string>();
  const ground = (at: { x: number; y: number }): string => `${at.x},${at.y}`;
  const hitAt = new Map<number, number>();
  let attacked: 'under_attack' | 'under_attack_town' | undefined;

  for (const entity of state.entities) {
    if (entity.owner !== player) continue;
    if (!entity.dead) {
      hp.set(entity.id, entity.hp);
      const previous = watcher.hp.get(entity.id);
      const lastHit = watcher.hitAt.get(entity.id);
      if (previous !== undefined && entity.hp < previous) {
        hitAt.set(entity.id, seconds);
        // News only if this one has been left alone for a while: a fight that
        // goes on is one alert, not a siren, and something else being hit
        // meanwhile is its own alert however loud the first one was.
        if (lastHit === undefined || seconds - lastHit >= ALERT_INTERVAL) {
          // A building being hit is the one worth interrupting for.
          if (isBuilding(entity.kind)) attacked = 'under_attack_town';
          else attacked ??= 'under_attack';
        }
      } else if (lastHit !== undefined) {
        hitAt.set(entity.id, lastHit);
      }
    }
    if (entity.kind !== 'farm' || entity.dead) continue;
    if ((entity.amount ?? 0) > 0) farms.set(entity.id, { ...entity.position });
    if ((entity.amount ?? 0) > 0 || entity.buildProgress !== undefined) standing.add(ground(entity.position));
  }
  const fallow = new Map(watcher.fallow);
  for (const [id, at] of watcher.farms) {
    if (!farms.has(id) && !fallow.has(id)) fallow.set(id, { ...at, since: seconds });
  }
  for (const [id, entry] of fallow) {
    // Something took the ground: sown again, and no news.
    if (standing.has(ground(entry))) fallow.delete(id);
    else if (seconds - entry.since >= RESEED_GRACE) {
      cues.push('farm_depleted');
      fallow.delete(id);
    }
  }

  // One sound however many were hit at once; the next one to be hit after a
  // quiet spell gets its own.
  if (watcher.started && attacked) cues.push(attacked);

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
  watcher.fallow = fallow;
  // Rebuilt from what is still standing, so the map does not grow without end.
  watcher.hitAt = hitAt;
  watcher.researched = self.researched.length;
  watcher.ended = state.winner !== undefined;
  watcher.started = true;
  return cues;
}
