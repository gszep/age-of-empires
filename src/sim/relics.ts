import { isUnit, TICK_SECONDS } from './data';
import { buildingRulesFor, playerAttributeFor } from './rules';
import type { Entity, GameState, Order, Point } from './types';

/** Owned Gaia DAT 285. Its identity survives every transfer and save. */
export function addRelic(state: GameState, position: Point): Entity {
  const relic: Entity = { id: state.nextId++, kind: 'relic', owner: 0, position: { ...position },
    hp: 30, maxHp: 30, radius: 0.5, activity: 'idle', order: { kind: 'idle' } };
  state.entities.push(relic);
  return relic;
}

export function relicOrder(state: GameState, monk: Entity, target?: Entity): Order | undefined {
  if (monk.kind !== 'monk' || !target || target.dead) return;
  if (!monk.relics?.length && target.kind === 'relic') return { kind: 'relic', targetId: target.id };
  if (monk.relics?.length && target.kind === 'monastery' && target.owner === monk.owner
    && target.buildProgress === undefined && (target.relics?.length ?? 0)
      < (buildingRulesFor(state, target.owner, 'monastery').garrison?.capacity ?? 10)) {
    return { kind: 'relic', targetId: target.id };
  }
}

/** Movement resolves contact before transferring; no duplicate pickup on ties. */
export function transferRelic(state: GameState, monk: Entity, target: Entity): void {
  if (!relicOrder(state, monk, target)) return;
  if (target.kind === 'relic') {
    state.entities = state.entities.filter(e => e.id !== target.id);
    monk.relics = [target];
  } else {
    (target.relics ??= []).push(...monk.relics!);
    monk.relics = undefined;
  }
}

export function releaseRelics(state: GameState, holder: Entity, at = holder.position): void {
  for (const relic of holder.relics ?? []) {
    relic.position = { ...at };
    relic.owner = 0;
    state.entities.push(relic);
  }
  holder.relics = undefined;
  if (isUnit(holder.kind)) {
    holder.order = { kind: 'idle' };
    holder.orderQueue = undefined;
    holder.activity = 'idle';
    holder.path = undefined;
    holder.pathGoal = undefined;
  }
}

/** XS resource191 = 30 gold/minute for Britons; fractions persist in saves. */
export function updateRelicIncome(state: GameState, monastery: Entity): void {
  if (monastery.owner === 0 || !monastery.relics?.length) return;
  const rate = playerAttributeFor(state, monastery.owner, 'relicRate') ?? 30;
  const total = (monastery.relicGoldProgress ?? 0) + rate * monastery.relics.length * TICK_SECONDS / 60;
  const earned = Math.floor(total + 1e-9);
  state.players[monastery.owner].gold += earned;
  monastery.relicGoldProgress = Math.max(0, total - earned);
}
