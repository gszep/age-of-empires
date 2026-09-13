import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyCommand, createGame, placementLegal, stepGame } from '../sim/game';
import type { Entity, GameState } from '../sim/types';
import { ALERT_INTERVAL, RESEED_GRACE, createCueWatcher, pollCues, type Cue } from './cues';

const run = (state: GameState, ticks: number) => {
  for (let i = 0; i < ticks; i++) stepGame(state);
};
const seconds = (state: GameState) => state.tick * 0.05;

const AUDIO_PATH = 'public/imported/aoe2/audio/manifest.json';
const importedAudio: { audio: Record<string, unknown> } | undefined = existsSync(AUDIO_PATH)
  ? JSON.parse(readFileSync(AUDIO_PATH, 'utf8')) as { audio: Record<string, unknown> }
  : undefined;

const EVERY_CUE: Cue[] = [
  'under_attack', 'under_attack_town', 'pop_capped', 'farm_depleted',
  'age_up', 'tech_researched', 'victory', 'defeat',
];

describe('feedback cues', () => {
  it.skipIf(!importedAudio)('names only cues the import actually brought in', () => {
    // The watcher answers with aliases the view feeds straight to the audio
    // manifest; a cue nobody imported would be silence with nothing to say so.
    for (const cue of EVERY_CUE) {
      expect(Object.keys(importedAudio!.audio), cue).toContain(cue);
    }
    // The two the view raises directly rather than by watching state.
    for (const cue of ['gatherpoint_set', 'error']) {
      expect(Object.keys(importedAudio!.audio), cue).toContain(cue);
    }
  });

  it('says nothing on the first look, however the world already is', () => {
    // A match resumed from a snapshot must not alert for every unit that was
    // already hurt before the view opened its eyes.
    const state = createGame(51);
    const villager = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
    villager.hp -= 5;
    const watcher = createCueWatcher();
    expect(pollCues(watcher, state, 1, seconds(state))).toEqual([]);
  });

  it('raises the town alert when a building of yours is being hit, once', () => {
    const state = createGame(52);
    const watcher = createCueWatcher();
    pollCues(watcher, state, 1, seconds(state));

    const tc = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
    tc.hp -= 20;
    expect(pollCues(watcher, state, 1, 5)).toEqual(['under_attack_town']);
    // Still under attack a moment later, and still quiet: an alert every tick
    // would be a siren rather than a warning.
    tc.hp -= 20;
    expect(pollCues(watcher, state, 1, 6)).toEqual([]);
    // ...and still quiet past the rearm window, because it has not been left
    // alone for any of it. A fight that goes on is one alert; the cases where
    // it should speak again have their own tests below.
    tc.hp -= 20;
    expect(pollCues(watcher, state, 1, 5 + ALERT_INTERVAL)).toEqual([]);
  });

  it('tells a wounded unit from a wounded building', () => {
    const state = createGame(53);
    const watcher = createCueWatcher();
    pollCues(watcher, state, 1, seconds(state));
    const villager = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
    villager.hp -= 3;
    expect(pollCues(watcher, state, 1, 20)).toEqual(['under_attack']);
  });

  it('announces a sustained attack once, not once every ten seconds', () => {
    // The alert used to hang off a single timer for the whole player, so a
    // building being ground down re-announced itself every time that timer
    // lapsed. One fight, one alert.
    const state = createGame(56);
    const watcher = createCueWatcher();
    pollCues(watcher, state, 1, seconds(state));
    const town = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
    const raised: Cue[] = [];
    for (let second = 1; second <= 60; second++) {
      town.hp -= 5;
      raised.push(...pollCues(watcher, state, 1, second));
    }
    expect(raised).toEqual(['under_attack_town']);
  });

  it('announces a second building attacked while the first still is', () => {
    // The worse half of the same bug: with one timer, anything hit inside the
    // window was silently ignored — exactly the moment a player needs telling.
    const state = createGame(57);
    const watcher = createCueWatcher();
    pollCues(watcher, state, 1, seconds(state));
    const town = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
    const rules = state.rules.buildings.house;
    const house: Entity = {
      id: state.nextId++, kind: 'house', owner: 1, position: { x: 50.5, y: 50.5 },
      hp: rules.hp, maxHp: rules.hp, radius: rules.radius,
      activity: 'idle', order: { kind: 'idle' },
    };
    state.entities.push(house);
    pollCues(watcher, state, 1, 1);

    town.hp -= 5;
    expect(pollCues(watcher, state, 1, 2)).toEqual(['under_attack_town']);
    // Three seconds later, well inside the old ten-second window.
    town.hp -= 5;
    house.hp -= 5;
    expect(pollCues(watcher, state, 1, 5)).toEqual(['under_attack_town']);
  });

  it('alerts again once a thing has been left alone for a while', () => {
    const state = createGame(58);
    const watcher = createCueWatcher();
    pollCues(watcher, state, 1, seconds(state));
    const town = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
    town.hp -= 5;
    expect(pollCues(watcher, state, 1, 2)).toEqual(['under_attack_town']);
    for (let second = 3; second < 2 + ALERT_INTERVAL; second++) {
      expect(pollCues(watcher, state, 1, second)).toEqual([]);
    }
    town.hp -= 5;
    expect(pollCues(watcher, state, 1, 2 + ALERT_INTERVAL + 1)).toEqual(['under_attack_town']);
  });

  it('never alerts for somebody else being hit', () => {
    const state = createGame(54);
    const watcher = createCueWatcher();
    pollCues(watcher, state, 1, seconds(state));
    const enemy = state.entities.find(e => e.owner === 2 && e.kind === 'villager')!;
    enemy.hp -= 10;
    expect(pollCues(watcher, state, 1, 30)).toEqual([]);
  });

  it('sounds an age-up and a technology differently', () => {
    const state = createGame(55);
    const watcher = createCueWatcher();
    pollCues(watcher, state, 1, seconds(state));
    state.players[1].researched.push('loom');
    expect(pollCues(watcher, state, 1, 10)).toEqual(['tech_researched']);
    state.players[1].researched.push('feudal-age');
    expect(pollCues(watcher, state, 1, 11)).toEqual(['age_up']);
    // And nothing again for what it has already announced.
    expect(pollCues(watcher, state, 1, 12)).toEqual([]);
  });

  it('sounds the population cap on the way in, not while it stays there', () => {
    const state = createGame(56);
    const watcher = createCueWatcher();
    pollCues(watcher, state, 1, seconds(state));
    state.players[1].populationCap = 5;
    state.players[1].population = 5;
    expect(pollCues(watcher, state, 1, 10)).toEqual(['pop_capped']);
    expect(pollCues(watcher, state, 1, 11)).toEqual([]);
    state.players[1].population = 4;
    expect(pollCues(watcher, state, 1, 12)).toEqual([]);
    state.players[1].population = 5;
    expect(pollCues(watcher, state, 1, 13)).toEqual(['pop_capped']);
  });

  it('notices a farm running out', () => {
    const state = createGame(57);
    state.players[1].wood = 500;
    const builders = state.entities.filter(e => e.owner === 1 && e.kind === 'villager').map(e => e.id);
    let target: { x: number; y: number } | undefined;
    for (let x = 7; x < 16 && !target; x += 0.5) {
      for (const y of [12, 11, 13, 10]) {
        if (placementLegal(state, 'farm', { x, y }).ok) { target = { x, y }; break; }
      }
    }
    expect(target).toBeDefined();
    expect(applyCommand(state, {
      kind: 'build', player: 1, builderIds: builders, building: 'farm', target: target!,
    }).ok).toBe(true);
    for (let i = 0; i < 4000 && !state.entities.some(e => e.kind === 'farm' && e.buildProgress === undefined); i++) {
      stepGame(state);
    }
    const farm = state.entities.find(e => e.kind === 'farm')!;
    const watcher = createCueWatcher();
    pollCues(watcher, state, 1, seconds(state));
    farm.amount = 0;
    run(state, 2);
    // Held briefly, in case a villager is about to sow it again.
    const emptied = seconds(state);
    expect(pollCues(watcher, state, 1, emptied)).not.toContain('farm_depleted');
    expect(pollCues(watcher, state, 1, emptied + RESEED_GRACE)).toContain('farm_depleted');
    // And said once, not on every frame after.
    expect(pollCues(watcher, state, 1, emptied + RESEED_GRACE + 5)).not.toContain('farm_depleted');
  });

  it('says nothing when the farm is really sown again by a villager', () => {
    // Issue #33, driven the way a player meets it: the mill's option on, a
    // villager farming, and the farm worked out under it. `reseedFarm` puts a
    // new foundation on the same ground on the next tick and the player is
    // told nothing, because nothing needs doing.
    const state = createGame(57);
    state.players[1].wood = 2000;
    state.players[1].food = 2000;
    const builders = state.entities.filter(e => e.owner === 1 && e.kind === 'villager').map(e => e.id);
    // A mill, so the option has somewhere to be asked for.
    let millAt: { x: number; y: number } | undefined;
    for (let x = 7; x < 20 && !millAt; x += 0.5) {
      for (const y of [16, 15, 17, 14]) {
        if (placementLegal(state, 'mill', { x, y }).ok) { millAt = { x, y }; break; }
      }
    }
    expect(applyCommand(state, {
      kind: 'build', player: 1, builderIds: builders, building: 'mill', target: millAt!,
    }).ok).toBe(true);
    for (let i = 0; i < 6000 && !state.entities.some(e => e.kind === 'mill' && e.buildProgress === undefined); i++) {
      stepGame(state);
    }
    const mill = state.entities.find(e => e.kind === 'mill' && e.buildProgress === undefined)!;
    expect(applyCommand(state, { kind: 'reseed', player: 1, buildingId: mill.id, enabled: true }).ok).toBe(true);

    let farmAt: { x: number; y: number } | undefined;
    for (let x = 7; x < 20 && !farmAt; x += 0.5) {
      for (const y of [12, 11, 13, 10]) {
        if (placementLegal(state, 'farm', { x, y }).ok) { farmAt = { x, y }; break; }
      }
    }
    expect(applyCommand(state, {
      kind: 'build', player: 1, builderIds: builders, building: 'farm', target: farmAt!,
    }).ok).toBe(true);
    for (let i = 0; i < 6000 && !state.entities.some(e => e.kind === 'farm' && e.buildProgress === undefined); i++) {
      stepGame(state);
    }
    const farm = state.entities.find(e => e.kind === 'farm' && e.buildProgress === undefined)!;
    // Put a villager on it and leave it almost empty, so it runs out shortly.
    const worker = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
    expect(applyCommand(state, {
      kind: 'order', player: 1, entityIds: [worker.id], target: farm.position, targetId: farm.id,
    }).ok).toBe(true);
    for (let i = 0; i < 4000 && worker.activity !== 'gathering'; i++) stepGame(state);
    expect(worker.activity).toBe('gathering');
    farm.amount = 2;
    const emptiedId = farm.id;

    const watcher = createCueWatcher();
    pollCues(watcher, state, 1, seconds(state));
    // Poll every tick, the way the frame loop does, right through the emptying
    // and well past the grace.
    const heard: Cue[] = [];
    for (let i = 0; i < 400; i++) {
      stepGame(state);
      heard.push(...pollCues(watcher, state, 1, seconds(state)));
    }
    expect(state.entities.some(e => e.kind === 'farm' && e.id !== emptiedId && !e.dead)).toBe(true);
    expect(heard).not.toContain('farm_depleted');
  });

  it('says nothing when the farm is sown again where it stood', () => {
    // Issue #33. Auto-reseeding replaces the farm on the tick after it empties,
    // so announcing the emptying cried about every farm the option exists to
    // stop the player having to think about.
    const state = createGame(57);
    state.players[1].wood = 500;
    const at = { x: 9, y: 12 };
    expect(placementLegal(state, 'farm', at).ok).toBe(true);
    const farm = state.entities.find(e => e.kind === 'farm')
      ?? (() => {
        const builders = state.entities.filter(e => e.owner === 1 && e.kind === 'villager').map(e => e.id);
        applyCommand(state, { kind: 'build', player: 1, builderIds: builders, building: 'farm', target: at });
        for (let i = 0; i < 4000 && !state.entities.some(e => e.kind === 'farm' && e.buildProgress === undefined); i++) {
          stepGame(state);
        }
        return state.entities.find(e => e.kind === 'farm')!;
      })();
    const watcher = createCueWatcher();
    pollCues(watcher, state, 1, seconds(state));

    // The farm empties, and on the next poll a fresh foundation stands on the
    // same ground -- which is exactly what `reseedFarm` builds.
    const where = { ...farm.position };
    farm.amount = 0;
    const emptied = seconds(state);
    expect(pollCues(watcher, state, 1, emptied)).not.toContain('farm_depleted');
    farm.dead = true;
    state.entities.push({
      ...farm, id: 99001, dead: false, hp: 1, buildProgress: 0, amount: undefined, position: where,
    });
    // Long past the grace, and still nothing to say.
    expect(pollCues(watcher, state, 1, emptied + RESEED_GRACE + 5)).not.toContain('farm_depleted');
    expect(pollCues(watcher, state, 1, emptied + RESEED_GRACE + 30)).not.toContain('farm_depleted');
  });

  it('calls the end of the match for the side it is watching', () => {
    const state = createGame(58);
    const watcher = createCueWatcher();
    pollCues(watcher, state, 1, seconds(state));
    state.winner = 2;
    expect(pollCues(watcher, state, 1, 40)).toEqual(['defeat']);
    expect(pollCues(watcher, state, 1, 41)).toEqual([]);

    const other = createCueWatcher();
    pollCues(other, state, 2, 40);
    state.winner = undefined;
    pollCues(other, state, 2, 41);
    state.winner = 2;
    expect(pollCues(other, state, 2, 42)).toEqual(['victory']);
  });
});
