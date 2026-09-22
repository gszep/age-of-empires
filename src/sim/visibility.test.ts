import { describe, expect, it } from 'vitest';
import { createGame } from './game';
import { createVisibility, updateVisibility } from './visibility';

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
});
