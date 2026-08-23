import { FALLBACK_RULES, TICK_SECONDS, TICKS_PER_SECOND, isBuilding, isUnit } from './data';
import type { GameRules } from './data';
import { random01 } from './random';
import type {
  BuildingKind, Command, Entity, GameState, PlayerId, Point, ResourceKind, UnitKind,
} from './types';

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

export type CommandResult = { ok: true } | { ok: false; reason: string };
const rejected = (reason: string): CommandResult => ({ ok: false, reason });

function addEntity(
  state: GameState, kind: Entity['kind'], owner: Entity['owner'], position: Point,
  base: { hp: number; radius: number }, extra: Partial<Entity> = {},
): Entity {
  const entity: Entity = {
    id: state.nextId++, kind, owner, position: { ...position }, hp: base.hp,
    maxHp: base.hp, radius: base.radius, activity: 'idle', order: { kind: 'idle' }, ...extra,
  };
  state.entities.push(entity);
  return entity;
}

function addNode(state: GameState, node: 'berries' | 'tree' | 'gold', position: Point): Entity {
  const rules = state.rules.nodes[node];
  return addEntity(state, 'resource', 0, position, { hp: 1, radius: rules.radius }, {
    resourceKind: rules.resource,
    amount: rules.amount,
  });
}

function cluster(state: GameState, node: 'berries' | 'tree' | 'gold', center: Point, count: number): void {
  for (let i = 0; i < count; i++) {
    const angle = random01(state) * Math.PI * 2;
    const radius = 1 + random01(state) * 2.2;
    addNode(state, node, {
      x: Math.min(state.width - 0.6, Math.max(0.6, center.x + Math.cos(angle) * radius)),
      y: Math.min(state.height - 0.6, Math.max(0.6, center.y + Math.sin(angle) * radius)),
    });
  }
}

export function createGame(seed = 42, rules: GameRules = FALLBACK_RULES): GameState {
  const state: GameState = {
    rules, seed: seed || 1, tick: 0, nextId: 1, width: 32, height: 18, entities: [],
    players: {
      1: { id: 1, ...rules.startingResources, population: 0, populationCap: 0 },
      2: { id: 2, ...rules.startingResources, population: 0, populationCap: 0 },
    },
  };
  for (const player of [1, 2] as PlayerId[]) {
    const mirror = (point: Point): Point => player === 1 ? point : { x: state.width - point.x, y: point.y };
    const tcRules = rules.buildings['town-center'];
    addEntity(state, 'town-center', player, mirror({ x: 5, y: 9 }), tcRules);
    const villagerRules = rules.units.villager;
    for (const dy of [-1, 0, 1]) {
      addEntity(state, 'villager', player, mirror({ x: 7.8, y: 9 + dy }), villagerRules);
    }
    cluster(state, 'berries', mirror({ x: 10, y: 5 }), 6);
    cluster(state, 'tree', mirror({ x: 10, y: 13.5 }), 8);
    cluster(state, 'gold', mirror({ x: 4, y: 3.5 }), 4);
  }
  recalculatePopulation(state);
  return state;
}

export const gameTimeSeconds = (state: GameState): number => state.tick * TICK_SECONDS;

function recalculatePopulation(state: GameState): void {
  for (const player of [1, 2] as PlayerId[]) {
    state.players[player].population = state.entities
      .filter(e => e.owner === player && isUnit(e.kind))
      .reduce((sum, e) => sum + state.rules.units[e.kind as UnitKind].popCost, 0);
    state.players[player].populationCap = state.rules.startingPopulationCap + state.entities
      .filter(e => e.owner === player && isBuilding(e.kind) && e.buildProgress === undefined)
      .reduce((sum, e) => sum + state.rules.buildings[e.kind as BuildingKind].popSupport, 0);
  }
}

function spend(state: GameState, player: PlayerId, kind: UnitKind | BuildingKind): CommandResult {
  const cost = isUnit(kind) ? state.rules.units[kind].cost : state.rules.buildings[kind].cost;
  const p = state.players[player];
  if (p.food < cost.food || p.wood < cost.wood || p.gold < cost.gold) {
    return rejected('not enough resources');
  }
  p.food -= cost.food;
  p.wood -= cost.wood;
  p.gold -= cost.gold;
  return { ok: true };
}

/** Axis-aligned square-footprint overlap for placement legality. */
function footprintsOverlap(a: Point, aHalf: number, b: Point, bHalf: number): boolean {
  return Math.abs(a.x - b.x) < aHalf + bHalf && Math.abs(a.y - b.y) < aHalf + bHalf;
}

