import { describe, expect, it } from 'vitest';
import { addNode, applyCommand, createGame, planContextCommand, resolveUnitOrder } from '../sim/game';
import { synchronizationHash } from '../shared/checksum';
import type { Entity } from '../sim/types';
import { hasGroundMove } from './move-feedback';

describe('move feedback uses actual planned unit orders', () => {
  it('uses the public command target filter for remembered, vanished Gaia', () => {
    const game = createGame(49);
    const worker = game.entities.find(e => e.kind === 'villager' && e.owner === 1)!;
    const tree = addNode(game, 'tree', { x: 35, y: 35 });
    tree.dead = true;
    tree.amount = 0; // An exhausted remembered node, not a still-gatherable carcass.
    game.visibility[1].memory[tree.id] = { id: tree.id, kind: tree.kind, owner: 0,
      x: 35, y: 35, hp: 1, maxHp: 1, lastSeenAt: 0 };
    const command = planContextCommand(game, 1, [worker], tree.position, tree)!;
    expect(hasGroundMove(game, command, [worker])).toBe(true);
    expect(applyCommand(game, command).ok).toBe(true);
    expect(worker.order.kind).toBe('move');
  });
  for (const action of ['move', 'queued move', 'garrison', 'tower clear', 'attack', 'gather'] as const) {
    it(action, () => {
      const game = createGame(49);
      const worker = game.entities.find(e => e.kind === 'villager' && e.owner === 1)!;
      const home = game.entities.find(e => e.kind === 'town-center' && e.owner === 1)!;
      const enemy = game.entities.find(e => e.kind === 'villager' && e.owner === 2)!;
      const towerRule = game.rules.buildings['watch-tower'];
      const tower: Entity = { id: game.nextId++, kind: 'watch-tower', owner: 1,
        position: { x: 30, y: 30 }, hp: towerRule.hp, maxHp: towerRule.hp, radius: towerRule.radius,
        activity: 'idle', order: { kind: 'attack', targetId: enemy.id } };
      game.entities.push(tower);
      const target = action === 'garrison' ? home : action === 'attack' ? enemy
        : action === 'gather' ? addNode(game, 'tree', { x: 35, y: 35 }) : undefined;
      const selection = action === 'tower clear' ? [tower] : [worker];
      const point = target?.position ?? { x: 40, y: 40 };
      const command = planContextCommand(game, 1, selection, point, target, action === 'queued move');
      expect(command?.kind).toBe('order');
      const before = synchronizationHash(game);
      expect(hasGroundMove(game, command!, selection)).toBe(action === 'move' || action === 'queued move');
      expect(synchronizationHash(game)).toBe(before);
      if (action !== 'tower clear') expect(resolveUnitOrder(game, worker, point, target).kind)
        .toBe(action === 'queued move' ? 'move' : action);
      expect(applyCommand(game, command!).ok).toBe(true);
      if (action === 'tower clear') expect(tower.order.kind).toBe('idle');
    });
  }
});
