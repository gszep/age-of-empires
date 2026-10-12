import { describe, expect, it } from 'vitest';
import { exampleAiCommands } from './ai';
import { observedBuildingSites } from './ai-placement';
import { applyCommand, createGame, placementLegal } from './game';
import { observe } from './observe';
import { observedTerrain } from '../protocol/terrain';
import type { Entity } from './types';

function militaryFixture(seed = 7) {
  const state = createGame(seed);
  // Stage Feudal infrastructure without changing seed7's problematic relief.
  state.entities = state.entities.filter(e => e.owner !== 0);
  state.visibility[2].memory = {};
  for (const [kind, x] of [['barracks', 80], ['lumber-camp', 85]] as const) {
    const rule = state.rules.buildings[kind];
    const e: Entity = { id: state.nextId++, kind, owner: 2, position: { x, y: 90 },
      hp: rule.hp, maxHp: rule.hp, radius: rule.radius, activity: 'idle', order: { kind: 'idle' } };
    state.entities.push(e);
  }
  Object.assign(state.players[2], { age: 1, wood: 1000, food: 400, populationCap: 50 });
  state.visibility[2].visible.fill(1); state.visibility[2].explored.fill(1);
  return state;
}

describe('observation-only building legality (#326)', () => {
  it('skips the demonstrated seed7 slope across repeated military-site rotations', () => {
    const state = militaryFixture();
    const bad = { x: 103, y: 66 };
    expect(placementLegal(state, 'archery-range', bad, 'x', 2))
      .toEqual({ ok: false, reason: 'placement is on unsuitable elevation' });
    let checked = 0;
    for (let decision = 0; decision < 20; decision++) {
      state.tick = decision * 60;
      const observation = JSON.parse(JSON.stringify(observe(state, 2)));
      const before = JSON.stringify(observation);
      expect(observedBuildingSites(observation)('archery-range', bad)).toBe(false);
      const build = exampleAiCommands(observation).find(c => c.kind === 'build' && c.building === 'archery-range');
      expect(build, `decision ${decision} must find another candidate`).toBeDefined();
      if (build?.kind !== 'build') throw new Error('missing range');
      expect(build.target).not.toEqual(bad);
      expect(placementLegal(state, build.building, build.target, 'x', 2)).toEqual({ ok: true });
      expect(applyCommand(structuredClone(state), build)).toEqual({ ok: true });
      expect(JSON.stringify(observation)).toBe(before);
      checked++;
    }
    expect(checked).toBe(20);
  });

  it('agrees with the authoritative ground/footprint check over known seed7 candidates', () => {
    const state = militaryFixture(), sites = observedBuildingSites(observe(state, 2));
    let legal = 0, rejected = 0;
    for (const kind of ['house', 'farm', 'barracks', 'archery-range', 'blacksmith', 'castle'] as const) {
      for (let y = 52; y <= 68; y++) for (let x = 90; x <= 106; x++) {
        const at = { x, y }, expected = placementLegal(state, kind, at, 'x', 2).ok;
        expect(sites(kind, at), `${kind} at ${x},${y}`).toBe(expected);
        if (expected) legal++; else rejected++;
      }
    }
    expect(legal).toBeGreaterThan(0); expect(rejected).toBeGreaterThan(0);
  });

  it('treats unknown footprints as unknown, never inspecting hidden terrain or blockers', () => {
    const state = militaryFixture();
    state.visibility[2].visible.fill(0); state.visibility[2].explored.fill(0);
    const before = observe(state, 2), wire = JSON.parse(JSON.stringify(before));
    const commands = exampleAiCommands(wire);
    expect(commands.some(c => c.kind === 'build')).toBe(false);
    expect(observedBuildingSites(wire)('archery-range', { x: 103, y: 66 })).toBe(false);
    state.terrain.fill(1); state.elevation.fill(12);
    const unseen = state.entities.find(e => e.owner === 1)!;
    unseen.position = { x: 103, y: 66 };
    const after = observe(state, 2);
    expect(after.terrain).toEqual(before.terrain);
    expect(exampleAiCommands(after)).toEqual(commands);
    expect(observedBuildingSites(after)('archery-range', { x: 103, y: 66 })).toBe(false);
    // The same terrain becomes relevant only after public exploration reveals it.
    state.visibility[2].explored.fill(1);
    expect(observedTerrain(state, 2)).not.toEqual(before.terrain);
  });

  it('accepts the demonstrated seed5 range site beside the barracks rather than vetoing it by coarse distance', () => {
    const state = militaryFixture(5);
    state.entities.find(e => e.owner === 2 && e.kind === 'barracks')!.position = { x: 100, y: 65 };
    const target = { x: 103, y: 66 };
    expect(placementLegal(state, 'archery-range', target, 'x', 2)).toEqual({ ok: true });
    const command = exampleAiCommands(JSON.parse(JSON.stringify(observe(state, 2))))
      .find(c => c.kind === 'build' && c.building === 'archery-range');
    expect(command).toMatchObject({ target });
    expect(applyCommand(state, command!)).toEqual({ ok: true });
  });

  it('accepts seed5 farm108,61 beside a house when the other template sites are occupied', () => {
    const state = militaryFixture(5);
    state.entities.find(e => e.owner === 2 && e.kind === 'barracks')!.position = { x: 100, y: 65 };
    // Reproduce the occupied template sites from the seed5 diagnostic. The
    // range/smith suppress unrelated infrastructure budgeting in this fixture.
    for (const [kind, x, y] of [
      ['house', 99, 56], ['house', 105, 61], ['house', 93, 67], ['house', 105, 58],
      ['house', 90, 56], ['house', 102, 58], ['mill', 90.80503246192987, 62.18977272897787],
      ['farm', 95, 64], ['farm', 95, 55], ['archery-range', 80, 85], ['blacksmith', 85, 85],
    ] as const) {
      const r = state.rules.buildings[kind];
      state.entities.push({ id: state.nextId++, kind, owner: 2, position: { x, y }, hp: r.hp,
        maxHp: r.hp, radius: r.radius, activity: 'idle', order: { kind: 'idle' },
        ...(kind === 'farm' ? { resourceKind: 'food', amount: 175 } : {}) });
    }
    Object.assign(state.players[2], { food: 0, wood: 60, populationCap: 50 });
    const target = { x: 108, y: 61 };
    expect(placementLegal(state, 'farm', target, 'x', 2)).toEqual({ ok: true });
    const command = exampleAiCommands(JSON.parse(JSON.stringify(observe(state, 2))))
      .find(c => c.kind === 'build' && c.building === 'farm');
    expect(command).toMatchObject({ target });
    expect(applyCommand(state, command!)).toEqual({ ok: true });
  });
});
