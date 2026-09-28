import type { DeepReadonly, Entity } from './types';

/** Occupied cargo slots, excluding the outer carrier itself. The owned TC
 * manual p8 counts a transported ram and every passenger inside it (#251). */
export function garrisonCount(carrier: DeepReadonly<Entity>): number {
  return (carrier.garrison ?? []).reduce((count, passenger) => count + 1 + garrisonCount(passenger), 0);
}
