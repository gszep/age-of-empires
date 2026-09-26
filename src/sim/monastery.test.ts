import { describe, expect, it } from 'vitest';
import { FALLBACK_RULES, type TechEffect } from './data';
import { activateAutomaticTechnologies, applyCommand, createGame, stepGame } from './game';
import { checksumState } from './checksum';
import { addRelic } from './relics';
import { updateVisibility } from './visibility';
import { chooseAnimation } from '../view/sprites';
import type { Entity, GameState, PlayerId, UnitKind } from './types';

function fixture() {
  const rules = structuredClone(FALLBACK_RULES);
  rules.units.monk.attackReloadSeconds = 1.6;
  Object.assign(rules.playerAttributes, { convertResistMinAdj: 0, convertResistMaxAdj: 0, theocracy: 0, relicRate: 30 });
  const state = createGame(130, rules);
  state.terrain = Array(state.width * state.height).fill(0); state.elevation.fill(0);
  state.entities = state.entities.filter(e => e.kind === 'town-center');
  state.players[1].age = state.players[2].age = 3;
  return state;
}
function spawn(state: GameState, kind: UnitKind | 'monastery', owner: PlayerId, x: number, y = 50) {
  const rule = kind === 'monastery' ? state.rules.buildings.monastery : state.rules.units[kind];
  const e: Entity = { id: state.nextId++, kind, owner, position: { x, y }, hp: rule.hp,
    maxHp: rule.hp, radius: rule.radius, order: { kind: 'idle' }, activity: 'idle' };
  state.entities.push(e); updateVisibility(state); return e;
}
function order(state: GameState, unit: Entity, target: Entity) {
  updateVisibility(state);
  expect(applyCommand(state, { kind: 'order', player: unit.owner as PlayerId,
    entityIds: [unit.id], target: target.position, targetId: target.id }).ok).toBe(true);
}
function run(state: GameState, n: number) { for (let i = 0; i < n; i++) stepGame(state); }
function until(state: GameState, predicate: () => boolean, ticks = 800) {
  for (let i = 0; i < ticks && !predicate(); i++) stepGame(state);
  expect(predicate()).toBe(true);
}
function research(state: GameState, owner: PlayerId, key: string, effects: TechEffect[]) {
  // Compressed research clock only; outcome values are the source effects.
  state.rules.technologies[key] = { ...state.rules.technologies.loom, name: key, researchedAt: 'monastery',
    requiresAge: 0, cost: { food: 0, wood: 0, gold: 0, stone: 0 }, researchSeconds: 0.05, effects };
  const home = state.entities.find(e => e.kind === 'monastery' && e.owner === owner)
    ?? spawn(state, 'monastery', owner, 15, owner * 15);
  expect(applyCommand(state, { kind: 'research', player: owner, buildingId: home.id, tech: key }).ok).toBe(true);
  stepGame(state); expect(state.players[owner].researched).toContain(key);
}

describe('Briton relic lifecycle', () => {
  it('walks, carries owned art, deposits, banks 30 gold/minute and releases the same relic on destruction', () => {
    const s = fixture(), monk = spawn(s, 'monk', 1, 50), home = spawn(s, 'monastery', 1, 57);
    const relic = addRelic(s, { x: 52, y: 50 });
    order(s, monk, relic); until(s, () => !!monk.relics?.length);
    expect(s.entities).not.toContain(relic); expect(chooseAnimation(s, monk).key).toBe('monk-relic');
    until(s, () => !!home.relics?.length);
    expect(home.relics![0].id).toBe(relic.id);
    const gold = s.players[1].gold; run(s, 1200); expect(s.players[1].gold - gold).toBe(30);
    applyCommand(s, { kind: 'delete', player: 1, entityIds: [home.id] });
    expect(s.entities.find(e => e.id === relic.id)?.owner).toBe(0);
    const after = s.players[1].gold; run(s, 100); expect(s.players[1].gold).toBe(after);
  });

  it('contests pickup, validates drop ownership, preserves JSON continuation and releases killed carriers', () => {
    const s = fixture(), a = spawn(s, 'monk', 1, 50), b = spawn(s, 'monk', 1, 50.1);
    const relic = addRelic(s, { x: 50.5, y: 50 }); order(s, a, relic); order(s, b, relic); run(s, 2);
    expect([a, b].filter(e => e.relics?.length)).toHaveLength(1);
    expect(applyCommand(s, { kind: 'ungarrison', player: 2, buildingId: a.id }).ok).toBe(false);
    const saved = JSON.parse(JSON.stringify(s)) as GameState;
    for (const state of [s, saved]) {
      expect(applyCommand(state, { kind: 'ungarrison', player: 1, buildingId: a.id }).ok).toBe(true);
      run(state, 30);
    }
    expect(checksumState(saved)).toBe(checksumState(s));
    order(s, a, relic); until(s, () => !!a.relics?.length);
    applyCommand(s, { kind: 'delete', player: 1, entityIds: [a.id] });
    expect(s.entities.filter(e => e.kind === 'relic')).toHaveLength(1);
  });

  it('does not bank carried relics or admit full/enemy monasteries', () => {
    const s = fixture(), monk = spawn(s, 'monk', 1, 50), enemy = spawn(s, 'monastery', 2, 54);
    order(s, monk, addRelic(s, { x: 50.5, y: 50 })); stepGame(s);
    const gold = s.players[1].gold; run(s, 100); expect(s.players[1].gold).toBe(gold);
    order(s, monk, enemy); expect(monk.order.kind).toBe('move');
    const home = spawn(s, 'monastery', 1, 46); s.rules.buildings.monastery.garrison!.capacity = 0;
    order(s, monk, home); expect(monk.order.kind).toBe('move');
    expect(monk.relics).toHaveLength(1);
  });

  it('unloads both stored relics and an existing self-rally garrison without losing the monk', () => {
    const s = fixture(), home = spawn(s, 'monastery', 1, 50);
    const monk = spawn(s, 'monk', 1, 50), relic = addRelic(s, home.position);
    // A completed self-rally trainee and a deposited relic can share a monastery.
    home.garrison = [monk]; home.relics = [relic];
    s.entities = s.entities.filter(e => e.id !== monk.id && e.id !== relic.id);
    expect(applyCommand(s, { kind: 'ungarrison', player: 1, buildingId: home.id }).ok).toBe(true);
    expect(home.garrison).toBeUndefined(); expect(home.relics).toBeUndefined();
    expect(s.entities.filter(e => e.id === monk.id || e.id === relic.id)).toHaveLength(2);
    expect(monk.owner).toBe(1); expect(relic.owner).toBe(0);
  });

  it('places five deterministic Arabia relics and fails closed on unsupported automatic relic thresholds', () => {
    for (const seed of [1, 7, 42]) {
      const relics = (s: GameState) => s.entities.filter(e => e.kind === 'relic').map(e => e.position);
      const a = createGame(seed), b = createGame(seed); expect(relics(a)).toHaveLength(5); expect(relics(a)).toEqual(relics(b));
    }
    const s = fixture(); s.rules.civilizationBonuses = { treeEffectId: 0, teamEffectId: 0, nodes: {} };
    for (let id = 699; id <= 702; id++) s.rules.civilizationBonuses.nodes[id] = {
      key: `automatic-${id}`, automatic: true, requiredTechs: [], requiredTechCount: 0, effects: [],
    };
    activateAutomaticTechnologies(s); expect(s.players[1].researched).toEqual([]);
  });
});

