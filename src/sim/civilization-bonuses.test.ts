import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FALLBACK_RULES, rulesFromManifest, type BonusTechnology, type CivilizationBonuses, type ContentManifest, type GameRules, type TechEffect } from './data';
import { activateAutomaticTechnologies, addNode, applyCommand, createGame, placementLegal, stepGame } from './game';
import { rulesForPlayer } from './civilizations';
import { observe } from './observe';
import { buildingRulesFor, unitRulesFor } from './rules';
import { synchronizationHash } from '../shared/checksum';
import { isEntityVisible, updateVisibility } from './visibility';
import type { BuildingKind, Entity, GameState, PlayerId, UnitKind } from './types';

// Small source-command fixtures also work without owned content. When installed,
// use the full published profile's graph/tech metadata with the diagnostic baselines.
const publishedPath = process.env.CIV_PROFILE_CONTENT ?? 'public/imported/aoe2/manifest.json';
const published: ContentManifest | undefined = existsSync(publishedPath)
  ? JSON.parse(readFileSync(publishedPath, 'utf8')) : undefined;
const extracted: Record<string, ContentManifest> | undefined = process.env.CIV_BONUS_EXTRACT
  ? JSON.parse(readFileSync(process.env.CIV_BONUS_EXTRACT, 'utf8'))
  : published?.civilizationBonuses && published.civilizations?.franks
    ? { britons: published, franks: published.civilizations.franks } : undefined;
const effect = (unit: string, attribute: TechEffect['attribute'], amount: number,
  operation: TechEffect['operation'] = 'multiply'): TechEffect => ({ unit, attribute, amount, operation });
