import { isBuilding, isUnit, TICK_SECONDS } from './data';
import { buildingRulesForEntity, playerAttributeFor, unitRulesForEntity } from './rules';
import { rulesForPlayer } from './civilizations';
import type { Entity, GameState } from './types';

function taskFor(state: GameState, monk: Entity, target: Entity) {
  const tasks = unitRulesForEntity(state, monk).convert?.tasks;
  if (!tasks || (!isUnit(target.kind) && !isBuilding(target.kind))) return undefined;
  const rules = isUnit(target.kind) ? unitRulesForEntity(state, target) : buildingRulesForEntity(state, target);
  return tasks.find(t => t.unitId >= 0 && t.unitId === rules.datId)
    ?? tasks.find(t => t.unitId < 0 && t.classId >= 0 && t.classId === rules.datClass)
    ?? tasks.find(t => t.unitId < 0 && t.classId < 0);
}

export function conversionPermissionError(state: GameState, monk: Entity, target: Entity): string | undefined {
  if (target.owner === 0 || target.owner === monk.owner || target.dead || !unitRulesForEntity(state, monk).convert) return;
  const targetRules = isUnit(target.kind) ? unitRulesForEntity(state, target)
    : isBuilding(target.kind) ? buildingRulesForEntity(state, target) : undefined;
  // Research cannot remove a target's permanent immunity.
  if (targetRules?.conversionImmune) return;
  const task = taskFor(state, monk, target);
  if (!task || task.requiredResource < 0) return;
  const key = Object.entries(rulesForPlayer(state, monk.owner).playerAttributeIds ?? {})
    .find(([, id]) => id === task.requiredResource)?.[0];
  if (!key || (playerAttributeFor(state, monk.owner, key) ?? 0) <= 0) {
    return task.failureMessage || 'Conversion research is required.';
  }
}

export function canConvert(state: GameState, monk: Entity, target: Entity): boolean {
  if (target.dead || target.owner === 0 || target.owner === monk.owner || monk.relics?.length
    || !unitRulesForEntity(state, monk).convert) return false;
  if (isUnit(target.kind)) {
    if (unitRulesForEntity(state, target).conversionImmune) return false;
  } else if (isBuilding(target.kind)) {
    const rules = buildingRulesForEntity(state, target);
    const task = taskFor(state, monk, target);
    if (target.buildProgress !== undefined || rules.conversionImmune || [27,39,49].includes(rules.datClass ?? -1)
      || !task || (task.unitId < 0 && task.classId < 0)) return false;
  } else return false;
  return !conversionPermissionError(state, monk, target);
}

export function conversionWindow(state: GameState, monk: Entity, target: Entity) {
  const base = unitRulesForEntity(state, monk).convert!;
  const task = taskFor(state, monk, target);
  return { ...base,
    range: task && task.range > 0 ? task.range : base.range,
    minSeconds: (task?.minSeconds ?? base.minSeconds) + (playerAttributeFor(state, target.owner, 'convertResistMinAdj') ?? 0),
    maxSeconds: (task?.maxSeconds ?? base.maxSeconds) + (playerAttributeFor(state, target.owner, 'convertResistMaxAdj') ?? 0),
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