describe('offered Briton monastery research outcomes', () => {
  it.each([1, 5])('Devotion / Faith resistance adds %s seconds without breaking captured rule snapshots', amount => {
    const s = fixture(), monk = spawn(s, 'monk', 1, 50), target = spawn(s, 'militia', 2, 54);
    research(s, 2, 'devotion', ['convertResistMinAdj', 'convertResistMaxAdj'].map(resource =>
      ({ resource, operation: 'add', amount: 1 } as TechEffect)));
    if (amount === 5) research(s, 2, 'faith', ['convertResistMinAdj', 'convertResistMaxAdj'].map(resource =>
      ({ resource, operation: 'add', amount: 4 } as TechEffect)));
    order(s, monk, target); run(s, (5 + amount) * 20 - 1); expect(target.owner).toBe(2);
    until(s, () => target.owner === 1); expect(target.convertedRules).toBeDefined(); expect(monk.faith).toBe(0);
  });

  it.each([false, true])('Theocracy=%s changes how many participating monks expend faith', enabled => {
    const s = fixture(), a = spawn(s, 'monk', 1, 50), b = spawn(s, 'monk', 1, 50, 51), target = spawn(s, 'militia', 2, 54);
    if (enabled) research(s, 1, 'theocracy', [{ resource: 'theocracy', operation: 'set', amount: 1 }]);
    order(s, a, target); order(s, b, target); until(s, () => target.owner === 1);
    expect([a, b].filter(e => (e.faith ?? 100) < 1)).toHaveLength(enabled ? 1 : 2);
  });

  it('Illumination recharges faster, Block Printing converts at extended reach, Herbal Medicine heals garrison HP', () => {
    const s = fixture(), monk = spawn(s, 'monk', 1, 50), target = spawn(s, 'militia', 2, 61);
    s.rules.units.monk.lineOfSight = 20;
    research(s, 1, 'block-printing', [{ unit: 'monk', attribute: 'range', operation: 'add', amount: 3 }]);
    order(s, monk, target); until(s, () => target.owner === 1); expect(monk.position.x).toBe(50);
    run(s, 100); const normal = monk.faith!;
    research(s, 1, 'illumination', [{ unit: 'monk', attribute: 'reloadSeconds', operation: 'multiply', amount: 1.875 }]);
    const before = monk.faith!; run(s, 100); expect(monk.faith! - before).toBeCloseTo(normal * 1.875);
    const tc = s.entities.find(e => e.kind === 'town-center' && e.owner === 1)!;
    const wounded = spawn(s, 'villager', 1, tc.position.x + 2, tc.position.y); wounded.hp = 10;
    order(s, wounded, tc); until(s, () => !!tc.garrison?.length);
    research(s, 1, 'herbal-medicine', [{ unit: 'town-center', attribute: 'garrisonHealRate', operation: 'multiply', amount: 6 }]);
    const hp = wounded.hp; run(s, 100); expect(wounded.hp - hp).toBe(3);
  });
});
