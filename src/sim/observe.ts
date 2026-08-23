import { TICK_SECONDS } from './data';
import { isEntityVisible } from './visibility';
import type { Entity, GameState, PlayerId } from './types';
import type { ObservedEntity, PlayerObservation, RememberedEntityObservation } from '../protocol/types';

function observeEntity(entity: Entity, player: PlayerId): ObservedEntity {
  const observed: ObservedEntity = {
    id: entity.id,
    kind: entity.kind,
    owner: entity.owner,
    x: Math.round(entity.position.x * 100) / 100,
    y: Math.round(entity.position.y * 100) / 100,
    hp: Math.max(0, Math.ceil(entity.hp)),
    maxHp: entity.maxHp,
  };
  if (entity.resourceKind) observed.resource = entity.resourceKind;
  if (entity.amount !== undefined) observed.amount = Math.floor(entity.amount);
  if (entity.buildProgress !== undefined) observed.buildProgress = Math.round(entity.buildProgress * 1000) / 1000;
  if (entity.owner === player) {
    // Orders, activities, carried loads, and production stay hidden from opponents.
    observed.activity = entity.activity;
    observed.order = entity.order.kind;
    if (entity.carrying) observed.carrying = { ...entity.carrying };
    if (entity.training) {
      observed.training = {
        kind: entity.training.kind,
        remainingSeconds: Math.round(entity.training.remainingTicks * TICK_SECONDS * 100) / 100,
      };
    }
  }
  return observed;
}

/** Canonical player-filtered observation; the only sanctioned agent input. */
export function observe(state: GameState, player: PlayerId): PlayerObservation {
  const self = state.players[player];
  const visibility = state.visibility[player];
  const visibleIds = new Set<number>();
  const entities: ObservedEntity[] = [];
  for (const entity of state.entities) {
    if (entity.dead || !isEntityVisible(state, player, entity)) continue;
    visibleIds.add(entity.id);
    entities.push(observeEntity(entity, player));
  }
  const memory: RememberedEntityObservation[] = Object.values(visibility.memory)
    .filter(remembered => !visibleIds.has(remembered.id))
    .sort((a, b) => a.id - b.id)
    .map(remembered => ({
      ...remembered,
      lastSeenAt: Math.round(remembered.lastSeenAt * TICK_SECONDS * 100) / 100,
    }));
  const explored: string[] = [];
  for (let y = 0; y < state.height; y++) {
    explored.push(visibility.explored.slice(y * state.width, (y + 1) * state.width).join(''));
  }
  const observation: PlayerObservation = {
    version: 1,
    time: Math.round(state.tick * TICK_SECONDS * 100) / 100,
    player,
    mapWidth: state.width,
    mapHeight: state.height,
    food: self.food,
    wood: self.wood,
    gold: self.gold,
    population: self.population,
    populationCap: self.populationCap,
    entities,
    memory,
    explored,
  };
  if (state.winner) observation.winner = state.winner;
  return observation;
}

/** Deterministic concise text rendering of an observation. */
export function describeObservation(observation: PlayerObservation): string {
  const mine = observation.entities.filter(e => e.owner === observation.player);
  const enemies = observation.entities.filter(e => e.owner !== 0 && e.owner !== observation.player);
  const nodes = [
    ...observation.entities.filter(e => e.kind === 'resource'),
    ...observation.memory.filter(e => e.kind === 'resource'),
  ];
  const countByKind = (entities: { kind: string }[]) => {
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
    `food=${observation.food} wood=${observation.wood} gold=${observation.gold} pop=${observation.population}/${observation.populationCap}`,
    `own: ${countByKind(mine) || 'none'}${idle ? ` (${idle} idle)` : ''}`,
    `enemy seen: ${countByKind(enemies) || 'none'}`,
    `remembered: ${observation.memory.length}`,
    `resource nodes: ${nodes.filter(e => e.resource === 'food').length} food, ${nodes.filter(e => e.resource === 'wood').length} wood, ${nodes.filter(e => e.resource === 'gold').length} gold`,
  ];
  if (observation.winner) parts.push(observation.winner === observation.player ? 'result: victory' : 'result: defeat');
  return parts.join(' | ');
}
