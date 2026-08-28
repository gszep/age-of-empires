import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TICKS_PER_SECOND, rulesFromManifest, type ContentManifest, type GameRules } from './data';
import { applyCommand, createGame, placementLegal, stepGame } from './game';
import { checksumState } from './checksum';
import type { BuildingKind, Entity, GameState, UnitKind } from './types';

const MANIFEST_PATH = 'public/imported/aoe2/manifest.json';
const importedRules: GameRules | undefined = existsSync(MANIFEST_PATH)
  ? rulesFromManifest(JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as ContentManifest)
  : undefined;

const run = (state: GameState, ticks: number) => {
  for (let i = 0; i < ticks; i++) stepGame(state);
};
const townCenter = (state: GameState) =>
  state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
const villagerOf = (state: GameState) =>
  state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;

function freeSpot(state: GameState, kind: BuildingKind, near: { x: number; y: number }) {
  for (let radius = 1; radius <= 16; radius += 0.5) {
    for (let step = 0; step < 16; step++) {
      const angle = step * Math.PI / 8;
      const spot = { x: near.x + Math.cos(angle) * radius, y: near.y + Math.sin(angle) * radius };
      if (placementLegal(state, kind, spot).ok) return spot;
    }
  }
  throw new Error(`no legal ${kind} placement near ${near.x},${near.y}`);
}

/** Stand a finished building of this kind next to the town center. */
function place(state: GameState, kind: BuildingKind, owner: 1 | 2 = 1): Entity {
  const home = state.entities.find(e => e.owner === owner && e.kind === 'town-center')!;
  const at = freeSpot(state, kind, home.position);
  const rules = state.rules.buildings[kind];
  const entity: Entity = {
    id: state.nextId++, kind, owner, position: at,
    hp: rules.hp, maxHp: rules.hp, radius: rules.radius,
    activity: 'idle', order: { kind: 'idle' },
  };
  state.entities.push(entity);
  return entity;
}

/** A unit of this kind standing where it is put, owned by whoever asked. */
function spawn(state: GameState, kind: UnitKind, owner: 1 | 2, at: { x: number; y: number }): Entity {
  const rules = state.rules.units[kind];
  const entity: Entity = {
    id: state.nextId++, kind, owner, position: { ...at },
    hp: rules.hp, maxHp: rules.hp, radius: rules.radius,
    activity: 'idle', order: { kind: 'idle' },
  };
  state.entities.push(entity);
  return entity;
}

