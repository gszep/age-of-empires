import { describe, expect, it } from 'vitest';
import { createGame } from '../sim/game';
import { observe } from '../sim/observe';
import { PROTOCOL_VERSION } from './types';

// The public contract is what every strategy -- subprocess, WebSocket, MCP,
// the live model -- parses. Its version is bumped by hand, so this pins the
// shape a strategy sees: when a key is added, removed or renamed, this test
// fails, and the fix is to bump PROTOCOL_VERSION *and* update the lists,
// never only the lists.

const OBSERVATION_KEYS = [
  'age', 'autoReseedFarms', 'civilization', 'entities', 'explored', 'food', 'gold', 'mapHeight', 'mapWidth',
  'memory', 'player', 'population', 'populationCap', 'researched', 'stone', 'time', 'version', 'winner', 'wood',
];
const OBSERVATION_ALWAYS = OBSERVATION_KEYS.filter(k => !['autoReseedFarms', 'winner'].includes(k));
const ENTITY_KEYS = [
  'activity', 'amount', 'buildProgress', 'buildTargetId', 'gatherTargetId', 'carrying', 'garrisoned', 'hp', 'id', 'kind', 'maxHp', 'node', 'order',
  'owner', 'researching', 'resource', 'training', 'x', 'y',
];
const ENTITY_ALWAYS = ['activity', 'hp', 'id', 'kind', 'maxHp', 'order', 'owner', 'x', 'y'];

describe('the observation contract', () => {
  it('has the keys strategies were written against, at this version', () => {
    const state = createGame(7);
    const observation = observe(state, 1);
    expect(observation.version).toBe(PROTOCOL_VERSION);
    expect(PROTOCOL_VERSION).toBe(4);
    for (const key of Object.keys(observation)) {
      expect(OBSERVATION_KEYS, `${key} is new to the contract: bump PROTOCOL_VERSION`).toContain(key);
    }
    for (const key of OBSERVATION_ALWAYS) expect(observation, `${key} left the contract: bump PROTOCOL_VERSION`).toHaveProperty(key);
    for (const entity of observation.entities) {
      for (const key of Object.keys(entity)) {
        expect(ENTITY_KEYS, `entity.${key} is new to the contract: bump PROTOCOL_VERSION`).toContain(key);
      }
      for (const key of ENTITY_ALWAYS) expect(entity, `entity.${key} left the contract`).toHaveProperty(key);
    }
  });

  it('carries every optional key somewhere in a played opening', () => {
    // Optional keys that never appear are keys nobody can rely on; this lists
    // the ones a strategy may see so that dropping one is a visible change.
    const state = createGame(7);
    const observation = observe(state, 1);
    const seen = new Set(observation.entities.flatMap(e => Object.keys(e)));
    for (const key of ['id', 'kind', 'owner', 'x', 'y', 'hp', 'maxHp', 'activity']) expect(seen.has(key), key).toBe(true);
  });
});
