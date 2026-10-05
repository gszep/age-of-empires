import { describe, expect, it } from 'vitest';
import { FALLBACK_RULES, TICK_SECONDS } from './data';
import { checksumState } from './checksum';
import { applyCommand, computeDamage, createGame, placementLegal, notYetUpgradedInto, stepGame, unitRulesFor } from './game';
import type { Entity } from './types';
import { importedRules, run, inFeudal, villagerOf, parkScouts, freeSpot } from './test-helpers/economy';


describe('towers', () => {
  it('shoot an enemy in range without being ordered', () => {
    const state = createGame();
    inFeudal(state);
    state.players[1].stone = 500;
    state.players[1].wood = 500;
    const builder = villagerOf(state);
    applyCommand(state, {
      kind: 'build', player: 1, builderIds: [builder.id], building: 'watch-tower',
      target: freeSpot(state, 'watch-tower', builder.position),
    });
    const tower = state.entities.find(e => e.kind === 'watch-tower')!;
    tower.buildProgress = undefined;
    parkScouts(state);
    const victim = state.entities.find(e => e.owner === 2 && e.kind === 'villager')!;
    victim.position = { x: tower.position.x + 1, y: tower.position.y };
    const before = victim.hp;
    run(state, 60);
    expect(victim.hp).toBeLessThan(before);
  });

  it('lands damage when the arrow arrives, not when it is loosed', () => {
    const state = createGame();
    inFeudal(state);
    state.players[1].stone = 500;
    state.players[1].wood = 500;
    const builder = villagerOf(state);
    applyCommand(state, {
      kind: 'build', player: 1, builderIds: [builder.id], building: 'watch-tower',
      target: freeSpot(state, 'watch-tower', builder.position),
    });
    const tower = state.entities.find(e => e.kind === 'watch-tower')!;
    tower.buildProgress = undefined;
    parkScouts(state);
    const victim = state.entities.find(e => e.owner === 2 && e.kind === 'villager')!;
    // Far enough that the arrow needs several ticks to cross.
    const range = FALLBACK_RULES.buildings['watch-tower'].attack!.range;
    victim.position = { x: tower.position.x + range - 0.5, y: tower.position.y };
    const before = victim.hp;

    // Step to the tick the tower looses its first arrow.
    let fired = 0;
    while (fired < 400 && state.projectiles.length === 0) { stepGame(state); fired++; }
    expect(state.projectiles.length).toBe(1);
    expect(victim.hp).toBe(before); // still in flight, nothing landed yet

    const arrow = state.projectiles[0];
    expect(arrow.owner).toBe(1);
    expect(arrow.targetId).toBe(victim.id);
    stepGame(state);
    // It moved toward the target rather than teleporting.
    expect(arrow.position.x).toBeGreaterThan(tower.position.x);
    expect(arrow.position.x).toBeLessThan(victim.position.x);

    while (state.projectiles.length > 0) stepGame(state);
    expect(victim.hp).toBeLessThan(before);
  });

  it('shoots enemy buildings, but takes a unit over a building', () => {
    const state = createGame();
    inFeudal(state);
    state.players[1].stone = 500;
    state.players[1].wood = 500;
    const builder = villagerOf(state);
    applyCommand(state, {
      kind: 'build', player: 1, builderIds: [builder.id], building: 'watch-tower',
      target: freeSpot(state, 'watch-tower', builder.position),
    });
    const tower = state.entities.find(e => e.kind === 'watch-tower')!;
    tower.buildProgress = undefined;
    parkScouts(state);
    // Park an enemy town center in range and keep every enemy unit away.
    const enemyTc = state.entities.find(e => e.owner === 2 && e.kind === 'town-center')!;
    enemyTc.position = { x: tower.position.x + 3, y: tower.position.y };
    for (const unit of state.entities.filter(e => e.owner === 2 && e.kind === 'villager')) {
      unit.position = { x: state.width - 1, y: 1 };
    }
    const beforeBuilding = enemyTc.hp;
    run(state, 200);
    expect(enemyTc.hp).toBeLessThan(beforeBuilding);

    // Now bring a unit into range: it is the live threat and takes priority.
    const victim = state.entities.find(e => e.owner === 2 && e.kind === 'villager')!;
    victim.position = { x: tower.position.x + 2, y: tower.position.y };
    const buildingHp = enemyTc.hp;
    const unitHp = victim.hp;
    run(state, 200);
    expect(victim.hp).toBeLessThan(unitHp);
    expect(enemyTc.hp).toBe(buildingHp);
  });

  it('takes an ordered target over the one it would pick itself', () => {
    const state = createGame();
    inFeudal(state);
    state.players[1].stone = 500;
    state.players[1].wood = 500;
    const builder = villagerOf(state);
    applyCommand(state, {
      kind: 'build', player: 1, builderIds: [builder.id], building: 'watch-tower',
      target: freeSpot(state, 'watch-tower', builder.position),
    });
    const tower = state.entities.find(e => e.kind === 'watch-tower')!;
    tower.buildProgress = undefined;
    parkScouts(state);
    const enemies = state.entities.filter(e => e.owner === 2 && e.kind === 'villager');
    const near = enemies[0];
    const far = enemies[1];
    near.position = { x: tower.position.x + 1, y: tower.position.y };
    far.position = { x: tower.position.x + 4, y: tower.position.y };

    expect(applyCommand(state, {
      kind: 'order', player: 1, entityIds: [tower.id], target: far.position, targetId: far.id,
    })).toEqual({ ok: true });
    const nearHp = near.hp;
    const farHp = far.hp;
    run(state, 200);
    // The nearer villager is the automatic choice; the order beats it.
    expect(far.hp).toBeLessThan(farHp);
    expect(near.hp).toBe(nearHp);
  });

  it('returns to picking its own target when the order is cleared', () => {
    const state = createGame();
    inFeudal(state);
    state.players[1].stone = 500;
    state.players[1].wood = 500;
    const builder = villagerOf(state);
    applyCommand(state, {
      kind: 'build', player: 1, builderIds: [builder.id], building: 'watch-tower',
      target: freeSpot(state, 'watch-tower', builder.position),
    });
    const tower = state.entities.find(e => e.kind === 'watch-tower')!;
    tower.buildProgress = undefined;
    parkScouts(state);
    const enemies = state.entities.filter(e => e.owner === 2 && e.kind === 'villager');
    const near = enemies[0];
    const far = enemies[1];
    near.position = { x: tower.position.x + 1, y: tower.position.y };
    far.position = { x: tower.position.x + 4, y: tower.position.y };
    applyCommand(state, {
      kind: 'order', player: 1, entityIds: [tower.id], target: far.position, targetId: far.id,
    });
    run(state, 60);

    // Right-clicking bare ground releases the tower back to its own judgement.
    applyCommand(state, { kind: 'order', player: 1, entityIds: [tower.id], target: { x: 1, y: 1 } });
    expect(tower.order.kind).toBe('idle');
    const nearHp = near.hp;
    run(state, 200);
    expect(near.hp).toBeLessThan(nearHp);
  });

  it('drops an ordered target that dies and defends itself again', () => {
    const state = createGame();
    inFeudal(state);
    state.players[1].stone = 500;
    state.players[1].wood = 500;
    const builder = villagerOf(state);
    applyCommand(state, {
      kind: 'build', player: 1, builderIds: [builder.id], building: 'watch-tower',
      target: freeSpot(state, 'watch-tower', builder.position),
    });
    const tower = state.entities.find(e => e.kind === 'watch-tower')!;
    tower.buildProgress = undefined;
    parkScouts(state);
    const enemies = state.entities.filter(e => e.owner === 2 && e.kind === 'villager');
    const ordered = enemies[0];
    const other = enemies[1];
    ordered.position = { x: tower.position.x + 3, y: tower.position.y };
    other.position = { x: tower.position.x + 2, y: tower.position.y };
    applyCommand(state, {
      kind: 'order', player: 1, entityIds: [tower.id], target: ordered.position, targetId: ordered.id,
    });
    run(state, 20);

    ordered.hp = 0;
    ordered.dead = true;
    const otherHp = other.hp;
    run(state, 200);
    expect(tower.order.kind).toBe('idle');
    expect(other.hp).toBeLessThan(otherHp);
  });

  it('lets an arrow whose target dies mid-flight fly on and land on nothing', () => {
    const state = createGame();
    inFeudal(state);
    state.players[1].stone = 500;
    state.players[1].wood = 500;
    const builder = villagerOf(state);
    applyCommand(state, {
      kind: 'build', player: 1, builderIds: [builder.id], building: 'watch-tower',
      target: freeSpot(state, 'watch-tower', builder.position),
    });
    const tower = state.entities.find(e => e.kind === 'watch-tower')!;
    tower.buildProgress = undefined;
    parkScouts(state);
    const victim = state.entities.find(e => e.owner === 2 && e.kind === 'villager')!;
    const range = FALLBACK_RULES.buildings['watch-tower'].attack!.range;
    victim.position = { x: tower.position.x + range - 0.5, y: tower.position.y };
    while (state.projectiles.length === 0) stepGame(state);

    // A second enemy well off to one side: if the arrow were retargeted rather
    // than aimed once, this is who it would go for.
    const bystander = state.entities.find(
      e => e.owner === 2 && e.kind === 'villager' && e.id !== victim.id)!;
    bystander.position = { x: tower.position.x, y: tower.position.y + range - 0.5 };
    const bystanderHp = bystander.hp;

    victim.hp = 0;
    victim.dead = true;
    stepGame(state);
    // A shot is aimed once. It keeps flying to the spot it was aimed at
    // rather than turning to chase somebody else...
    expect(state.projectiles.length).toBeGreaterThan(0);
    for (let i = 0; i < 200 && state.projectiles.length; i++) stepGame(state);
    // ...and lands there on nothing at all, hurting no one.
    expect(state.projectiles.length).toBe(0);
    expect(bystander.hp).toBe(bystanderHp);
  });
});