describe('the Castle Age', () => {
  it('is researched at the town center, and only after the Feudal Age', () => {
    const state = createGame(51);
    const tc = townCenter(state);
    const castleAge = state.rules.technologies['castle-age'];
    expect(castleAge.researchedAt).toBe('town-center');
    expect(castleAge.requiresAge).toBe(1);
    expect(castleAge.grantsAge).toBe(2);
    // The DAT's own price and time, not a transcription.
    expect(castleAge.cost).toEqual({ food: 800, wood: 0, gold: 200, stone: 0 });
    expect(castleAge.researchSeconds).toBe(160);

    state.players[1].food = 2000;
    state.players[1].gold = 2000;
    const early = applyCommand(state, { kind: 'research', player: 1, buildingId: tc.id, tech: 'castle-age' });
    expect(early.ok).toBe(false);
    if (!early.ok) expect(early.reason).toContain('later age');

    state.players[1].age = 1;
    expect(applyCommand(state, { kind: 'research', player: 1, buildingId: tc.id, tech: 'castle-age' }).ok).toBe(true);
    // It costs what it says, and the age arrives only when the research does.
    expect(state.players[1].food).toBe(1200);
    expect(state.players[1].gold).toBe(1800);
    run(state, 160 * 20 - 1);
    expect(state.players[1].age).toBe(1);
    run(state, 1);
    expect(state.players[1].age).toBe(2);
    expect(state.players[1].researched).toContain('castle-age');
  });

  it('gates its buildings and units behind the age, by name', () => {
    const state = createGame(52);
    state.players[1].age = 1;
    state.players[1].wood = 2000;
    state.players[1].stone = 2000;
    state.players[1].food = 2000;
    state.players[1].gold = 2000;
    const builders = state.entities.filter(e => e.owner === 1 && e.kind === 'villager').map(e => e.id);
    for (const building of ['monastery', 'siege-workshop', 'castle'] as const) {
      const result = applyCommand(state, {
        kind: 'build', player: 1, builderIds: builders, building, target: { x: 14, y: 14 },
      });
      expect(result.ok, building).toBe(false);
      if (!result.ok) expect(result.reason).toContain('later age');
    }
    // A Feudal stable will not train a knight until the age arrives.
    const stable = place(state, 'stable');
    const early = applyCommand(state, { kind: 'train', player: 1, buildingId: stable.id, unit: 'knight' });
    expect(early.ok).toBe(false);
    if (!early.ok) expect(early.reason).toContain('later age');

    state.players[1].age = 2;
    for (const building of ['monastery', 'siege-workshop', 'castle'] as const) {
      expect(applyCommand(state, {
        kind: 'build', player: 1, builderIds: builders, building,
        target: freeSpot(state, building, townCenter(state).position),
      }).ok, building).toBe(true);
    }
    expect(applyCommand(state, { kind: 'train', player: 1, buildingId: stable.id, unit: 'knight' }).ok).toBe(true);
  });

  it('trains each Castle Age unit at the building the DAT names', () => {
    const state = createGame(53);
    state.players[1].age = 2;
    const expected: Record<string, BuildingKind> = {
      knight: 'stable',
      'cavalry-archer': 'archery-range',
      longbowman: 'castle',
      'battering-ram': 'siege-workshop',
      mangonel: 'siege-workshop',
      monk: 'monastery',
    };
    for (const [unit, building] of Object.entries(expected)) {
      expect(state.rules.units[unit as UnitKind].trainedAt, unit).toBe(building);
    }
    // And each of those buildings actually produces it end to end.
    for (const [unit, building] of Object.entries(expected)) {
      const producer = place(state, building);
      state.players[1].food = 5000;
      state.players[1].wood = 5000;
      state.players[1].gold = 5000;
      state.players[1].populationCap = 200;
      const result = applyCommand(state, {
        kind: 'train', player: 1, buildingId: producer.id, unit: unit as UnitKind,
      });
      expect(result.ok, unit).toBe(true);
      run(state, Math.ceil(state.rules.units[unit as UnitKind].trainSeconds * 20) + 5);
      expect(state.entities.some(e => e.owner === 1 && e.kind === unit && !e.dead), unit).toBe(true);
    }
  });

  it('lets a castle shoot, and support population, as the DAT has it', () => {
    const state = createGame(54);
    state.players[1].age = 2;
    const rules = state.rules.buildings.castle;
    expect(rules.attack?.range).toBe(8);
    expect(rules.popSupport).toBe(20);
    expect(rules.cost.stone).toBe(650);

    const castle = place(state, 'castle');
    const victim = spawn(state, 'militia', 2, { x: castle.position.x + 3, y: castle.position.y });
    const before = victim.hp;
    run(state, 200);
    expect(victim.hp).toBeLessThan(before);
  });
});

