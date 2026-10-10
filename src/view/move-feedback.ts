import { isUnit } from '../sim/data';
import { isCarcass, resolveUnitOrder, unitRulesForEntity } from '../sim/game';
import type { Command, Entity, GameState } from '../sim/types';

/** Read the same pure per-unit resolution as the sim, before applying the
 * planned command. An 'order' can also gather, garrison or clear tower targets.
 */
export function hasGroundMove(game: GameState, command: Command, selection: readonly Entity[]): boolean {
  if (command.kind !== 'order') return false;
  const ids = new Set(command.entityIds);
  const target = command.targetId === undefined ? undefined
    : game.entities.find(e => e.id === command.targetId && (!e.dead || isCarcass(e)));
  return selection.some(e => ids.has(e.id) && e.owner === command.player && !e.dead
    && isUnit(e.kind) && unitRulesForEntity(game, e).speed > 0
    && resolveUnitOrder(game, e, command.target, target).kind === 'move');
}
