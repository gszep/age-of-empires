import { TICK_SECONDS } from './data';
import { isEntityVisible } from './visibility';
import { isAnimal, isUnit } from './data';
import type { BuildingKind, Entity, GameState, PlayerId } from './types';
import { buildingRulesForEntity, playerAttributeFor, unitRulesForEntity } from './rules';
import { researchCostFor, technologyRequirementsMet } from './technologies';
import { COMMODITIES, hasMarket, marketQuote, tributeFee } from './market';
import { TREASON_GOLD, treasonMarkers } from './regicide';
import { rulesForPlayer } from './civilizations';
import { fireChargeOf } from './fire-charge';
import type { ObservedEntity, PlayerObservation, RememberedEntityObservation } from '../protocol/types';
import { PROTOCOL_VERSION } from '../protocol/types';
import { observedTerrain } from '../protocol/terrain';
import { garrisonCount } from './garrison';

function observeEntity(state: GameState, entity: Entity, player: PlayerId): ObservedEntity {
  const observed: ObservedEntity = {
    id: entity.id,
    kind: entity.kind,
    owner: entity.owner,
    x: Math.round(entity.position.x * 100) / 100,
    y: Math.round(entity.position.y * 100) / 100,
    hp: entity.dead ? 0 : Math.max(0, Math.ceil(entity.hp)),
    maxHp: entity.maxHp,
  };
  if (entity.resourceKind) observed.resource = entity.resourceKind;
  if (entity.node) observed.node = entity.node;
  if (entity.amount !== undefined) observed.amount = Math.floor(entity.amount);
  if (entity.buildProgress !== undefined) observed.buildProgress = Math.round(entity.buildProgress * 1000) / 1000;
  if (entity.garrison?.length) observed.hasGarrison = true;
  if (isUnit(entity.kind) && entity.relics?.length) observed.carryingRelic = true;
  if (entity.owner === player) {
    // Orders, activities, carried loads, and production stay hidden from opponents.
    observed.activity = entity.activity;
    observed.order = entity.order.kind;
    if (entity.relics?.length) observed.relics = entity.relics.length;
    if (entity.faith !== undefined) observed.faith = Math.floor(entity.faith);
    if (isUnit(entity.kind)) {
      const charge = fireChargeOf(state, entity) ?? unitRulesForEntity(state, entity).alternateAttack;
      if (charge) observed.charge = { current: Math.round((entity.charge ?? charge.maximum) * 1000) / 1000, maximum: charge.maximum };
    }
    if (entity.kind === 'town-center') observed.townBell = !!entity.townBell;
    if (entity.order.kind === 'build') observed.buildTargetId = entity.order.targetId;
    if (entity.order.kind === 'gather') observed.gatherTargetId = entity.order.targetId;
    if (entity.carrying) {
      // Task identity is simulation memory for a depleted target, not part of
      // the public resource-load schema.
      const { task, ...load } = entity.carrying;
      observed.carrying = load;
    }
    if (entity.garrison?.length) observed.garrisoned = garrisonCount(entity);
    // Production clocks hold remaining work. Agents need game-time seconds,
    // including the owner's active production/research speed modifiers.
    const workRate = entity.training || entity.researching
      ? buildingRulesForEntity(state, entity).workRate ?? 1 : 1;
    if (entity.training) {
      observed.training = {
        kind: entity.training.kind,
        remainingSeconds: Math.round(entity.training.remainingTicks / workRate * TICK_SECONDS * 100) / 100,
      };
    }
    // What it is researching, on the same terms. A strategy that cannot see
    // this has no way to tell "the age is on its way" from "the age was
    // refused", and re-issues the command every decision.
    if (entity.researching) {
      observed.researching = {
        tech: entity.researching.tech,
        remainingSeconds: Math.round(entity.researching.remainingTicks / workRate * TICK_SECONDS * 100) / 100,
      };
    }
    // Observation consumers must not be able to mutate the authoritative queue.
    if (entity.researchQueue?.length) {
      observed.researchQueue = [...entity.researchQueue];
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
    if ((entity.dead && !(isAnimal(entity.kind) && (entity.amount ?? 0) > 0))
      || !isEntityVisible(state, player, entity)) continue;
    visibleIds.add(entity.id);
    entities.push(observeEntity(state, entity, player));
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
    version: PROTOCOL_VERSION,
    mode: state.mode ?? 'random-map',
    time: Math.round(state.tick * TICK_SECONDS * 100) / 100,
    player,
    mapWidth: state.width,
    mapHeight: state.height,
    food: self.food,
    wood: self.wood,
    gold: self.gold,
    stone: self.stone,
    population: self.population,
    populationCap: self.populationCap,
    civilization: self.civilization,
    age: self.age,
    ...(self.autoReseedFarms !== undefined ? { autoReseedFarms: self.autoReseedFarms } : {}),
    researched: [...self.researched],
    entities,
    memory,
    explored,
    terrain: observedTerrain(state, player),
  };
  if (state.winner) observation.winner = state.winner;
  if (state.draw) observation.draw = true;
  if (state.mode === 'regicide') observation.treason = {
    goldCost: TREASON_GOLD, available: state.entities.some(e => e.owner === player && e.kind === 'castle' && !e.dead && e.buildProgress === undefined),
    untilTick: state.treasonUntil?.[player] ?? 0,
    kings: treasonMarkers(state, player).map(k => ({ owner: k.owner, x: k.position.x, y: k.position.y })),
  };
  const modifiedResearchPrices = (playerAttributeFor(state, player, 'researchCostMod') ?? 0) !== 0;
  observation.researchCosts = Object.fromEntries(Object.entries(rulesForPlayer(state, player).technologies)
    .filter(([key, tech]) => !(state.mode === 'regicide' && tech.effects.some(e => e.resource === 'spies'))
      && (modifiedResearchPrices || tech.effects.some(e => e.resource === 'spies'))
      && !self.researched.includes(key) && tech.requiresAge <= self.age && technologyRequirementsMet(state, player, tech)
      && state.entities.some(e => e.owner === player && !e.dead && e.kind === tech.researchedAt && e.buildProgress === undefined))
    .map(([key]) => [key, researchCostFor(state, player, key)]));
  if (hasMarket(state, player)) observation.market = {
    buy: Object.fromEntries(COMMODITIES.map(r => [r, marketQuote(state, player, r, 'buy').gold])) as Record<'wood' | 'food' | 'stone', number>,
    sell: Object.fromEntries(COMMODITIES.map(r => [r, marketQuote(state, player, r, 'sell').gold])) as Record<'wood' | 'food' | 'stone', number>,
    tributeFee: tributeFee(state, player, 100),
  };
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
  const idle = mine.filter(e => e.order === 'idle' && isUnit(e.kind as never)).length;
  const parts = [
    `t=${observation.time.toFixed(1)}`,
    `p${observation.player}`,
    `mode=${observation.mode}`,
    `food=${observation.food} wood=${observation.wood} gold=${observation.gold} stone=${observation.stone} pop=${observation.population}/${observation.populationCap}`,
    `age=${observation.age}${observation.researched.length ? ` researched=${observation.researched.join(',')}` : ''}`,
    `own: ${countByKind(mine) || 'none'}${idle ? ` (${idle} idle)` : ''}`,
    `enemy seen: ${countByKind(enemies) || 'none'}`,
    `remembered: ${observation.memory.length}`,
    `resource nodes: ${nodes.filter(e => e.resource === 'food').length} food, ${nodes.filter(e => e.resource === 'wood').length} wood, ${nodes.filter(e => e.resource === 'gold').length} gold, ${nodes.filter(e => e.resource === 'stone').length} stone`,
  ];
  if (observation.winner) parts.push(observation.winner === observation.player ? 'result: victory' : 'result: defeat');
  if (observation.draw) parts.push('result: draw');
  if (observation.treason?.kings.length) parts.push(`enemy kings: ${observation.treason.kings.map(k => `p${k.owner}@${k.x},${k.y}`).join('; ')}`);
  return parts.join(' | ');
}
