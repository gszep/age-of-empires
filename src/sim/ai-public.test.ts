import { describe, expect, it } from 'vitest';
import { exampleAiCommands } from './ai';
import { enemyWonderDeadline, siegePlan } from './ai-siege';
import { applyCommand, createGame, stepGame } from './game';
import { publicWonderFixture } from './agent-public.fixture';
import { observe } from './observe';
import { updateVisibility } from './visibility';
import type { Entity, UnitKind } from './types';
import { SharedMatch } from '../shared/match';
import { synchronizationHash } from '../shared/checksum';

describe('example AI public ceilings and deadlines', () => {
  it.each([
    [200, 200, 200, false], [225, 200, 200, false], [200, 200, 210, true],
    [5, 4, 200, true], [200, 200, undefined, true],
  ] as const)('housing %s, population %s, ceiling %s: new house=%s', (cap, population, limit, builds) => {
    const state = createGame(281);
    state.entities = state.entities.filter(e => e.owner !== 0);
    state.terrain.fill(0); state.elevation.fill(0); updateVisibility(state);
    const observation = observe(state, 1);
    Object.assign(observation, { populationCap: cap, population, populationLimit: limit });
    const commands = exampleAiCommands(JSON.parse(JSON.stringify(observation)), { fishing: false });
    const houses = commands.filter(c => c.kind === 'build' && c.building === 'house');
    expect(houses.length > 0).toBe(builds);
    for (const command of houses) expect(applyCommand(state, command).ok).toBe(true);
  });

  function defenders() {
    const f = publicWonderFixture(); f.finish();
    const { state } = f;
    state.players[2].age = 3;
    const put = (kind: UnitKind, x: number, y: number) => {
      const r = state.rules.units[kind];
      const e: Entity = { id: state.nextId++, kind, owner: 2, position: { x, y },
        hp: r.hp, maxHp: r.hp, radius: r.radius, activity: 'idle', order: { kind: 'idle' } };
      state.entities.push(e); return e;
    };
    const soldier = put('crossbowman', 80, 80), engine = put('trebuchet', 82, 80);
    updateVisibility(state);
    return { ...f, soldier, engine };
  }

  it('prioritizes the earliest enemy announcement deterministically, without targeting hidden ids', () => {
    const { state, wonder, soldier, engine } = defenders();
    const observation = observe(state, 2);
    expect(observation.entities.some(e => e.id === wonder.id)).toBe(false);
    expect(observation.memory).toEqual([]);
    const first = observation.wonderCountdowns![0];
    observation.wonderCountdowns = [
      { ...first, owner: 2, remainingSeconds: 1, x: 10, y: 10 },
      { ...first, entityId: state.nextId + 2, remainingSeconds: 100, x: 20, y: 20 },
      { ...first, entityId: state.nextId + 1, remainingSeconds: 100, x: 30, y: 30 },
      { ...first, x: 40, y: 40 },
    ];
    const expected = observation.wonderCountdowns[2];
    expect(enemyWonderDeadline(observation)).toEqual(expected);
    const decide = () => exampleAiCommands(JSON.parse(JSON.stringify(observation)), { fishing: false });
    const a = decide(); observation.wonderCountdowns.reverse(); expect(decide()).toEqual(a);
    for (const actor of [soldier, engine]) {
      expect(a.filter(c => c.kind === 'order' && c.entityIds.includes(actor.id))).toEqual([
        { kind: 'order', player: 2, entityIds: [actor.id], target: { x: expected.x, y: expected.y } },
      ]);
    }
    expect(siegePlan(observation, 1).needsCastle).toBe(true); // no remembered building or ten-unit gate
    observation.wonderCountdowns = [{ ...first, owner: 2 }];
    expect(enemyWonderDeadline(observation)).toBeUndefined();
    expect(siegePlan(observation, 1).needsCastle).toBe(false);
    expect(decide().some(c => c.kind === 'order' && c.entityIds.includes(engine.id))).toBe(false);
  });

  it('redirects moving troops, attacks only after sight, and repeated decisions allow real damage', () => {
    const { state, wonder, soldier, engine } = defenders();
    soldier.position = { x: 60, y: 20.5 }; engine.position = { x: 62, y: 20.5 };
    soldier.order = { kind: 'move', target: { x: 80, y: 80 } };
    updateVisibility(state);
    expect(observe(state, 2).entities.some(e => e.id === wonder.id)).toBe(false);
    const decide = () => exampleAiCommands(observe(state, 2), { fishing: false });
    const march = decide().filter(c => c.kind === 'order' && c.entityIds.includes(soldier.id));
    expect(march).toEqual([{ kind: 'order', player: 2, entityIds: [soldier.id], target: { ...wonder.position } }]);
    const hp = wonder.hp;
    let targeted = false;
    for (let i = 0; i < 2000 && wonder.hp === hp; i++) {
      if (i % 10 === 0) for (const command of decide()) {
        if (command.kind === 'order' && command.targetId === wonder.id) {
          expect(observe(state, 2).entities.some(e => e.id === wonder.id)).toBe(true);
          targeted = true;
        }
        expect(applyCommand(state, command).ok).toBe(true);
      }
      stepGame(state);
    }
    expect(targeted).toBe(true); expect(wonder.hp).toBeLessThan(hp);
    // An attack must not be reissued every decision: that aborts its windup.
    engine.order = { kind: 'attack', targetId: wonder.id };
    soldier.order = { kind: 'attack', targetId: wonder.id };
    expect(decide().some(c => c.kind === 'order' && c.entityIds.some(id => [engine.id, soldier.id].includes(id)))).toBe(false);
  });

  it('replicates the changed host AI through JSON commands without follower AI or checksum changes', () => {
    const { state, wonder, soldier } = defenders();
    state.tick = Math.ceil(state.tick / 10) * 10;
    const host = new SharedMatch(state);
    const client = JSON.parse(JSON.stringify(state));
    let marched = false;
    for (let i = 0; i < 100; i++) {
      const message = JSON.parse(JSON.stringify(host.advance()));
      for (const command of message.commands) {
        if (command.kind === 'order' && command.entityIds.includes(soldier.id)) {
          expect(command.target).toEqual(wonder.position);
          expect(command).not.toHaveProperty('targetId'); marched = true;
        }
        expect(applyCommand(client, command).ok).toBe(true);
      }
      stepGame(client);
      expect(synchronizationHash(client)).toBe(synchronizationHash(host.state));
    }
    expect(marched).toBe(true);
  });
});
