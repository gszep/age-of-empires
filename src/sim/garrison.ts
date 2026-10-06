import type { DeepReadonly, Entity } from './types';
import { isBuilding } from './data';

/** Public occupancy indicator, not a passenger/relic count. Carried relics
 * change a monk's art; only stored building relics raise a garrison flag. */
export function hasGarrisonFlag(entity: DeepReadonly<Entity>): boolean {
  return !!entity.garrison?.length || (isBuilding(entity.kind) && !!entity.relics?.length);
}

/** Research follows each entity's owner even inside an enemy mobile carrier,
 * including infantry inside a transported ram. */
export function* entitiesWithGarrison(entities: Entity[]): Generator<Entity> {
  for (const entity of entities) {
    yield entity;
    if (entity.garrison?.length) yield* entitiesWithGarrison(entity.garrison);
  }
}

/** Occupied cargo slots, excluding the outer carrier itself. The owned TC
 * manual p8 counts a transported ram and every passenger inside it (#251). */
export function garrisonCount(carrier: DeepReadonly<Entity>): number {
  return (carrier.garrison ?? []).reduce((count, passenger) => count + 1 + garrisonCount(passenger), 0);
}