describe('siege', () => {
  it('lets a ram hurt a building far more than it hurts a soldier', () => {
    const state = createGame(55);
    state.players[1].age = 2;
    const ram = state.rules.units['battering-ram'];
    const building = state.rules.buildings.house;
    const soldier = state.rules.units.militia;
    const vsBuilding = ram.attacks.find(a => a.class === 11)!.amount;
    expect(vsBuilding).toBeGreaterThan(100);
    // The classes are what carry it: the house shares the building class, a
    // militia does not.
    expect(building.armors.some(a => a.class === 11)).toBe(true);
    expect(soldier.armors.some(a => a.class === 11)).toBe(false);
  });

  it("spreads a mangonel's stone over everything standing by the target", () => {
    const state = createGame(56);
    state.players[1].age = 2;
    expect(state.rules.units.mangonel.blastRadius).toBeGreaterThan(0);
    const mangonel = spawn(state, 'mangonel', 1, { x: 30, y: 30 });
    const target = spawn(state, 'militia', 2, { x: 35, y: 30 });
    // A second enemy within the blast, and one well outside it.
    const beside = spawn(state, 'militia', 2, { x: 35.5, y: 30 });
    const away = spawn(state, 'militia', 2, { x: 39, y: 30 });
    applyCommand(state, {
      kind: 'order', player: 1, entityIds: [mangonel.id], target: target.position, targetId: target.id,
    });
    for (let i = 0; i < 400 && target.hp === target.maxHp; i++) stepGame(state);
    expect(target.hp).toBeLessThan(target.maxHp);
    expect(beside.hp).toBeLessThan(beside.maxHp);
    expect(away.hp).toBe(away.maxHp);
  });

  it('throws its stone with the blast the projectile carries', () => {
    const state = createGame(57);
    state.players[1].age = 2;
    const mangonel = spawn(state, 'mangonel', 1, { x: 30, y: 30 });
    const target = spawn(state, 'militia', 2, { x: 35, y: 30 });
    applyCommand(state, {
      kind: 'order', player: 1, entityIds: [mangonel.id], target: target.position, targetId: target.id,
    });
    for (let i = 0; i < 400 && !state.projectiles.length; i++) stepGame(state);
    expect(state.projectiles.length).toBeGreaterThan(0);
    expect(state.projectiles[0].blastRadius).toBe(state.rules.units.mangonel.blastRadius);
  });
});