function node(id: number, effects: TechEffect[] = [], requiredTechs: number[] = [], requiredTechCount = requiredTechs.length): BonusTechnology {
  return { key: `automatic-${id}`, automatic: true, requiredTechs, requiredTechCount, effects };
}
function profile(key: 'britons' | 'franks'): GameRules {
  const rules = structuredClone(FALLBACK_RULES);
  rules.technologies['imperial-age'] = { ...rules.technologies['castle-age'], techId: 103, grantsAge: 3, requiresAge: 2 };
  rules.civilization.key = key;
  rules.civilization.unavailable = { units: [], buildings: [], technologies: [] };
  const nodes: CivilizationBonuses['nodes'] = {
    104: { ...node(104), age: 0 },
    101: { ...node(101), key: 'feudal-age', automatic: false, age: 1 },
    102: { ...node(102), key: 'castle-age', automatic: false, age: 2 },
    103: { ...node(103), key: 'imperial-age', automatic: false, age: 3 },
  };
  if (key === 'britons') {
    nodes[383] = node(383, [effect('villager-shepherd', 'workRate', 1.25)]);
    nodes[381] = node(381, [effect('town-center', 'woodCost', 0.5)], [102]);
    for (const [id, age] of [[382, 102], [403, 103]]) {
      nodes[id] = node(id, ['archer', 'crossbowman', 'arbalester', 'longbowman', 'elite-longbowman', 'skirmisher', 'elite-skirmisher'].flatMap(kind => [
        effect(kind, 'range', 1, 'add'), effect(kind, 'lineOfSight', 1, 'add'),
        ...(kind.includes('skirmisher') ? [effect(kind, 'range', -1, 'add'), effect(kind, 'lineOfSight', -1, 'add')] : []),
      ]), [age]);
    }
    nodes[-2] = node(-2, [effect('archery-range', 'workRate', 1.1)]);
  } else {
    nodes[524] = node(524, [effect('villager-forager', 'workRate', 1.15)]);
    nodes[290] = node(290, ['scout-cavalry', 'light-cavalry', 'knight', 'cavalier', 'cavalry-archer', 'heavy-cavalry-archer']
      .map(kind => effect(kind, 'hitPoints', 1.2)), [101]);
    nodes[325] = node(325, [effect('castle', 'cost', 0.85)], [102]);
    nodes[330] = node(330, [effect('castle', 'cost', 0.882353)], [103]);
    nodes[-2] = node(-2, [effect('knight', 'lineOfSight', 2, 'add'), effect('cavalier', 'lineOfSight', 2, 'add')]);
    for (const [id, name, age, previous, amount] of [
      [14, 'horse-collar', 101, undefined, 75], [13, 'heavy-plow', 102, 14, 125], [12, 'crop-rotation', 103, 13, 175],
    ] as const) {
      const requiredTechs = previous ? [age, previous, 761] : [age, 758];
      nodes[id] = { ...node(id, [], [...requiredTechs], previous ? 2 : 1), key: name, researchedAt: 'mill' };
      rules.technologies[name] = { techId: id, name, researchedAt: 'mill', researchSeconds: 0, requiresAge: 0,
        cost: { food: 0, wood: 0, gold: 0, stone: 0 }, requiredTechs: [...requiredTechs], requiredTechCount: previous ? 2 : 1,
        effects: [{ resource: 'farmFoodAmount', operation: 'add', amount }] };
    }
    nodes[761] = { ...node(761), disabled: true };
    nodes[758] = { ...node(758), disabled: true };
  }
  rules.civilizationBonuses = { treeEffectId: key === 'britons' ? 254 : 258, teamEffectId: key === 'britons' ? 399 : 403, nodes };
  if (extracted) {
    const source = extracted[key];
    rules.civilizationBonuses = structuredClone(source.civilizationBonuses!);
    rules.technologies = {};
    for (const [name, tech] of Object.entries(source.technologies!)) {
      const building = Object.entries(source.entities).find(([, e]) => e.category === 'building' && e.id === tech.researchedAt)?.[0];
      if (!building || !(building in rules.buildings)) continue;
      rules.technologies[name] = { ...tech, researchedAt: building as BuildingKind,
        cost: { food: 0, wood: 0, gold: 0, stone: 0, ...tech.cost }, effects: tech.effects ?? [] };
    }
    for (const [kind, e] of Object.entries(source.entities)) {
      if (kind in rules.buildings) rules.buildings[kind as BuildingKind].workRate = e.workRate;
    }
  }
  // Short clocks are fixture-only. Rates/bonus values remain source values.
  for (const age of ['feudal-age', 'castle-age', 'imperial-age']) {
    if (rules.technologies[age]) rules.technologies[age].researchSeconds = 0.1;
  }
  rules.units.archer.trainSeconds = 1.1;
  rules.units.knight.trainSeconds = 0.1;
  rules.units.militia.speed = 0;
  rules.units.sheep.foodDecayPerSecond = 0;
  rules.buildings.farm.buildSeconds = 0.1;
  return rules;
}
function arena() {
  const rules = profile('britons');
  rules.civilizations = { franks: profile('franks') };
  const state = createGame(123, rules, { 1: 'britons', 2: 'franks' });
  state.entities = state.entities.filter(e => e.owner !== 0);
  state.terrain.fill(0); state.elevation.fill(0);
  for (const owner of [1, 2] as const) Object.assign(state.players[owner], { food: 10000, wood: 10000, gold: 10000, stone: 10000 });
  return state;
}
const run = (state: GameState, ticks: number) => { for (let i = 0; i < ticks; i++) stepGame(state); };
const home = (state: GameState, owner: PlayerId) => state.entities.find(e => e.owner === owner && e.kind === 'town-center')!;
function spawn(state: GameState, kind: UnitKind | BuildingKind, owner: PlayerId, x = 40, y = 40): Entity {
  const rules = rulesForPlayer(state, owner);
  const base = kind in rules.units ? unitRulesFor(state, owner, kind as UnitKind) : buildingRulesFor(state, owner, kind as BuildingKind);
  const e: Entity = { id: state.nextId++, kind, owner, position: { x, y }, hp: base.hp, maxHp: base.hp,
    radius: base.radius, activity: 'idle', order: { kind: 'idle' } };
  state.entities.push(e);
  return e;
}
function age(state: GameState, owner: PlayerId, value: number) {
  state.players[owner].age = value;
  activateAutomaticTechnologies(state);
}