export function placementLegal(state: GameState, building: BuildingKind, target: Point): CommandResult {
  const half = state.rules.buildings[building].radius;
  if (target.x - half < 0 || target.x + half > state.width || target.y - half < 0 || target.y + half > state.height) {
    return rejected('placement is outside the map');
  }
  // Units are ignored: real AoE nudges them off foundations (recorded approximation).
  for (const entity of state.entities) {
    if (!isBuilding(entity.kind) && entity.kind !== 'resource') continue;
    if (footprintsOverlap(target, half, entity.position, entity.radius)) {
      return rejected(`placement overlaps ${entity.kind} ${entity.id}`);
    }
  }
  return { ok: true };
}

function assignOrder(state: GameState, entity: Entity, target: Point, targetEntity?: Entity): void {
  if (targetEntity?.kind === 'resource' && entity.kind === 'villager') {
    entity.order = { kind: 'gather', targetId: targetEntity.id };
  } else if (
    targetEntity && targetEntity.owner === entity.owner &&
    isBuilding(targetEntity.kind) && targetEntity.buildProgress !== undefined && entity.kind === 'villager'
  ) {
    entity.order = { kind: 'build', targetId: targetEntity.id };
  } else if (targetEntity && targetEntity.owner !== 0 && targetEntity.owner !== entity.owner) {
    entity.order = { kind: 'attack', targetId: targetEntity.id };
  } else {
    entity.order = { kind: 'move', target: { ...target } };
  }
  entity.activity = 'moving';
  entity.gatherProgress = 0;
}

export function applyCommand(state: GameState, command: Command): CommandResult {
  if (state.winner) return rejected('match is over');
  if (command.player !== 1 && command.player !== 2) return rejected('unknown player');

  if (command.kind === 'order' || command.kind === 'stop') {
    const targetEntity = 'targetId' in command && command.targetId
      ? state.entities.find(e => e.id === command.targetId)
      : undefined;
    if (command.kind === 'order' && command.targetId && !targetEntity) {
      return rejected(`target ${command.targetId} does not exist`);
    }
    let matched = 0;
    for (const entity of state.entities) {
      if (!command.entityIds.includes(entity.id) || entity.owner !== command.player || !isUnit(entity.kind)) continue;
      matched++;
      if (command.kind === 'stop') {
        entity.order = { kind: 'idle' };
        entity.activity = 'idle';
      } else {
        assignOrder(state, entity, command.target, targetEntity);
      }
    }
    return matched ? { ok: true } : rejected('no owned units matched');
  }

  if (command.kind === 'train') {
    const building = state.entities.find(e => e.id === command.buildingId && e.owner === command.player);
    if (!building) return rejected(`building ${command.buildingId} is not owned`);
    if (building.buildProgress !== undefined) return rejected('building is under construction');
    if (building.training) return rejected('building is already training');
    const unitRules = state.rules.units[command.unit];
    if (unitRules.trainedAt !== building.kind) return rejected(`${building.kind} cannot train ${command.unit}`);
    const player = state.players[command.player];
    if (player.population + unitRules.popCost > player.populationCap) return rejected('population cap reached');
    const paid = spend(state, command.player, command.unit);
    if (!paid.ok) return paid;
    building.training = { kind: command.unit, remainingTicks: Math.round(unitRules.trainSeconds * TICKS_PER_SECOND) };
    return { ok: true };
  }

  if (command.kind === 'rally') {
    const building = state.entities.find(e => e.id === command.buildingId && e.owner === command.player);
    if (!building || !isBuilding(building.kind)) return rejected(`building ${command.buildingId} is not owned`);
    building.rally = { target: { ...command.target }, targetId: command.targetId };
    return { ok: true };
  }

  const rules = state.rules.buildings[command.building];
  if (!rules.buildable) return rejected(`${command.building} cannot be built`);
  const builders = state.entities.filter(
    e => command.builderIds.includes(e.id) && e.owner === command.player && e.kind === 'villager',
  );
  if (!builders.length) return rejected('builders must be owned villagers');
  const legal = placementLegal(state, command.building, command.target);
  if (!legal.ok) return legal;
  const paid = spend(state, command.player, command.building);
  if (!paid.ok) return paid;
  const site = addEntity(state, command.building, command.player, command.target, rules, {
    hp: 1,
    buildProgress: 0,
  });
  site.maxHp = rules.hp;
  for (const builder of builders) {
    builder.order = { kind: 'build', targetId: site.id };
    builder.activity = 'moving';
  }
  return { ok: true };
}

function moveToward(entity: Entity, target: Point, speed: number): boolean {
  const step = speed * TICK_SECONDS;
  const d = distance(entity.position, target);
  if (d <= step) {
    entity.position = { ...target };
    return true;
  }
  entity.position.x += (target.x - entity.position.x) / d * step;
  entity.position.y += (target.y - entity.position.y) / d * step;
  return false;
}

