import { isAnimal, isUnit } from '../sim/data';
import { rulesForPlayer } from '../sim/civilizations';
import { isRepairable, planContextCommand, resolveUnitOrder } from '../sim/game';
import type { Entity, GameState, PlayerId, Point, ReadonlyGameState, DeepReadonly } from '../sim/types';
import type { UiAssets } from './assets';

export type ContextCursor = 'default' | 'attack' | 'hunt' | 'chop' | 'mine_gold' | 'mine_stone'
  | 'gather' | 'gather_meat' | 'fish' | 'build' | 'repair' | 'heal' | 'convert'
  | 'garrison' | 'board' | 'unboard' | 'flag' | 'action' | 'not-allowed';

/** Predict exactly the current context command; never mutate/reserve its target.
 * Mixed selections use the first unit, matching the command dispatcher order.
 */
export function contextCursor(
  state: ReadonlyGameState, player: PlayerId, selection: readonly DeepReadonly<Entity>[], point: Point,
  target?: DeepReadonly<Entity>, mode: { build?: boolean; repair?: boolean; unload?: boolean; replay?: boolean } = {},
): ContextCursor {
  if (mode.replay) return 'default';
  if (mode.build) return 'build';
  if (mode.unload) return 'unboard';
  // The sim classification helpers below are pure; the view only reads them.
  const game = state as GameState, selected = selection as Entity[], entity = target as Entity | undefined;
  if (mode.repair) return entity && selected.some(e => isRepairable(game, e, entity)) ? 'repair' : 'not-allowed';
  const command = planContextCommand(game, player, selected, point, entity);
  if (!command) return 'default';
  if (command.kind === 'rally') return 'flag';
  if (command.kind !== 'order') return 'default';
  const first = selected.find(e => command.entityIds.includes(e.id));
  if (!first) return 'default';
  const targetEntity = command.targetId === entity?.id ? entity : undefined;
  if (!isUnit(first.kind)) return targetEntity ? 'attack' : 'default';
  const order = resolveUnitOrder(game, first, point, targetEntity);
  switch (order.kind) {
    case 'attack': return first.kind === 'villager' && targetEntity && isAnimal(targetEntity.kind) ? 'hunt' : 'attack';
    case 'build': return 'build';
    case 'repair': return 'repair';
    case 'heal': return 'heal';
    case 'convert': return 'convert';
    case 'trade': return 'action';
    case 'relic': return targetEntity?.kind === 'monastery' ? 'garrison' : 'action';
    case 'cross-wall': return 'unboard';
    case 'garrison': return targetEntity && isUnit(targetEntity.kind)
      && rulesForPlayer(game, targetEntity.owner).units[targetEntity.kind].transportCapacity ? 'board' : 'garrison';
    case 'gather': {
      const node = order.targetId === targetEntity?.id ? targetEntity : game.entities.find(e => e.id === order.targetId);
      if (node && isAnimal(node.kind)) return 'gather_meat';
      if (node?.kind === 'fish-trap' || node?.node === 'fish' || node?.node === 'shore-fish') return 'fish';
      return node?.resourceKind === 'wood' ? 'chop' : node?.resourceKind === 'gold' ? 'mine_gold'
        : node?.resourceKind === 'stone' ? 'mine_stone' : 'gather';
    }
    default: return 'default';
  }
}

export function cursorCss(ui: UiAssets | undefined, cursor: ContextCursor): string {
  if (cursor === 'not-allowed') return 'not-allowed';
  const asset = ui?.cursors?.[cursor];
  return asset ? `url("${ui!.base}${asset.image}") ${asset.hotspot[0]} ${asset.hotspot[1]}, default` : 'default';
}
