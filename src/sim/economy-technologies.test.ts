import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FALLBACK_RULES, isAnimal, rulesFromManifest, type ContentManifest } from './data';
import { checksumState } from './checksum';
import { applyCommand, carryCapacityFor, createGame, stepGame, unitRulesFor } from './game';
import type { BuildingKind, Entity, GameState, UnitKind } from './types';
import { isTileVisible } from './visibility';
import { MANIFEST_PATH, importedRules as sharedImportedRules, importedAudio, run, villagerOf, freeSpot } from './test-helpers/economy';

// A local const preserves narrowing inside the upgrade-line callbacks.
const importedRules = sharedImportedRules;


describe('technologies', () => {
  const townCenter = (state: GameState) =>
    state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;

  it('reads its technologies from the manifest rather than the fallback table', () => {
    // The importer extracted the DAT's technologies into content.json and the
    // atlas step then dropped them on the way to the published manifest, so
    // `rulesFromManifest` found no key and every match ran on the hand-written
    // fallback rules. Nothing failed, because the fallback numbers happen to
    // match the DAT. This asserts the wire is connected rather than the
    // numbers agreeing: a manifest that says something else must win.
    const manifest = existsSync(MANIFEST_PATH)
      ? JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as ContentManifest
      : undefined;
    if (manifest) {
      expect(manifest.technologies, 'the published manifest carries no technologies').toBeDefined();
      expect(Object.keys(manifest.technologies!)).toContain('loom');
    }
    const fixture: ContentManifest = {
      entities: {},
      technologies: {
        loom: {
          techId: 22, name: 'Loom', researchSeconds: 999, researchedAt: 109,
          requiresAge: 0, cost: { gold: 7 },
        },
      },
    };
    const rules = rulesFromManifest(fixture);
    expect(rules.technologies.loom.researchSeconds).toBe(999);
    expect(rules.technologies.loom.cost.gold).toBe(7);
    expect(FALLBACK_RULES.technologies.loom.researchSeconds).not.toBe(999);
  });

  it('researches Loom at its DAT cost and heals the villagers already standing there', () => {
    const state = createGame(41);
    const loom = state.rules.technologies.loom;
    expect(loom.researchedAt).toBe('town-center');
    expect(loom.cost).toEqual({ food: 0, wood: 0, gold: 50, stone: 0 });

    const villager = villagerOf(state);
    const before = { hp: villager.hp, maxHp: villager.maxHp };
    state.players[1].gold = 100;
    const tc = townCenter(state);
    expect(applyCommand(state, { kind: 'research', player: 1, buildingId: tc.id, tech: 'loom' }).ok).toBe(true);
    expect(state.players[1].gold).toBe(50);
    // Nothing changes until it finishes.
    run(state, 10);
    expect(villager.maxHp).toBe(before.maxHp);
    expect(state.players[1].researched).toEqual([]);

    run(state, loom.researchSeconds * 20);
    expect(state.players[1].researched).toEqual(['loom']);
    expect(villager.maxHp).toBe(before.maxHp + 15);
    expect(villager.hp).toBe(before.hp + 15);
    // And the armour it grants reaches units trained afterwards.
    expect(applyCommand(state, { kind: 'train', player: 1, buildingId: tc.id, unit: 'villager' }).ok).toBe(true);
    for (let i = 0; i < 2000 && state.entities.filter(e => e.kind === 'villager' && e.owner === 1).length < 4; i++) {
      stepGame(state);
    }
    const fresh = state.entities.filter(e => e.owner === 1 && e.kind === 'villager').at(-1)!;
    expect(fresh.maxHp).toBe(before.maxHp + 15);

    // One research per player, and one at a time.
    expect(applyCommand(state, { kind: 'research', player: 1, buildingId: tc.id, tech: 'loom' }).ok).toBe(false);
  });

  it('gates the Feudal age behind its own research, and everything behind the age', () => {
    const state = createGame(42);
    expect(state.players[1].age).toBe(0);
    const builders = state.entities.filter(e => e.owner === 1 && e.kind === 'villager').map(e => e.id);
    state.players[1].wood = 1000;
    state.players[1].food = 1000;

    // Feudal buildings and units are refused in the Dark Age, by name.
    for (const building of ['market', 'blacksmith', 'archery-range', 'stable', 'watch-tower'] as const) {
      const result = applyCommand(state, {
        kind: 'build', player: 1, builderIds: builders, building, target: { x: 12, y: 12 },
      });
      expect(result.ok, building).toBe(false);
      if (!result.ok) expect(result.reason).toContain('later age');
    }
    // What is Dark Age in the DAT still goes up.
    expect(applyCommand(state, {
      kind: 'build', player: 1, builderIds: builders, building: 'house', target: freeSpot(state, 'house', { x: 8, y: 12 }),
    }).ok).toBe(true);

    const tc = townCenter(state);
    const feudal = state.rules.technologies['feudal-age'];
    expect(feudal.cost.food).toBe(500);
    expect(applyCommand(state, { kind: 'research', player: 1, buildingId: tc.id, tech: 'feudal-age' }).ok).toBe(true);
    run(state, feudal.researchSeconds * 20);
    expect(state.players[1].age).toBe(1);

    // And now the same building goes up, for this player only.
    expect(applyCommand(state, {
      kind: 'build', player: 1, builderIds: builders, building: 'market',
      target: freeSpot(state, 'market', { x: 12, y: 12 }),
    }).ok).toBe(true);
    const theirs = applyCommand(state, {
      kind: 'build', player: 2,
      builderIds: state.entities.filter(e => e.owner === 2 && e.kind === 'villager').map(e => e.id),
      building: 'market', target: freeSpot(state, 'market', { x: 22, y: 12 }),
    });
    expect(theirs.ok).toBe(false);
    if (!theirs.ok) expect(theirs.reason).toContain('later age');
  });

  it('replays identically across a research', () => {
    const play = () => {
      const state = createGame(43);
      state.players[1].gold = 200;
      const tc = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
      applyCommand(state, { kind: 'research', player: 1, buildingId: tc.id, tech: 'loom' });
      run(state, 900);
      return checksumState(state);
    };
    expect(play()).toBe(play());
  });
});

