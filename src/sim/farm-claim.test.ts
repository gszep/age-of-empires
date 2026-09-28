import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FALLBACK_RULES, rulesFromManifest, type GameRules } from './data';
import { addNode, applyCommand, createGame, resolveUnitOrder, stepGame } from './game';
import { updateVisibility } from './visibility';
import { synchronizationHash } from '../shared/checksum';
import { contextCursor } from '../view/cursors';
import { contextTargets } from '../view/selection';
import type { Entity, GameState, PlayerId } from './types';

const modes: [string, GameRules][] = [['fallback', FALLBACK_RULES]];
if (existsSync('public/imported/aoe2/manifest.json')) {
  const manifest = JSON.parse(readFileSync('public/imported/aoe2/manifest.json', 'utf8'));
  modes.push(['britons', rulesFromManifest(manifest)]);
  if (manifest.civilizations?.franks) modes.push(['franks', rulesFromManifest(manifest.civilizations.franks)]);
}
function fixture(rules: GameRules) {
  const state = createGame(156, rules);
  state.terrain.fill(0); state.elevation.fill(0);
  state.entities = state.entities.filter(e => e.kind === 'town-center' || e.kind === 'villager');
  const home = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
  const workers = state.entities.filter(e => e.owner === 1 && e.kind === 'villager');
  const enemy = state.entities.find(e => e.owner === 2 && e.kind === 'villager')!;
  const rule = rules.buildings.farm;
  const farm: Entity = { id: state.nextId++, kind: 'farm', owner: 2,
    // Outside the TC's attack range: measure preservation during capture,
    // without the old enemy ownership provoking unrelated defensive arrows.
    position: { x: home.position.x + 12, y: home.position.y },
    hp: rule.hp - 37, maxHp: rule.hp, radius: rule.radius, resourceKind: 'food', amount: 73,
    activity: 'idle', order: { kind: 'idle' } };
  state.entities.push(farm);
  workers.forEach((w, i) => { w.position = { x: farm.position.x, y: farm.position.y + i * 0.6 }; });
  updateVisibility(state);
  return { state, home, workers, enemy, farm };
}
function order(state: GameState, player: PlayerId, workers: Entity[], farm: Entity, queue = false) {
  return applyCommand(state, { kind: 'order', player, entityIds: workers.map(w => w.id),
    target: farm.position, targetId: farm.id, queue });
}
const claimants = (state: GameState, farm: Entity) => state.entities.filter(e => !e.dead
  && e.order.kind === 'gather' && e.order.targetId === farm.id);

