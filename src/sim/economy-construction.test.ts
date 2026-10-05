import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TICKS_PER_SECOND, type ContentManifest } from './data';
import { applyCommand, buildingFootprint, createGame, placementLegal, stepGame } from './game';
import type { Entity, GameState } from './types';
import { MANIFEST_PATH, importedRules, run, villagerOf } from './test-helpers/economy';


describe('construction', () => {
  const clearArea = (state: GameState, center: { x: number; y: number }, half: number) => {
    state.entities = state.entities.filter(
      e => e.kind !== 'resource' || Math.abs(e.position.x - center.x) > half + 1 || Math.abs(e.position.y - center.y) > half + 1,
    );
  };

  it('builds a house in the data-backed time with one villager', () => {
    const state = createGame(5);
    clearArea(state, { x: 16, y: 9 }, 2);
    const villager = villagerOf(state);
    villager.position = { x: 15, y: 9 };
    expect(applyCommand(state, { kind: 'build', player: 1, builderIds: [villager.id], building: 'house', target: { x: 16, y: 9 } })).toEqual({ ok: true });
    const site = state.entities.find(e => e.kind === 'house' && e.owner === 1)!;
    const buildTicks = Math.round(state.rules.buildings.house.buildSeconds * 20);

    // Walk in, then build for exactly buildSeconds (one builder). The tick
    // that flipped the activity to 'building' already contributed progress.
    let walkTicks = 0;
    while (villager.activity !== 'building' && walkTicks < 200) { stepGame(state); walkTicks++; }
    run(state, buildTicks - 2);
    expect(site.buildProgress).toBeDefined();
    run(state, 2);
    expect(site.buildProgress).toBeUndefined();
    expect(site.hp).toBe(site.maxHp);
  });

  it('accelerates with more builders following the 3T/(k+2) rule', () => {
    const state = createGame(5);
    clearArea(state, { x: 16, y: 9 }, 2);
    const villagers = state.entities.filter(e => e.owner === 1 && e.kind === 'villager');
    for (const v of villagers) v.position = { x: 15.2, y: 9 };
    applyCommand(state, { kind: 'build', player: 1, builderIds: villagers.map(v => v.id), building: 'house', target: { x: 16, y: 9 } });
    const site = state.entities.find(e => e.kind === 'house' && e.owner === 1)!;
    while (villagers[0].activity !== 'building') stepGame(state);
    // 3 builders: 3T/(3+2) = 15s for a 25s house.
    const expected = Math.round(3 * state.rules.buildings.house.buildSeconds / 5 * 20);
    run(state, expected + 2);
    expect(site.buildProgress).toBeUndefined();
  });

  it('rejects illegal placements with diagnostics', () => {
    const state = createGame(5);
    const villager = villagerOf(state);
    const tc = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
    const onTc = applyCommand(state, { kind: 'build', player: 1, builderIds: [villager.id], building: 'house', target: tc.position });
    expect(onTc.ok).toBe(false);
    if (!onTc.ok) expect(onTc.reason).toContain('overlaps');
    const offMap = placementLegal(state, 'house', { x: 0.2, y: 9 });
    expect(offMap.ok).toBe(false);
    if (!offMap.ok) expect(offMap.reason).toContain('outside');
  });

  it('houses raise the population cap only once complete', () => {
    const state = createGame(5);
    clearArea(state, { x: 16, y: 9 }, 2);
    const villager = villagerOf(state);
    villager.position = { x: 15, y: 9 };
    const capBefore = state.players[1].populationCap;
    applyCommand(state, { kind: 'build', player: 1, builderIds: [villager.id], building: 'house', target: { x: 16, y: 9 } });
    expect(state.players[1].populationCap).toBe(capBefore);
    run(state, 20 * 40);
    expect(state.players[1].populationCap).toBe(capBefore + state.rules.buildings.house.popSupport);
  });
});