const inRange = (entity: Entity, target: Entity, margin = 0.15): boolean =>
  distance(entity.position, target.position) <= entity.radius + target.radius + margin;

function nearestNode(state: GameState, from: Point, resource: ResourceKind): Entity | undefined {
  let best: Entity | undefined;
  let bestDistance = Infinity;
  for (const entity of state.entities) {
    if (entity.kind !== 'resource' || entity.resourceKind !== resource || (entity.amount ?? 0) <= 0) continue;
    const d = distance(from, entity.position);
    if (d < bestDistance || (d === bestDistance && best && entity.id < best.id)) {
      best = entity;
      bestDistance = d;
    }
  }
  return best;
}

function nearestDropSite(state: GameState, entity: Entity): Entity | undefined {
  let best: Entity | undefined;
  let bestDistance = Infinity;
  for (const candidate of state.entities) {
    if (candidate.owner !== entity.owner || candidate.kind !== 'town-center' || candidate.buildProgress !== undefined) continue;
    const d = distance(entity.position, candidate.position);
    if (d < bestDistance || (d === bestDistance && best && candidate.id < best.id)) {
      best = candidate;
      bestDistance = d;
    }
  }
  return best;
}

function becomeIdle(entity: Entity): void {
  entity.order = { kind: 'idle' };
  entity.activity = 'idle';
  entity.gatherProgress = 0;
}

function updateGatherer(state: GameState, entity: Entity): void {
  if (entity.order.kind !== 'gather') return;
  const speed = state.rules.units.villager.speed;
  const capacity = state.rules.carryCapacity;
  const carrying = entity.carrying;

  if (carrying && carrying.amount >= capacity) {
    const drop = nearestDropSite(state, entity);
    if (!drop) { becomeIdle(entity); return; }
    entity.activity = 'carrying';
    if (inRange(entity, drop)) {
      state.players[entity.owner as PlayerId][carrying.kind] += carrying.amount;
      entity.carrying = undefined;
    } else {
      moveToward(entity, drop.position, speed);
    }
    return;
  }

  let node = state.entities.find(e => e.id === (entity.order as { targetId: number }).targetId && (e.amount ?? 0) > 0);
  if (!node) {
    const wanted = carrying?.kind ?? undefined;
    node = wanted ? nearestNode(state, entity.position, wanted) : undefined;
    if (node) entity.order = { kind: 'gather', targetId: node.id };
    else if (carrying && carrying.amount > 0) {
      // Nothing left to gather: bank what is carried, then idle.
      const drop = nearestDropSite(state, entity);
      if (drop && inRange(entity, drop)) {
        state.players[entity.owner as PlayerId][carrying.kind] += carrying.amount;
        entity.carrying = undefined;
        becomeIdle(entity);
      } else if (drop) {
        entity.activity = 'carrying';
        moveToward(entity, drop.position, speed);
      } else becomeIdle(entity);
      return;
    } else { becomeIdle(entity); return; }
  }

  if (!inRange(entity, node)) {
    entity.activity = carrying && carrying.amount > 0 ? 'carrying' : 'moving';
    moveToward(entity, node.position, speed);
    return;
  }

  entity.activity = 'gathering';
  const resource = node.resourceKind!;
  entity.gatherProgress = (entity.gatherProgress ?? 0) + state.rules.gatherRatePerSecond[resource] * TICK_SECONDS;
  while ((entity.gatherProgress ?? 0) >= 1 && (node.amount ?? 0) > 0 && (entity.carrying?.amount ?? 0) < capacity) {
    entity.gatherProgress! -= 1;
    node.amount! -= 1;
    // Switching resource types discards the old load, as in AoE2.
    if (!entity.carrying || entity.carrying.kind !== resource) entity.carrying = { kind: resource, amount: 0 };
    entity.carrying.amount += 1;
  }
}

function updateBuilder(state: GameState, entity: Entity, builderCounts: Map<number, number>): void {
  if (entity.order.kind !== 'build') return;
  const site = state.entities.find(e => e.id === (entity.order as { targetId: number }).targetId);
  if (!site || site.buildProgress === undefined) { becomeIdle(entity); return; }
  if (!inRange(entity, site, 0.3)) {
    entity.activity = 'moving';
    moveToward(entity, site.position, state.rules.units.villager.speed);
    return;
  }
  entity.activity = 'building';
  builderCounts.set(site.id, (builderCounts.get(site.id) ?? 0) + 1);
}

