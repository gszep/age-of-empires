import { describe, expect, it } from 'vitest';
import { FALLBACK_RULES, isBuilding } from '../sim/data';
import { addNode, applyCommand, createGame, planContextCommand, resolveUnitOrder } from '../sim/game';
import { checksumState } from '../sim/checksum';
import type { BuildingKind, Entity, EntityKind, GameState, UnitKind } from '../sim/types';
import { contextCursor, cursorCss } from './cursors';
import { contextTargets } from './selection';

function add(state: GameState, kind: EntityKind, owner: Entity['owner'], extra: Partial<Entity> = {}): Entity {
  const rule = isBuilding(kind) ? state.rules.buildings[kind as BuildingKind] : state.rules.units[kind as UnitKind];
  const entity: Entity = { id: state.nextId++, kind, owner, position: { x: 40.5, y: 50.5 },
    hp: rule.hp, maxHp: rule.hp, radius: rule.radius, activity: 'idle', order: { kind: 'idle' }, ...extra };
  state.entities.push(entity);
  return entity;
}

describe('owned context cursor classification', () => {
  it('uses remembered Gaia metadata rather than exposing unseen live resource or animal state', () => {
    const state = createGame(54);
    const gold = addNode(state, 'gold', { x: 100.5, y: 100.5 });
    const sheep = add(state, 'sheep', 0, { position: { x: 101.5, y: 100.5 }, amount: 100, resourceKind: 'food' });
    state.visibility[1].visible.fill(0);
    state.visibility[1].memory = {};
    expect([...contextTargets(state, 1)].some(c => c.entity.id === gold.id)).toBe(false);
    state.visibility[1].memory[sheep.id] = { id: sheep.id, kind: 'sheep', owner: 0,
      x: 99.5, y: 100.5, hp: sheep.hp, maxHp: sheep.maxHp, resource: 'food', amount: 100, lastSeenAt: 0 };
    sheep.dead = true; sheep.hp = 0; sheep.amount = 12;
    const remembered = [...contextTargets(state, 1)].find(c => c.entity.id === sheep.id)!;
    expect(remembered.remembered).toBe(true);
    expect(remembered.entity.position).toEqual({ x: 99.5, y: 100.5 });
    expect(remembered.entity.amount).toBe(100);
    expect(remembered.entity.dead).toBeUndefined();
    state.entities = state.entities.filter(e => e.id !== sheep.id);
    expect([...contextTargets(state, 1)].some(c => c.entity.id === sheep.id)).toBe(true);
    expect([...contextTargets(state, 1, true)].some(c => c.entity.id === gold.id)).toBe(true);
    const worker = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
    const target = remembered.entity as Entity;
    const command = planContextCommand(state, 1, [worker], target.position, target)!;
    expect(applyCommand(state, command).ok).toBe(true);
    expect(worker.order).toEqual({ kind: 'move', target: target.position });
  });

  it('uses the same pure plan as public unit commands for economy and interaction targets', () => {
    const state = createGame(51);
    const worker = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
    const monk = add(state, 'monk', 1), soldier = add(state, 'militia', 1), ship = add(state, 'fishing-ship', 1);
    const tree = addNode(state, 'tree', { x: 40.5, y: 50.5 });
    const gold = addNode(state, 'gold', { x: 42.5, y: 50.5 });
    const stone = addNode(state, 'stone', { x: 44.5, y: 50.5 });
    const food = addNode(state, 'berries', { x: 46.5, y: 50.5 });
    const fish = addNode(state, 'fish', { x: 48.5, y: 50.5 });
    const sheep = add(state, 'sheep', 1, { amount: 100, resourceKind: 'food' });
    const deer = add(state, 'deer', 0, { amount: 100, resourceKind: 'food' });
    const carcass = add(state, 'deer', 0, { dead: true, hp: 0, amount: 100, resourceKind: 'food' });
    const foundation = add(state, 'house', 1, { buildProgress: 0.5, hp: 1 });
    const damaged = add(state, 'house', 1, { hp: 1 });
    const wounded = add(state, 'villager', 1, { hp: 1 });
    const enemy = add(state, 'militia', 2);
    const tc = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
    const transport = add(state, 'transport-ship', 1);
    const ram = add(state, 'battering-ram', 1);
    const cart = add(state, 'trade-cart', 1), market = add(state, 'market', 2);
    const cases = [
      [worker, tree, 'chop', 'gather'], [worker, gold, 'mine_gold', 'gather'],
      [worker, stone, 'mine_stone', 'gather'], [worker, food, 'gather', 'gather'],
      [worker, fish, 'fish', 'gather'], [ship, fish, 'fish', 'gather'],
      [ship, food, 'default', 'move'], [soldier, tree, 'default', 'move'],
      [worker, sheep, 'gather_meat', 'gather'], [worker, carcass, 'gather_meat', 'gather'],
      [worker, deer, 'hunt', 'attack'], [worker, foundation, 'build', 'build'],
      [worker, damaged, 'repair', 'repair'], [monk, wounded, 'heal', 'heal'],
      [monk, enemy, 'convert', 'convert'], [soldier, enemy, 'attack', 'attack'],
      [worker, tc, 'garrison', 'garrison'], [worker, transport, 'board', 'garrison'],
      [worker, ram, 'garrison', 'garrison'],
      [cart, market, 'action', 'trade'],
    ] as const;
    for (const [actor, target, cursor, kind] of cases) {
      const before = checksumState(state);
      expect(contextCursor(state, 1, [actor], target.position, target)).toBe(cursor);
      const expected = resolveUnitOrder(state, actor, target.position, target);
      expect(expected.kind).toBe(kind);
      expect(checksumState(state)).toBe(before);
      const command = planContextCommand(state, 1, [actor], target.position, target)!;
      expect(applyCommand(state, command).ok).toBe(true);
      expect(actor.order).toEqual(expected);
    }
  });

  it('does not reserve farms or erase a carrying worker’s continuation while hovering', () => {
    const state = createGame(52);
    const worker = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
    const farm = add(state, 'farm', 1, { amount: 175, resourceKind: 'food' });
    worker.carrying = { kind: 'wood', amount: 10, task: 'lumberjack' };
    worker.gatherProgress = 0.3;
    worker.fishingPosition = { x: 4, y: 5 };
    const before = JSON.stringify(state);
    for (let i = 0; i < 5; i++) expect(contextCursor(state, 1, [worker], farm.position, farm)).toBe('gather');
    expect(JSON.stringify(state)).toBe(before);
    const rivalWorker = add(state, 'villager', 1, { order: { kind: 'gather', targetId: farm.id } });
    expect(contextCursor(state, 1, [worker], farm.position, farm)).toBe('default');
    expect(rivalWorker.order.kind).toBe('gather');
  });

  it('shares building rally/attack dispatch and respects selection, replay and explicit modes', () => {
    const state = createGame(53);
    const tc = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
    const enemy = add(state, 'militia', 2);
    expect(contextCursor(state, 1, [tc], { x: 50, y: 50 })).toBe('flag');
    expect(planContextCommand(state, 1, [tc], { x: 50, y: 50 })?.kind).toBe('rally');
    // A shooting producer targets enemies; it does not plant a rally flag there.
    expect(contextCursor(state, 1, [tc], enemy.position, enemy)).toBe(FALLBACK_RULES.buildings['town-center'].attack ? 'attack' : 'flag');
    expect(contextCursor(state, 1, [], enemy.position, enemy)).toBe('default');
    expect(contextCursor(state, 1, [enemy], enemy.position, enemy)).toBe('default');
    expect(contextCursor(state, 1, [tc], enemy.position, enemy, { replay: true, build: true })).toBe('default');
    expect(contextCursor(state, 1, [], enemy.position, enemy, { unload: true })).toBe('unboard');
    expect(contextCursor(state, 1, [], enemy.position, enemy, { build: true })).toBe('build');
    expect(contextCursor(state, 1, [], enemy.position, enemy, { repair: true })).toBe('not-allowed');
  });

  it('uses owned hotspots and falls back cleanly without a cursor manifest', () => {
    const ui = { base: '/owned/', layouts: {}, materials: {}, icons: {}, cursors: {
      flag: { image: 'cursors/flag32x32.cur', size: [48, 48] as [number, number], hotspot: [9, 43] as [number, number] },
    } };
    expect(cursorCss(ui, 'flag')).toBe('url("/owned/cursors/flag32x32.cur") 9 43, default');
    expect(cursorCss(ui, 'attack')).toBe('default');
    expect(cursorCss(undefined, 'chop')).toBe('default');
    expect(cursorCss(undefined, 'not-allowed')).toBe('not-allowed');
  });
});
