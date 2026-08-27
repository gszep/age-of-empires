import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyCommand, createGame, placementLegal, stepGame } from '../sim/game';
import type { GameState } from '../sim/types';
import { ALERT_INTERVAL, createCueWatcher, pollCues, type Cue } from './cues';

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
    tc.hp -= 20;
    expect(pollCues(watcher, state, 1, 5 + ALERT_INTERVAL)).toEqual(['under_attack_town']);
  });

  it('tells a wounded unit from a wounded building', () => {
    const state = createGame(53);
    const watcher = createCueWatcher();
    pollCues(watcher, state, 1, seconds(state));
    const villager = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
    villager.hp -= 3;
    expect(pollCues(watcher, state, 1, 20)).toEqual(['under_attack']);
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
    expect(pollCues(watcher, state, 1, seconds(state))).toContain('farm_depleted');
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
