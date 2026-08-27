import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FALLBACK_RULES, isAnimal } from './data';
import { createGame, applyCommand, stepGame } from './game';
import { describeObservation, observe } from './observe';
import { validateObservation, explain } from '../protocol/validate';

describe('the public contract', () => {
  const schema = (name: string) =>
    JSON.parse(readFileSync(`schemas/${name}.schema.json`, 'utf8')) as Record<string, never>;

  it('names every kind the rules know', () => {
    // The schemas are a versioned public contract, and a kind added to the
    // rules without being added here fails only once something of that kind
    // reaches an observation — which for a building is long after the change.
    const observation = JSON.stringify(schema('observation'));
    for (const kind of Object.keys(FALLBACK_RULES.units)) {
      expect(observation, `unit ${kind}`).toContain(`"${kind}"`);
    }
    for (const kind of Object.keys(FALLBACK_RULES.buildings)) {
      expect(observation, `building ${kind}`).toContain(`"${kind}"`);
    }
    const command = JSON.stringify(schema('command'));
    for (const key of Object.keys(FALLBACK_RULES.technologies)) {
      expect(command, `researchable ${key}`).toContain(`"${key}"`);
    }
    for (const kind of Object.keys(FALLBACK_RULES.units)) {
      // Gaia's animals are nobody's to train.
      if (isAnimal(kind as never)) continue;
      expect(command, `trainable ${kind}`).toContain(`"${kind}"`);
    }
    for (const [kind, rules] of Object.entries(FALLBACK_RULES.buildings)) {
      if (!rules.buildable) continue;
      expect(command, `buildable ${kind}`).toContain(`"${kind}"`);
    }
  });
});

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
    stepGame(state); // visibility is authoritative state, refreshed by the tick

    const observed = observe(state, 1).entities.find(e => e.id === enemyTc.id)!;
    expect(observed.training).toBeUndefined();
    expect(observe(state, 2).entities.find(e => e.id === enemyTc.id)!.training).toBeDefined();
  });

  it('remembers fogged buildings with lastSeenAt and forgets razed ones on resight', () => {
    const state = createGame(11);
    const rules = state.rules.buildings.house;
    const enemyHouse = {
      id: state.nextId++, kind: 'house' as const, owner: 2 as const, position: { x: 20, y: 9 },
      hp: rules.hp, maxHp: rules.hp, radius: rules.radius, activity: 'idle' as const, order: { kind: 'idle' as const },
    };
    state.entities.push(enemyHouse);
    const scout = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
    scout.position = { x: 17, y: 9 };
    stepGame(state);
    expect(observe(state, 1).entities.some(e => e.id === enemyHouse.id)).toBe(true);

    // Walk away: the house drops into memory.
    scout.position = { x: 5, y: 9 };
    stepGame(state);
    const fogged = observe(state, 1);
    expect(fogged.entities.some(e => e.id === enemyHouse.id)).toBe(false);
    const remembered = fogged.memory.find(e => e.id === enemyHouse.id);
    expect(remembered).toBeDefined();
    expect(remembered!.lastSeenAt).toBeLessThanOrEqual(fogged.time);

    // Raze it while unseen; memory persists until the tile is seen again.
    enemyHouse.hp = 0;
    for (let i = 0; i < 80; i++) stepGame(state);
    expect(observe(state, 1).memory.some(e => e.id === enemyHouse.id)).toBe(true);
    scout.position = { x: 17, y: 9 };
    stepGame(state);
    expect(observe(state, 1).memory.some(e => e.id === enemyHouse.id)).toBe(false);
  });

  it('hides unexplored gaia resources until scouted', () => {
    const state = createGame(11);
    const observation = observe(state, 1);
    const farNodes = state.entities.filter(
      e => e.kind === 'resource' && e.position.x > 18,
    );
    expect(farNodes.length).toBeGreaterThan(0);
    for (const node of farNodes) {
      expect(observation.entities.some(e => e.id === node.id)).toBe(false);
      expect(observation.memory.some(e => e.id === node.id)).toBe(false);
    }
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
