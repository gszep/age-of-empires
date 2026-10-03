import { TICK_SECONDS, isUnit, isBuilding } from './data';
import { unitRulesForEntity } from './rules';
import { rulesForPlayer } from './civilizations';
import { technologyFor } from './technologies';
import type { GameState } from './types';

/** Passive XS healing tasks. Resolve converted sources through their captured
 * rules, and apply the strongest overlapping aura once per recipient. */
export function updateHealingAuras(state: GameState): void {
  const kinds = new Map<number, Set<string>>();
  for (const owner of [1, 2] as const) {
    const rules = rulesForPlayer(state, owner), enabled = new Set<string>();
    for (const key of state.players[owner].researched) {
      for (const effect of technologyFor(rules, key)?.effects ?? []) {
        if (effect.healingAura && effect.unit) enabled.add(effect.unit);
      }
    }
    kinds.set(owner, enabled);
  }
  const rates = new Map<number, number>();
  for (const source of state.entities) {
    if (source.dead || source.hp <= 0 || !isUnit(source.kind)) continue;
    if (!source.convertedRules?.healingAura && !kinds.get(source.owner)?.has(source.kind)) continue;
    const aura = unitRulesForEntity(state, source).healingAura;
    if (!aura) continue;
    for (const target of state.entities) {
      if (target.id === source.id || target.dead || target.hp <= 0 || target.hp >= target.maxHp
        || target.owner !== source.owner || target.buildProgress !== undefined) continue;
      const rules = rulesForPlayer(state, target.owner);
      const cls = isUnit(target.kind) ? (target.convertedRules ?? rules.units[target.kind]).datClass
        : isBuilding(target.kind) ? (target.convertedBuildingRules ?? rules.buildings[target.kind]).datClass : undefined;
      if (cls === undefined || !aura.targetClasses.includes(cls)) continue;
      const dx = source.position.x - target.position.x, dy = source.position.y - target.position.y;
      if (dx * dx + dy * dy > aura.range * aura.range) continue;
      rates.set(target.id, Math.max(rates.get(target.id) ?? 0, aura.hitPointsPerSecond));
    }
  }
  for (const target of state.entities) {
    const rate = rates.get(target.id);
    if (rate) target.hp = Math.min(target.maxHp, target.hp + rate * TICK_SECONDS);
  }
}