function updateAttacker(state: GameState, entity: Entity): void {
  if (entity.order.kind !== 'attack') return;
  const target = state.entities.find(e => e.id === (entity.order as { targetId: number }).targetId);
  if (!target || target.owner === entity.owner || target.hp <= 0) { becomeIdle(entity); return; }
  const rules = state.rules.units[entity.kind as UnitKind];
  if (!inRange(entity, target, 0.25)) {
    entity.activity = 'moving';
    moveToward(entity, target.position, rules.speed);
    return;
  }
  entity.activity = 'attacking';
  entity.attackCooldown = (entity.attackCooldown ?? 0) - 1;
  if ((entity.attackCooldown ?? 0) <= 0) {
    target.hp -= rules.attackDamage;
    entity.attackCooldown = Math.round(rules.attackReloadSeconds * TICKS_PER_SECOND);
  }
}

function updateUnit(state: GameState, entity: Entity, builderCounts: Map<number, number>): void {
  switch (entity.order.kind) {
    case 'move': {
      entity.activity = 'moving';
      const rules = state.rules.units[entity.kind as UnitKind];
      if (moveToward(entity, entity.order.target, rules.speed)) becomeIdle(entity);
      return;
    }
    case 'gather': return updateGatherer(state, entity);
    case 'build': return updateBuilder(state, entity, builderCounts);
    case 'attack': return updateAttacker(state, entity);
    default:
      entity.activity = 'idle';
  }
}

function spawnTrainedUnit(state: GameState, building: Entity, kind: UnitKind): void {
  const rules = state.rules.units[kind];
  const spawn = {
    x: building.position.x,
    y: building.position.y + building.radius + rules.radius + 0.2,
  };
  const unit = addEntity(state, kind, building.owner, spawn, rules);
  if (building.rally) {
    const target = building.rally.targetId
      ? state.entities.find(e => e.id === building.rally!.targetId)
      : undefined;
    assignOrder(state, unit, building.rally.target, target);
  }
}

function updateBuildingProduction(state: GameState, entity: Entity): void {
  if (!entity.training) return;
  entity.training.remainingTicks -= 1;
  if (entity.training.remainingTicks > 0) return;
  const kind = entity.training.kind;
  const player = state.players[entity.owner as PlayerId];
  if (player.population + state.rules.units[kind].popCost > player.populationCap) {
    entity.training.remainingTicks = 1; // hold the finished unit until room exists
    return;
  }
  entity.training = undefined;
  spawnTrainedUnit(state, entity, kind);
  recalculatePopulation(state);
}

export function stepGame(state: GameState): void {
  if (state.winner) return;
  state.tick += 1;
  const builderCounts = new Map<number, number>();
  for (const entity of [...state.entities]) {
    if (isUnit(entity.kind)) updateUnit(state, entity, builderCounts);
    else if (isBuilding(entity.kind) && entity.buildProgress === undefined) updateBuildingProduction(state, entity);
  }
  for (const site of state.entities) {
    if (site.buildProgress === undefined) continue;
    const builders = builderCounts.get(site.id) ?? 0;
    if (!builders) continue;
    const seconds = state.rules.buildings[site.kind as BuildingKind].buildSeconds;
    // AoE2 rule: k builders finish in 3T/(k+2) seconds.
    const delta = TICK_SECONDS * (builders + 2) / (3 * seconds);
    site.buildProgress = Math.min(1, site.buildProgress + delta);
    site.hp = Math.min(site.maxHp, site.hp + site.maxHp * delta);
    if (site.buildProgress >= 1) {
      site.buildProgress = undefined;
      site.hp = Math.min(site.maxHp, Math.round(site.hp));
      for (const builder of state.entities) {
        if (builder.order.kind === 'build' && builder.order.targetId === site.id) becomeIdle(builder);
      }
      recalculatePopulation(state);
    }
  }

  const destroyedTownCenters = state.entities.filter(e => e.kind === 'town-center' && e.hp <= 0);
  const removed = state.entities.some(e => e.hp <= 0 || (e.kind === 'resource' && (e.amount ?? 0) <= 0));
  if (removed) {
    state.entities = state.entities.filter(e => e.hp > 0 && (e.kind !== 'resource' || (e.amount ?? 0) > 0));
    recalculatePopulation(state);
  }
  for (const tc of destroyedTownCenters) state.winner = tc.owner === 1 ? 2 : 1;
}

export function nearestEntity(state: GameState, point: Point, maxDistance = 1.3): Entity | undefined {
  return state.entities
    .map(entity => ({ entity, d: distance(entity.position, point) - entity.radius }))
    .filter(item => item.d <= maxDistance)
    .sort((a, b) => a.d - b.d || a.entity.id - b.entity.id)[0]?.entity;
}