describe('the archery range', () => {
  it('trains the skirmisher as well as the archer', () => {
    const state = createGame(23);
    inFeudal(state);
    const trainedHere = (Object.keys(state.rules.units) as (keyof typeof state.rules.units)[])
      .filter(kind => state.rules.units[kind].trainedAt === 'archery-range')
      .sort();
    // Asserting the exact roster here breaks every time a unit is added, and
    // says nothing useful when it does. What matters is the rule: the range
    // is where the archer line lives, and everything on it that exists only
    // as the far end of an upgrade is offered only once that is researched.
    expect(trainedHere).toEqual(expect.arrayContaining(['archer', 'skirmisher', 'cavalry-archer']));
    // Only imported content has the upgrade technologies; the open fallback
    // has no upgrades at all, so there is nothing to be gated behind.
    if (importedRules) {
      const upgraded = createGame(23, importedRules);
      const here = (Object.keys(upgraded.rules.units) as (keyof typeof upgraded.rules.units)[])
        .filter(kind => upgraded.rules.units[kind].trainedAt === 'archery-range'
          && !upgraded.rules.civilization.unavailable.units.includes(upgraded.rules.units[kind].datId!));
      expect(here).toEqual(expect.arrayContaining(['crossbowman', 'arbalester', 'elite-skirmisher']));
      for (const kind of here) {
        const gated = notYetUpgradedInto(upgraded, 1, kind);
        const isBase = ['archer', 'skirmisher', 'cavalry-archer'].includes(kind);
        expect(gated, `${kind} should ${isBase ? 'not ' : ''}need an upgrade first`).toBe(!isBase);
      }
    }
    expect(state.rules.units.skirmisher.cost).toEqual({ food: 25, wood: 35, gold: 0, stone: 0 });
  });

  it("leaves a skirmisher standing when its target is inside its minimum range", () => {
    const state = createGame(24);
    const rules = state.rules.units.skirmisher;
    expect(rules.minRange).toBeGreaterThan(0);
    const villager = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
    const enemy = state.entities.find(e => e.owner === 2 && e.kind === 'villager')!;
    // Stand a skirmisher on top of an enemy.
    villager.kind = 'skirmisher';
    villager.hp = villager.maxHp = rules.hp;
    villager.radius = rules.radius;
    enemy.position = { x: villager.position.x + 0.3, y: villager.position.y };
    const before = enemy.hp;
    applyCommand(state, {
      kind: 'order', player: 1, entityIds: [villager.id], target: enemy.position, targetId: enemy.id,
    });
    run(state, 200);
    expect(enemy.hp).toBe(before);
    // It holds where it stands rather than shoving its way closer.
    expect(villager.activity).toBe('idle');

    // Backed off past the minimum, the same shot lands.
    enemy.position = { x: villager.position.x + 2.5, y: villager.position.y };
    run(state, 200);
    expect(enemy.hp).toBeLessThan(before);
  });
});

