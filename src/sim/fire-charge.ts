import { TICK_SECONDS, TICKS_PER_SECOND } from './data';
import { unitRulesForEntity } from './rules';
import type { Entity, GameState, Point, Projectile } from './types';

export function fireChargeOf(state: GameState, unit: Entity) {
  if (!['fire-galley', 'fire-ship', 'fast-fire-ship'].includes(unit.kind)) return;
  const charge = unitRulesForEntity(state, unit).fireCharge;
  return charge && charge.type === 6 && charge.event === 0 && charge.target === 64 && charge.maximum >= 1 ? charge : undefined;
}

export function rechargeFireCharge(state: GameState, unit: Entity): void {
  if (unit.charge === undefined) return;
  const rules = fireChargeOf(state, unit);
  if (rules) unit.charge = Math.min(rules.maximum, unit.charge + rules.rechargePerSecond * TICK_SECONDS);
}

/** Inferred bounded policy: an extra aimed projectile on a ready normal swing. */
export function releaseFireCharge(state: GameState, unit: Entity, target: Entity, aim: Point): void {
  const rules = fireChargeOf(state, unit);
  if (!rules || unit.owner === 0 || target.owner === 0 || target.owner === unit.owner
    || (unit.charge ?? rules.maximum) + 1e-9 < 1) return;
  const shot = rules.projectile;
  unit.charge = Math.max(0, (unit.charge ?? rules.maximum) - 1);
  state.projectiles.push({ id: state.nextId++, owner: unit.owner, shooterId: unit.id, targetId: target.id,
    origin: { ...unit.position }, position: { ...unit.position }, aim: { ...aim }, launchHeight: 0,
    speed: shot.speed, art: 'fire-charge', attacks: shot.attacks.map(a => ({ ...a })),
    blastRadius: shot.radius, blastAttackLevel: shot.level,
    impactEffect: shot.impactEffect, impactSeconds: shot.impactSeconds });
}

/** Keep the owned impact flipbook on the simulation clock; never hit twice. */
export function beginProjectileImpact(projectile: Projectile, at: Point): boolean {
  if (!projectile.impactEffect) return false;
  const ticks = Math.max(1, Math.round((projectile.impactSeconds ?? 0) * TICKS_PER_SECOND));
  projectile.position = { ...at }; projectile.aim = { ...at };
  projectile.impact = { effect: projectile.impactEffect, remainingTicks: ticks, totalTicks: ticks };
  return true;
}