describe('imported rules', () => {
  it.skipIf(!importedRules)('carry DAT-backed timings and costs', () => {
    expect(importedRules!.origin).toBe('imported');
    expect(importedRules!.units.villager.trainSeconds).toBe(25);
    expect(importedRules!.units.militia.trainSeconds).toBe(21);
    expect(importedRules!.units.militia.cost).toEqual({ food: 50, wood: 0, gold: 20, stone: 0 });
    expect(importedRules!.gatherRatePerSecond).toEqual({ food: 0.31, wood: 0.39, gold: 0.38, stone: 0.36 });
    expect(importedRules!.buildings.house.buildSeconds).toBe(25);
    expect(importedRules!.buildings['town-center'].hp).toBe(2400);
    expect(importedRules!.nodes.gold.amount).toBe(800);
    // The trade cart's rate and capacity are its own DAT fields, not a
    // hand-picked gold-per-tile constant.
    const skirmisher = importedRules!.units.skirmisher;
    expect(skirmisher.trainedAt).toBe('archery-range');
    expect(skirmisher.cost).toEqual({ food: 25, wood: 35, gold: 0, stone: 0 });
    expect(skirmisher.range).toBe(4);
    expect(skirmisher.minRange).toBe(1);
    const scout = importedRules!.units['scout-cavalry'];
    expect(scout.trainedAt).toBe('stable');
    expect(scout.trainSeconds).toBe(30);
    expect(scout.cost).toEqual({ food: 80, wood: 0, gold: 0, stone: 0 });
    expect(importedRules!.buildings.stable.cost).toEqual({ food: 0, wood: 175, gold: 0, stone: 0 });
    const cart = importedRules!.units['trade-cart'];
    expect(cart.trainedAt).toBe('market');
    expect(cart.trainSeconds).toBe(51);
    expect(cart.cost).toEqual({ food: 0, wood: 100, gold: 50, stone: 0 });
    expect(cart.tradeRatePerSecond).toBe(0.2875);
    expect(cart.tradeCapacity).toBe(100);
    expect(cart.attacks).toEqual([]);
  });

  it.skipIf(!importedAudio)('gives every trainable unit a voice the view can name', () => {
    // The view asks for `<kind>-select`; a renamed alias would go quiet with
    // nothing to say so.
    for (const kind of Object.keys(FALLBACK_RULES.units)) {
      if (isAnimal(kind as never)) continue;
      expect(Object.keys(importedAudio!.audio), kind).toContain(`${kind}-select`);
    }
  });

  it.skipIf(!importedRules)('replays identically under imported rules', () => {
    const a = createGame(77, importedRules);
    const b = createGame(77, importedRules);
    for (let i = 0; i < 400; i++) { stepGame(a); stepGame(b); }
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('the technology tree', () => {
  const plantBuilding = (state: GameState, kind: BuildingKind): Entity => {
    const rules = state.rules.buildings[kind];
    const entity: Entity = {
      id: state.nextId++, kind, owner: 1, position: { x: 55.5 + state.nextId % 7, y: 55.5 },
      hp: rules.hp, maxHp: rules.hp, radius: rules.radius,
      activity: 'idle', order: { kind: 'idle' },
    };
    state.entities.push(entity);
    return entity;
  };

  /** Research `key` to completion, returning the command's own verdict. */
  const research = async (state: GameState, key: string) => {
    const tech = state.rules.technologies[key];
    const building = plantBuilding(state, tech.researchedAt);
    Object.assign(state.players[1], { food: 9000, wood: 9000, gold: 9000, stone: 9000 });
    const started = applyCommand(state, {
      kind: 'research', player: 1, buildingId: building.id, tech: key,
    });
    if (!started.ok) return started;
    for (let i = 0; i < 20_000 && !state.players[1].researched.includes(key); i++) {
      stepGame(state);
      if (i % 2048 === 2047) await new Promise(resolve => setImmediate(resolve));
    }
    return started;
  };

  it('takes its whole list from the civilisation tree, not from a table here', () => {
    if (!importedRules) return;
    const keys = Object.keys(importedRules.technologies);
    // Three were hand-written before; the tree carries the blacksmith lines,
    // the economy technologies and the ages.
    expect(keys.length).toBeGreaterThan(30);
    for (const expected of ['loom', 'feudal-age', 'castle-age', 'forging', 'fletching',
      'scale-mail-armor', 'padded-archer-armor', 'wheelbarrow', 'double-bit-axe']) {
      expect(keys, `${expected} is missing`).toContain(expected);
    }
  });

  it('refuses a technology before its age and applies it after', async () => {
    if (!importedRules) return;
    for (const key of ['forging', 'fletching', 'wheelbarrow']) {
      const early = createGame(51, importedRules);
      const tech = early.rules.technologies[key];
      expect(tech.requiresAge, `${key} should not be a Dark Age technology`).toBeGreaterThan(0);
      const refused = await research(early, key);
      expect(refused.ok, `${key} was allowed in the Dark Age`).toBe(false);
      expect(refused.ok ? '' : refused.reason).toContain('later age');

      const state = createGame(51, importedRules);
      state.players[1].age = tech.requiresAge;
      expect((await research(state, key)).ok, `${key} was refused in its own age`).toBe(true);
      expect(state.players[1].researched).toContain(key);
    }
  });

  it.skipIf(!importedRules)('town watch makes a building see further (issue #29)', () => {
    // Measured at the outcome -- the tile the player can see -- not at the
    // rules table, because #26 proved a lookup can be right while nothing
    // reads it. Probe 9.5 tiles west of the actual home, beyond its base8
    // sight and inside Town Watch's +4, away from the eastern starting units.
    const state = createGame(51, importedRules!);
    state.players[1].age = state.rules.technologies['town-watch'].requiresAge;
    const tc = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
    const west = { x: Math.floor(tc.position.x) - 10, y: Math.floor(tc.position.y) };
    stepGame(state);
    expect(isTileVisible(state, 1, west.x, west.y)).toBe(false);
    Object.assign(state.players[1], { food: 9000, wood: 9000, gold: 9000, stone: 9000 });
    expect(applyCommand(state, {
      kind: 'research', player: 1, buildingId: tc.id, tech: 'town-watch',
    }).ok).toBe(true);
    for (let i = 0; i < 20_000 && !state.players[1].researched.includes('town-watch'); i++) {
      stepGame(state);
    }
    expect(state.players[1].researched).toContain('town-watch');
    stepGame(state);
    expect(isTileVisible(state, 1, west.x, west.y)).toBe(true);
  });

  it.skipIf(!importedRules)('replays identically across town watch', () => {
    const play = () => {
      const state = createGame(51, importedRules);
      state.players[1].age = 1;
      state.players[1].researched.push('town-watch');
      for (let i = 0; i < 400; i++) stepGame(state);
      return checksumState(state);
    };
    expect(play()).toBe(play());
  });

  it('opens the university, and the university opens Ballistics', () => {
    // The building was left out because it trains nothing; the technologies
    // are the reason to build it. Ballistics is 300 wood and 175 gold at the
    // university in the Castle Age, which is what the DAT says.
    if (!importedRules) return;
    const ballistics = importedRules.technologies.ballistics;
    expect(ballistics, 'Ballistics is not researchable').toBeDefined();
    expect(ballistics.researchedAt).toBe('university');
    expect(ballistics.requiresAge).toBe(2);
    expect(ballistics.cost).toMatchObject({ wood: 300, gold: 175 });
    expect(ballistics.effects).toEqual(expect.arrayContaining([
      { unit: 'arrow', attribute: 'leadsTarget', operation: 'set', amount: 1 },
      { unit: 'scorpion-bolt', attribute: 'leadsTarget', operation: 'set', amount: 1 },
      { unit: 'heavy-scorpion-bolt', attribute: 'leadsTarget', operation: 'set', amount: 1 },
    ]));
    expect(importedRules.buildings.university.buildable).toBe(true);
    expect(importedRules.buildings.university.age).toBe(2);
  });

  it('will not take a technology before the one it follows', async () => {
    // The DAT states each technology's own requirements, and without them a
    // player could research Blast Furnace without ever taking Forging and
    // collect the same bonus for a third of the clicks.
    if (!importedRules) return;
    const state = createGame(57, importedRules);
    state.players[1].age = 3;
    const early = await research(state, 'iron-casting');
    expect(early.ok).toBe(false);
    expect(early.ok ? '' : early.reason).toContain('forging');

    expect((await research(state, 'forging')).ok).toBe(true);
    expect((await research(state, 'iron-casting')).ok).toBe(true);
    expect(state.players[1].researched).toEqual(expect.arrayContaining(['forging', 'iron-casting']));
  });

  it('gives Forging the melee attack the DAT says it gives', async () => {
    if (!importedRules) return;
    const state = createGame(52, importedRules);
    state.players[1].age = 1;
    const meleeBefore = unitRulesFor(state, 1, 'militia').attacks.find(a => a.class === 4)!.amount;
    expect((await research(state, 'forging')).ok).toBe(true);
    const meleeAfter = unitRulesFor(state, 1, 'militia').attacks.find(a => a.class === 4)!.amount;
    expect(meleeAfter).toBe(meleeBefore + 1);
    // The other side never researched it.
    expect(unitRulesFor(state, 2, 'militia').attacks.find(a => a.class === 4)!.amount)
      .toBe(meleeBefore);
  });

  it('gives Fletching the range and pierce attack the DAT says it gives', async () => {
    if (!importedRules) return;
    const state = createGame(53, importedRules);
    state.players[1].age = 1;
    const before = unitRulesFor(state, 1, 'archer');
    const pierceBefore = before.attacks.find(a => a.class === 3)!.amount;
    const rangeBefore = before.range!;
    expect((await research(state, 'fletching')).ok).toBe(true);
    const after = unitRulesFor(state, 1, 'archer');
    expect(after.attacks.find(a => a.class === 3)!.amount).toBe(pierceBefore + 1);
    expect(after.range).toBe(rangeBefore + 1);
    expect(after.lineOfSight).toBe(before.lineOfSight + 1);
  });

  it('makes Wheelbarrow move and carry more', async () => {
    if (!importedRules) return;
    const state = createGame(54, importedRules);
    state.players[1].age = 1;
    const speedBefore = unitRulesFor(state, 1, 'villager').speed;
    const carryBefore = carryCapacityFor(state, 1);
    expect((await research(state, 'wheelbarrow')).ok).toBe(true);
    expect(unitRulesFor(state, 1, 'villager').speed).toBeCloseTo(speedBefore * 1.1, 6);
    expect(carryCapacityFor(state, 1)).toBeGreaterThan(carryBefore);
  });

  it('raises the hit points of what is already standing, and of what comes next', async () => {
    if (!importedRules) return;
    const state = createGame(55, importedRules);
    const standing = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
    const before = standing.maxHp;
    expect((await research(state, 'loom')).ok).toBe(true);
    expect(standing.maxHp).toBe(before + 15);
    expect(standing.hp).toBe(before + 15);
    expect(unitRulesFor(state, 1, 'villager').hp).toBe(before + 15);
  });

  it('replays identically across a research it never had before', async () => {
    if (!importedRules) return;
    const play = async (): Promise<string> => {
      const state = createGame(56, importedRules);
      state.players[1].age = 1;
      await research(state, 'fletching');
      for (let i = 0; i < 400; i++) stepGame(state);
      return checksumState(state);
    };
    expect(await play()).toBe(await play());
  });
});

describe('unit upgrades', () => {
  it('turns every militia into a man-at-arms, wounds and all', () => {
    // An upgrade is not a modifier. AoE2 replaces the unit, so a militia
    // standing on the map becomes a man-at-arms where it stands — and being
    // promoted is not a heal: it keeps the damage it had taken.
    if (!importedRules) return;
    const state = createGame(64, importedRules);
    state.players[1].age = 1;
    Object.assign(state.players[1], { food: 9000, gold: 9000, wood: 9000 });
    const rules = state.rules.buildings.barracks;
    const barracks: Entity = {
      id: state.nextId++, kind: 'barracks', owner: 1, position: { x: 56.5, y: 56.5 },
      hp: rules.hp, maxHp: rules.hp, radius: rules.radius,
      activity: 'idle', order: { kind: 'idle' },
    };
    state.entities.push(barracks);
    const militiaRules = state.rules.units.militia;
    const hurt: Entity = {
      id: state.nextId++, kind: 'militia', owner: 1, position: { x: 54.5, y: 56.5 },
      hp: militiaRules.hp - 12, maxHp: militiaRules.hp, radius: militiaRules.radius,
      activity: 'idle', order: { kind: 'idle' },
    };
    state.entities.push(hurt);

    expect(applyCommand(state, {
      kind: 'research', player: 1, buildingId: barracks.id, tech: 'man-at-arms',
    }).ok).toBe(true);
    for (let i = 0; i < 4000 && !state.players[1].researched.includes('man-at-arms'); i++) {
      stepGame(state);
    }
    expect(state.players[1].researched).toContain('man-at-arms');

    const promoted = state.entities.find(e => e.id === hurt.id)!;
    expect(promoted.kind).toBe('man-at-arms');
    const upgraded = state.rules.units['man-at-arms'];
    expect(promoted.maxHp).toBe(upgraded.hp);
    expect(upgraded.hp - promoted.hp, 'promotion healed it').toBe(12);
    // ...and it hits harder, which is the point of the upgrade.
    const before = militiaRules.attacks.find(a => a.class === 4)!.amount;
    expect(upgraded.attacks.find(a => a.class === 4)!.amount).toBeGreaterThan(before);
  });

  // The rule, not the inventory: every technology that replaces a unit
  // promotes the ones already standing, whichever building researches it
  // and whatever age it waits on -- the elite longbowman at the castle as
  // much as the man-at-arms at the barracks. One `it` per line: as one test
  // the fifteen took 22 s against a 30 s timeout and failed under load.
  const upgradeLines = importedRules
    ? Object.entries(importedRules.technologies)
      .flatMap(([key, tech]) => (tech.upgrades ?? []).filter(step => step.from in importedRules.units)
        .map(step => ({ key, tech, step })))
    : [];
  it.skipIf(!importedRules)('carries at least the fifteen upgrade lines, the castle line included', () => {
    expect(upgradeLines.length).toBeGreaterThanOrEqual(15);
    expect(upgradeLines.some(l => l.key === 'elite-longbowman')).toBe(true);
  });
  it.each(upgradeLines.map(l => [`${l.key} from ${l.step.from}`, l] as const))('promotes a standing unit through %s', (_name, { key, tech, step }) => {
    const state = createGame(66, importedRules);
    state.players[1].age = 3;
    state.players[1].researched.push('feudal-age', 'castle-age', 'imperial-age', ...(tech.requires ?? []));
    Object.assign(state.players[1], { food: 9000, gold: 9000, wood: 9000, stone: 9000 });
    const site = state.rules.buildings[tech.researchedAt];
    const building: Entity = {
      id: state.nextId++, kind: tech.researchedAt, owner: 1, position: { x: 56.5, y: 56.5 },
      hp: site.hp, maxHp: site.hp, radius: site.radius, activity: 'idle', order: { kind: 'idle' },
    };
    state.entities.push(building);
    const from = state.rules.units[step.from as UnitKind];
    const standing: Entity = {
      id: state.nextId++, kind: step.from as UnitKind, owner: 1, position: { x: 52.5, y: 56.5 },
      hp: from.hp, maxHp: from.hp, radius: from.radius, activity: 'idle', order: { kind: 'idle' },
    };
    state.entities.push(standing);
    // Activate the staged scenario's age/producer bookkeeping: hidden
    // prerequisites are now real gates, not discarded by the importer.
    stepGame(state);
    expect(applyCommand(state, { kind: 'research', player: 1, buildingId: building.id, tech: key }).ok,
      `${key} refused`).toBe(true);
    for (let i = 0; i < 6000 && !state.players[1].researched.includes(key); i++) stepGame(state);
    expect(state.players[1].researched, `${key} never landed`).toContain(key);
    expect(state.entities.find(e => e.id === standing.id)!.kind, `${key} left a ${step.from}`).toBe(step.to);
  });

  it('stops the barracks offering what it has upgraded past', () => {
    if (!importedRules) return;
    const state = createGame(65, importedRules);
    state.players[1].age = 1;
    Object.assign(state.players[1], { food: 9000, gold: 9000, populationCap: 50 });
    const rules = state.rules.buildings.barracks;
    const barracks: Entity = {
      id: state.nextId++, kind: 'barracks', owner: 1, position: { x: 56.5, y: 56.5 },
      hp: rules.hp, maxHp: rules.hp, radius: rules.radius,
      activity: 'idle', order: { kind: 'idle' },
    };
    state.entities.push(barracks);
    // Before: the militia is what it trains, and the man-at-arms does not
    // exist yet however much you can afford it.
    expect(applyCommand(state, {
      kind: 'train', player: 1, buildingId: barracks.id, unit: 'militia',
    }).ok).toBe(true);
    barracks.training = undefined;
    const early = applyCommand(state, {
      kind: 'train', player: 1, buildingId: barracks.id, unit: 'man-at-arms',
    });
    expect(early.ok).toBe(false);
    expect(early.ok ? '' : early.reason).toContain('upgrade');

    state.players[1].researched.push('man-at-arms');
    barracks.training = undefined;
    const late = applyCommand(state, {
      kind: 'train', player: 1, buildingId: barracks.id, unit: 'militia',
    });
    expect(late.ok, 'the militia was still on offer after the upgrade').toBe(false);
    barracks.training = undefined;
    expect(applyCommand(state, {
      kind: 'train', player: 1, buildingId: barracks.id, unit: 'man-at-arms',
    }).ok).toBe(true);
  });
});