describe('the monk', () => {
  it('has no attack, and is never given one by an order', () => {
    const state = createGame(58);
    state.players[1].age = 2;
    expect(state.rules.units.monk.attacks.every(a => a.amount <= 0)).toBe(true);
    const monk = spawn(state, 'monk', 1, { x: 30, y: 30 });
    const boar = state.entities.find(e => e.kind === 'boar' && !e.dead);
    if (boar) {
      applyCommand(state, {
        kind: 'order', player: 1, entityIds: [monk.id], target: boar.position, targetId: boar.id,
      });
      expect(monk.order.kind).not.toBe('attack');
    }
    // Nor does it march off at an enemy of its own accord: an idle military
    // unit acquires the nearest one, and a monk must not be in that set.
    spawn(state, 'militia', 2, { x: 31, y: 30 });
    monk.order = { kind: 'idle' };
    run(state, 40);
    expect((monk.order as { kind: string }).kind).toBe('idle');
  });

  it('heals a wounded ally back to full, a hit point at a time', () => {
    const state = createGame(59);
    state.players[1].age = 2;
    const monk = spawn(state, 'monk', 1, { x: 30, y: 30 });
    const hurt = spawn(state, 'militia', 1, { x: 31, y: 30 });
    hurt.hp = 5;
    applyCommand(state, {
      kind: 'order', player: 1, entityIds: [monk.id], target: hurt.position, targetId: hurt.id,
    });
    expect(monk.order.kind).toBe('heal');
    run(state, 60);
    const partway = hurt.hp;
    expect(partway).toBeGreaterThan(5);
    expect(partway).toBeLessThan(hurt.maxHp);
    // Whole hit points only: a wounded unit never shows a fraction.
    expect(Number.isInteger(hurt.hp)).toBe(true);
    run(state, 20 * 60);
    expect(hurt.hp).toBe(hurt.maxHp);
    // And the monk stops once there is nothing left to mend.
    expect(monk.order.kind).toBe('idle');
  });

  it("converts an enemy soldier inside the DAT's window, and never before it", () => {
    const state = createGame(60);
    state.players[1].age = 2;
    const convert = state.rules.units.monk.convert!;
    expect(convert.minSeconds).toBe(5);
    expect(convert.maxSeconds).toBe(9);
    const monk = spawn(state, 'monk', 1, { x: 30, y: 30 });
    const victim = spawn(state, 'militia', 2, { x: 32, y: 30 });
    applyCommand(state, {
      kind: 'order', player: 1, entityIds: [monk.id], target: victim.position, targetId: victim.id,
    });
    expect(monk.order.kind).toBe('convert');
    // Nothing can happen before the earliest second the DAT allows.
    run(state, Math.floor(convert.minSeconds * 20) - 1);
    expect(victim.owner).toBe(2);
    // And it must have happened by the last.
    run(state, Math.ceil((convert.maxSeconds - convert.minSeconds) * 20) + 2);
    expect(victim.owner).toBe(1);
    expect(victim.order.kind).toBe('idle');
  });

  it('loses the work when the target walks out of reach', () => {
    const state = createGame(61);
    state.players[1].age = 2;
    const monk = spawn(state, 'monk', 1, { x: 30, y: 30 });
    const victim = spawn(state, 'militia', 2, { x: 32, y: 30 });
    applyCommand(state, {
      kind: 'order', player: 1, entityIds: [monk.id], target: victim.position, targetId: victim.id,
    });
    run(state, Math.floor(state.rules.units.monk.convert!.minSeconds * 20) - 10);
    expect(monk.convertTicks).toBeGreaterThan(0);
    // Out of range: the monk gives chase and the progress is gone.
    victim.position = { x: 60, y: 60 };
    stepGame(state);
    expect(monk.convertTicks).toBeUndefined();
  });

  it('counts a converted unit against its new owner and not its old', () => {
    const state = createGame(62);
    state.players[1].age = 2;
    const monk = spawn(state, 'monk', 1, { x: 30, y: 30 });
    const victim = spawn(state, 'militia', 2, { x: 32, y: 30 });
    applyCommand(state, {
      kind: 'order', player: 1, entityIds: [monk.id], target: victim.position, targetId: victim.id,
    });
    for (let i = 0; i < 400 && victim.owner === 2; i++) stepGame(state);
    expect(victim.owner).toBe(1);
    // Both players' counts are asked of the board rather than of a reading
    // taken earlier: the population is recalculated on events, not each tick.
    const owned = (player: 1 | 2) => state.entities
      .filter(e => !e.dead && e.owner === player && e.kind !== 'resource')
      .reduce((total, e) => total + (state.rules.units[e.kind as UnitKind]?.popCost ?? 0), 0);
    expect(state.players[1].population).toBe(owned(1));
    expect(state.players[2].population).toBe(owned(2));
    expect(state.entities.filter(e => !e.dead && e.owner === 2 && e.kind === 'militia')).toHaveLength(0);
  });
});

