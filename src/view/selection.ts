/**
 * What a click takes, as rules that can be tested without a camera.
 *
 * The camera and the canvas decide what "on screen" means; this decides what
 * to do with the answer.
 */
import { isUnit } from '../sim/data';
import type { Entity, PlayerId, Point } from '../sim/types';

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
