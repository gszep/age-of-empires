import { describe, expect, it } from 'vitest';
import { FALLBACK_RULES, terrainAllows } from './data';
import {
  applyCommand, createGame, holdOf, placementLegal, rateOn, stepGame,
} from './game';
import { isOpenWater } from './mapgen';
import { chooseAnimation } from '../view/sprites';
import type { Entity, GameState, Point } from './types';

/** An Islands board with player 1's villagers and town center to hand. */
const islands = (seed = 2): GameState => createGame(seed, FALLBACK_RULES, undefined, 'islands');

const tileAt = (state: GameState, p: Point): number =>
  state.terrain[Math.floor(p.y) * state.width + Math.floor(p.x)];

/**
 * The first spot on player 1's coast a dock may stand: the scan runs out
 * from the town center, so it is the home shore and not the enemy's.
 */
function dockSpot(state: GameState): Point {
  const home = state.entities.find(e => e.kind === 'town-center' && e.owner === 1)!.position;
  let best: Point | undefined;
  let bestDistance = Infinity;
  // On tile centres, as the UI snaps a three-by-three footprint.
  for (let y = 2.5; y < state.height - 2; y++) {
    for (let x = 2.5; x < state.width - 2; x++) {
      const at = { x, y };
      const d = Math.hypot(x - home.x, y - home.y);
      if (d >= bestDistance || !placementLegal(state, 'dock', at).ok) continue;
      best = at;
      bestDistance = d;
    }
  }
  expect(best, 'a shore the dock fits').toBeDefined();
  return best!;
}

/** A finished dock on the home shore, with the wood to pay for it. */
function dockFor(state: GameState): Entity {
  state.players[1].wood = 1000;
  const villager = state.entities.find(e => e.kind === 'villager' && e.owner === 1)!;
  const at = dockSpot(state);
  expect(applyCommand(state, {
    kind: 'build', player: 1, builderIds: [villager.id], building: 'dock', target: at,
  })).toEqual({ ok: true });
  const dock = state.entities.find(e => e.kind === 'dock')!;
  dock.buildProgress = undefined;
  return dock;
}

describe('W4, the dock', () => {
  it('is refused inland, refused at sea, and accepted across the shoreline', () => {
    // Row 6 admits water and beach, and the engine's rule on top of the
    // table is that a dock reaches the water and touches the land.
    const state = islands();
    const home = state.entities.find(e => e.kind === 'town-center' && e.owner === 1)!.position;
    expect(placementLegal(state, 'dock', { x: home.x + 6, y: home.y }).ok).toBe(false);
    let sea: Point | undefined;
    for (let y = 10; y < state.height - 10 && !sea; y++) {
      for (let x = 10; x < state.width - 10; x++) {
        // Nine tiles of medium water: the open sea, nowhere near a shore.
        const tiles = [-1, 0, 1].flatMap(dy => [-1, 0, 1].map(dx => state.terrain[(y + dy) * state.width + x + dx]));
        if (tiles.every(id => id === 23)) { sea = { x: x + 0.5, y: y + 0.5 }; break; }
      }
    }
    expect(sea).toBeDefined();
    expect(placementLegal(state, 'dock', sea!)).toEqual({ ok: false, reason: 'placement does not touch the shore' });
    const at = dockSpot(state);
    const half = 1.5;
    let wet = 0;
    let dry = 0;
    for (let y = Math.floor(at.y - half + 1e-6); y < Math.ceil(at.y + half - 1e-6); y++) {
      for (let x = Math.floor(at.x - half + 1e-6); x < Math.ceil(at.x + half - 1e-6); x++) {
        const id = state.terrain[y * state.width + x];
        expect(terrainAllows(state.rules, 6, id), `dock tile ${x},${y} is ${id}`).toBe(true);
        if (isOpenWater(id)) wet++; else dry++;
      }
    }
    expect(wet).toBeGreaterThan(0);
    expect(dry).toBeGreaterThan(0);
  });

  it('is built by a villager and trains a fishing ship that appears on the water', () => {
    const state = islands();
    const dock = dockFor(state);
    state.players[1].wood = 1000;
    expect(applyCommand(state, { kind: 'train', player: 1, buildingId: dock.id, unit: 'fishing-ship' })).toEqual({ ok: true });
    let ship: Entity | undefined;
    for (let i = 0; i < 2000 && !ship; i++) {
      stepGame(state);
      ship = state.entities.find(e => e.kind === 'fishing-ship');
    }
    expect(ship).toBeDefined();
    expect(terrainAllows(state.rules, 13, tileAt(state, ship!.position))).toBe(true);
    expect(isOpenWater(tileAt(state, ship!.position)), 'launched onto the sea, not the sand').toBe(true);
    expect(ship!.owner).toBe(1);
  });
});