describe('the trebuchet', () => {
  // Issue #28. The DAT keeps it as two units -- 331 packed, 42 unpacked -- and
  // states everything about each except which is the other, so the pairing is
  // named in the rules and every number is imported. Packed it travels and has
  // no attack at all; unpacked it shoots sixteen tiles and cannot move.
  const imperial = (state: GameState) => {
    for (const player of [1, 2] as const) {
      state.players[player].age = 3;
      state.players[player].researched.push('feudal-age', 'castle-age', 'imperial-age');
    }
  };

  const engineFor = (state: GameState, at: { x: number; y: number }): Entity => {
    const rules = state.rules.units.trebuchet;
    const entity: Entity = {
      id: state.nextId++, kind: 'trebuchet', owner: 1, position: { ...at },
      hp: rules.hp, maxHp: rules.hp, radius: rules.radius,
      activity: 'idle', order: { kind: 'idle' },
    };
    state.entities.push(entity);
    return entity;
  };

  it('is an Imperial unit the castle trains, at the DAT\'s price', () => {
    const state = createGame(120, importedRules);
    const rules = state.rules.units.trebuchet;
    expect(rules.trainedAt).toBe('castle');
    expect(rules.age).toBe(3);
    expect(rules.cost).toMatchObject({ wood: 200, gold: 200 });
    expect(rules.trainSeconds).toBe(50);
    // Packed it carries no attack; what it does once set up is its own block.
    expect(rules.attacks).toEqual([]);
    expect(rules.unpacked?.range).toBe(16);
    expect(rules.unpacked?.minRange).toBe(4);
    expect(rules.unpacked?.attackReloadSeconds).toBe(10);
    expect(rules.unpacked?.attacks.find(a => a.class === 11)?.amount).toBe(250);
  });

  it('takes the DAT\'s own time to set up, and does nothing while it does', () => {
    const state = createGame(121, importedRules);
    imperial(state);
    const engine = engineFor(state, { x: 60.5, y: 60.5 });
    const setup = state.rules.units.trebuchet.unpacked!.seconds;
    expect(applyCommand(state, {
      kind: 'pack', player: 1, entityIds: [engine.id], unpacked: true,
    })).toEqual({ ok: true });
    const ticks = Math.round(setup * TICKS_PER_SECOND);
    for (let i = 0; i < ticks - 1; i++) stepGame(state);
    expect(engine.unpacked).toBeFalsy();
    stepGame(state);
    expect(engine.unpacked).toBe(true);
  });

  it('shoots only when it is set up, and reaches what a castle cannot', () => {
    const state = createGame(122, importedRules);
    imperial(state);
    const enemy = state.entities.find(e => e.owner === 2 && e.kind === 'town-center')!;
    // Twelve tiles out: inside the trebuchet's sixteen and outside everything
    // else's, and outside its own four-tile minimum.
    const engine = engineFor(state, { x: enemy.position.x - 12, y: enemy.position.y });
    applyCommand(state, {
      kind: 'order', player: 1, entityIds: [engine.id],
      target: enemy.position, targetId: enemy.id,
    });
    // Packed, it is not armed: the order cannot become an attack. It reads as
    // a move instead, so stop it before it walks inside its own minimum range.
    expect(engine.order.kind).not.toBe('attack');
    const untouched = enemy.hp;
    run(state, 20);
    applyCommand(state, { kind: 'stop', player: 1, entityIds: [engine.id] });
    run(state, 100);
    expect(enemy.hp).toBe(untouched);

    // Set it up where it stands, then send it at the town center again.
    applyCommand(state, { kind: 'pack', player: 1, entityIds: [engine.id], unpacked: true });
    run(state, Math.round(state.rules.units.trebuchet.unpacked!.seconds * TICKS_PER_SECOND));
    expect(engine.unpacked).toBe(true);
    const where = { ...engine.position };
    applyCommand(state, {
      kind: 'order', player: 1, entityIds: [engine.id],
      target: enemy.position, targetId: enemy.id,
    });
    expect(engine.order).toEqual({ kind: 'attack', targetId: enemy.id });
    for (let i = 0; i < 600 && enemy.hp === untouched; i++) stepGame(state);
    expect(enemy.hp).toBeLessThan(untouched);
    // And it never moved an inch to do it.
    expect(engine.position).toEqual(where);
  });

  it('packs itself away when it is told to go somewhere', () => {
    const state = createGame(123, importedRules);
    imperial(state);
    const engine = engineFor(state, { x: 60.5, y: 60.5 });
    applyCommand(state, { kind: 'pack', player: 1, entityIds: [engine.id], unpacked: true });
    run(state, Math.round(state.rules.units.trebuchet.unpacked!.seconds * TICKS_PER_SECOND));
    expect(engine.unpacked).toBe(true);
    applyCommand(state, {
      kind: 'order', player: 1, entityIds: [engine.id], target: { x: 70.5, y: 60.5 },
    });
    // It folds up first, and only then travels.
    run(state, 2);
    expect(engine.position.x).toBeCloseTo(60.5, 5);
    run(state, Math.round(state.rules.units.trebuchet.unpacked!.seconds * TICKS_PER_SECOND));
    expect(engine.unpacked).toBe(false);
    run(state, 100);
    expect(engine.position.x).toBeGreaterThan(60.5);
  });

  it('replays identically through a set-up and a shot', () => {
    const play = () => {
      const state = createGame(124, importedRules);
      imperial(state);
      const enemy = state.entities.find(e => e.owner === 2 && e.kind === 'town-center')!;
      const engine = engineFor(state, { x: enemy.position.x - 12, y: enemy.position.y });
      applyCommand(state, { kind: 'pack', player: 1, entityIds: [engine.id], unpacked: true });
      run(state, 120);
      applyCommand(state, {
        kind: 'order', player: 1, entityIds: [engine.id],
        target: enemy.position, targetId: enemy.id,
      });
      run(state, 400);
      return checksumState(state);
    };
    expect(play()).toBe(play());
  });
});