describe('palisade walls', () => {
  it('builds the whole dragged line, not only the segment tasked last', () => {
    // A wall is placed a tile at a time but dragged as one line, so the
    // builders have to carry on down it. Left to the raw command each new
    // foundation would steal them from the last and nine would never rise.
    const state = createGame(71);
    state.players[1].wood = 200;
    const builders = state.entities.filter(e => e.owner === 1 && e.kind === 'villager').map(e => e.id);
    const half = state.rules.buildings['palisade-wall'].radius;

    let line: { x: number; y: number }[] = [];
    for (let y = 4.5; y < 20 && line.length < 6; y++) {
      for (let x = 4.5; x < 22 && line.length < 6; x++) {
        const run: { x: number; y: number }[] = [];
        for (let i = 0; i < 6; i++) {
          const tile = { x: x + i, y };
          if (!placementLegal(state, 'palisade-wall', tile).ok) break;
          run.push(tile);
        }
        if (run.length === 6) line = run;
      }
    }
    expect(line, 'a clear six-tile run to wall').toHaveLength(6);
    expect(half).toBe(0.5);

    for (const target of line) {
      expect(applyCommand(state, {
        kind: 'build', player: 1, builderIds: builders, building: 'palisade-wall', target,
      }).ok, `${target.x},${target.y}`).toBe(true);
    }
    const segments = () => state.entities.filter(e => e.kind === 'palisade-wall' && !e.dead);
    expect(segments()).toHaveLength(6);

    for (let i = 0; i < 6000 && segments().some(e => e.buildProgress !== undefined); i++) {
      stepGame(state);
    }
    expect(segments().filter(e => e.buildProgress === undefined)).toHaveLength(6);
    // And once the line is up the builders stop rather than wandering off to
    // somebody else's foundations.
    expect(state.entities.filter(e => builders.includes(e.id)).every(e => e.order.kind === 'idle')).toBe(true);
  });

  it('turns a gate to the axis it was placed on, and charges the DAT price', () => {
    const state = createGame(72);
    state.players[1].wood = 200;
    const builders = state.entities.filter(e => e.owner === 1 && e.kind === 'villager').map(e => e.id);

    // Two tiles by one, so a legal spot has to be searched for either way round.
    let placed: { target: { x: number; y: number }; along: 'x' | 'y' } | undefined;
    for (let y = 4; y < 20 && !placed; y++) {
      for (let x = 4; x < 22 && !placed; x++) {
        if (placementLegal(state, 'palisade-gate', { x, y: y + 0.5 }, 'x').ok) {
          placed = { target: { x, y: y + 0.5 }, along: 'x' };
        }
      }
    }
    expect(placed, 'somewhere to put a gate').toBeDefined();

    const before = state.players[1].wood;
    expect(applyCommand(state, {
      kind: 'build', player: 1, builderIds: builders, building: 'palisade-gate',
      target: placed!.target, orientation: 'x',
    }).ok).toBe(true);
    expect(before - state.players[1].wood).toBe(state.rules.buildings['palisade-gate'].cost.wood);

    const gate = state.entities.find(e => e.kind === 'palisade-gate')!;
    expect(gate.footprint).toEqual({ x: 1, y: 0.5 });
    // The other way round is the same box turned, which is what the DAT's two
    // gate units are: identical numbers, one long in x and one long in y.
    expect(buildingFootprint(state, 'palisade-gate', 'y')).toEqual({ x: 0.5, y: 1 });

    // And the same spot is no longer free for a gate lying the other way.
    expect(placementLegal(state, 'palisade-gate', placed!.target, 'y').ok).toBe(false);
  });

  it('carries the builders across the gate in the line rather than stopping at it', () => {
    // The gate is a different kind from the wall either side of it, but one
    // drag placed the lot, so it is the same line to whoever is building it.
    const state = createGame(73);
    state.players[1].wood = 300;
    const builders = state.entities.filter(e => e.owner === 1 && e.kind === 'villager').map(e => e.id);

    // A wall centre sits on a tile, a gate centre on the corner between the two
    // it covers: with walls on x0 and x0+1 the gate goes on x0+2.5, filling the
    // two tiles between them and the walls on x0+4 and x0+5.
    let row: number | undefined;
    let startX: number | undefined;
    for (let y = 4.5; y < 20 && row === undefined; y++) {
      for (let x = 4.5; x < 18; x++) {
        const tiles = [x, x + 1, x + 4, x + 5];
        if (!tiles.every(at => placementLegal(state, 'palisade-wall', { x: at, y }).ok)) continue;
        if (!placementLegal(state, 'palisade-gate', { x: x + 2.5, y }, 'x').ok) continue;
        row = y; startX = x; break;
      }
    }
    expect(row, 'a clear row for a wall with a gate in it').toBeDefined();

    for (const at of [startX!, startX! + 1, startX! + 4, startX! + 5]) {
      expect(applyCommand(state, {
        kind: 'build', player: 1, builderIds: builders, building: 'palisade-wall',
        target: { x: at, y: row! },
      }).ok).toBe(true);
    }
    // Tasked last, so it is the one the builders start on and the walls are
    // only reached by carrying on down the line.
    expect(applyCommand(state, {
      kind: 'build', player: 1, builderIds: builders, building: 'palisade-gate',
      target: { x: startX! + 2.5, y: row! }, orientation: 'x',
    }).ok).toBe(true);

    const line = () => state.entities.filter(
      e => !e.dead && (e.kind === 'palisade-wall' || e.kind === 'palisade-gate'));
    for (let i = 0; i < 8000 && line().some(e => e.buildProgress !== undefined); i++) stepGame(state);
    expect(line().filter(e => e.buildProgress === undefined)).toHaveLength(5);
  });
});