describe(`civilisation bonus outcomes (${extracted ? 'owned decoder' : 'source-command fixtures'})`, () => {
  it('loads independent bonus graphs from root/additional manifests and applies their effects at match creation', () => {
    const manifest = (key: string, hp: number): ContentManifest & { civilization: GameRules['civilization'] } => ({
      entities: {}, civilization: { key, name: key, unavailable: { units: [], buildings: [], technologies: [] } },
      civilizationBonuses: { treeEffectId: 0, teamEffectId: 0, nodes: { 90001: node(90001, [effect('villager', 'hitPoints', hp, 'add')]) } },
      technologies: { loom: { techId: 22, name: 'Loom', researchedAt: 109, requiresAge: 0, researchSeconds: 0.1,
        requiredTechs: [90001, 90002], requiredTechCount: 1, cost: {}, effects: [effect('villager', 'hitPoints', 1, 'add')] } },
    });
    const root = manifest('fixture-a', 5);
    root.civilizations = { 'fixture-b': manifest('fixture-b', 20) };
    const state = createGame(123, rulesFromManifest(JSON.parse(JSON.stringify(root))), { 1: 'fixture-a', 2: 'fixture-b' });
    for (const [owner, delta] of [[1, 5], [2, 20]] as const) {
      const worker = state.entities.find(e => e.owner === owner && e.kind === 'villager')!;
      expect(worker.maxHp).toBe(FALLBACK_RULES.units.villager.hp + delta);
      expect(applyCommand(state, { kind: 'research', player: owner, buildingId: home(state, owner).id, tech: 'loom' }).ok).toBe(true);
    }
    run(state, 3);
    for (const [owner, delta] of [[1, 5], [2, 20]] as const) {
      expect(state.entities.find(e => e.owner === owner && e.kind === 'villager')!.maxHp).toBe(FALLBACK_RULES.units.villager.hp + delta + 1);
    }
  });

  it('keeps unsatisfied slots and count choices, rejecting premature public research without payment', () => {
    const state = arena(), own = state.rules, nodes = own.civilizationBonuses!.nodes;
    nodes[90001] = node(90001, [effect('villager', 'hitPoints', 100, 'add')], [], 1);
    nodes[90002] = node(90002, [], [], 0);
    nodes[90003] = { ...node(90003), automatic: false };
    own.technologies['choice-fixture'] = { ...own.technologies.loom, techId: 90004, requiredTechs: [90002, 90003, 101], requiredTechCount: 2, researchSeconds: 0.1 };
    activateAutomaticTechnologies(state);
    const before = state.players[1].gold;
    const command = { kind: 'research', player: 1, buildingId: home(state, 1).id, tech: 'choice-fixture' } as const;
    expect(applyCommand(state, command).ok).toBe(false);
    expect(state.players[1].gold).toBe(before);
    age(state, 1, 1);
    expect(applyCommand(state, command).ok).toBe(true);
    run(state, 3);
    expect(state.players[1].researched).toContain('choice-fixture');
    expect(state.players[1].researched).not.toContain('automatic-90001');
    expect(state.players[1].researched).not.toContain('automatic-90003');
  });

  it('activates Feudal cavalry HP through real age research on existing and garrisoned units, then trains a buffed knight', () => {
    const state = arena();
    spawn(state, 'mill', 2, 80, 50); spawn(state, 'barracks', 2, 85, 50);
    const knight = spawn(state, 'knight', 2, 80, 60), held = spawn(state, 'knight', 2, 82, 60);
    const foreign = spawn(state, 'knight', 2, 84, 60);
    foreign.convertedRules = structuredClone(unitRulesFor(state, 1, 'knight'));
    const base = knight.maxHp;
    knight.hp -= 10;
    home(state, 2).garrison = [held];
    state.entities = state.entities.filter(e => e !== held);
    const other = spawn(state, 'knight', 1, 40, 60);
    run(state, 1);
    expect(knight.maxHp).toBe(base);
    expect(applyCommand(state, { kind: 'research', player: 2, buildingId: home(state, 2).id, tech: 'feudal-age' }).ok).toBe(true);
    run(state, 3);
    expect(knight.maxHp).toBeCloseTo(base * 1.2);
    expect(knight.hp).toBeCloseTo(base * 1.2 - 10);
    expect(held.maxHp).toBeCloseTo(base * 1.2);
    expect(foreign.maxHp).toBe(base);
    expect(other.maxHp).toBe(base);
    age(state, 2, 2);
    const stable = spawn(state, 'stable', 2, 90, 60);
    expect(applyCommand(state, { kind: 'train', player: 2, buildingId: stable.id, unit: 'knight' }).ok).toBe(true);
    run(state, 4);
    expect(state.entities.filter(e => e.owner === 2 && e.kind === 'knight').at(-1)!.maxHp).toBeCloseTo(base * 1.2);
    const resumed = JSON.parse(JSON.stringify(state)) as GameState;
    run(state, 10); run(resumed, 10);
    expect(synchronizationHash(resumed)).toBe(synchronizationHash(state));
    expect(knight.maxHp).toBeCloseTo(base * 1.2);
  });

  it('finishes archery-range production in 20 rather than 22 ticks with unchanged payment/refund', () => {
    const state = arena();
    for (const owner of [1, 2] as const) {
      age(state, owner, 1);
      const range = spawn(state, 'archery-range', owner, owner === 1 ? 40 : 80, 50);
      const before = state.players[owner].wood;
      const command = { kind: 'train', player: owner, buildingId: range.id, unit: 'archer' } as const;
      expect(applyCommand(state, command).ok).toBe(true);
      expect(applyCommand(state, { kind: 'cancel-train', player: owner, buildingId: range.id }).ok).toBe(true);
      expect(state.players[owner].wood).toBe(before);
      expect(applyCommand(state, command).ok).toBe(true);
      expect(observe(state, owner).entities.find(e => e.id === range.id)!.training!.remainingSeconds)
        .toBe(owner === 1 ? 1 : 1.1);
    }
    run(state, 20);
    expect(state.entities.filter(e => e.kind === 'archer' && e.owner === 1)).toHaveLength(1);
    expect(state.entities.filter(e => e.kind === 'archer' && e.owner === 2)).toHaveLength(0);
    run(state, 2);
    expect(state.entities.filter(e => e.kind === 'archer' && e.owner === 2)).toHaveLength(1);
  });

  it('reports research seconds at the active work rate and completes at that time', () => {
    const state = arena();
    for (const owner of [1, 2] as const) {
      age(state, owner, 1);
      const range = spawn(state, 'archery-range', owner, owner === 1 ? 40 : 80, 50);
      rulesForPlayer(state, owner).technologies['work-fixture'] = {
        techId: 90005, name: 'Work fixture', researchedAt: 'archery-range', requiresAge: 1,
        researchSeconds: 1.1, cost: { food: 0, wood: 0, gold: 0, stone: 0 }, effects: [],
      };
      expect(applyCommand(state, { kind: 'research', player: owner, buildingId: range.id, tech: 'work-fixture' }).ok).toBe(true);
      expect(observe(state, owner).entities.find(e => e.id === range.id)!.researching!.remainingSeconds)
        .toBe(owner === 1 ? 1 : 1.1);
    }
    run(state, 20);
    expect(state.players[1].researched).toContain('work-fixture');
    expect(state.players[2].researched).not.toContain('work-fixture');
    run(state, 2);
    expect(state.players[2].researched).toContain('work-fixture');
  });

  it('applies age range to archers trained before the bonus and held in a garrison, and to future trainees', () => {
    const state = arena();
    age(state, 1, 1);
    const range = spawn(state, 'archery-range', 1, 40, 50);
    spawn(state, 'house', 1, 35, 50);
    expect(applyCommand(state, { kind: 'rally', player: 1, buildingId: range.id, target: range.position, targetId: range.id }).ok).toBe(true);
    expect(applyCommand(state, { kind: 'train', player: 1, buildingId: range.id, unit: 'archer' }).ok).toBe(true);
    run(state, 21);
    expect(range.garrison).toHaveLength(1);
    const held = range.garrison![0];
    age(state, 1, 3);
    expect(applyCommand(state, { kind: 'ungarrison', player: 1, buildingId: range.id }).ok).toBe(true);
    expect(applyCommand(state, { kind: 'rally', player: 1, buildingId: range.id, target: { x: 40, y: 55 } }).ok).toBe(true);
    expect(applyCommand(state, { kind: 'train', player: 1, buildingId: range.id, unit: 'archer' }).ok).toBe(true);
    run(state, 21);
    const fresh = state.entities.find(e => e.kind === 'archer' && e.id !== held.id)!;
    expect(fresh).toBeDefined();
    for (const [index, archer] of [held, fresh].entries()) {
      archer.position = { x: 40, y: 65 + index * 10 };
      const target = spawn(state, 'militia', 2, 45.75, archer.position.y);
      target.hp = target.maxHp = 1000;
      updateVisibility(state);
      expect(applyCommand(state, { kind: 'order', player: 1, entityIds: [archer.id], target: target.position, targetId: target.id }).ok).toBe(true);
      run(state, 70);
      expect(target.hp).toBeLessThan(1000);
      expect(archer.position.x).toBeCloseTo(40);
    }
  });

  it('uses the knight team sight bonus in the actual fog map without leaking it to the opposing civ', () => {
    for (const owner of [1, 2] as const) {
      const state = arena();
      spawn(state, 'knight', owner, 40, 65);
      const node = addNode(state, 'gold', { x: 45, y: 65 });
      updateVisibility(state);
      expect(isEntityVisible(state, owner, node)).toBe(owner === 2);
    }
  });

  it.skipIf(!extracted)('keeps owned Yeomen paid and gives its researched range to an existing Longbowman in combat', () => {
    const state = arena();
    age(state, 1, 3);
    const castle = spawn(state, 'castle', 1, 40, 50);
    const bow = spawn(state, 'longbowman', 1, 40, 65);
    const tech = state.rules.technologies.yeomen;
    tech.researchSeconds = 0.1;
    run(state, 1);
    expect(state.players[1].researched).not.toContain('yeomen');
    const before = { wood: state.players[1].wood, gold: state.players[1].gold };
    expect(applyCommand(state, { kind: 'research', player: 1, buildingId: castle.id, tech: 'yeomen' }).ok).toBe(true);
    expect(before.wood - state.players[1].wood).toBe(750);
    expect(before.gold - state.players[1].gold).toBe(450);
    run(state, 3);
    const target = spawn(state, 'militia', 2, 40 + state.rules.units.longbowman.range! + 2.75, 65);
    target.hp = target.maxHp = 1000;
    updateVisibility(state);
    expect(applyCommand(state, { kind: 'order', player: 1, entityIds: [bow.id], target: target.position, targetId: target.id }).ok).toBe(true);
    run(state, 90);
    expect(target.hp).toBeLessThan(1000);
    expect(bow.position.x).toBeCloseTo(40);
  });

  it('requires each farm age and predecessor even though all three research bills are zero', () => {
    const state = arena();
    spawn(state, 'mill', 2, 80, 50);
    run(state, 1);
    expect(state.players[2].researched).not.toContain('horse-collar');
    age(state, 2, 1);
    expect(state.players[2].researched).toContain('horse-collar');
    expect(state.players[2].researched).not.toContain('heavy-plow');
    expect(state.players[2].researched).not.toContain('crop-rotation');
    age(state, 2, 2);
    expect(state.players[2].researched).toContain('heavy-plow');
    expect(state.players[2].researched).not.toContain('crop-rotation');
    age(state, 2, 3);
    expect(state.players[2].researched).toContain('crop-rotation');
  });

  it('keeps cavalry bonuses after upgrades, while excluding converted active and garrisoned cavalry from owner upgrades', () => {
    const state = arena();
    age(state, 2, 3);
    const knight = spawn(state, 'knight', 2, 80, 60), held = spawn(state, 'knight', 2, 82, 60);
    const converted = spawn(state, 'knight', 2, 84, 60), convertedHeld = spawn(state, 'knight', 2, 86, 60);
    for (const e of [converted, convertedHeld]) e.convertedRules = structuredClone(FALLBACK_RULES.units.knight);
    const stable = spawn(state, 'stable', 2, 90, 60);
    stable.garrison = [held, convertedHeld];
    state.entities = state.entities.filter(e => e !== held && e !== convertedHeld);
    const own = rulesForPlayer(state, 2);
    own.technologies['upgrade-fixture'] = { techId: 99999, name: 'Upgrade fixture', researchedAt: 'stable',
      requiresAge: 3, researchSeconds: 0.1, cost: { food: 0, wood: 0, gold: 0, stone: 0 },
      upgrades: [{ from: 'knight', to: 'cavalier' }], effects: [effect('cavalier', 'hitPoints', 10, 'add')] };
    knight.hp -= 10;
    expect(applyCommand(state, { kind: 'research', player: 2, buildingId: stable.id, tech: 'upgrade-fixture' }).ok).toBe(true);
    run(state, 3);
    for (const e of [knight, held]) {
      expect(e.kind).toBe('cavalier');
      expect(e.maxHp).toBeCloseTo(own.units.cavalier.hp * 1.2 + 10);
    }
    expect(knight.hp).toBeCloseTo(own.units.cavalier.hp * 1.2);
    for (const e of [converted, convertedHeld]) expect(e.kind).toBe('knight');
  });

  it.each([1, 2, 3])('charges age %s TC wood and staged castle stone discounts through build commands', value => {
    const state = arena();
    for (const [owner, kind, resource, expected] of [
      [1, 'town-center', 'wood', value >= 2 ? 138 : 275],
      [2, 'castle', 'stone', value === 3 ? 488 : 553],
    ] as const) {
      age(state, owner, value);
      if (kind === 'castle' && value < 2) continue;
      // Before Castle, this must be a replacement, not a second TC (#177).
      if (kind === 'town-center' && value < 2) {
        expect(applyCommand(state, { kind: 'delete', player: owner, entityIds: [home(state, owner).id] }).ok).toBe(true);
      }
      const worker = state.entities.find(e => e.owner === owner && e.kind === 'villager')!;
      const target = { x: owner === 1 ? 40 : 80, y: 60 };
      updateVisibility(state);
      const before = state.players[owner][resource];
      expect(placementLegal(state, kind, target, 'x', owner).ok).toBe(true);
      expect(applyCommand(state, { kind: 'build', player: owner, building: kind, builderIds: [worker.id], target }).ok).toBe(true);
      expect(before - state.players[owner][resource]).toBe(expected);
    }
  });

  it('grants only eligible free farm research once, after mill completion; new farms gain the food', () => {
    const state = arena();
    age(state, 2, 3);
    expect(state.players[2].researched).not.toContain('horse-collar');
    const mill = spawn(state, 'mill', 2, 80, 50);
    mill.buildProgress = 0.5;
    run(state, 1);
    expect(state.players[2].researched).not.toContain('horse-collar');
    const before = { food: state.players[2].food, wood: state.players[2].wood };
    mill.buildProgress = undefined;
    run(state, 1);
    for (const key of ['horse-collar', 'heavy-plow', 'crop-rotation']) {
      expect(state.players[2].researched.filter(k => k === key)).toHaveLength(1);
      expect(state.players[1].researched).not.toContain(key);
    }
    expect(state.players[2].food).toBe(before.food);
    expect(state.players[2].wood).toBe(before.wood);
    const worker = state.entities.find(e => e.owner === 2 && e.kind === 'villager')!;
    const target = { x: 80.5, y: 60.5 };
    worker.position = { x: 78.5, y: 60.5 };
    expect(applyCommand(state, { kind: 'build', player: 2, building: 'farm', builderIds: [worker.id], target }).ok).toBe(true);
    const farm = state.entities.at(-1)!;
    for (let i = 0; i < 100 && farm.buildProgress !== undefined; i++) stepGame(state);
    expect(farm.buildProgress).toBeUndefined();
    expect(farm.amount).toBe(550);
    run(state, 20);
    expect(state.players[2].researched.filter(k => k === 'horse-collar')).toHaveLength(1);
  });

  it.each(['shepherd', 'forager'] as const)('%s bonus accelerates actual collection and the first bank only for the source task/civ', task => {
    const times: number[] = [];
    for (const owner of [1, 2] as const) {
      const state = arena(), tc = home(state, owner);
      const worker = state.entities.find(e => e.owner === owner && e.kind === 'villager')!;
      const position = { x: tc.position.x + 7, y: tc.position.y };
      const target = task === 'forager' ? addNode(state, 'berries', position)
        : spawn(state, 'sheep', owner, position.x, position.y);
      if (task === 'shepherd') Object.assign(target, { dead: true, amount: 100, resourceKind: 'food', decayTicks: 10000 });
      worker.position = { x: target.position.x - target.radius - worker.radius, y: target.position.y };
      updateVisibility(state);
      expect(applyCommand(state, { kind: 'order', player: owner, entityIds: [worker.id], target: target.position, targetId: target.id }).ok).toBe(true);
      const before = state.players[owner].food;
      let ticks = 0;
      while (state.players[owner].food === before && ticks < 2000) { stepGame(state); ticks++; }
      expect(state.players[owner].food - before).toBe(10);
      times.push(ticks);
    }
    expect(task === 'shepherd' ? times[0] : times[1]).toBeLessThan(task === 'shepherd' ? times[1] : times[0]);
  });

  it.each(['archer', 'skirmisher', 'cavalry-archer'] as const)('%s consumes Castle/Imperial range in combat without granting skirmishers or mounted archers range', kind => {
    for (const value of [1, 2, 3]) {
      const state = arena();
      const shooter = spawn(state, kind, 1, 40, 60);
      age(state, 1, value);
      const baseRange = state.rules.units[kind].range!;
      const bonus = kind === 'archer' ? value - 1 : 0;
      const victim = spawn(state, 'militia', 2, 40 + baseRange + 0.75 + Math.max(0, value - 2), 60);
      victim.hp = victim.maxHp = 1000;
      updateVisibility(state);
      expect(applyCommand(state, { kind: 'order', player: 1, entityIds: [shooter.id], target: victim.position, targetId: victim.id }).ok).toBe(true);
      run(state, 70);
      expect(victim.hp).toBeLessThan(1000);
      if (bonus > 0) expect(shooter.position.x).toBeCloseTo(40);
      else expect(shooter.position.x).toBeGreaterThan(40.1);
    }
  });
});
