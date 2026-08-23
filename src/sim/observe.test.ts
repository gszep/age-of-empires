import { describe, expect, it } from 'vitest';
import { createGame, applyCommand, stepGame } from './game';
import { describeObservation, observe } from './observe';
import { validateObservation, explain } from '../protocol/validate';

describe('player observations', () => {
  it('never reveals enemy entities beyond every own line of sight', () => {
    const state = createGame(11);
    // Bases start 22 tiles apart with max LOS 8: nothing enemy is visible.
    const observation = observe(state, 1);
    expect(observation.entities.some(e => e.owner === 2)).toBe(false);
    // Privileged truth differs: the enemy exists in the authoritative state.
    expect(state.entities.some(e => e.owner === 2)).toBe(true);
  });

  it('reveals an enemy that walks into own line of sight and hides its orders', () => {
    const state = createGame(11);
    const enemyVillager = state.entities.find(e => e.owner === 2 && e.kind === 'villager')!;
    const ownTc = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
    enemyVillager.position = { x: ownTc.position.x + 3, y: ownTc.position.y };
    enemyVillager.order = { kind: 'move', target: { x: 0, y: 0 } };

    const observed = observe(state, 1).entities.find(e => e.id === enemyVillager.id);
    expect(observed).toBeDefined();
    expect(observed!.order).toBeUndefined();
    expect(observed!.activity).toBeUndefined();
    expect(observed!.training).toBeUndefined();
  });

  it('hides enemy production queues even when the building is visible', () => {
    const state = createGame(11);
    const enemyTc = state.entities.find(e => e.owner === 2 && e.kind === 'town-center')!;
    applyCommand(state, { kind: 'train', player: 2, buildingId: enemyTc.id, unit: 'villager' });
    const ownMilitia = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
    ownMilitia.position = { x: enemyTc.position.x - 3, y: enemyTc.position.y };

    const observed = observe(state, 1).entities.find(e => e.id === enemyTc.id)!;
    expect(observed.training).toBeUndefined();
    expect(observe(state, 2).entities.find(e => e.id === enemyTc.id)!.training).toBeDefined();
  });

  it('emits schema-valid observations throughout a running match', () => {
    const state = createGame(3);
    for (let i = 0; i < 200; i++) stepGame(state);
    for (const player of [1, 2] as const) {
      const observation = observe(state, player);
      expect(validateObservation(observation), explain(validateObservation)).toBe(true);
    }
  });

  it('derives deterministic text from the observation alone', () => {
    const state = createGame(5);
    const a = describeObservation(observe(state, 1));
    const b = describeObservation(observe(createGame(5), 1));
    expect(a).toBe(b);
    expect(a).toContain('food=200 wood=200');
    expect(a).toContain('enemy seen: none');
  });
});
