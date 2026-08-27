import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FALLBACK_RULES, isAnimal, isBuilding, isUnit } from './data';
import { createGame, applyCommand, stepGame } from './game';
import { describeObservation, observe } from './observe';
import { isTileExplored, isTileVisible } from './visibility';
import { validateObservation, explain } from '../protocol/validate';
import type { Entity } from './types';

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

  it('answers to what it is for every kind the rules know', () => {
    // `isBuilding` and `isUnit` decide who is stepped, what obstructs, and
    // which art a thing draws. A kind missing from them is not a compile
    // error: it is a wall units stroll through, found only by looking.
    for (const kind of Object.keys(FALLBACK_RULES.buildings)) {
      expect(isBuilding(kind as never), `building ${kind}`).toBe(true);
      expect(isUnit(kind as never), `not a unit: ${kind}`).toBe(false);
    }
    for (const kind of Object.keys(FALLBACK_RULES.units)) {
      expect(isUnit(kind as never), `unit ${kind}`).toBe(true);
      expect(isBuilding(kind as never), `not a building: ${kind}`).toBe(false);
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

  it('gives a building its line of sight only once it is finished', () => {
    // Issue #1: a foundation is a claim on the ground, not a watchtower. The
    // DAT has one `line_of_sight` per unit and no construction-time variant,
    // so the rule is checked here rather than imported.
    const state = createGame(11);
    const rules = state.rules.buildings.house;
    const far = { x: 60, y: 60 };
    for (const entity of state.entities.filter(e => e.owner === 1)) {
      expect(
        Math.hypot(entity.position.x - far.x, entity.position.y - far.y),
        `${entity.kind} stands too near the test site`,
      ).toBeGreaterThan(rules.lineOfSight + 12);
    }
    const foundation: Entity = {
      id: state.nextId++, kind: 'house', owner: 1, position: far,
      hp: 1, maxHp: rules.hp, radius: rules.radius,
      activity: 'idle', order: { kind: 'idle' }, buildProgress: 0.1,
    };
    state.entities.push(foundation);
    stepGame(state);
    const edge = { x: far.x + rules.lineOfSight - 1, y: far.y };
    expect(isTileVisible(state, 1, edge.x, edge.y)).toBe(false);
    expect(isTileExplored(state, 1, edge.x, edge.y)).toBe(false);

    // Finished, it sees what its rules say it sees.
    foundation.buildProgress = undefined;
    foundation.hp = rules.hp;
    stepGame(state);
    expect(isTileVisible(state, 1, edge.x, edge.y)).toBe(true);
    expect(isTileVisible(state, 1, far.x + rules.lineOfSight + 3, far.y)).toBe(false);
  });

  it('lets an enemy unit walk out of sight rather than leaving it standing there', () => {
    // Issue #4. The DAT decides this: in the gaia civ every resource and every
    // huntable is `fog_visibility` 1, and every unit a player trains is 0.
    const state = createGame(11);
    const scout = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
    const enemy = state.entities.find(e => e.owner === 2 && e.kind === 'villager')!;
    const sheep = state.entities.find(e => e.kind === 'sheep')!;
    enemy.position = { x: 40, y: 40 };
    sheep.position = { x: 41, y: 40 };
    scout.position = { x: 40, y: 41 };
    stepGame(state);
    expect(observe(state, 1).entities.some(e => e.id === enemy.id)).toBe(true);
    expect(observe(state, 1).entities.some(e => e.id === sheep.id)).toBe(true);

    // Look away. The sheep is still where it was found; the villager is not.
    scout.position = { x: 5, y: 9 };
    stepGame(state);
    const fogged = observe(state, 1);
    expect(fogged.entities.some(e => e.id === enemy.id)).toBe(false);
    expect(fogged.memory.some(e => e.id === enemy.id)).toBe(false);
    expect(fogged.memory.some(e => e.id === sheep.id)).toBe(true);
  });

  it('hides unexplored gaia resources until scouted', () => {
    const state = createGame(11);
    const observation = observe(state, 1);
    // Far enough that no line of sight the player owns reaches it — the town
    // center sees eight tiles and the scout four, from nine tiles out.
    const tc = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
    const farNodes = state.entities.filter(
      e => e.kind === 'resource'
        && Math.hypot(e.position.x - tc.position.x, e.position.y - tc.position.y) > 30,
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
