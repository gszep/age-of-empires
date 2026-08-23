import { COST, STATS, isBuilding, isUnit } from './data';
import { random01 } from './random';
import type { BuildingKind, Command, Entity, GameState, PlayerId, Point, UnitKind } from './types';

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

function addEntity(state: GameState, kind: Entity['kind'], owner: Entity['owner'], position: Point, extra: Partial<Entity> = {}): Entity {
  const stats = STATS[kind];
  const entity: Entity = {
    id: state.nextId++, kind, owner, position: { ...position }, hp: stats.hp,
    maxHp: stats.hp, radius: stats.radius, activity: 'idle', order: { kind: 'idle' }, ...extra,
  };
  state.entities.push(entity);
  return entity;
}

function cluster(state: GameState, kind: 'food' | 'wood', center: Point, count: number): void {
  for (let i = 0; i < count; i++) {
    const angle = random01(state) * Math.PI * 2;
    const radius = 1 + random01(state) * 2.5;
    addEntity(state, 'resource', 0, {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
    }, { resourceKind: kind, amount: kind === 'food' ? 250 : 400 });
  }
}

export function createGame(seed = 42): GameState {
  const state: GameState = {
    seed: seed || 1, time: 0, nextId: 1, width: 32, height: 18, entities: [],
    players: {
      1: { id: 1, food: 200, wood: 200, population: 0, populationCap: 10 },
      2: { id: 2, food: 200, wood: 200, population: 0, populationCap: 10 },
    },
  };
  for (const player of [1, 2] as PlayerId[]) {
    const x = player === 1 ? 5 : 27;
    const y = player === 1 ? 9 : 9;
    addEntity(state, 'town-center', player, { x, y });
    addEntity(state, 'villager', player, { x: x + (player === 1 ? 1.8 : -1.8), y: y - 1 });
    addEntity(state, 'villager', player, { x: x + (player === 1 ? 1.8 : -1.8), y });
    addEntity(state, 'villager', player, { x: x + (player === 1 ? 1.8 : -1.8), y: y + 1 });
    cluster(state, 'food', { x: player === 1 ? 9 : 23, y: 6 }, 5);
    cluster(state, 'wood', { x: player === 1 ? 9 : 23, y: 13 }, 7);
  }
  recalculatePopulation(state);
  return state;
}

function recalculatePopulation(state: GameState): void {
  for (const player of [1, 2] as PlayerId[]) {
    state.players[player].population = state.entities.filter(e => e.owner === player && isUnit(e.kind)).length;
    state.players[player].populationCap = 10 + state.entities.filter(e => e.owner === player && e.kind === 'house').length * 5;
  }
}

function spend(state: GameState, player: PlayerId, kind: UnitKind | BuildingKind): boolean {
  const cost = COST[kind];
  const p = state.players[player];
  if (p.food < cost.food || p.wood < cost.wood) return false;
  p.food -= cost.food;
  p.wood -= cost.wood;
  return true;
}

export function applyCommand(state: GameState, command: Command): boolean {
  if (state.winner || command.player !== 1 && command.player !== 2) return false;
  if (command.kind === 'order') {
    const targetEntity = command.targetId ? state.entities.find(e => e.id === command.targetId) : undefined;
    for (const entity of state.entities) {
      if (!command.entityIds.includes(entity.id) || entity.owner !== command.player || !isUnit(entity.kind)) continue;
      if (targetEntity?.kind === 'resource' && entity.kind === 'villager') entity.order = { kind: 'gather', targetId: targetEntity.id };
      else if (targetEntity && targetEntity.owner !== 0 && targetEntity.owner !== command.player) entity.order = { kind: 'attack', targetId: targetEntity.id };
      else entity.order = { kind: 'move', target: { ...command.target } };
      entity.activity = 'moving';
    }
    return true;
  }
  if (command.kind === 'train') {
    const building = state.entities.find(e => e.id === command.buildingId && e.owner === command.player);
    const valid = building && !building.training && ((building.kind === 'town-center' && command.unit === 'villager') || (building.kind === 'barracks' && command.unit === 'militia'));
    if (!valid || state.players[command.player].population >= state.players[command.player].populationCap || !spend(state, command.player, command.unit)) return false;
    building.training = { kind: command.unit, remaining: command.unit === 'villager' ? 8 : 10 };
    return true;
  }
  const builder = state.entities.find(e => e.id === command.builderId && e.owner === command.player && e.kind === 'villager');
  if (!builder || command.building === 'town-center' || !spend(state, command.player, command.building)) return false;
  addEntity(state, command.building, command.player, command.target);
  recalculatePopulation(state);
  return true;
}

