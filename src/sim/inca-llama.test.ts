import { describe, expect, it } from 'vitest';
import { FALLBACK_RULES, isAnimal, rulesFromManifest, type ContentManifest, type TechEffect } from './data';
import { activateAutomaticTechnologies, applyCommand, createGame, placementLegal, rulesForPlayer, stepGame } from './game';
import { checksumState } from './checksum';
import { random01 } from './random';
import { observe } from './observe';
import { exampleAiCommands } from './ai';
import { validateObservation } from '../protocol/validate';
import { contextCursor } from '../view/cursors';
import { contextTargets } from '../view/selection';
import { decayFraction } from '../view/sprites';
import { SharedMatch } from '../shared/match';
import { replayRecord, runMatch } from '../headless/runner';
import type { BuildingKind, Entity, GameState, PlayerId } from './types';
import { existsSync, readFileSync } from 'node:fs';

const choices = ['dat-unit-305', 'dat-unit-1963'] as const;
const sides = { 1: 'incas', 2: 'britons' } as const;
// Synthetic manifest plumbing, with the DAT/XS gate shape checked independently
// by test_inca.py. No artificial producer or manual researched-list injection.
function manifest(spawn: TechEffect['spawn'] = { units: [...choices], building: 'town-center', count: 1 }): ContentManifest {
  const civilization = { ...structuredClone(FALLBACK_RULES.civilization), key: 'britons' };
  const entities = Object.fromEntries(choices.map((key, i) => [key, {
    id: [305, 1963][i], category: 'animal', class: 58, hitPoints: 7,
    collision: [0.2, 0.2] as [number, number], lineOfSight: 3,
    speedTilesPerSecond: 0.7, storage: { food: 100 }, foodDecayPerSecond: .25,
  }]));
  return { civilization, entities, civilizations: { incas: {
    civilization: { ...civilization, key: 'incas' }, entities,
    civilizationBonuses: { treeEffectId: 3, teamEffectId: 4, nodes: {
      '639': { key: 'automatic-639', automatic: true, requiredTechs: [], requiredTechCount: 0, effects: [] },
      '307': { key: 'automatic-307', automatic: true, requiredTechs: [], requiredTechCount: 1,
        triggeredByBuildings: ['town-center'], effects: [] },
      '730': { key: 'automatic-730', automatic: true, requiredTechs: [639, 307], requiredTechCount: 2,
        effects: [{ resource: 'spawnCap', operation: 'set', amount: 1 },
          ...(spawn ? [{ spawn, operation: 'set' as const, amount: 1 }] : [])] },
    } },
  } } };
}
const llamas = (s: GameState, owner: PlayerId = 1) => s.entities.filter(e =>
  e.owner === owner && choices.some(kind => kind === e.kind));
function arena(seed = 199) {
  const s = createGame(seed, rulesFromManifest(manifest()), sides);
  s.entities = s.entities.filter(e => e.owner !== 0);
  s.terrain.fill(0); s.elevation.fill(0);
  return s;
}