describe.each(modes)('%s abandoned farm capture (#156)', (_mode, rules) => {
  it('claims on reaching work, preserves crop/HP, and banks food only for the new owner', () => {
    const { state, home, farm, workers } = fixture(rules);
    const worker = workers[0]; worker.position = { x: home.position.x - 4, y: home.position.y };
    const before = JSON.stringify(state);
    expect(contextCursor(state, 1, [worker], farm.position, farm)).toBe('gather');
    expect(JSON.stringify(state)).toBe(before);
    expect(order(state, 1, [worker], farm).ok).toBe(true);
    expect(farm.owner).toBe(2);
    stepGame(state);
    expect(farm.owner).toBe(2); // no remote capture
    const clone = JSON.parse(JSON.stringify(state)) as GameState;
    const food = [state.players[1].food, state.players[2].food];
    for (let i = 0; i < 2000 && state.players[1].food === food[0]; i++) { stepGame(state); stepGame(clone); }
    expect(farm.owner).toBe(1);
    expect(farm.hp).toBe(rules.buildings.farm.hp - 37);
    expect(farm.maxHp).toBe(rules.buildings.farm.hp);
    expect(farm.amount).toBeLessThan(73);
    expect(73 - farm.amount!).toBeCloseTo(state.players[1].food - food[0] + (worker.carrying?.amount ?? 0));
    expect(state.players[1].food).toBeGreaterThan(food[0]);
    expect(state.players[2].food).toBe(food[1]);
    expect(synchronizationHash(state)).toBe(synchronizationHash(clone));
  });

  it('a group reserves just one foreign farm without surplus villagers attacking it', () => {
    const { state, farm, workers } = fixture(rules);
    expect(order(state, 1, workers, farm).ok).toBe(true);
    expect(claimants(state, farm)).toHaveLength(1);
    expect(workers.every(w => w.order.kind !== 'attack')).toBe(true);
    const hp = farm.hp;
    for (let i = 0; i < 200; i++) stepGame(state);
    expect(farm.owner).toBe(1);
    expect(farm.hp).toBe(hp);
    expect(claimants(state, farm)).toHaveLength(1);
  });

  it.each(['stop', 'delete'] as const)('an incumbent blocks capture even while banking, until %s releases it', action => {
    const { state, farm, workers, enemy } = fixture(rules);
    enemy.position = { x: farm.position.x + 10, y: farm.position.y };
    expect(order(state, 2, [enemy], farm).ok).toBe(true);
    enemy.carrying = { kind: 'food', amount: 10 }; enemy.activity = 'carrying';
    expect(resolveUnitOrder(state, workers[0], farm.position, farm).kind).toBe('attack');
    expect(applyCommand(state, { kind: action, player: 2, entityIds: [enemy.id] }).ok).toBe(true);
    expect(order(state, 1, [workers[0]], farm).ok).toBe(true);
    expect(workers[0].order.kind).toBe('gather');
    stepGame(state);
    expect(farm.owner).toBe(1);
  });

  it('queued orders recheck occupancy, and competing owners cannot both reserve the crop', () => {
    const { state, farm, workers, enemy } = fixture(rules);
    expect(applyCommand(state, { kind: 'order', player: 1, entityIds: [workers[0].id], target: { ...workers[0].position } }).ok).toBe(true);
    expect(order(state, 1, [workers[0]], farm, true).ok).toBe(true);
    expect(claimants(state, farm)).toHaveLength(0);
    expect(order(state, 2, [enemy], farm).ok).toBe(true);
    for (let i = 0; i < 3; i++) stepGame(state);
    expect(claimants(state, farm).map(e => e.id)).toEqual([enemy.id]);
    expect(farm.owner).toBe(2);
  });

  it('reseeds a depleted captured farm at the new owner’s expense', () => {
    const { state, home, farm, workers } = fixture(rules);
    const millRule = rules.buildings.mill;
    state.entities.push({ id: state.nextId++, kind: 'mill', owner: 1,
      position: { x: home.position.x, y: home.position.y + 6 }, hp: millRule.hp, maxHp: millRule.hp,
      radius: millRule.radius, activity: 'idle', order: { kind: 'idle' } });
    state.players[1].autoReseedFarms = true;
    const wood = [state.players[1].wood, state.players[2].wood];
    farm.amount = 1;
    expect(order(state, 1, [workers[0]], farm).ok).toBe(true);
    workers[0].gatherProgress = 0.99;
    let replacement: Entity | undefined;
    for (let i = 0; i < 100 && !replacement; i++) {
      stepGame(state);
      replacement = state.entities.find(e => e.kind === 'farm' && e.id !== farm.id);
    }
    expect(farm.dead).toBe(true);
    expect(replacement?.owner).toBe(1);
    expect(replacement?.position).toEqual(farm.position);
    expect(replacement?.buildProgress).toBeDefined();
    expect(state.players[1].wood).toBe(wood[0] - rules.buildings.farm.cost.wood);
    expect(state.players[2].wood).toBe(wood[1]);
  });

  it('does not silently capture an enemy farm through automatic food continuation', () => {
    const { state, farm, workers } = fixture(rules);
    const berry = addNode(state, 'berries', { x: farm.position.x + 3, y: farm.position.y });
    berry.amount = 0;
    workers[0].order = { kind: 'gather', targetId: berry.id };
    workers[0].lastResource = 'food';
    stepGame(state);
    expect(workers[0].order.kind).toBe('idle');
    expect(farm.owner).toBe(2);
    expect(order(state, 1, [workers[0]], farm).ok).toBe(true);
    stepGame(state);
    expect(farm.owner).toBe(1);
  });

  it('does not offer unfinished, exhausted or hidden enemy farms as gather targets', () => {
    const { state, farm, workers } = fixture(rules);
    farm.buildProgress = 0.5;
    expect(resolveUnitOrder(state, workers[0], farm.position, farm).kind).toBe('attack');
    farm.buildProgress = undefined; farm.amount = 0;
    expect(resolveUnitOrder(state, workers[0], farm.position, farm).kind).toBe('attack');
    farm.amount = 73;
    state.visibility[1].visible.fill(0); state.visibility[1].explored.fill(0); state.visibility[1].memory = {};
    expect([...contextTargets(state, 1)].some(t => t.entity.id === farm.id)).toBe(false);
    expect(farm.owner).toBe(2);
  });
});