function moveToward(entity: Entity, target: Point, speed: number, dt: number): boolean {
  const d = distance(entity.position, target);
  if (d <= speed * dt) { entity.position = { ...target }; return true; }
  entity.position.x += (target.x - entity.position.x) / d * speed * dt;
  entity.position.y += (target.y - entity.position.y) / d * speed * dt;
  return false;
}

function updateUnit(state: GameState, entity: Entity, dt: number): void {
  const speed = entity.kind === 'militia' ? 2.2 : 1.8;
  if (entity.order.kind === 'move') {
    entity.activity = 'moving';
    if (moveToward(entity, entity.order.target, speed, dt)) {
      entity.order = { kind: 'idle' };
      entity.activity = 'idle';
    }
    return;
  }
  if (entity.order.kind === 'gather') {
    const order = entity.order;
    const resource = state.entities.find(e => e.id === order.targetId && (e.amount ?? 0) > 0);
    if (!resource) { entity.order = { kind: 'idle' }; entity.activity = 'idle'; return; }
    if (distance(entity.position, resource.position) > entity.radius + resource.radius + 0.15) {
      entity.activity = 'moving';
      moveToward(entity, resource.position, speed, dt);
    } else {
      entity.activity = 'gathering';
      const amount = Math.min(resource.amount ?? 0, 3 * dt);
      resource.amount = (resource.amount ?? 0) - amount;
      state.players[entity.owner as PlayerId][resource.resourceKind!] += amount;
    }
    return;
  }
  if (entity.order.kind === 'attack') {
    const order = entity.order;
    const target = state.entities.find(e => e.id === order.targetId);
    if (!target || target.owner === entity.owner) { entity.order = { kind: 'idle' }; entity.activity = 'idle'; return; }
    const reach = entity.radius + target.radius + 0.25;
    if (distance(entity.position, target.position) > reach) {
      entity.activity = 'moving';
      moveToward(entity, target.position, speed, dt);
    } else {
      entity.activity = 'attacking';
      target.hp -= (entity.kind === 'militia' ? 8 : 2) * dt;
    }
    return;
  }
  entity.activity = 'idle';
}

export function stepGame(state: GameState, dt: number): void {
  if (state.winner) return;
  state.time += dt;
  for (const entity of [...state.entities]) {
    if (isUnit(entity.kind)) updateUnit(state, entity, dt);
    if (isBuilding(entity.kind) && entity.training) {
      entity.training.remaining -= dt;
      if (entity.training.remaining <= 0) {
        addEntity(state, entity.training.kind, entity.owner, { x: entity.position.x, y: entity.position.y + entity.radius + 0.8 });
        entity.training = undefined;
      }
    }
  }
  const destroyedTownCenters = state.entities.filter(e => e.kind === 'town-center' && e.hp <= 0);
  state.entities = state.entities.filter(e => e.hp > 0 && (e.kind !== 'resource' || (e.amount ?? 0) > 0));
  for (const tc of destroyedTownCenters) state.winner = tc.owner === 1 ? 2 : 1;
  recalculatePopulation(state);
}

export function nearestEntity(state: GameState, point: Point, maxDistance = 1.3): Entity | undefined {
  return state.entities
    .map(entity => ({ entity, d: distance(entity.position, point) - entity.radius }))
    .filter(item => item.d <= maxDistance)
    .sort((a, b) => a.d - b.d)[0]?.entity;
}
