import { TICK_SECONDS } from './data';
import { playerAttributeFor, unitRulesForEntity } from './rules';
import type { Entity, GameState } from './types';

export function conversionWindow(state: GameState, monk: Entity, target: Entity) {
  const base = unitRulesForEntity(state, monk).convert!;
  return { ...base,
    minSeconds: base.minSeconds + (playerAttributeFor(state, target.owner, 'convertResistMinAdj') ?? 0),
    maxSeconds: base.maxSeconds + (playerAttributeFor(state, target.owner, 'convertResistMaxAdj') ?? 0),
  };
}

/** Monk reload_time is recharge: 1.6 faith points/sec; Illumination multiplies it. */
export function rechargeFaith(state: GameState, monk: Entity): void {
  if (monk.faith === undefined || monk.faith >= 100) return;
  monk.faith = Math.min(100, monk.faith + (unitRulesForEntity(state, monk).attackReloadSeconds || 1.6) * TICK_SECONDS);
}

export function spendConversionFaith(state: GameState, monk: Entity, target: Entity): void {
  const theocracy = (playerAttributeFor(state, monk.owner, 'theocracy') ?? 0) > 0;
  for (const other of state.entities) {
    if (other.id !== monk.id && (theocracy || other.owner !== monk.owner || other.dead
      || other.activity !== 'converting' || other.order.kind !== 'convert'
      || other.order.targetId !== target.id)) continue;
    other.faith = 0;
    other.convertTicks = undefined;
    other.order = { kind: 'idle' };
    other.activity = 'idle';
  }
}
