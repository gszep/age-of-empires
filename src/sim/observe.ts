import { STATS } from './data';
import type { Entity, GameState, PlayerId } from './types';
import type { ObservedEntity, PlayerObservation } from '../protocol/types';

const distance = (a: Entity, b: Entity) =>
  Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y);

function isVisible(state: GameState, player: PlayerId, entity: Entity): boolean {
  if (entity.owner === player || entity.owner === 0) return true;
  return state.entities.some(
    own => own.owner === player && distance(own, entity) <= STATS[own.kind].lineOfSight,
  );
}

function observeEntity(entity: Entity, player: PlayerId): ObservedEntity {
  const observed: ObservedEntity = {
    id: entity.id,
    kind: entity.kind,
    owner: entity.owner,
    x: Math.round(entity.position.x * 100) / 100,
    y: Math.round(entity.position.y * 100) / 100,
    hp: Math.ceil(entity.hp),
    maxHp: entity.maxHp,
  };
  if (entity.resourceKind) observed.resource = entity.resourceKind;
  if (entity.amount !== undefined) observed.amount = Math.floor(entity.amount);
  if (entity.owner === player) {
    // Orders, activities, and production queues stay hidden from opponents.
    observed.activity = entity.activity;
    observed.order = entity.order.kind;
    if (entity.training) observed.training = { ...entity.training };
  }
  return observed;
}

/** Canonical player-filtered observation; the only sanctioned agent input. */
export function observe(state: GameState, player: PlayerId): PlayerObservation {
  const self = state.players[player];
  const observation: PlayerObservation = {
    version: 1,
    time: Math.round(state.time * 100) / 100,
    player,
    mapWidth: state.width,
    mapHeight: state.height,
    food: Math.floor(self.food),
    wood: Math.floor(self.wood),
    population: self.population,
    populationCap: self.populationCap,
    entities: state.entities
      .filter(entity => isVisible(state, player, entity))
      .map(entity => observeEntity(entity, player)),
  };
  if (state.winner) observation.winner = state.winner;
  return observation;
}

/** Deterministic concise text rendering of an observation. */
export function describeObservation(observation: PlayerObservation): string {
  const mine = observation.entities.filter(e => e.owner === observation.player);
  const enemies = observation.entities.filter(e => e.owner !== 0 && e.owner !== observation.player);
  const nodes = observation.entities.filter(e => e.kind === 'resource');
  const countByKind = (entities: ObservedEntity[]) => {
    const counts = new Map<string, number>();
    for (const entity of entities) counts.set(entity.kind, (counts.get(entity.kind) ?? 0) + 1);
    return [...counts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([kind, count]) => `${count} ${kind}`)
      .join(', ');
  };
  const idle = mine.filter(e => e.order === 'idle' && (e.kind === 'villager' || e.kind === 'militia')).length;
  const parts = [
    `t=${observation.time.toFixed(1)}`,
    `p${observation.player}`,
    `food=${observation.food} wood=${observation.wood} pop=${observation.population}/${observation.populationCap}`,
    `own: ${countByKind(mine) || 'none'}${idle ? ` (${idle} idle)` : ''}`,
    `enemy seen: ${countByKind(enemies) || 'none'}`,
    `resource nodes: ${nodes.filter(e => e.resource === 'food').length} food, ${nodes.filter(e => e.resource === 'wood').length} wood`,
  ];
  if (observation.winner) parts.push(observation.winner === observation.player ? 'result: victory' : 'result: defeat');
  return parts.join(' | ');
}
