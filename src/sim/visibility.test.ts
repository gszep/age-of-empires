import { describe, expect, it } from 'vitest';
import { createGame } from './game';
import { createVisibility, updateVisibility } from './visibility';
import { observe } from './observe';
import type { Entity } from './types';

describe('last-seen building occupancy (#291)', () => {
  it.each(['relics', 'garrison'] as const)('remembers %s without exposing hidden changes or contents', storage => {
    const state = createGame(291);
    const scout = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
    const payload: Entity = { id: state.nextId++, kind: storage === 'relics' ? 'relic' : 'monk',
      owner: storage === 'relics' ? 0 : 2, position: { x: 40, y: 40 }, hp: 30, maxHp: 30,
      radius: .5, activity: 'idle', order: { kind: 'idle' } };
    const monastery: Entity = { ...payload, id: state.nextId++, kind: 'monastery', owner: 2, radius: 1.5 };
    state.entities = [scout, monastery];
    state.visibility = createVisibility(state);
    scout.position = { x: 40, y: 40 };
    const refresh = () => { state.tick++; updateVisibility(state); };
    const visible = () => observe(state, 1).entities.find(e => e.id === monastery.id)!;
    const remembered = () => observe(state, 1).memory.find(e => e.id === monastery.id)!;
    refresh();
    expect(visible().hasGarrison).toBeUndefined();
    monastery[storage] = [payload];
    refresh();
    expect(visible().hasGarrison).toBe(true);
    expect(visible()).not.toHaveProperty('relics');
    expect(visible()).not.toHaveProperty('garrisoned');
    expect(observe(state, 2).entities.find(e => e.id === monastery.id))
      .toHaveProperty(storage === 'relics' ? 'relics' : 'garrisoned', 1);
    expect(state.visibility[1].memory[monastery.id].hasGarrison).toBe(true);
    scout.position = { x: 90, y: 90 };
    refresh();
    const lastSeen = structuredClone(remembered());
    expect(lastSeen.hasGarrison).toBe(true);
    monastery[storage] = [];
    refresh();
    expect(visible()).toBeUndefined();
    expect(remembered()).toEqual(lastSeen);
    expect(remembered()).not.toHaveProperty('relics');
    expect(remembered()).not.toHaveProperty('garrison');
    scout.position = { x: 40, y: 40 };
    refresh();
    expect(visible().hasGarrison).toBeUndefined();
    expect(state.visibility[1].memory[monastery.id].hasGarrison).toBeUndefined();
    scout.position = { x: 90, y: 90 };
    refresh();
    const empty = structuredClone(remembered());
    monastery[storage] = [payload];
    refresh();
    expect(remembered()).toEqual(empty);
    expect(remembered().hasGarrison).toBeUndefined();
    scout.position = { x: 40, y: 40 };
    refresh();
    expect(visible().hasGarrison).toBe(true);
  });
});

describe('fog-memory lookup lifetime (#165)', () => {
  function fixture() {
    const state = createGame(11);
    const scouts = [1, 2].map(owner => state.entities.find(e => e.kind === 'villager' && e.owner === owner)!);
    const sheep = state.entities.find(e => e.kind === 'sheep')!;
    state.entities = [...scouts, sheep];
    for (const entity of state.entities) entity.position = { x: 40, y: 40 };
    state.visibility = createVisibility(state);
    updateVisibility(state);
    for (const player of [1, 2] as const) expect(state.visibility[player].memory[sheep.id]).toBeDefined();
    return { state, sheep, scouts };
  }

  it.each(['dead', 'removed'] as const)('forgets a %s entity even when called again in the same tick', change => {
    const { state, sheep } = fixture();
    const tick = state.tick;
    if (change === 'dead') sheep.dead = true;
    else state.entities = state.entities.filter(e => e !== sheep);
    updateVisibility(state);
    expect(state.tick).toBe(tick);
    for (const player of [1, 2] as const) expect(state.visibility[player].memory[sheep.id]).toBeUndefined();
  });

  it('drops moved/claimed memories independently for both players without retaining a stale entity reference', () => {
    const { state, sheep } = fixture();
    const replacement = { ...sheep, position: { x: 90, y: 90 }, owner: 1 as const };
    state.entities[state.entities.indexOf(sheep)] = replacement;
    state.tick++;
    updateVisibility(state);
    expect(state.visibility[1].memory[sheep.id]).toBeUndefined();
    expect(state.visibility[2].memory[sheep.id]).toBeUndefined();
  });

  it('keeps a disappeared object remembered until its old tile is seen again', () => {
    const { state, sheep, scouts } = fixture();
    for (const scout of scouts) scout.position = { x: 90, y: 90 };
    state.entities = state.entities.filter(e => e !== sheep);
    state.tick++;
    updateVisibility(state);
    for (const player of [1, 2] as const) expect(state.visibility[player].memory[sheep.id]).toBeDefined();
    scouts[0].position = { x: 40, y: 40 };
    updateVisibility(state);
    expect(state.visibility[1].memory[sheep.id]).toBeUndefined();
    expect(state.visibility[2].memory[sheep.id]).toBeDefined();
  });

  it('refreshes visible objects and forgets a removed neighbour in the same tick', () => {
    const { state, sheep } = fixture();
    const neighbour = { ...sheep, id: state.nextId++, position: { x: 41, y: 40 }, amount: 100 };
    state.entities.push(neighbour);
    updateVisibility(state);
    state.entities = state.entities.filter(entity => entity !== sheep);
    neighbour.hp -= 1;
    neighbour.amount = 12;
    updateVisibility(state);
    for (const player of [1, 2] as const) {
      expect(state.visibility[player].memory[sheep.id]).toBeUndefined();
      expect(state.visibility[player].memory[neighbour.id]).toMatchObject({
        hp: neighbour.hp, amount: 12, x: 41, y: 40, lastSeenAt: state.tick,
      });
    }
  });
});
