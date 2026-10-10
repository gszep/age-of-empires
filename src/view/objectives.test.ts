import { describe, it, expect } from 'vitest';
import { createGame } from '../sim/game';
import { FALLBACK_RULES } from '../sim/data';
import { WONDER_YEAR_TICKS } from '../sim/wonder';
import { objectivesAvailable, objectivesModel } from './objectives';
import { wonderTimerText, wonderYearsRemaining } from './wonder';
import type { GameState, PlayerId } from '../sim/types';
import type { UiAssets } from './assets';

function fixture() {
  return createGame(138, FALLBACK_RULES);
}

function countdown(state: GameState, owner: PlayerId, ticks: number) {
  const entity = structuredClone(state.entities.find(e => e.kind === 'town-center' && e.owner === owner)!);
  entity.id = state.nextId++; entity.kind = 'wonder';
  state.entities.push(entity);
  (state.wonderCountdowns ??= []).push({ entityId: entity.id, owner, finishTick: state.tick + ticks });
  return entity;
}

describe('objectives model', () => {
  it('always shows Conquest as the standard victory condition', () => {
    const state = fixture();
    const model = objectivesModel(state, 1);
    expect(model.lines).toHaveLength(1);
    expect(model.lines[0]).toMatch(/Conquest/);
  });

  it('adds Wonder victory countdown when wonderVictory is enabled', () => {
    const state = fixture();
    state.tick = 100;
    state.wonderVictory = true;
    countdown(state, 1, WONDER_YEAR_TICKS);
    const model = objectivesModel(state, 1);
    expect(model.lines).toHaveLength(3);
    expect(model.lines[1]).toMatch(/Wonder/);
    expect(model.lines[1]).toContain('200 Years');
    expect(model.lines[2]).toContain('1 Years');
  });

  it('excludes Wonder countdown when wonderVictory is disabled', () => {
    const state = fixture();
    state.tick = 100;
    state.wonderVictory = false;
    countdown(state, 1, WONDER_YEAR_TICKS);
    const model = objectivesModel(state, 1);
    expect(model.lines).toHaveLength(1);
    expect(model.lines[0]).toMatch(/Conquest/);
  });

  it('ceil-rounds partial years like the HUD, reaching zero only at expiry', () => {
    const state = fixture();
    state.tick = 500;
    state.wonderVictory = true;
    countdown(state, 1, 50); // 50 ticks / 20 Hz = 2.5 seconds = half a year
    expect(objectivesModel(state, 1).lines[2]).toContain('1 Years');
    for (const [tick, years] of [[549, 1], [550, 0], [551, 0]]) {
      state.tick = tick;
      expect(objectivesModel(state, 1).lines[2]).toContain(wonderTimerText(years));
      expect(wonderYearsRemaining(550, tick)).toBe(years);
    }
  });

  it('uses provided localization strings when available', () => {
    const state = fixture();
    state.wonderVictory = true;
    countdown(state, 1, WONDER_YEAR_TICKS + 1);
    const strings = { '9823': 'Localized conquest', '11436': 'Localized build', '11301': 'Localized timer: %d' };
    const model = objectivesModel(state, 1, strings);
    expect(model.lines).toEqual(['Localized conquest', 'Localized build — Localized timer: 200', 'Player 1 — Localized timer: 2']);
  });

  it('handles missing Wonder countdown for the player', () => {
    const state = fixture();
    state.tick = 100;
    state.wonderVictory = true;
    countdown(state, 2, WONDER_YEAR_TICKS);
    const model = objectivesModel(state, 1);
    expect(model.lines).toHaveLength(3); // Enabled condition plus the public enemy timer
    expect(model.lines[2]).toBe('Player 2 — Wonder: 1 Years');
  });

  it('shows the enabled condition before any Wonder is completed', () => {
    const state = fixture(); state.wonderVictory = true;
    expect(objectivesModel(state, 1).lines).toHaveLength(2);
    expect(objectivesModel(state, 1).lines[1]).toBe('Build a Wonder — Wonder: 200 Years');
  });

  it('uses each side’s earliest valid timer and removes destroyed or captured Wonders without mutating state', () => {
    const state = fixture(); state.wonderVictory = true;
    countdown(state, 1, 500);
    countdown(state, 1, 200);
    countdown(state, 2, 300).dead = true;
    countdown(state, 2, 100).owner = 1;
    const before = structuredClone(state);
    expect(objectivesModel(state, 1).lines.slice(2)).toEqual(['Player 1 — Wonder: 2 Years']);
    expect(state).toEqual(before);
  });

  it('requires the owned layout and all localized labels (old imports fail closed)', () => {
    expect(objectivesAvailable(undefined)).toBe(false);
    const ui = { layouts: { dialogobjectives: {} }, objectivesStrings: {
      '10910': 'Title', '9249': 'Close', '9823': 'Conquest', '11436': 'Build', '11301': 'Timer %d',
    } } as unknown as UiAssets;
    expect(objectivesAvailable(ui)).toBe(true);
    delete ui.objectivesStrings!['9823'];
    expect(objectivesAvailable(ui)).toBe(false);
  });
});