describe('Inca XS llama grant', () => {
  // The worker's full185872 x1 extraction is optional owned evidence. The
  // synthetic profile above exercises the same normalized 639/307/730 graph.
  it.skipIf(!existsSync('.local/content-185872.json'))('185872 imported activation grants Inca one llama and enemy Britons none through aging', () => {
    const content = JSON.parse(readFileSync('.local/content-185872.json', 'utf8'));
    expect(content.importBlockers).toBeUndefined();
    expect(content.civilizationBonuses.nodes['730']).toBeUndefined();
    expect(content.civilizations.incas.civilizationBonuses.nodes['730']).toMatchObject({
      initialState: 'ready', automatic: true, requiredTechs: [639, 307], requiredTechCount: 2,
    });
    const s = createGame(199, rulesFromManifest(content), sides);
    expect(llamas(s, 1)).toHaveLength(1);
    expect(llamas(s, 2)).toHaveLength(0);
    const tc = s.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
    Object.assign(s.players[1], { food: 10000, wood: 10000, gold: 10000, stone: 10000 });
    for (const [tech, age] of [['feudal-age', 1], ['castle-age', 2], ['imperial-age', 3]] as const) {
      // Fixture completed venues supply the real DAT age prerequisites. This
      // tests research/llama outcomes, not construction or map placement.
      const venues: BuildingKind[][] = [[], ['settlement', 'barracks'], ['blacksmith', 'market'], ['monastery', 'siege-workshop']];
      for (const [i, kind] of venues[age].entries()) {
        const rule = rulesForPlayer(s, 1).buildings[kind];
        s.entities.push({ id: s.nextId++, kind, owner: 1, position: { x: 55 + i * 5, y: 50 + age * 5 },
          hp: rule.hp, maxHp: rule.hp, radius: rule.radius, activity: 'idle', order: { kind: 'idle' } });
      }
      activateAutomaticTechnologies(s);
      expect(applyCommand(s, { kind: 'research', player: 1, buildingId: tc.id, tech }), tech).toEqual({ ok: true });
      for (let i = 0; i < 10000 && s.players[1].age < age; i++) stepGame(s);
      expect(s.players[1].age).toBe(age);
      expect(llamas(s, 1)).toHaveLength(1);
      expect(llamas(s, 2)).toHaveLength(0);
    }
    expect(s.players[1].researched.filter(k => k === 'automatic-730')).toHaveLength(1);
  });
  it.each([1, 2] as const)('naturally completes 639/307/730 and grants one animal beside player %s TC, not Britons', owner => {
    const other = owner === 1 ? 2 : 1;
    const selected = { [owner]: 'incas', [other]: 'britons' } as Record<PlayerId, string>;
    const s = createGame(199, rulesFromManifest(manifest()), selected);
    expect(s.players[owner].researched).toEqual(expect.arrayContaining(['automatic-639', 'automatic-307', 'automatic-730']));
    expect(llamas(s, owner)).toHaveLength(1);
    expect(llamas(s, other)).toHaveLength(0);
    const llama = llamas(s, owner)[0], tc = s.entities.find(e => e.owner === owner && e.kind === 'town-center')!;
    expect(llama).toMatchObject({ owner, resourceKind: 'food', amount: 100, order: { kind: 'idle' } });
    expect(Math.hypot(llama.position.x - tc.position.x, llama.position.y - tc.position.y)).toBeLessThan(6);
  });

  it('preserves the positive unsatisfied annex gate rather than granting without a TC trigger', () => {
    const m = manifest();
    delete m.civilizations!.incas.civilizationBonuses!.nodes['307'].triggeredByBuildings;
    const s = createGame(199, rulesFromManifest(m), sides);
    expect(s.players[1].researched).toContain('automatic-639');
    expect(s.players[1].researched).not.toContain('automatic-730');
    expect(llamas(s)).toHaveLength(0);
  });

  it('draws only for a completed choice grant and keeps single-unit spawns RNG-neutral', () => {
    const m = manifest();
    m.civilizations!.incas.civilizationBonuses!.nodes['730'].effects.pop();
    const baseline = createGame(42, rulesFromManifest(m), sides);
    const before = baseline.seed, draw = { seed: before };
    const expected = choices[Math.floor(random01(draw) * choices.length)];
    const s = createGame(42, rulesFromManifest(manifest()), sides);
    expect(llamas(s)[0].kind).toBe(expected);
    expect(s.seed).toBe(draw.seed);
    const single = createGame(42, rulesFromManifest(manifest({ unit: 'villager', building: 'town-center', count: 3 })), sides);
    expect(single.entities.filter(e => e.owner === 1 && e.kind === 'villager')).toHaveLength(6);
    expect(single.seed).toBe(before);
    activateAutomaticTechnologies(s);
    expect(s.seed).toBe(draw.seed);
  });

  it('same seeds pick the same animal, and multiple seeds exercise both XS choices', () => {
    const seen = new Set<string>();
    for (const seed of [1, 2, 3, 42, 199, 730]) {
      const a = arena(seed), b = arena(seed);
      expect(checksumState(a)).toBe(checksumState(b));
      seen.add(llamas(a)[0].kind);
    }
    expect([...seen].sort()).toEqual([...choices].sort());
  });

  it('JSON continuation, restart and recorded replay never duplicate the grant', async () => {
    const s = arena(), restored = JSON.parse(JSON.stringify(s)) as GameState;
    for (let i = 0; i < 20; i++) { stepGame(s); stepGame(restored); }
    expect(checksumState(restored)).toBe(checksumState(s));
    expect(llamas(restored)).toHaveLength(1);
    const match = new SharedMatch(restored);
    match.restart(199, 'arabia');
    expect(llamas(match.state)).toHaveLength(1);
    expect(checksumState(match.state)).toBe(checksumState(createGame(199, s.rules, sides)));
    const idle = { decide: () => [] };
    const { record } = await runMatch({ version: 1, seed: 199, maxTimeSeconds: 5, civilizations: sides },
      { 1: idle, 2: idle }, s.rules);
    expect(replayRecord(JSON.parse(JSON.stringify(record)), JSON.parse(JSON.stringify(s.rules))))
      .toMatchObject({ ok: true, checked: 1 });
  });

  it('another completed TC does not grant a second llama', () => {
    const s = arena();
    Object.assign(s.players[1], { age: 2, wood: 5000, stone: 5000 });
    const worker = s.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
    const target = { x: 50, y: 45 };
    worker.position = { x: 47, y: 45 };
    expect(placementLegal(s, 'town-center', target, 'x', 1).ok).toBe(true);
    expect(applyCommand(s, { kind: 'build', player: 1, builderIds: [worker.id], building: 'town-center', target }).ok).toBe(true);
    const tc = s.entities.find(e => e.kind === 'town-center' && e.buildProgress !== undefined)!;
    expect(tc).toBeDefined();
    for (let i = 0; i < 5000 && tc.buildProgress !== undefined; i++) stepGame(s);
    expect(tc.buildProgress).toBeUndefined();
    expect(llamas(s)).toHaveLength(1);
    expect(s.players[1].researched.filter(k => k === 'automatic-730')).toHaveLength(1);
  });

  it('recognizes both source IDs as animals throughout the shared interaction contract', () => {
    const rules = rulesFromManifest(manifest());
    for (const kind of choices) expect(isAnimal(kind, rules), kind).toBe(true);
  });

  it('classifies from serialized source fields without changing fallback or leaking between rulesets', () => {
    const before = JSON.stringify(FALLBACK_RULES);
    const m = manifest();
    m.entities['dat-unit-999999'] = { ...m.entities[choices[0]], id: 999999 };
    const rules = JSON.parse(JSON.stringify(rulesFromManifest(m)));
    expect(isAnimal('dat-unit-999999', rules)).toBe(true);
    rules.units['dat-unit-999999'].datClass = 4;
    expect(isAnimal('dat-unit-999999', rules)).toBe(false);
    expect(isAnimal('dat-unit-999999', FALLBACK_RULES)).toBe(false);
    expect(JSON.stringify(FALLBACK_RULES)).toBe(before);
  });

  it('claims Gaia livestock, retains contested ownership, and recaptures by proximity through JSON', () => {
    const s = arena(), llama = llamas(s)[0];
    const own = s.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
    const enemy = s.entities.find(e => e.owner === 2 && e.kind === 'villager')!;
    s.entities = s.entities.filter(e => e.kind === 'town-center' || [llama.id, own.id, enemy.id].includes(e.id));
    llama.owner = 0; llama.position = { x: 50, y: 50 };
    own.position = { x: 45, y: 45 }; enemy.position = { x: 50.5, y: 50 };
    const restored = JSON.parse(JSON.stringify(s)) as GameState;
    for (const game of [s, restored]) {
      const animal = game.entities.find(e => e.id === llama.id)!;
      const worker = game.entities.find(e => e.id === own.id)!;
      const rival = game.entities.find(e => e.id === enemy.id)!;
      for (let i = 0; i < 5; i++) stepGame(game);
      expect(animal.owner).toBe(2);
      worker.position = { x: 49.5, y: 50 };
      for (let i = 0; i < 5; i++) stepGame(game);
      expect(animal.owner).toBe(2);
      rival.position = { x: 70, y: 70 };
      for (let i = 0; i < 5; i++) stepGame(game);
      expect(animal.owner).toBe(1);
      expect(applyCommand(game, { kind: 'delete', player: 1, entityIds: [animal.id] }).ok).toBe(true);
      const wire = JSON.parse(JSON.stringify(observe(game, 1)));
      expect(validateObservation(wire)).toBe(true);
      expect(wire.entities.find((e: { id: number }) => e.id === animal.id)).toMatchObject({ hp: 0, amount: 100 });
    }
    expect(checksumState(restored)).toBe(checksumState(s));
  });

  it('a villager kills and gathers the granted llama, then banks its food', () => {
    const s = arena(), llama = llamas(s)[0];
    const worker = s.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
    const food = s.players[1].food;
    expect(applyCommand(s, { kind: 'order', player: 1, entityIds: [worker.id], targetId: llama.id, target: llama.position }).ok).toBe(true);
    expect(worker.order).toEqual({ kind: 'gather', targetId: llama.id });
    for (let i = 0; i < 2000 && s.players[1].food === food; i++) stepGame(s);
    expect(llama.dead).toBe(true);
    expect(llama.amount).toBeLessThan(100);
    expect(s.players[1].food).toBeGreaterThan(food);
  });

  it('the observation-only AI brings its llama home before sending shepherds after it', () => {
    const s = arena(), llama = llamas(s)[0];
    const home = s.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
    Object.assign(s.players[1], { food: 0, wood: 0, gold: 0, stone: 0 });
    llama.position = { x: home.position.x + 8, y: home.position.y };
    const wire = JSON.parse(JSON.stringify(observe(s, 1)));
    expect(validateObservation(wire)).toBe(true);
    const commands = exampleAiCommands(wire);
    expect(commands).toContainEqual({ kind: 'order', player: 1, entityIds: [llama.id], target: { ...home.position } });
    expect(commands.some(c => c.kind === 'order' && c.targetId === llama.id)).toBe(false);
    for (let i = 0; i < 2000 && s.players[1].food === 0; i++) {
      if (i % 10 === 0) for (const command of exampleAiCommands(JSON.parse(JSON.stringify(observe(s, 1))))) {
        expect(applyCommand(s, command).ok).toBe(true);
      }
      stepGame(s);
      if (llama.dead) expect(Math.hypot(llama.position.x - home.position.x, llama.position.y - home.position.y)).toBeLessThanOrEqual(2.5);
    }
    expect(llama.dead).toBe(true);
    expect(s.players[1].food).toBeGreaterThan(0);
  });

  it('adds optional schema-valid identity only to visible/remembered animals, without reading hidden live state', () => {
    const s = arena(), llama = llamas(s)[0];
    let wire = JSON.parse(JSON.stringify(observe(s, 1)));
    expect(wire.entities.find((e: { id: number }) => e.id === llama.id).livestock).toBe(true);
    for (const row of [...wire.entities, ...wire.memory]) delete row.livestock;
    expect(validateObservation(wire)).toBe(true);
    llama.owner = 0; llama.position = { x: 90, y: 90 };
    s.visibility[1].visible.fill(0); s.visibility[1].memory = {};
    wire = observe(s, 1);
    expect(wire.entities.some((e: { id: number }) => e.id === llama.id)).toBe(false);
    expect(wire.memory).toHaveLength(0);
    s.visibility[1].memory[llama.id] = { id: llama.id, kind: llama.kind, owner: 0,
      x: 50, y: 50, hp: 0, maxHp: llama.maxHp, resource: 'food', amount: 50, lastSeenAt: 0 };
    // The last-seen carcass survives removal of its hidden live counterpart.
    s.entities = s.entities.filter(e => e.id !== llama.id);
    wire = JSON.parse(JSON.stringify(observe(s, 1)));
    expect(wire.memory[0]).toMatchObject({ livestock: true, hp: 0, amount: 50, x: 50 });
    expect(validateObservation(wire)).toBe(true);
    wire.memory[0].livestock = 'yes';
    expect(validateObservation(wire)).toBe(false);
    delete wire.memory[0].livestock;
    expect(validateObservation(wire)).toBe(true);
    const remembered = [...contextTargets(s, 1)].find(row => row.entity.id === llama.id)!;
    expect(remembered.entity.dead).toBe(true);
    const pictured: Entity = JSON.parse(JSON.stringify(remembered.entity));
    expect(decayFraction(s, pictured)).toBe(.5);
    const worker = s.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
    expect(contextCursor(s, 1, [worker], remembered.entity.position, remembered.entity)).toBe('gather_meat');
  });
});