describe('what a razing leaves behind', () => {
  it('keeps a corpse for as long as the DAT says, never less than its death', () => {
    // A building's collapse runs 8.3 seconds and a castle's 12.5, against the
    // flat 3-second window everything used to get — so a razed barracks
    // vanished a third of the way through falling down and never reached the
    // rubble the DAT names for it. The lifetime is stated on the corpse unit:
    // a type-12 resource storage draining at its own rate, 300 seconds for
    // every unit in the file and 60 for every building's rubble.
    if (!importedRules) return;
    expect(importedRules.buildings.barracks.deathSeconds).toBeGreaterThan(8);
    expect(importedRules.buildings.barracks.corpseSeconds).toBe(60);
    expect(importedRules.units.militia.corpseSeconds).toBe(300);

    const state = createGame(61, importedRules);
    const rules = state.rules.buildings.barracks;
    const barracks: Entity = {
      id: state.nextId++, kind: 'barracks', owner: 1, position: { x: 58.5, y: 58.5 },
      hp: 1, maxHp: rules.hp, radius: rules.radius,
      activity: 'idle', order: { kind: 'idle' },
    };
    state.entities.push(barracks);
    // Killed the way anything is killed, by being hit until it falls.
    const enemy = state.entities.find(e => e.owner === 2 && e.kind === 'militia')
      ?? state.entities.find(e => e.owner === 2 && e.kind === 'villager')!;
    enemy.position = { x: 57, y: 58.5 };
    applyCommand(state, {
      kind: 'order', player: 2, entityIds: [enemy.id],
      target: barracks.position, targetId: barracks.id,
    });
    for (let i = 0; i < 4000 && !barracks.dead; i++) stepGame(state);
    expect(barracks.dead, 'the barracks never fell').toBe(true);

    // Long enough to finish falling down, and then to lie there.
    // Read a tick or two into the collapse, so allow for what has ticked off.
    const window = barracks.decayTicks! / TICKS_PER_SECOND;
    expect(window).toBeGreaterThanOrEqual(rules.deathSeconds!);
    expect(window).toBeCloseTo(rules.corpseSeconds!, 0);

    // Still there once the collapse has played out, which is what the old
    // three-second window could not manage.
    for (let i = 0; i < Math.ceil(rules.deathSeconds! * TICKS_PER_SECOND) + 1; i++) stepGame(state);
    expect(state.entities.some(e => e.id === barracks.id), 'gone mid-collapse').toBe(true);
  });

  it('gives every building rubble of its own to leave', () => {
    if (!importedRules) return;
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as ContentManifest;
    for (const [key, rules] of Object.entries(importedRules.buildings)) {
      if (!rules.datId) continue;
      const entity = manifest.entities[key];
      if (!entity) continue;
      // The farm is the one building that leaves no rubble, and the DAT says
      // so: its dead unit (357, FARM_D) draws the same FARM0NNG sheet as the
      // living one, with no dying and no rubble graphic -- a dead farm is a
      // fallow farm. It is imported for its portrait and strings and drawn
      // as terrain, so it carries no animations at all.
      if (key === 'farm') { expect(entity.animations ?? {}).toEqual({}); continue; }
      // The dock is the other: the DAT gives it no dead unit at all (its
      // `dead_unit_id` is -1), so a razed dock collapses into the water and
      // the water keeps it.
      if (key === 'dock') { expect(Object.keys(entity.animations ?? {})).not.toContain('decay'); continue; }
      expect(Object.keys(entity.animations ?? {}), `${key} leaves nothing`).toContain('decay');
    }
  });
});