describe('the stable', () => {
  it('builds and trains the scout it is for', () => {
    const state = createGame(21);
    inFeudal(state);
    state.players[1].wood = 1000;
    state.players[1].food = 1000;
    const builders = state.entities.filter(e => e.owner === 1 && e.kind === 'villager').map(e => e.id);
    let target: { x: number; y: number } | undefined;
    for (let step = 0; step < 12 && !target; step += 0.5) {
      for (const y of [9, 10, 8, 11]) {
        if (placementLegal(state, 'stable', { x: 8.5 + step, y }).ok) { target = { x: 8.5 + step, y }; break; }
      }
    }
    expect(target).toBeDefined();
    expect(applyCommand(state, { kind: 'build', player: 1, builderIds: builders, building: 'stable', target: target! }).ok).toBe(true);
    const stable = () => state.entities.find(e => e.kind === 'stable' && e.buildProgress === undefined);
    for (let i = 0; i < 4000 && !stable(); i++) stepGame(state);
    expect(stable()).toBeDefined();

    expect(applyCommand(state, { kind: 'train', player: 1, buildingId: stable()!.id, unit: 'scout-cavalry' }).ok).toBe(true);
    const scout = () => state.entities.find(e => e.kind === 'scout-cavalry' && !e.dead);
    for (let i = 0; i < 2000 && !scout(); i++) stepGame(state);
    expect(scout()).toBeDefined();
    // A scout is cavalry, not a worker: it defends itself.
    expect(state.rules.units['scout-cavalry'].attacks.some(a => a.amount > 0)).toBe(true);
    // Nothing else trains there, and the scout is trained nowhere else.
    expect(applyCommand(state, { kind: 'train', player: 1, buildingId: stable()!.id, unit: 'militia' }).ok).toBe(false);
  });
});

