/** Observation-only finishing policy adapted from Promisory/finaling.per:
 * ten military units, known enemy buildings, and the lower four-trebuchet cap.
 * DAT331 costs200W/200G at Castle82; its default castle costs650S. Those are
 * conservative public baseline budgets, not a private rules query.
 */
import { isBuilding } from './data';
import { distance } from './nav';
import type { PlayerObservation } from '../protocol/types';
import type { Command } from './types';

export const CASTLE_STONE = 650;
export const TREBUCHET_BUDGET = 200;
export const TREBUCHET_LIMIT = 4;

/** Example policy, not a reproduction of native tactical AI: earliest opposing
 * announcement first, entity id breaks ties independently of array order. */
export function enemyWonderDeadline(observation: PlayerObservation) {
  return observation.wonderCountdowns?.filter(w => w.owner !== observation.player)
    .sort((a, b) => a.remainingSeconds - b.remainingSeconds || a.entityId - b.entityId)[0];
}

export function siegePlan(observation: PlayerObservation, army: number) {
  const deadline = enemyWonderDeadline(observation);
  const mine = observation.entities.filter(e => e.owner === observation.player && e.hp > 0);
  const castles = mine.filter(e => e.kind === 'castle').sort((a, b) => a.id - b.id);
  const engines = mine.filter(e => e.kind === 'trebuchet');
  const targets = [...observation.entities, ...observation.memory]
    .filter(e => e.hp > 0 && e.owner !== 0 && e.owner !== observation.player && isBuilding(e.kind));
  const active = observation.age >= 2 && (deadline !== undefined || (army >= 10 && targets.length > 0));
  const count = engines.length + castles.filter(e => e.training?.kind === 'trebuchet').length;
  const saving = active && observation.age >= 3 && count < TREBUCHET_LIMIT;
  const producer = saving ? castles.find(e => e.buildProgress === undefined && !e.training && !e.researching) : undefined;
  const orders: Command[] = [];
  for (const engine of engines) {
    if (engine.order !== 'idle' && engine.order !== 'move') continue;
    if (deadline) {
      orders.push({ kind: 'order', player: observation.player, entityIds: [engine.id],
        target: { x: deadline.x, y: deadline.y },
        ...(observation.entities.some(e => e.id === deadline.entityId) ? { targetId: deadline.entityId } : {}) });
      continue;
    }
    const visible = new Set(observation.entities.map(e => e.id));
    const target = targets.filter(e => engine.order === 'idle' || visible.has(e.id))
      .sort((a, b) => Number(!visible.has(a.id)) - Number(!visible.has(b.id))
        || distance(engine, a) - distance(engine, b) || a.id - b.id)[0];
    if (!target) continue;
    // A fog memory is a destination, never an attack on a hidden live entity.
    // Once visible, a packed right-click approaches and sets up automatically.
    orders.push({ kind: 'order', player: observation.player, entityIds: [engine.id],
      target: { x: target.x, y: target.y }, ...(visible.has(target.id) ? { targetId: target.id } : {}) });
  }
  return { needsCastle: active && !castles.length,
    gatherStone: active && !castles.length && observation.stone < CASTLE_STONE,
    reserve: saving ? TREBUCHET_BUDGET : 0, producer, orders };
}
