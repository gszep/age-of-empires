import { isUnit } from './data';
import { isGateKind } from './buildings';
import { rulesForPlayer } from './civilizations';
import type { GameState } from './types';

/** Inferred approach range, retained from the former presentation rule. */
export const GATE_OPEN_RANGE = 2.5;

/** Resolve all gates before movement, independently of entity iteration order.
 * DAT closed/open transforms change obstruction for everybody. Enemy contact
 * with the doorway takes precedence over friendly approach (#133). The contact
 * boundary and instantaneous tick transition remain inferred engine semantics.
 */
export function updateGates(state: GameState): void {
  const gates = state.entities.filter(e => !e.dead && isGateKind(e.kind));
  if (!gates.length) return;
  const units = state.entities.filter(e => !e.dead && e.hp > 0 && isUnit(e.kind));
  for (const gate of gates) {
    if (gate.buildProgress !== undefined || gate.hp <= 0) {
      gate.gateState = 'closed';
      continue;
    }
    const half = gate.footprint ?? { x: gate.radius, y: gate.radius };
    const rules = gate.convertedBuildingRules ?? rulesForPlayer(state, gate.owner).buildings[gate.kind as keyof typeof state.rules.buildings];
    const opening = rules.gateOpening ?? Math.max(half.x, half.y);
    const door = half.x > half.y ? { x: opening, y: half.y } : { x: half.x, y: opening };
    let friendly = false, enemy = false;
    for (const unit of units) {
      const dx = Math.abs(unit.position.x - gate.position.x);
      const dy = Math.abs(unit.position.y - gate.position.y);
      if (unit.owner === gate.owner && gate.owner !== 0) {
        if (dx <= GATE_OPEN_RANGE && dy <= GATE_OPEN_RANGE) friendly = true;
      } else if (unit.owner !== 0 && dx < door.x + unit.radius && dy < door.y + unit.radius) {
        enemy = true;
      }
    }
    gate.gateState = enemy ? 'blocked' : friendly ? 'open' : 'closed';
  }
}