describe('Castle Age determinism', () => {
  it.skipIf(!importedRules)('replays a monk and a mangonel identically', () => {
    const seed = 84;
    const build = () => {
      const state = createGame(seed, importedRules);
      state.players[1].age = 2;
      state.players[2].age = 2;
      const monk = spawn(state, 'monk', 1, { x: 30, y: 30 });
      spawn(state, 'militia', 2, { x: 32, y: 30 });
      spawn(state, 'mangonel', 1, { x: 34, y: 34 });
      spawn(state, 'militia', 2, { x: 38, y: 34 });
      const victim = state.entities.find(e => e.owner === 2 && e.kind === 'militia')!;
      applyCommand(state, {
        kind: 'order', player: 1, entityIds: [monk.id], target: victim.position, targetId: victim.id,
      });
      return state;
    };
    const a = build();
    const b = build();
    for (let i = 0; i < 600; i++) { stepGame(a); stepGame(b); }
    // A conversion roll consumes the shared RNG, so an identical run is what
    // proves the roll is in the simulation's own stream and not the clock's.
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('the Imperial Age', () => {
  // The Imperial Age is imported content: the open fallback stops at the
  // Castle Age, so these run only when the manifest is present.
  it.skipIf(!importedRules)('is researched at the town center, and only after the Castle Age', () => {
    const state = createGame(61, importedRules);
    const tc = townCenter(state);
    const imperial = state.rules.technologies['imperial-age'];
    expect(imperial.researchedAt).toBe('town-center');
    expect(imperial.requiresAge).toBe(2);
    expect(imperial.grantsAge).toBe(3);
    // The DAT's own price and time, not a transcription.
    expect(imperial.cost).toEqual({ food: 1000, wood: 0, gold: 800, stone: 0 });
    expect(imperial.researchSeconds).toBe(190);

    state.players[1].food = 3000;
    state.players[1].gold = 3000;
    const early = applyCommand(state, { kind: 'research', player: 1, buildingId: tc.id, tech: 'imperial-age' });
    expect(early.ok).toBe(false);
    if (!early.ok) expect(early.reason).toContain('later age');

    state.players[1].age = 2;
    expect(applyCommand(state, { kind: 'research', player: 1, buildingId: tc.id, tech: 'imperial-age' }).ok).toBe(true);
    expect(state.players[1].food).toBe(2000);
    expect(state.players[1].gold).toBe(2200);
    run(state, 190 * 20 - 1);
    expect(state.players[1].age).toBe(2);
    run(state, 1);
    expect(state.players[1].age).toBe(3);
    expect(state.players[1].researched).toContain('imperial-age');
  });

  it.skipIf(!importedRules)('holds its technologies back until the age arrives', () => {
    const state = createGame(62, importedRules);
    state.players[1].age = 2;
    state.players[1].food = 3000;
    state.players[1].gold = 3000;
    // The elite longbowman needs the age and nothing else — no prerequisite
    // technology stands in front of it, so what it proves is the age gate.
    expect(state.rules.technologies['elite-longbowman'].requiresAge).toBe(3);
    const castle = place(state, 'castle');
    const early = applyCommand(state, {
      kind: 'research', player: 1, buildingId: castle.id, tech: 'elite-longbowman',
    });
    expect(early.ok).toBe(false);
    if (!early.ok) expect(early.reason).toContain('later age');

    state.players[1].age = 3;
    expect(applyCommand(state, {
      kind: 'research', player: 1, buildingId: castle.id, tech: 'elite-longbowman',
    }).ok).toBe(true);
  });
});
