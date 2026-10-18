import { describe, expect, it } from 'vitest';
import { exampleAiCommands } from './ai';
import { addNode, applyCommand, createGame, rulesForPlayer, stepGame } from './game';
import { observe } from './observe';
import { updateVisibility } from './visibility';
import { FALLBACK_RULES, rulesFromManifest, TICK_SECONDS, type ContentManifest } from './data';
import type { BuildingKind, Command, Entity, GameState } from './types';

const sides = { 1: 'incas', 2: 'britons' } as const;
const camps = ['mill', 'lumber-camp', 'mining-camp'];

// Synthetic plumbing fixture, not a balance calibration. Source identities,
// prices, venues and disables follow pinned civ21/INCAS.json (tools/test_inca.py).
// Compact resource patches and 1 resource/second workers bound the outcome test.
function incaManifest(): ContentManifest {
  const civilization = { ...structuredClone(FALLBACK_RULES.civilization), key: 'britons' };
  const entity = { hitPoints: 600, collision: [1, 1] as [number, number], lineOfSight: 6 };
  const buildings = Object.fromEntries(([
    ['town-center', 109], ['barracks', 12], ['castle', 82], ['archery-range', 87],
    ['mill', 68], ['lumber-camp', 562], ['mining-camp', 584],
  ] as const).map(([kind, id]) => {
    const r = FALLBACK_RULES.buildings[kind];
    return [kind, { ...entity, id, category: 'building', hitPoints: r.hp,
      collision: [r.radius, r.radius] as [number, number], cost: r.cost,
      lineOfSight: r.lineOfSight, popSupport: r.popSupport, accepts: r.accepts,
      build: { builderId: 118, seconds: r.buildSeconds } }];
  }));
  return {
    civilization, entities: {}, civilizations: {
      incas: {
        civilization: { ...civilization, key: 'incas', startingScout: 'dat-unit-2550',
          unavailable: { buildings: [68, 562, 584], units: [74], technologies: [222] } },
        entities: {
          ...buildings,
          militia: { ...entity, id: 74, category: 'unit', train: { buildingId: 12, seconds: 21 } },
          settlement: { ...entity, id: 2556, category: 'building', hitPoints: 1000,
            collision: [1.5, 1.5], cost: { wood: 125 },
            build: { builderId: 118, seconds: 40, button: 2 },
            popSupport: 5, accepts: ['food', 'wood', 'gold', 'stone'] },
          ...Object.fromEntries(([2550, 2588, 879, 185] as const).map(id => [
            `dat-unit-${id}`, { ...entity, id, category: 'unit', hitPoints: 35,
              collision: [0.2, 0.2] as [number, number], speedTilesPerSecond: 1,
              cost: { food: 50, gold: 25 }, populationCost: 1,
              train: { buildingId: id === 879 ? 82 : id === 185 ? 87 : 12,
                seconds: id === 2550 ? 42 : 34 } },
          ])),
          ...Object.fromEntries(([
            ['forager', 'food'], ['lumberjack', 'wood'], ['goldminer', 'gold'], ['stonemason', 'stone'],
          ] as const).map(([task, resource]) => [`villager-${task}`, {
            ...entity, gather: { resource, ratePerSecond: 1, capacity: 10, dropSites: [109, 2556] },
          }])),
        },
        technologies: {
          ...Object.fromEntries(['loom', 'feudal-age', 'castle-age'].map(key => [key, {
            ...FALLBACK_RULES.technologies[key], researchedAt: 109,
          }])),
          'champi-runner': { techId: 1402, name: 'Champi Runner', button: 6,
            cost: { food: 90, gold: 60 }, researchSeconds: 40, researchedAt: 12,
            requiresAge: 1, upgrades: [{ from: 'dat-unit-2550', to: 'dat-unit-2588' }], effects: [] },
          'double-bit-axe': { techId: 202, name: 'Double-Bit Axe', button: 12,
            cost: { food: 100, wood: 50 }, researchSeconds: 25, researchedAt: 2556,
            requiresAge: 1, effects: [] },
        },
      },
    },
  };
}

function arena(): GameState {
  const state = createGame(199, rulesFromManifest(incaManifest()), sides);
  state.entities = state.entities.filter(e => e.owner !== 0);
  state.terrain.fill(0);
  state.elevation.fill(0);
  updateVisibility(state);
  return state;
}

function building(state: GameState, kind: BuildingKind, x: number, y: number): Entity {
  const r = rulesForPlayer(state, 1).buildings[kind];
  const e: Entity = { id: state.nextId++, kind, owner: 1, position: { x, y },
    hp: r.hp, maxHp: r.hp, radius: r.radius, activity: 'idle', order: { kind: 'idle' } };
  state.entities.push(e);
  return e;
}

