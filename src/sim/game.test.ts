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

  it('refuses an order whose target is not a point, and keeps ticking', () => {
    // The debug bridge once relayed `target: {}` -- an entity's coordinates
    // sit under `position`, and a probe read them off the top -- and the
    // pathfinder followed a NaN goal round a parent chain that never ends.
    const state = createGame();
    const unit = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
    const bad = { kind: 'order', player: 1, entityIds: [unit.id], target: {} } as unknown as Parameters<typeof applyCommand>[1];
    expect(applyCommand(state, bad).ok).toBe(false);
    expect(unit.order.kind).toBe('idle');
    const nan = { kind: 'order' as const, player: 1 as const, entityIds: [unit.id], target: { x: Number.NaN, y: 3 } };
    expect(applyCommand(state, nan).ok).toBe(false);
    run(state, 20);
  });

  it('queues a shift-clicked order behind the one it is doing', () => {
    // Issue #38. The reference's shift-click: a route laid without waiting for
    // each leg, and each leg decided when the unit gets there.
    const state = createGame();
    const unit = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
    const first = { x: unit.position.x + 4, y: unit.position.y };
    const second = { x: unit.position.x + 4, y: unit.position.y + 4 };
    expect(applyCommand(state, { kind: 'order', player: 1, entityIds: [unit.id], target: first })).toEqual({ ok: true });
    expect(applyCommand(state, {
      kind: 'order', player: 1, entityIds: [unit.id], target: second, queue: true,
    })).toEqual({ ok: true });
    // The first is what it is doing; the second is waiting.
    expect(unit.order).toEqual({ kind: 'move', target: first });
    expect(unit.orderQueue).toHaveLength(1);

    // Walk until it takes the second leg of its own accord.
    let took = false;
    for (let i = 0; i < 2000 && !took; i++) {
      stepGame(state);
      took = unit.order.kind === 'move'
        && Math.abs(unit.order.target.y - second.y) < 1e-9;
    }
    expect(took, 'never went on to the queued waypoint').toBe(true);
    expect(unit.orderQueue).toBeUndefined();
  });

  it('throws the queue away on a fresh order or a stop', () => {
    const state = createGame();
    const unit = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
    const away = { x: unit.position.x + 4, y: unit.position.y };
    const queue = () => applyCommand(state, {
      kind: 'order', player: 1, entityIds: [unit.id], target: away, queue: true,
    });
    applyCommand(state, { kind: 'order', player: 1, entityIds: [unit.id], target: away });
    queue(); queue();
    expect(unit.orderQueue).toHaveLength(2);
    // An unshifted order replaces the whole plan, not just the current step.
    applyCommand(state, { kind: 'order', player: 1, entityIds: [unit.id], target: away });
    expect(unit.orderQueue).toBeUndefined();
    queue();
    applyCommand(state, { kind: 'stop', player: 1, entityIds: [unit.id] });
    expect(unit.orderQueue).toBeUndefined();
  });

  it('gives an idle unit a shift-clicked order straight away', () => {
    // Nothing to queue behind: the first click of a route must simply go.
    const state = createGame();
    const unit = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
    applyCommand(state, { kind: 'stop', player: 1, entityIds: [unit.id] });
    const away = { x: unit.position.x + 4, y: unit.position.y };
    applyCommand(state, { kind: 'order', player: 1, entityIds: [unit.id], target: away, queue: true });
    expect(unit.order).toEqual({ kind: 'move', target: away });
    expect(unit.orderQueue).toBeUndefined();
  });

  it('deletes your own things and nobody else\'s', () => {
    // Issue #37. The reference's Delete: your own, gone, nothing back.
    const state = createGame();
    const mine = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
    const theirs = state.entities.find(e => e.owner === 2 && e.kind === 'villager')!;
    const before = state.players[1].population;

    expect(applyCommand(state, { kind: 'delete', player: 1, entityIds: [theirs.id] }))
      .toEqual({ ok: false, reason: 'nothing of yours was named' });
    expect(theirs.dead).toBeFalsy();

    expect(applyCommand(state, { kind: 'delete', player: 1, entityIds: [mine.id] })).toEqual({ ok: true });
    expect(mine.dead).toBe(true);
    // It frees the population it was using, as any other death does.
    expect(state.players[1].population).toBe(before - 1);
    // And leaves a corpse that decays rather than vanishing on the spot.
    expect(mine.decayTicks).toBeGreaterThan(0);
  });

  it('deletes a building without giving anything back', () => {
    // Deliberately not a refund: cancelling a queued unit is what refunds.
    const state = createGame();
    const tc = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
    const purse = { ...state.players[1] };
    expect(applyCommand(state, { kind: 'delete', player: 1, entityIds: [tc.id] })).toEqual({ ok: true });
    expect(tc.dead).toBe(true);
    for (const resource of ['food', 'wood', 'gold', 'stone'] as const) {
      expect(state.players[1][resource], resource).toBe(purse[resource]);
    }
  });

  it('trains a villager from a town center in the data-backed time', () => {
    const state = createGame();
    const tc = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
    // Counted against whatever the opening hands out, which the map script
    // decides: three villagers and a scout today.
    const opening = state.players[1].population;
    expect(applyCommand(state, { kind: 'train', player: 1, buildingId: tc.id, unit: 'villager' })).toEqual({ ok: true });
    run(state, 499); // villager trainSeconds = 25s -> 500 ticks
    expect(state.players[1].population).toBe(opening);
    run(state, 1);
    expect(state.players[1].population).toBe(opening + 1);
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

  it('lands every crowded attacker\'s hits on a shared target', () => {
    // Attackers packed against a building are nudged apart by separation. A
    // nudge that crosses the range margin used to discard the swing in
    // progress, so a tight group could loop between "almost swung" and "reset"
    // and land far less than its combined damage.
    const attackersDealing = (count: number): number => {
      const state = createGame();
      const target = state.entities.find(e => e.owner === 2 && e.kind === 'town-center')!;
      const villagers = state.entities.filter(e => e.owner === 1 && e.kind === 'villager').slice(0, count);
      expect(villagers).toHaveLength(count);
      // Stack them along the axis to the target so separation pushes outward.
      const side = target.position.x > state.width / 2 ? -1 : 1;
      const contact = target.radius + villagers[0].radius + 0.1;
      for (const [index, villager] of villagers.entries()) {
        villager.position = { x: target.position.x + side * (contact + index * 0.05), y: target.position.y };
      }
      applyCommand(state, {
        kind: 'order', player: 1, entityIds: villagers.map(e => e.id),
        target: target.position, targetId: target.id,
      });
      const initialHp = target.hp;
      run(state, Math.round(state.rules.units.villager.attackReloadSeconds * 20) * 3);
      return initialHp - target.hp;
    };

    const single = attackersDealing(1);
    expect(single).toBeGreaterThan(0);
    expect(attackersDealing(3)).toBe(single * 3);
  });

  it('catches a target that is walking away from it', () => {
    // Issue #18. A swing that is under way was thrown away the moment the
    // target drifted out of reach, and the next one started from nothing --
    // so a unit with a real windup could never land a blow on anything that
    // kept moving. A scout has a 0.6s windup and a villager walks 0.48 tiles
    // in that time, which is further than the reach margin: it swung, lost
    // the swing, closed the gap, swung again, and never connected once.
    const state = createGame(91);
    const prey = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
    const scout = state.entities.find(e => e.owner === 2 && e.kind === 'scout-cavalry')!;
    // Side by side in open ground, with the villager walking steadily away.
    prey.position = { x: 60.5, y: 60.5 };
    scout.position = { x: 59.5, y: 60.5 };
    applyCommand(state, {
      kind: 'order', player: 1, entityIds: [prey.id], target: { x: 100.5, y: 60.5 },
    });
    applyCommand(state, {
      kind: 'order', player: 2, entityIds: [scout.id],
      target: prey.position, targetId: prey.id,
    });
    const hits: number[] = [];
    let hp = prey.hp;
    let flips = 0;
    let last = scout.activity;
    for (let i = 0; i < 600 && !prey.dead; i++) {
      stepGame(state);
      if (scout.activity !== last) { flips++; last = scout.activity; }
      if (prey.hp !== hp) { hits.push(i); hp = prey.hp; }
    }
    // It catches the villager and kills it.
    expect(hits.length).toBeGreaterThan(3);
    expect(prey.dead).toBe(true);
    // And the blows arrive on the weapon's own reload clock rather than on
    // however long it takes to re-close a gap that should never have opened.
    const reload = Math.round(state.rules.units['scout-cavalry'].attackReloadSeconds * 20);
    for (let i = 1; i < hits.length; i++) expect(hits[i] - hits[i - 1]).toBe(reload);
    // One flip: it walks in once and then stays on its target. It used to
    // bounce between 'moving' and 'attacking' hundreds of times, which is the
    // attack animation restarting that the report describes.
    expect(flips).toBe(1);
  });

  it('replays a chase identically', () => {
    // Pursuit is a checksum change: an attacker now moves on ticks where it
    // used to stand still.
    const chase = (seed: number) => {
      const state = createGame(seed);
      const prey = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
      const hunter = state.entities.find(e => e.owner === 2 && e.kind === 'scout-cavalry')!;
      prey.position = { x: 60.5, y: 60.5 };
      hunter.position = { x: 59.5, y: 60.5 };
      applyCommand(state, {
        kind: 'order', player: 1, entityIds: [prey.id], target: { x: 100.5, y: 60.5 },
      });
      applyCommand(state, {
        kind: 'order', player: 2, entityIds: [hunter.id],
        target: prey.position, targetId: prey.id,
      });
      run(state, 500);
      return digest(state);
    };
    expect(chase(91)).toBe(chase(91));
  });

  it('lets the example AI finish a match against a passive opponent', async () => {
    // 48,000 ticks is 40 sim-minutes, the same clock the headless fixture
    // runs: the invariant is the win, and the Q1 rebalance's boom-first
    // strategy lands it around minute thirty-five.
    const state = createGame(7);
    for (let i = 0; i < 48_000 && !state.winner; i++) {
      if (i % 10 === 0) {
        for (const command of exampleAiCommands(observe(state, 2))) applyCommand(state, command);
      }
      stepGame(state);
      // A macrotask yield now and then keeps the vitest worker's RPC alive
      // through a minute of pure simulation.
      if (i % 2048 === 0) await new Promise(resolve => setImmediate(resolve));
    }
    expect(state.winner).toBe(2);
    // The sim-time bound is above; the wall clock just has to simulate it
    // while the rest of the suite runs beside it.
  }, 150_000);

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
