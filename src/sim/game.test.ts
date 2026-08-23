import { describe, expect, it } from 'vitest';
import { exampleAiCommands } from './ai';
import { observe } from './observe';
import { applyCommand, computeDamage, createGame, stepGame } from './game';

function digest(state: ReturnType<typeof createGame>): string {
  return JSON.stringify(state);
}

const run = (state: ReturnType<typeof createGame>, ticks: number) => {
  for (let i = 0; i < ticks; i++) stepGame(state);
};

describe('simulation', () => {
  it('is deterministic for a seed and command stream', () => {
    const a = createGame(123);
    const b = createGame(123);
    run(a, 200);
    run(b, 200);
    expect(digest(a)).toBe(digest(b));
  });

  it('trains a villager from a town center in the data-backed time', () => {
    const state = createGame();
    const tc = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
    expect(applyCommand(state, { kind: 'train', player: 1, buildingId: tc.id, unit: 'villager' })).toEqual({ ok: true });
    run(state, 499); // villager trainSeconds = 25s -> 500 ticks
    expect(state.players[1].population).toBe(3);
    run(state, 1);
    expect(state.players[1].population).toBe(4);
  });

  it('walks into range, winds up, and releases discrete armor-based hits', () => {
    const state = createGame();
    const villagerRules = state.rules.units.villager;
    const target = state.entities.find(e => e.owner === 2 && e.kind === 'town-center')!;
    const attacker = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
    applyCommand(state, { kind: 'order', player: 1, entityIds: [attacker.id], target: target.position, targetId: target.id });
    const initialHp = target.hp;
    stepGame(state);
    expect(attacker.activity).toBe('moving');
    expect(target.hp).toBe(initialHp);

    for (let i = 0; i < 4000 && attacker.activity !== 'attacking'; i++) stepGame(state);
    expect(attacker.activity).toBe('attacking');
    // No damage lands before the swing releases.
    expect(target.hp).toBe(initialHp);
    // The tick that flipped to 'attacking' already consumed one windup tick.
    const releaseTicks = Math.max(1, Math.round(villagerRules.attackReleaseSeconds * 20));
    run(state, releaseTicks - 2);
    expect(target.hp).toBe(initialHp);
    run(state, 1);
    // Villager vs town center: class-11 bonus 3, melee zeroed by armor.
    const expected = computeDamage(villagerRules.attacks, state.rules.buildings['town-center'].armors);
    expect(target.hp).toBe(initialHp - expected);
    // The next hit lands one full reload after the first.
    run(state, Math.round(villagerRules.attackReloadSeconds * 20) - 1);
    expect(target.hp).toBe(initialHp - expected);
    run(state, 1);
    expect(target.hp).toBe(initialHp - expected * 2);
  });

  it('lets the example AI finish a match against a passive opponent', () => {
    const state = createGame(7);
    for (let i = 0; i < 40_000 && !state.winner; i++) {
      if (i % 10 === 0) {
        for (const command of exampleAiCommands(observe(state, 2))) applyCommand(state, command);
      }
      stepGame(state);
    }
    expect(state.winner).toBe(2);
  });

  it('rejects invalid commands with a diagnostic reason', () => {
    const state = createGame();
    const tc = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
    expect(applyCommand(state, { kind: 'train', player: 2, buildingId: tc.id, unit: 'villager' }))
      .toEqual({ ok: false, reason: `building ${tc.id} is not owned` });
    state.players[1].food = 0;
    expect(applyCommand(state, { kind: 'train', player: 1, buildingId: tc.id, unit: 'villager' }))
      .toEqual({ ok: false, reason: 'not enough resources' });
  });
});
