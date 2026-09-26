/**
 * What a click takes, as rules that can be tested without a camera.
 *
 * The camera and the canvas decide what "on screen" means; this decides what
 * to do with the answer.
 */
import { isAnimal, isBuilding, isUnit, NODE_OF_RESOURCE } from '../sim/data';
import type { DeepReadonly, Entity, PlayerId, Point, ReadonlyGameState, UnitKind } from '../sim/types';

/** The same knowledge boundary as rendering: owned/visible live entities, or
 * last-seen Gaia snapshots. Unexplored resources must not leak via a cursor.
 * Snapshot positions must not be interpolated through a hidden live entity.
 */
export function* contextTargets(state: ReadonlyGameState, player: PlayerId, reveal = false): Generator<{
  entity: DeepReadonly<Entity>; remembered: boolean;
}> {
  const visibility = state.visibility[player];
  const visible = (at: Point) => visibility.visible[Math.floor(at.y) * state.width + Math.floor(at.x)] === 1;
  const live = new Set<number>();
  for (const entity of state.entities) {
    if (!reveal && entity.owner !== player && !visible(entity.position)) continue;
    live.add(entity.id);
    yield { entity, remembered: false };
  }
  if (reveal) return;
  for (const memory of Object.values(visibility.memory)) {
    if (memory.owner !== 0 || live.has(memory.id) || visible(memory)) continue;
    const rule = memory.kind === 'relic' ? { radius: 0.5 } : memory.kind === 'resource'
      ? state.rules.nodes[memory.node ?? NODE_OF_RESOURCE[memory.resource ?? 'food']]
      : isBuilding(memory.kind) ? state.rules.buildings[memory.kind] : state.rules.units[memory.kind as UnitKind];
    yield { remembered: true, entity: {
      id: memory.id, kind: memory.kind, owner: 0, position: { x: memory.x, y: memory.y },
      hp: memory.hp, maxHp: memory.maxHp, radius: rule.radius,
      activity: 'idle', order: { kind: 'idle' }, resourceKind: memory.resource,
      node: memory.node, amount: memory.amount, buildProgress: memory.buildProgress,
      ...(isAnimal(memory.kind) && memory.hp <= 0 ? { dead: true } : {}),
    } };
  }
}

/**
 * Every unit of the same kind as `target` that its owner can presently see on
 * screen. AoE2's double-click rule says "on screen" rather than "on the map"
 * because it is a selection you could have made with a drag — so a unit of the
 * same kind across the map is not in it (issue #6).
 *
 * Only the player's own units group this way: a double-click on somebody
 * else's soldier, or on a building or a tree, takes just that one thing.
 */
export function sameKindOnScreen(
  entities: readonly Entity[],
  target: Entity,
  player: PlayerId,
  onScreen: (point: Point) => boolean,
): Entity[] {
  if (target.owner !== player || !isUnit(target.kind)) return [target];
  const same = entities.filter(entity => !entity.dead
    && entity.owner === player
    && entity.kind === target.kind
    && onScreen(entity.position));
  // The one that was clicked is always in it, even if the camera has moved
  // since and it is a pixel outside.
  return same.some(entity => entity.id === target.id) ? same : [target, ...same];
}