describe('W5, the fishing ship and the fish', () => {
  it('deals fish on the sea and none on land', () => {
    const state = islands(3);
    const fish = state.entities.filter(e => e.kind === 'resource' && (e.node === 'fish' || e.node === 'shore-fish'));
    expect(fish.length).toBeGreaterThan(100);
    for (const f of fish) {
      expect(isOpenWater(tileAt(state, f.position)), `fish ${f.id} on ${tileAt(state, f.position)}`).toBe(true);
      expect(f.resourceKind).toBe('food');
    }
    expect(fish.filter(f => f.node === 'fish').length).toBeGreaterThan(10);
    // Mirrored like everything else dealt.
    for (const f of fish) {
      const mirrored = { x: state.width - f.position.x, y: f.position.y };
      expect(fish.some(g => Math.abs(g.position.x - mirrored.x) < 1e-6 && Math.abs(g.position.y - mirrored.y) < 1e-6)).toBe(true);
    }
    // No fish on Arabia's ponds: the script deals none there.
    expect(createGame(3).entities.some(e => e.node === 'fish' || e.node === 'shore-fish')).toBe(false);
  });

  it('works a fish to exhaustion, banks the food at the dock, and never leaves the water', () => {
    const state = islands();
    const dock = dockFor(state);
    state.players[1].wood = 1000;
    applyCommand(state, { kind: 'train', player: 1, buildingId: dock.id, unit: 'fishing-ship' });
    let ship: Entity | undefined;
    for (let i = 0; i < 2000 && !ship; i++) {
      stepGame(state);
      ship = state.entities.find(e => e.kind === 'fishing-ship');
    }
    expect(ship).toBeDefined();
    // The nearest fish, made small enough to empty in the test's patience.
    const fish = state.entities
      .filter(e => e.kind === 'resource' && (e.node === 'fish' || e.node === 'shore-fish'))
      .sort((a, b) => Math.hypot(a.position.x - ship!.position.x, a.position.y - ship!.position.y)
        - Math.hypot(b.position.x - ship!.position.x, b.position.y - ship!.position.y))[0];
    fish.amount = 20;
    // The DAT's rates: the ship's 0.24 a second times 1.75 on a deep fish and
    // 1.0 on a shore fish; its hold is 15.
    expect(rateOn(state, ship!, fish)).toBeCloseTo(fish.node === 'fish' ? 0.42 : 0.24, 5);
    expect(holdOf(state, ship!)).toBe(15);
    expect(applyCommand(state, {
      kind: 'order', player: 1, entityIds: [ship!.id], target: fish.position, targetId: fish.id,
    })).toEqual({ ok: true });
    expect(ship!.order).toEqual({ kind: 'gather', targetId: fish.id });
    const foodBefore = state.players[1].food;
    let banked = 0;
    for (let i = 0; i < 12_000 && banked < 20; i++) {
      stepGame(state);
      banked = state.players[1].food - foodBefore;
      expect(isOpenWater(tileAt(state, ship!.position)), `tick ${i}: ship on ${tileAt(state, ship!.position)}`).toBe(true);
    }
    // Two trips of a fifteen-hold bank the twenty; the second trip may
    // already carry on from the next fish, which is the gatherer loop's
    // habit and not the test's business.
    expect(banked).toBeGreaterThanOrEqual(20);
    expect(state.entities.find(e => e.id === fish.id)?.amount ?? 0).toBe(0);
    expect(chooseAnimation(state, { ...ship!, activity: 'gathering' })).toEqual({ key: 'fishing-ship', name: 'work' });
  });

  it('lets a villager cast for a shore fish from the bank at the fisherman\'s rate', () => {
    const state = islands();
    const villager = state.entities.find(e => e.kind === 'villager' && e.owner === 1)!;
    // A shore fish with land beside it, on the home island's coast.
    const home = state.entities.find(e => e.kind === 'town-center' && e.owner === 1)!.position;
    const landBeside = (p: Point): boolean => {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const x = Math.floor(p.x) + dx;
          const y = Math.floor(p.y) + dy;
          if (x < 0 || y < 0 || x >= state.width || y >= state.height) continue;
          if (terrainAllows(state.rules, 7, state.terrain[y * state.width + x])) return true;
        }
      }
      return false;
    };
    const fish = state.entities
      .filter(e => e.node === 'shore-fish' && landBeside(e.position))
      .sort((a, b) => Math.hypot(a.position.x - home.x, a.position.y - home.y)
        - Math.hypot(b.position.x - home.x, b.position.y - home.y))[0];
    expect(fish, 'a shore fish within a cast of the beach').toBeDefined();
    expect(rateOn(state, villager, fish)).toBeCloseTo(0.43, 5);
    fish.amount = 5;
    expect(applyCommand(state, {
      kind: 'order', player: 1, entityIds: [villager.id], target: fish.position, targetId: fish.id,
    })).toEqual({ ok: true });
    const foodBefore = state.players[1].food;
    let worked = false;
    for (let i = 0; i < 6000 && state.players[1].food - foodBefore < 5; i++) {
      stepGame(state);
      // Once the fish is spent the villager carries on to the nearest food,
      // which may be a bush; only the fish itself is the fisherman's work.
      if (villager.activity === 'gathering' && villager.order.kind === 'gather' && villager.order.targetId === fish.id) {
        worked = true;
        expect(chooseAnimation(state, villager).key).toBe('villager-fisher');
        expect(terrainAllows(state.rules, 7, tileAt(state, villager.position)), 'fishing from the bank').toBe(true);
      }
    }
    expect(worked).toBe(true);
    // The five off the fish, plus whatever the bush after it filled the
    // basket with before the walk home.
    expect(state.players[1].food - foodBefore).toBeGreaterThanOrEqual(5);
    expect(state.entities.find(e => e.id === fish.id)?.amount ?? 0).toBe(0);
  });
});