describe('what a blow does to a building', () => {
  // Issue #26. Every building that does not shoot came out of the importer
  // with no armours at all, because a `combat` block was asked for only when
  // the unit had an attack. Damage is scored class by class and a class the
  // target has no entry for scores nothing, so a house took exactly the
  // minimum -- one point a hit, from a sword or an arrow alike -- and no
  // blacksmith upgrade could move it.
  it.skipIf(!importedRules)('gives a building that never fights the DAT\'s own armour', () => {
    for (const [kind, rules] of Object.entries(importedRules!.buildings)) {
      expect(rules.armors.length, kind).toBeGreaterThan(0);
    }
    const house = importedRules!.buildings.house.armors;
    expect(house.find(a => a.class === 4)?.amount).toBe(-2);
    expect(house.find(a => a.class === 3)?.amount).toBe(7);
  });

  it.skipIf(!importedRules)('lets a blade through a house where an arrow scratches it', () => {
    const house = importedRules!.buildings.house.armors;
    // -2 melee armour makes a house soft to a sword; 7 pierce against an
    // archer's 4 is why archers do not raze towns in the original either.
    expect(computeDamage(importedRules!.units.militia.attacks, house)).toBeGreaterThan(1);
    expect(computeDamage(importedRules!.units.archer.attacks, house)).toBe(1);
  });

  it.skipIf(!importedRules).each([0, 2])('lands building damage in a real match from elevation %s', level => {
    const state = createGame(83, importedRules);
    state.elevation.fill(0);
    const rules = state.rules.buildings.house;
    const home = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
    const house: Entity = {
      id: state.nextId++, kind: 'house', owner: 1,
      position: { x: home.position.x + 4, y: home.position.y + 4 },
      hp: rules.hp, maxHp: rules.hp, radius: rules.radius,
      activity: 'idle', order: { kind: 'idle' },
    };
    state.entities.push(house);
    const soldier = state.entities.find(e => e.owner === 2 && e.kind === 'villager')!;
    soldier.position = { x: house.position.x + house.radius + soldier.radius, y: house.position.y };
    state.elevation[Math.floor(soldier.position.y) * state.width + Math.floor(soldier.position.x)] = level;
    applyCommand(state, {
      kind: 'order', player: 2, entityIds: [soldier.id],
      target: house.position, targetId: house.id,
    });
    const expected = computeDamage(
      unitRulesFor(state, 2, 'villager').attacks, state.rules.buildings.house.armors);
    expect(expected).toBeGreaterThan(1);
    const start = house.hp;
    for (let i = 0; i < 400 && house.hp === start; i++) stepGame(state);
    expect(start - house.hp).toBe(expected * (level > 0 ? 1.25 : 1));
  });

  it.skipIf(!importedRules)('lands the upgrade on the target, not only in the rules', () => {
    // The half of #26 that the first fix missed, and that asserting on
    // `unitRulesFor` could never catch: the attacker loop read the *base*
    // rules, so Fletching moved the archer's attack from 4 to 5 and a villager
    // went on taking 4. Measure what the target actually loses.
    const dealt = (researched: string[]): number => {
      const state = createGame(101, importedRules);
      state.players[1].researched.push(...researched);
      const rules = importedRules!.units.archer;
      const archer: Entity = {
        id: state.nextId++, kind: 'archer', owner: 1, position: { x: 60, y: 60 },
        hp: rules.hp, maxHp: rules.hp, radius: rules.radius,
        activity: 'idle', order: { kind: 'idle' },
      };
      state.entities.push(archer);
      const prey = state.entities.find(e => e.owner === 2 && e.kind === 'villager')!;
      prey.position = { x: 62, y: 60 };
      applyCommand(state, { kind: 'stop', player: 2, entityIds: [prey.id] });
      applyCommand(state, {
        kind: 'order', player: 1, entityIds: [archer.id],
        target: prey.position, targetId: prey.id,
      });
      const start = prey.hp;
      for (let i = 0; i < 400 && prey.hp === start; i++) stepGame(state);
      return start - prey.hp;
    };
    const base = dealt([]);
    expect(base).toBeGreaterThan(1);
    expect(dealt(['fletching'])).toBe(base + 1);
  });

  it.skipIf(!importedRules)('carries the blacksmith upgrade into what the arrow hits', () => {
    // The other half of #26: the effect does reach the shot. It cannot show on
    // a house, and that is the DAT's answer rather than a defect -- 7 pierce
    // armour against 4 + 1 still leaves the minimum.
    const state = createGame(84, importedRules);
    const before = unitRulesFor(state, 1, 'archer').attacks;
    const soft = importedRules!.units.villager.armors;
    state.players[1].researched.push('fletching');
    const after = unitRulesFor(state, 1, 'archer').attacks;
    expect(computeDamage(after, soft)).toBe(computeDamage(before, soft) + 1);
    expect(computeDamage(after, importedRules!.buildings.house.armors)).toBe(1);
  });

  it.skipIf(!importedRules)('replays identically now that buildings have armour', () => {
    const a = createGame(85, importedRules);
    const b = createGame(85, importedRules);
    for (let i = 0; i < 600; i++) { stepGame(a); stepGame(b); }
    expect(checksumState(a)).toBe(checksumState(b));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('what a shot is aimed at', () => {
  /**
   * An archer of player 1 and a lone villager of player 2, set up somewhere
   * empty so nothing else wanders into the shot. Returns both plus a helper
   * that runs until the archer has loosed and the arrow has landed.
   */
  function duel(seed: number, range = 3.5) {
    const state = createGame(seed);
    inFeudal(state);
    parkScouts(state);
    const archerRules = state.rules.units.archer;
    const spot = { x: 60.5, y: 60.5 };
    const archer: Entity = {
      id: state.nextId++, kind: 'archer', owner: 1, position: { ...spot },
      hp: archerRules.hp, maxHp: archerRules.hp, radius: archerRules.radius,
      activity: 'idle', order: { kind: 'idle' },
    };
    state.entities.push(archer);
    const victim = state.entities.find(e => e.owner === 2 && e.kind === 'villager')!;
    victim.position = { x: spot.x + range, y: spot.y };
    return { state, archer, victim };
  }

  it('takes each shooter\'s own accuracy from the imported content', () => {
    // The field existed on the rules before this was checked and nothing ever
    // read it out of the manifest, so every shooter silently fell back to a
    // perfect 100 and the miss could not happen. Assert the numbers arrive.
    if (!importedRules) return; // open-content checkout
    expect(importedRules.units.archer.accuracyPercent).toBe(80);
    expect(importedRules.units.skirmisher.accuracyPercent).toBe(90);
    expect(importedRules.units.longbowman.accuracyPercent).toBe(70);
    expect(importedRules.units['cavalry-archer'].accuracyPercent).toBe(50);
    expect(importedRules.buildings['watch-tower'].attack?.accuracyPercent).toBe(100);
  });

  it('hits a target that stands still', () => {
    // The archer's own accuracy is 80, so a few of these go wide; over a run
    // of shots a standing target is hit again and again.
    const { state, archer, victim } = duel(81);
    victim.hp = 100_000;
    victim.maxHp = 100_000;
    applyCommand(state, {
      kind: 'order', player: 1, entityIds: [archer.id], target: victim.position, targetId: victim.id,
    });
    const before = victim.hp;
    for (let i = 0; i < 600; i++) {
      stepGame(state);
      victim.position = { x: archer.position.x + 3.5, y: archer.position.y }; // pinned
    }
    expect(victim.hp).toBeLessThan(before);
  });

  it('misses a target that keeps walking across the shot', () => {
    // The reference: without Ballistics a shot goes to where the target stood
    // when it was loosed, so anything not walking along the line of fire is
    // missed. This is the whole reason that technology exists.
    const { state, archer, victim } = duel(82);
    victim.hp = 100_000;
    victim.maxHp = 100_000;
    const speed = state.rules.units.villager.speed;
    applyCommand(state, {
      kind: 'order', player: 1, entityIds: [archer.id], target: victim.position, targetId: victim.id,
    });
    const before = victim.hp;
    let shots = 0;
    for (let i = 0; i < 600; i++) {
      shots = Math.max(shots, state.projectiles.length);
      stepGame(state);
      // Walked steadily across the line of fire, at its own pace.
      victim.position = {
        x: archer.position.x + 3.5,
        y: victim.position.y + speed * TICK_SECONDS,
      };
      victim.activity = 'moving';
    }
    expect(shots, 'the archer never loosed at all').toBeGreaterThan(0);
    expect(victim.hp, 'a walking target was hit anyway').toBe(before);
  });

  it('hits a walking target once Ballistics is researched, and not before', () => {
    // The whole of what that technology is. A watch tower, whose own accuracy
    // is 100 so nothing else can explain a miss, shoots at a villager walking
    // straight past it four tiles out. Same seed, same walk, same fifteen
    // shots; the only difference is the research.
    if (!importedRules) return;
    const walkPast = (ballistics: boolean): { damage: number; shots: number } => {
      const state = createGame(84, importedRules);
      state.players[1].age = 2;
      if (ballistics) state.players[1].researched.push('ballistics');
      // The duel needs open ground, and the middle of the map now holds the
      // neutral wood: clear the range and the walking line.
      state.entities = state.entities.filter(e => !(e.kind === 'resource'
        && Math.abs(e.position.x - 62) < 9 && Math.abs(e.position.y - 62) < 12));
      const towerRules = state.rules.buildings['watch-tower'];
      const tower: Entity = {
        id: state.nextId++, kind: 'watch-tower', owner: 1, position: { x: 60.5, y: 60.5 },
        hp: towerRules.hp, maxHp: towerRules.hp, radius: towerRules.radius,
        activity: 'idle', order: { kind: 'idle' },
      };
      state.entities.push(tower);
      const victim = state.entities.find(e => e.owner === 2 && e.kind === 'villager')!;
      victim.position = { x: 64.5, y: 54.5 };
      victim.hp = 1_000_000;
      victim.maxHp = 1_000_000;
      applyCommand(state, {
        kind: 'order', player: 2, entityIds: [victim.id], target: { x: 64.5, y: 70.5 },
      });
      const before = victim.hp;
      const seen = new Set<number>();
      for (let i = 0; i < 1200; i++) {
        stepGame(state);
        for (const shot of state.projectiles) seen.add(shot.id);
      }
      return { damage: before - victim.hp, shots: seen.size };
    };
    const without = walkPast(false);
    const with_ = walkPast(true);
    expect(without.shots, 'the tower never shot').toBeGreaterThan(5);
    expect(with_.shots, 'a different number of shots is not a fair comparison')
      .toBe(without.shots);
    expect(without.damage, 'a walking target was hit without Ballistics').toBe(0);
    expect(with_.damage, 'Ballistics did not help').toBeGreaterThan(0);
  });

  it('hits a target walking straight at the shooter', () => {
    // Also the reference: a unit closing on the archer stays on the line the
    // arrow travels, so it runs onto the shot rather than out of it.
    const { state, archer, victim } = duel(83, 3.5);
    victim.hp = 100_000;
    victim.maxHp = 100_000;
    const speed = state.rules.units.villager.speed;
    applyCommand(state, {
      kind: 'order', player: 1, entityIds: [archer.id], target: victim.position, targetId: victim.id,
    });
    const before = victim.hp;
    for (let i = 0; i < 600; i++) {
      stepGame(state);
      const gap = victim.position.x - archer.position.x;
      victim.position = {
        x: archer.position.x + (gap > 1 ? gap - speed * TICK_SECONDS : 3.5),
        y: archer.position.y,
      };
      victim.activity = 'moving';
    }
    expect(victim.hp).toBeLessThan(before);
  });
});

describe('a tower has a minimum range, and Murder Holes takes it away', () => {
  const towerAndVictim = (murderHoles: boolean) => {
    const state = createGame(93, importedRules!);
    state.players[1].age = 2;
    if (murderHoles) state.players[1].researched.push('murder-holes');
    const rules = state.rules.buildings['watch-tower'];
    const tower: Entity = {
      id: state.nextId++, kind: 'watch-tower', owner: 1, position: { x: 62.5, y: 62.5 },
      hp: rules.hp, maxHp: rules.hp, radius: rules.radius,
      activity: 'idle', order: { kind: 'idle' },
    };
    state.entities.push(tower);
    const victim = state.entities.find(e => e.owner === 2 && e.kind === 'villager')!;
    // Stood against the wall, inside the DAT's one-tile minimum.
    victim.position = { x: 63.2, y: 62.5 };
    victim.hp = 100_000;
    victim.maxHp = 100_000;
    const before = victim.hp;
    for (let i = 0; i < 600; i++) {
      stepGame(state);
      victim.position = { x: 63.2, y: 62.5 };
    }
    return before - victim.hp;
  };

  it('will not shoot somebody stood against its wall', () => {
    if (!importedRules) return;
    // The DAT gives a watch tower and a castle a tile of minimum range, and
    // nothing read it: `tooClose` answered false for every building.
    expect(importedRules.buildings['watch-tower'].attack?.minRange).toBe(1);
    expect(towerAndVictim(false)).toBe(0);
  });

  it('shoots them once Murder Holes is researched', () => {
    if (!importedRules) return;
    const holes = importedRules.technologies['murder-holes'];
    expect(holes, 'Murder Holes is not researchable').toBeDefined();
    expect(holes.effects.some(e => e.unit === 'watch-tower' && e.attribute === 'minRange'
      && e.operation === 'set' && e.amount === 0)).toBe(true);
    expect(towerAndVictim(true)).toBeGreaterThan(0);
  });
});