const decide = (state: GameState) => exampleAiCommands(JSON.parse(JSON.stringify(observe(state, 1))));

describe('Inca AI public-command outcomes', () => {
  it.each(['dat-unit-879', 'dat-unit-185'] as const)(
    '(a) explores with the opening Champi, never a single trained %s', kind => {
      const state = arena();
      const scout = state.entities.find(e => e.owner === 1 && e.kind === 'dat-unit-2550')!;
      expect(scout).toBeDefined();
      expect(state.entities.filter(e => e.owner === 2 && e.kind === 'scout-cavalry')).toHaveLength(1);
      const producer = building(state, kind === 'dat-unit-879' ? 'castle' : 'archery-range', 50, 60);
      state.players[1].age = 2;
      expect(applyCommand(state, { kind: 'train', player: 1, buildingId: producer.id, unit: kind }).ok).toBe(true);
      for (let tick = 0; tick < 35 / TICK_SECONDS; tick++) stepGame(state);
      const troops = state.entities.filter(e => e.owner === 1 && e.kind === kind);
      expect(troops).toHaveLength(1); // the old singleton heuristic must fail here
      updateVisibility(state);
      const commands = decide(state);
      const exploration = commands.filter(c => c.kind === 'order' && c.entityIds.includes(scout.id));
      expect(exploration).toHaveLength(1);
      expect(exploration[0]).not.toHaveProperty('targetId');
      expect(commands.some(c => c.kind === 'order' && c.entityIds.includes(troops[0].id))).toBe(false);
      const explored = state.visibility[1].explored.filter(Boolean).length;
      expect(applyCommand(state, exploration[0]).ok).toBe(true);
      for (let tick = 0; tick < 20 / TICK_SECONDS; tick++) stepGame(state);
      expect(state.visibility[1].explored.filter(Boolean).length).toBeGreaterThan(explored);
    });

  it('(b) builds a Settlement and Barracks, banks wood/gold and trains military in five game minutes', () => {
    const state = arena();
    const tc = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
    for (let x = 0; x < 6; x++) for (let y = 0; y < 3; y++) {
      addNode(state, 'tree', { x: tc.position.x + 14.5 + x, y: tc.position.y + 0.5 + y });
    }
    for (let i = 0; i < 6; i++) {
      addNode(state, 'berries', { x: tc.position.x - 7.5 + i, y: tc.position.y + 3.5 });
      addNode(state, 'gold', { x: tc.position.x + 14.5 + i, y: tc.position.y + 5.5 });
    }
    updateVisibility(state);
    expect(observe(state, 1).entities.some(e => e.node === 'berries')).toBe(true);
    for (const kind of camps) expect(rulesForPlayer(state, 1).buildings[kind as BuildingKind].buildable).toBe(false);
    const initialIds = new Set(state.entities.map(e => e.id));
    const builds: string[] = [], trained: string[] = [];
    const rejected: { command: Command; reason: string }[] = [];
    const banked = { wood: 0, gold: 0 };
    const settlementBanked = { wood: 0, gold: 0 };
    for (let tick = 0; tick < 300 / TICK_SECONDS; tick++) {
      if (tick % 10 === 0) for (const command of decide(state)) {
        if (command.kind === 'build') builds.push(command.building);
        const result = applyCommand(state, command);
        if (!result.ok) rejected.push({ command, reason: result.reason });
        else if (command.kind === 'train' && command.unit !== 'villager') trained.push(command.unit);
      }
      // Only tick-time income, never initial stock or command-time refunds.
      const before = { wood: state.players[1].wood, gold: state.players[1].gold };
      const loads = state.entities.filter(e => e.owner === 1 && e.kind === 'villager'
        && (e.carrying?.kind === 'wood' || e.carrying?.kind === 'gold'))
        .map(worker => ({ worker, cargo: { ...worker.carrying! } }));
      stepGame(state);
      for (const r of ['wood', 'gold'] as const) banked[r] += Math.max(0, state.players[1][r] - before[r]);
      for (const resource of ['wood', 'gold'] as const) {
        const deposited = loads.filter(({ worker, cargo }) => cargo.kind === resource && !worker.carrying);
        // Every cleared load must reach the stockpile on this exact tick.
        expect(state.players[1][resource] - before[resource])
          .toBe(deposited.reduce((sum, { cargo }) => sum + cargo.amount, 0));
        for (const { worker, cargo } of deposited) {
          const near = (site: Entity) => Math.hypot(worker.position.x - site.position.x,
            worker.position.y - site.position.y) <= worker.radius + site.radius + 0.3;
          const settlement = state.entities.find(e => e.owner === 1 && e.kind === 'settlement'
            && !e.dead && e.buildProgress === undefined && near(e));
          if (!settlement) continue; // TC income cannot satisfy Settlement acceptance.
          expect(near(tc)).toBe(false);
          settlementBanked[resource] += cargo.amount;
        }
      }
    }
    const outcome = { banked, settlementBanked, builds, trained, rejected, age: state.players[1].age,
      food: state.players[1].food, wood: state.players[1].wood };
    expect(builds.filter(kind => camps.includes(kind))).toEqual([]);
    for (const kind of ['settlement', 'barracks']) {
      expect(state.entities.some(e => e.owner === 1 && e.kind === kind && !e.dead
        && e.buildProgress === undefined), JSON.stringify(outcome)).toBe(true);
    }
    expect(banked.wood).toBeGreaterThan(0);
    expect(banked.gold).toBeGreaterThan(0);
    expect(settlementBanked.wood, JSON.stringify(outcome)).toBeGreaterThan(0);
    expect(settlementBanked.gold, JSON.stringify(outcome)).toBeGreaterThan(0);
    expect(trained.length, JSON.stringify(outcome)).toBeGreaterThan(0);
    expect(state.entities.some(e => e.owner === 1 && !initialIds.has(e.id)
      && trained.includes(e.kind) && !e.dead)).toBe(true);
    expect(trained).not.toContain('militia');
    // The inherited placement fan may probe obstructed candidates. No other
    // failures (disabled camps/units, wrong venue, age or price) are acceptable.
    expect(rejected.every(r => r.command.kind === 'build'
      && r.reason.startsWith('placement overlaps ')), JSON.stringify(rejected)).toBe(true);
    console.info('Inca five-minute outcome', { banked, settlementBanked, buildings: [...new Set(builds)], trained,
      rejected: [...new Set(rejected.map(r => r.reason))] });
  });

  it('(c) keeps Briton opening decisions identical with or without the loaded Inca profile', () => {
    const rules = rulesFromManifest(incaManifest());
    const withInca = createGame(199, structuredClone(rules), { 1: 'britons', 2: 'britons' });
    delete rules.civilizations;
    const withoutInca = createGame(199, rules, { 1: 'britons', 2: 'britons' });
    for (let tick = 0; tick < 30 / TICK_SECONDS; tick++) {
      if (tick % 10 === 0) {
        const commands = decide(withInca);
        expect(commands).toEqual(decide(withoutInca));
        expect(commands.some(c => c.kind === 'build' && c.building === 'settlement')).toBe(false);
        for (const command of commands) {
          expect(applyCommand(withInca, command)).toEqual(applyCommand(withoutInca, command));
        }
      }
      stepGame(withInca); stepGame(withoutInca);
    }
  });

  it.each([499, 500])('permits an opening recruit but does not delay affordable Feudal (food=%s)', food => {
    for (const hasRecruit of [false, true]) {
      const state = arena();
      const barracks = building(state, 'barracks', 50, 60);
      building(state, 'house', 50, 66);
      stepGame(state);
      if (hasRecruit) {
        expect(applyCommand(state, { kind: 'train', player: 1, buildingId: barracks.id, unit: 'dat-unit-2550' }).ok).toBe(true);
        for (let tick = 0; tick <= 42 / TICK_SECONDS; tick++) stepGame(state);
      }
      expect(state.entities.filter(e => e.owner === 1 && e.kind === 'dat-unit-2550'))
        .toHaveLength(hasRecruit ? 2 : 1);
      Object.assign(state.players[1], { food, wood: 0, gold: 25, researched: ['loom'] });
      const commands = decide(state);
      const age = commands.find(c => c.kind === 'research' && c.tech === 'feudal-age');
      const recruit = commands.find(c => c.kind === 'train' && c.buildingId === barracks.id);
      expect(!!age).toBe(food === 500);
      expect(!!recruit).toBe(!hasRecruit);
      if (age) {
        expect(applyCommand(state, age).ok).toBe(true);
        expect(state.players[1].food).toBe(0); // affordable age takes precedence
      } else if (recruit) {
        expect(applyCommand(state, recruit).ok).toBe(true);
        expect(state.players[1].food).toBe(food - 50);
      }
    }
  });

  it('keeps the upgraded scout separate, then reassigns its paid recruit after scout loss', () => {
    const state = arena();
    const scout = state.entities.find(e => e.owner === 1 && e.kind === 'dat-unit-2550')!;
    const barracks = building(state, 'barracks', 50, 60);
    building(state, 'house', 50, 66);
    Object.assign(state.players[1], { age: 1, food: 1000, gold: 1000, researched: ['loom', 'feudal-age'] });
    expect(applyCommand(state, { kind: 'research', player: 1, buildingId: barracks.id, tech: 'champi-runner' }).ok).toBe(true);
    for (let tick = 0; tick <= 40 / TICK_SECONDS; tick++) stepGame(state);
    expect(scout.kind).toBe('dat-unit-2588');
    const recruit = decide(state).find(c => c.kind === 'train' && c.buildingId === barracks.id);
    expect(recruit).toMatchObject({ kind: 'train', unit: 'dat-unit-2588' });
    expect(applyCommand(state, recruit!).ok).toBe(true);
    for (let tick = 0; tick <= 34 / TICK_SECONDS; tick++) stepGame(state);
    const soldiers = state.entities.filter(e => e.owner === 1 && e.kind === 'dat-unit-2588' && e.id !== scout.id);
    expect(soldiers).toHaveLength(1);
    const commands = decide(state);
    expect(commands.filter(c => c.kind === 'order' && c.entityIds.includes(scout.id))).toHaveLength(1);
    expect(commands.some(c => c.kind === 'order' && c.entityIds.includes(soldiers[0].id))).toBe(false);
    expect(applyCommand(state, { kind: 'delete', player: 1, entityIds: [scout.id] }).ok).toBe(true);
    const afterLoss = decide(state);
    expect(afterLoss.some(c => c.kind === 'order' && c.entityIds.includes(scout.id))).toBe(false);
    const replacement = afterLoss.filter(c => c.kind === 'order' && c.entityIds.includes(soldiers[0].id));
    expect(replacement).toHaveLength(1);
    expect(replacement[0]).not.toHaveProperty('targetId');
    expect(afterLoss).toEqual(decide(JSON.parse(JSON.stringify(state))));
    expect(applyCommand(state, replacement[0]).ok).toBe(true);
    expect(soldiers[0].order.kind).toBe('move');
  });

  it('(d) builds a Settlement and completes Double-Bit Axe there through public commands', () => {
    const state = arena();
    const worker = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
    worker.position = { x: 47, y: 60 };
    expect(applyCommand(state, { kind: 'build', player: 1, builderIds: [worker.id],
      building: 'settlement', target: { x: 50, y: 60 } }).ok).toBe(true);
    const settlement = state.entities.find(e => e.owner === 1 && e.kind === 'settlement')!;
    const research: Command = { kind: 'research', player: 1, buildingId: settlement.id, tech: 'double-bit-axe' };
    state.players[1].age = 1;
    expect(applyCommand(state, research).ok).toBe(false); // unfinished venue
    for (let tick = 0; tick < 60 / TICK_SECONDS && settlement.buildProgress !== undefined; tick++) stepGame(state);
    expect(settlement.buildProgress).toBeUndefined();
    const before = { food: state.players[1].food, wood: state.players[1].wood };
    expect(applyCommand(state, research).ok).toBe(true);
    expect(state.players[1].food).toBe(before.food - 100);
    expect(state.players[1].wood).toBe(before.wood - 50);
    expect(settlement.researching?.tech).toBe('double-bit-axe');
    for (let tick = 0; tick <= 25 / TICK_SECONDS; tick++) stepGame(state);
    expect(state.players[1].researched).toContain('double-bit-axe');
    expect(state.players[2].researched).not.toContain('double-bit-axe');
    expect(settlement.researching).toBeUndefined();
  });

  it('(e) emits reseed command at a completed Settlement when autoReseedFarms is unset (#321)', () => {
    const state = arena();
    const worker = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
    worker.position = { x: 47, y: 60 };
    expect(applyCommand(state, { kind: 'build', player: 1, builderIds: [worker.id],
      building: 'settlement', target: { x: 50, y: 60 } }).ok).toBe(true);
    const settlement = state.entities.find(e => e.owner === 1 && e.kind === 'settlement')!;
    // Settlement is under construction: no reseed command.
    let commands = decide(state);
    expect(commands.some(c => c.kind === 'reseed')).toBe(false);
    // Settlement is completed: reseed command is issued.
    for (let tick = 0; tick < 60 / TICK_SECONDS && settlement.buildProgress !== undefined; tick++) stepGame(state);
    expect(settlement.buildProgress).toBeUndefined();
    expect(state.players[1].autoReseedFarms).toBeFalsy();
    commands = decide(state);
    const reseed = commands.find(c => c.kind === 'reseed');
    expect(reseed).toEqual({ kind: 'reseed', player: 1, buildingId: settlement.id, enabled: true });
    // Once applied, toggle stays on and no second command is emitted.
    expect(applyCommand(state, reseed!)).toEqual({ ok: true });
    expect(state.players[1].autoReseedFarms).toBe(true);
    commands = decide(state);
    expect(commands.filter(c => c.kind === 'reseed')).toHaveLength(0);
  });
});
