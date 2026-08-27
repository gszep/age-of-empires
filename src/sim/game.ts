import { FALLBACK_RULES, TICK_SECONDS, TICKS_PER_SECOND, isAnimal, isBuilding, isMilitary, isUnit } from './data';
import type { AttackValue, Cost, GameRules, NodeKind, TechKey, UnitRules } from './data';
import { buildNavGrid, findPath, halfExtent, isBlocked, separateUnits, tileOf, type NavGrid } from './nav';
import { random01 } from './random';
import { createVisibility, isEntityVisible, updateVisibility } from './visibility';
import type {
  AnimalKind, BuildingKind, Command, Entity, GameState, PlayerId, Point, ResourceKind, UnitKind,
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

function addNode(state: GameState, node: NodeKind, position: Point): Entity {
  const rules = state.rules.nodes[node];
  return addEntity(state, 'resource', 0, position, { hp: 1, radius: rules.radius }, {
    resourceKind: rules.resource,
    amount: rules.amount,
  });
}

/**
 * AoE2's "tiny", square. The game's own string table encodes each map size's
 * tile dimension in its key: `MAPSIZE_TINY` is 25120, `MAPSIZE_SMALL` 25144,
 * `MAPSIZE_NORMAL` 25200. Tiny is what two players get, and it is the smallest
 * board the original's opening resources are laid out for.
 */
export const MAP_TILES = 120;

/** Where a player's town center stands. The other player's mirrors across x. */
const START = { x: 30, y: 60 };

/**
 * One group of starting resources, read out of `land_resources.inc` — the
 * include every Arabia-family script pulls in for its player openings.
 * `near`/`far` are the script's `min/max_distance_to_players` in tiles, and
 * `spread` its `group_placement_radius`; `groups` repeats the group at its own
 * bearing, as `number_of_groups` does.
 */
interface StartGroup {
  kind: NodeKind | AnimalKind;
  count: number;
  groups?: number;
  near: number;
  far: number;
  spread: number;
  /** Fill contiguous tiles rather than scatter over a disc; see `growClump`. */
  solid?: boolean;
}

const OPENING: StartGroup[] = [
  { kind: 'berries', count: 6, near: 10, far: 12, spread: 3 },
  { kind: 'gold', count: 7, near: 12, far: 16, spread: 3 },
  { kind: 'gold', count: 4, near: 18, far: 26, spread: 3 },
  { kind: 'gold', count: 4, near: 25, far: 35, spread: 3 },
  { kind: 'stone', count: 5, near: 14, far: 18, spread: 2 },
  { kind: 'stone', count: 4, near: 20, far: 26, spread: 2 },
  { kind: 'sheep', count: 4, near: 10, far: 12, spread: 3 },
  { kind: 'sheep', count: 2, groups: 2, near: 14, far: 30, spread: 3 },
  { kind: 'deer', count: 4, near: 14, far: 30, spread: 3 },
  { kind: 'boar', count: 1, near: 16, far: 22, spread: 1 },
  { kind: 'boar', count: 1, near: 16, far: 22, spread: 1 },
  // Wood is the one the script sizes by the map rather than by the group:
  // `PLAYER_FOREST_TILES` is `PLAYER_FOREST_BASE_COUNT` (55 at its smallest)
  // times `PLAYER_FOREST_CLUMPS` (2 when forests are few), kept off the start
  // area by `PLAYER_FOREST_AVOIDANCE`. It is a terrain clump in the script, not
  // scattered objects, which is why woods in AoE2 are solid.
  { kind: 'tree', count: 55, groups: 2, near: 14, far: 26, spread: 7, solid: true },
];

function addAnimal(state: GameState, kind: AnimalKind, position: Point): Entity {
  const rules = state.rules.units[kind];
  return addEntity(state, kind, 0, position, rules, {
    resourceKind: 'food',
    amount: rules.foodAmount ?? 0,
  });
}

const TAU = Math.PI * 2;

/**
 * The middle of the tile a point falls in. Everything the map generator places
 * is one tile across, and a one-tile footprint centred anywhere else straddles
 * four tiles of the obstruction map instead of filling one — which turned a
 * forest into a wall with a few holes in it and made the pathfinder work
 * through the whole map to find its way to a tree.
 */
const onTile = (at: Point): Point => ({ x: Math.floor(at.x) + 0.5, y: Math.floor(at.y) + 0.5 });

/** A point inside the map, clear of every footprint already placed. */
function freeSpot(state: GameState, at: Point): boolean {
  return at.x >= 1 && at.y >= 1 && at.x <= state.width - 1 && at.y <= state.height - 1
    && spawnFree(state, at, 0.5);
}

/**
 * A forest: `count` contiguous tiles grown outward from a seed, one free
 * neighbour at a time. The script builds one with `create_terrain`, which
 * fills every tile of the area it covers, and forest terrain carries a tree on
 * each — which is why woods in AoE2 are something to walk round rather than
 * through, and why they can be walled with. A ragged edge comes free from
 * taking the next tile out of the frontier at random.
 */
function growClump(
  state: GameState, kind: NodeKind, seed: Point, count: number, mirror: (p: Point) => Point,
): number {
  const frontier: Point[] = [seed];
  let filled = 0;
  while (filled < count && frontier.length) {
    const at = frontier.splice(Math.floor(random01(state) * frontier.length), 1)[0];
    const other = mirror(at);
    if (!freeSpot(state, at) || !freeSpot(state, other)) continue;
    addNode(state, kind, at);
    addNode(state, kind, other);
    filled++;
    for (const step of [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]) {
      frontier.push({ x: at.x + step.x, y: at.y + step.y });
    }
  }
  return filled;
}

/**
 * Scatter one group around a bearing from each player's start, placing both
 * players' copies together so the two halves are exact mirrors of each other
 * and neither can land on the other. A member that finds nowhere to stand is
 * dropped rather than stacked; the count is what the script asks for, not a
 * promise the ground can hold it.
 */
function placeGroup(state: GameState, group: StartGroup, mirror: (p: Point) => Point): void {
  for (let attempt = 0; attempt < 60; attempt++) {
    const angle = random01(state) * TAU;
    const distance = group.near + random01(state) * (group.far - group.near);
    const centre = {
      x: START.x + Math.cos(angle) * distance,
      y: START.y + Math.sin(angle) * distance,
    };
    if (!freeSpot(state, onTile(centre))) continue;
    if (group.solid) {
      if (growClump(state, group.kind as NodeKind, onTile(centre), group.count, mirror)) return;
      continue;
    }
    let placed = 0;
    for (let i = 0; i < group.count; i++) {
      for (let tries = 0; tries < 16; tries++) {
        const spin = random01(state) * TAU;
        // Square-rooted radius spreads the group evenly over its disc rather
        // than piling it at the middle.
        const radius = Math.sqrt(random01(state)) * group.spread;
        const at = onTile({ x: centre.x + Math.cos(spin) * radius, y: centre.y + Math.sin(spin) * radius });
        const other = onTile(mirror(at));
        if (!freeSpot(state, at) || !freeSpot(state, other)) continue;
        const kind = group.kind;
        if (kind === 'sheep' || kind === 'deer' || kind === 'boar') {
          addAnimal(state, kind, at);
          addAnimal(state, kind, other);
        } else {
          addNode(state, kind, at);
          addNode(state, kind, other);
        }
        placed++;
        break;
      }
    }
    if (placed) return;
  }
}

export function createGame(seed = 42, rules: GameRules = FALLBACK_RULES): GameState {
  const state: GameState = {
    rules, seed: seed || 1, tick: 0, nextId: 1, width: MAP_TILES, height: MAP_TILES,
    entities: [], projectiles: [],
    players: {
      1: { id: 1, ...rules.startingResources, age: 0, researched: [], population: 0, populationCap: 0 },
      2: { id: 2, ...rules.startingResources, age: 0, researched: [], population: 0, populationCap: 0 },
    },
    visibility: undefined as never,
  };
  state.visibility = createVisibility(state);
  const mirror = (point: Point): Point => ({ x: state.width - point.x, y: point.y });

  for (const player of [1, 2] as PlayerId[]) {
    const at = (point: Point) => player === 1 ? point : mirror(point);
    addEntity(state, 'town-center', player, at(START), rules.buildings['town-center']);
    for (const dy of [-1, 0, 1]) {
      addEntity(state, 'villager', player, at({ x: START.x + 2.8, y: START.y + dy }), rules.units.villager);
    }
    // `create_object SCOUT`, one per player at 7-9 tiles. On a board this size
    // it is not a luxury: a town center sees eight tiles and the nearest food
    // the script places is ten away, so without something to ride out and look
    // there is nothing known to gather from and the game never starts.
    addEntity(state, 'scout-cavalry', player, at({ x: START.x + 8, y: START.y }), rules.units['scout-cavalry']);
  }
  for (const group of OPENING) {
    for (let repeat = 0; repeat < (group.groups ?? 1); repeat++) placeGroup(state, group, mirror);
  }

  recalculatePopulation(state);
  updateVisibility(state);
  return state;
}

export const gameTimeSeconds = (state: GameState): number => state.tick * TICK_SECONDS;

function recalculatePopulation(state: GameState): void {
  for (const player of [1, 2] as PlayerId[]) {
    state.players[player].population = state.entities
      .filter(e => !e.dead && e.owner === player && isUnit(e.kind))
      .reduce((sum, e) => sum + state.rules.units[e.kind as UnitKind].popCost, 0);
    state.players[player].populationCap = state.rules.startingPopulationCap + state.entities
      .filter(e => !e.dead && e.owner === player && isBuilding(e.kind) && e.buildProgress === undefined)
      .reduce((sum, e) => sum + state.rules.buildings[e.kind as BuildingKind].popSupport, 0);
  }
}

function spendCost(state: GameState, player: PlayerId, cost: Cost): CommandResult {
  const p = state.players[player];
  if (p.food < cost.food || p.wood < cost.wood || p.gold < cost.gold || p.stone < cost.stone) {
    return rejected('not enough resources');
  }
  p.food -= cost.food;
  p.wood -= cost.wood;
  p.gold -= cost.gold;
  p.stone -= cost.stone;
  return { ok: true };
}

function spend(state: GameState, player: PlayerId, kind: UnitKind | BuildingKind): CommandResult {
  return spendCost(state, player, isUnit(kind) ? state.rules.units[kind].cost : state.rules.buildings[kind].cost);
}

/** What a player has researched, applied to one unit kind's rules. */
export function unitRulesFor(state: GameState, owner: Entity['owner'], kind: UnitKind): UnitRules {
  const base = state.rules.units[kind];
  if (owner === 0) return base;
  const researched = state.players[owner as PlayerId].researched;
  if (!researched.length) return base;
  let rules = base;
  for (const key of researched) {
    for (const effect of state.rules.technologies[key as TechKey]?.effects ?? []) {
      if (effect.unit !== kind) continue;
      if (rules === base) rules = { ...base, armors: base.armors.map(a => ({ ...a })) };
      if (effect.hitPoints) rules.hp += effect.hitPoints;
      for (const bonus of effect.armors ?? []) {
        const existing = rules.armors.find(a => a.class === bonus.class);
        if (existing) existing.amount += bonus.amount;
        else rules.armors.push({ ...bonus });
      }
    }
  }
  return rules;
}

/** A completed building that shoots, so it can be given a target. */
function canShoot(state: GameState, entity: Entity): boolean {
  return isBuilding(entity.kind) && entity.buildProgress === undefined
    && state.rules.buildings[entity.kind as BuildingKind].attack !== undefined;
}

/** Axis-aligned square-footprint overlap for placement legality. */
function footprintsOverlap(
  a: Point, aHalf: { x: number; y: number }, b: Point, bHalf: { x: number; y: number },
): boolean {
  return Math.abs(a.x - b.x) < aHalf.x + bHalf.x && Math.abs(a.y - b.y) < aHalf.y + bHalf.y;
}

/**
 * The half-extents a building would occupy. Everything is square except a
 * gate, which is two tiles by one and lies whichever way it was placed.
 */
export function buildingFootprint(
  state: GameState, building: BuildingKind, orientation: 'x' | 'y' = 'x',
): { x: number; y: number } {
  const rules = state.rules.buildings[building];
  const half = rules.footprint ?? { x: rules.radius, y: rules.radius };
  return orientation === 'y' ? { x: half.y, y: half.x } : { ...half };
}

export function placementLegal(
  state: GameState, building: BuildingKind, target: Point, orientation: 'x' | 'y' = 'x',
): CommandResult {
  const half = buildingFootprint(state, building, orientation);
  if (target.x - half.x < 0 || target.x + half.x > state.width
    || target.y - half.y < 0 || target.y + half.y > state.height) {
    return rejected('placement is outside the map');
  }
  // Units are ignored: real AoE nudges them off foundations (recorded approximation).
  for (const entity of state.entities) {
    if (entity.dead) continue;
    if (!isBuilding(entity.kind) && entity.kind !== 'resource') continue;
    if (footprintsOverlap(target, half, entity.position, halfExtent(entity))) {
      return rejected(`placement overlaps ${entity.kind} ${entity.id}`);
    }
  }
  return { ok: true };
}

/** Resource nodes, and the owner's finished farms, can be gathered from. */
function isGatherable(state: GameState, entity: Entity, gatherer: Entity): boolean {
  if (entity.kind === 'resource') return true;
  if (isAnimal(entity.kind)) {
    // A carcass is food for whoever reaches it. A live herdable is food only
    // for the player it has walked over to; a live deer or boar has to be
    // hunted down first.
    if ((entity.amount ?? 0) <= 0) return false;
    if (entity.dead) return true;
    return state.rules.units[entity.kind].herdRange !== undefined && entity.owner === gatherer.owner;
  }
  return entity.kind === 'farm' && entity.owner === gatherer.owner
    && entity.buildProgress === undefined && (entity.amount ?? 0) > 0;
}

/** A live animal a hunter has to kill before there is anything to carry. */
function isHuntable(state: GameState, entity: Entity): boolean {
  return isAnimal(entity.kind) && !entity.dead && (entity.amount ?? 0) > 0
    && state.rules.units[entity.kind].herdRange === undefined;
}

function assignOrder(state: GameState, entity: Entity, target: Point, targetEntity?: Entity): void {
  if (entity.kind === 'trade-cart' && targetEntity && isTradePartner(state, entity, targetEntity)) {
    entity.order = { kind: 'trade', targetId: targetEntity.id };
    entity.carrying = undefined;
  } else if (targetEntity && isGatherable(state, targetEntity, entity) && entity.kind === 'villager') {
    entity.order = { kind: 'gather', targetId: targetEntity.id };
  } else if (targetEntity && isHuntable(state, targetEntity)) {
    // Gaia owns it, so the usual "somebody else's" test never fires; hunting
    // is what an order onto a live deer or boar means.
    entity.order = { kind: 'attack', targetId: targetEntity.id };
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
      ? state.entities.find(e => e.id === command.targetId && !e.dead)
      : undefined;
    if (command.kind === 'order' && command.targetId && !targetEntity) {
      return rejected(`target ${command.targetId} does not exist`);
    }
    let matched = 0;
    for (const entity of state.entities) {
      if (entity.dead || !command.entityIds.includes(entity.id) || entity.owner !== command.player) continue;
      const defensive = canShoot(state, entity);
      if (!isUnit(entity.kind) && !defensive) continue;
      matched++;
      if (command.kind === 'stop') {
        entity.order = { kind: 'idle' };
        entity.activity = 'idle';
      } else if (defensive) {
        // A tower cannot be sent anywhere, so only a hostile target means
        // anything to it: pointing at the ground releases it back to
        // picking its own targets.
        entity.order = targetEntity && targetEntity.owner !== 0 && targetEntity.owner !== entity.owner
          ? { kind: 'attack', targetId: targetEntity.id }
          : { kind: 'idle' };
      } else {
        assignOrder(state, entity, command.target, targetEntity);
      }
    }
    return matched ? { ok: true } : rejected('no owned units matched');
  }

  if (command.kind === 'train') {
    const building = state.entities.find(e => e.id === command.buildingId && e.owner === command.player && !e.dead);
    if (!building) return rejected(`building ${command.buildingId} is not owned`);
    if (building.buildProgress !== undefined) return rejected('building is under construction');
    if (building.training) return rejected('building is already training');
    const unitRules = state.rules.units[command.unit];
    if (unitRules.trainedAt !== building.kind) return rejected(`${building.kind} cannot train ${command.unit}`);
    const player = state.players[command.player];
    if ((unitRules.age ?? 0) > player.age) return rejected(`${command.unit} needs a later age`);
    if (player.population + unitRules.popCost > player.populationCap) return rejected('population cap reached');
    const paid = spend(state, command.player, command.unit);
    if (!paid.ok) return paid;
    building.training = { kind: command.unit, remainingTicks: Math.round(unitRules.trainSeconds * TICKS_PER_SECOND) };
    return { ok: true };
  }

  if (command.kind === 'research') {
    const building = state.entities.find(e => e.id === command.buildingId && e.owner === command.player && !e.dead);
    if (!building) return rejected(`building ${command.buildingId} is not owned`);
    if (building.buildProgress !== undefined) return rejected('building is under construction');
    if (building.researching) return rejected('building is already researching');
    const tech = state.rules.technologies[command.tech as TechKey];
    if (!tech) return rejected(`unknown technology ${command.tech}`);
    if (tech.researchedAt !== building.kind) return rejected(`${building.kind} cannot research ${command.tech}`);
    const player = state.players[command.player];
    if (player.researched.includes(command.tech)) return rejected(`${command.tech} is already researched`);
    if (player.age < tech.requiresAge) return rejected(`${command.tech} needs a later age`);
    const paid = spendCost(state, command.player, tech.cost);
    if (!paid.ok) return paid;
    building.researching = {
      tech: command.tech,
      remainingTicks: Math.round(tech.researchSeconds * TICKS_PER_SECOND),
    };
    return { ok: true };
  }

  if (command.kind === 'rally') {
    const building = state.entities.find(e => e.id === command.buildingId && e.owner === command.player && !e.dead);
    if (!building || !isBuilding(building.kind)) return rejected(`building ${command.buildingId} is not owned`);
    building.rally = { target: { ...command.target }, targetId: command.targetId };
    return { ok: true };
  }

  const rules = state.rules.buildings[command.building];
  if (!rules.buildable) return rejected(`${command.building} cannot be built`);
  if ((rules.age ?? 0) > state.players[command.player].age) {
    return rejected(`${command.building} needs a later age`);
  }
  const builders = state.entities.filter(
    e => !e.dead && command.builderIds.includes(e.id) && e.owner === command.player && e.kind === 'villager',
  );
  if (!builders.length) return rejected('builders must be owned villagers');
  const orientation = command.orientation ?? 'x';
  const legal = placementLegal(state, command.building, command.target, orientation);
  if (!legal.ok) return legal;
  const paid = spend(state, command.player, command.building);
  if (!paid.ok) return paid;
  const footprint = buildingFootprint(state, command.building, orientation);
  const site = addEntity(state, command.building, command.player, command.target, rules, {
    hp: 1,
    buildProgress: 0,
    // Only a building that is longer than it is wide needs one; leaving it off
    // everything else keeps the state a square footprint writes today.
    ...(rules.footprint ? { footprint } : {}),
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

function clearPath(entity: Entity): void {
  entity.path = undefined;
  entity.pathGoal = undefined;
  entity.stuckTicks = 0;
}

/**
 * Grid path following with repathing on dynamic obstruction or lack of
 * progress. Returns true once the destination (or its nearest reachable
 * tile) is reached.
 */
/**
 * A step straight at the destination, off the grid's path. A walker standing
 * inside a footprint — the final approach and the separation nudge both move in
 * continuous space — must be able to step out again, so a tile it is already on
 * never stops it. Stepping *into* one is what it may not do: a wood is not
 * something to walk through, and neither is a wall. There it stops where it
 * stands, and reporting arrival is how the caller learns to give up rather than
 * walking on the spot forever.
 */
function moveDirect(grid: NavGrid, entity: Entity, destination: Point, speed: number): boolean {
  const from = tileOf(entity.position);
  const before = { ...entity.position };
  const arrived = moveToward(entity, destination, speed);
  const to = tileOf(entity.position);
  if ((to.x !== from.x || to.y !== from.y)
    && isBlocked(grid, to.x, to.y) && !isBlocked(grid, from.x, from.y)) {
    entity.position = before;
    return true;
  }
  return arrived;
}

function moveAlong(state: GameState, grid: NavGrid, entity: Entity, destination: Point, speed: number, directRange = 0): boolean {
  // Final approach straight at an interaction target whose footprint blocks
  // the grid; the caller's range check stops movement at its edge.
  if (directRange > 0 && distance(entity.position, destination) <= directRange) {
    return moveToward(entity, destination, speed);
  }
  const goalChanged = !entity.pathGoal ||
    Math.abs(entity.pathGoal.x - destination.x) > 0.5 || Math.abs(entity.pathGoal.y - destination.y) > 0.5;
  const nextBlocked = entity.path?.length
    ? isBlocked(grid, Math.floor(entity.path[0].x), Math.floor(entity.path[0].y))
    : false;
  if (goalChanged || nextBlocked || !entity.path || (entity.stuckTicks ?? 0) > 30) {
    entity.path = findPath(grid, entity.position, destination);
    entity.pathGoal = { ...destination };
    entity.stuckTicks = 0;
    if (!entity.path) {
      // No path at all now means the walker is boxed in on its own tile —
      // the final approach and the separation nudge both move in continuous
      // space, so a unit can end up inside a tree cluster it cannot step out
      // of. It goes straight at its destination until it is out again, which
      // is how it got in.
      clearPath(entity);
      return moveDirect(grid, entity, destination, speed);
    }
  }
  const before = { ...entity.position };
  while (entity.path.length && distance(entity.position, entity.path[0]) <= 0.12) entity.path.shift();
  if (!entity.path.length) {
    const tile = tileOf(destination);
    // The grid took us as far as it can. Either the destination is walkable
    // and we step onto it, or it is a footprint and the caller's own range
    // check stops us at its edge — but if we are still far from it, the grid
    // ran out early (a pocket) and the rest of the gap closes directly, which
    // is how the walker got in there in the first place.
    const far = distance(entity.position, destination) > Math.max(directRange, 1.5);
    const arrivedExactly = !isBlocked(grid, tile.x, tile.y) || far
      ? moveDirect(grid, entity, destination, speed)
      : true;
    if (arrivedExactly) clearPath(entity);
    return arrivedExactly;
  }
  moveToward(entity, entity.path[0], speed);
  if (distance(before, entity.position) < speed * TICK_SECONDS * 0.5) {
    entity.stuckTicks = (entity.stuckTicks ?? 0) + 1;
  } else {
    entity.stuckTicks = 0;
  }
  return false;
}

const inRange = (entity: Entity, target: Entity, margin = 0.15): boolean =>
  distance(entity.position, target.position) <= entity.radius + target.radius + margin;

/** Melee units close to contact; ranged ones stop at their weapon range. */
function attackRange(state: GameState, entity: Entity): number {
  if (isUnit(entity.kind)) return state.rules.units[entity.kind as UnitKind].range ?? 0;
  return state.rules.buildings[entity.kind as BuildingKind].attack?.range ?? 0;
}

const inAttackRange = (state: GameState, entity: Entity, target: Entity): boolean =>
  inRange(entity, target, 0.35 + attackRange(state, entity));

/** Nearer than a shooter's minimum range, where its shot has nowhere to go. */
function tooClose(state: GameState, entity: Entity, target: Entity): boolean {
  if (!isUnit(entity.kind)) return false;
  const minimum = state.rules.units[entity.kind as UnitKind].minRange ?? 0;
  return minimum > 0 && inRange(entity, target, minimum);
}

const interactionRange = (target: Entity): number => target.radius + 1.6;

/**
 * How far a worker looks for more of the same when what it was working runs
 * out. A villager sees four tiles; three times that is about the width of one
 * forest clump, which is the point — step to the next tree, not walk across
 * the map to a bush somebody scouted an hour ago.
 */
function autoContinueRange(state: GameState, entity: Entity): number {
  const los = isUnit(entity.kind) ? state.rules.units[entity.kind as UnitKind].lineOfSight : 0;
  return los * 3;
}

/**
 * Whether anything can stand next to a node to work it. A wood is a solid
 * clump of tiles, so the trees inside it are nobody's to cut until the ones
 * around them come down — and a villager sent at one walks to the edge, finds
 * it cannot get closer, and gives up. Asking the grid first is four lookups
 * against a pathfind over the whole wood.
 */
function hasElbowRoom(grid: NavGrid, node: Entity): boolean {
  const x = Math.floor(node.position.x);
  const y = Math.floor(node.position.y);
  if (!isBlocked(grid, x, y)) return true;
  return !isBlocked(grid, x + 1, y) || !isBlocked(grid, x - 1, y)
    || !isBlocked(grid, x, y + 1) || !isBlocked(grid, x, y - 1);
}

/**
 * What to work next when the current node is spent: the nearest thing of the
 * same kind first — another sheep after a sheep, the next tree in the wood —
 * and only then anything else yielding the same resource. Nothing the owner
 * cannot presently see counts, however close, and nothing beyond
 * `autoContinueRange`; a worker with nothing in reach goes idle and waits to
 * be told, which is the honest answer and what AoE2 does.
 */
function nextToWork(
  state: GameState, grid: NavGrid, entity: Entity, resource: ResourceKind,
  was: Entity['kind'] | undefined,
): Entity | undefined {
  const range = autoContinueRange(state, entity);
  const owner = entity.owner as PlayerId;
  let best: Entity | undefined;
  let bestKey = Infinity;
  for (const candidate of state.entities) {
    if (candidate.dead && !isAnimal(candidate.kind)) continue;
    if (candidate.resourceKind !== resource || (candidate.amount ?? 0) <= 0) continue;
    if (!isGatherable(state, candidate, entity)) continue;
    const d = distance(entity.position, candidate.position);
    if (d > range) continue;
    if (!isEntityVisible(state, owner, candidate)) continue;
    if (!hasElbowRoom(grid, candidate)) continue;
    // Same kind first, then distance. Adding a whole range to everything else
    // orders the two groups without a second pass, and ids break exact ties so
    // two runs of the same match choose the same thing.
    const key = d + (candidate.kind === was ? 0 : range + 1);
    if (key < bestKey - 1e-9 || (Math.abs(key - bestKey) <= 1e-9 && best && candidate.id < best.id)) {
      best = candidate;
      bestKey = key;
    }
  }
  return best;
}

/**
 * Nearest completed building of the owner that accepts `resource`. Drop-site
 * buildings are what make mills and camps worth placing: they shorten the walk
 * for one resource each, while the town center still takes everything.
 */
function nearestDropSite(state: GameState, entity: Entity, resource?: ResourceKind): Entity | undefined {
  const wanted = resource ?? entity.carrying?.kind;
  let best: Entity | undefined;
  let bestDistance = Infinity;
  for (const candidate of state.entities) {
    if (candidate.dead || candidate.owner !== entity.owner || candidate.buildProgress !== undefined) continue;
    if (!isBuilding(candidate.kind)) continue;
    const accepts = state.rules.buildings[candidate.kind as BuildingKind].accepts;
    if (!wanted || !accepts.includes(wanted)) continue;
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
  entity.attackWindup = undefined;
  entity.path = undefined;
  entity.pathGoal = undefined;
}

/** AoE2 damage: bonus per shared armor class, then a minimum of 1. */
export function computeDamage(attacks: AttackValue[], armors: AttackValue[]): number {
  let total = 0;
  for (const attack of attacks) {
    const armor = armors.find(a => a.class === attack.class);
    if (!armor) continue;
    total += Math.max(0, attack.amount - armor.amount);
  }
  return Math.max(1, total);
}

function armorsOf(state: GameState, entity: Entity): AttackValue[] {
  if (isUnit(entity.kind)) return unitRulesFor(state, entity.owner, entity.kind as UnitKind).armors;
  if (isBuilding(entity.kind)) return state.rules.buildings[entity.kind as BuildingKind].armors;
  return [];
}

function kill(state: GameState, entity: Entity): void {
  entity.dead = true;
  entity.activity = 'dying';
  entity.order = { kind: 'idle' };
  entity.training = undefined;
  entity.decayTicks = 60; // death animation window before the corpse despawns
  clearPath(entity);
}

function updateGatherer(state: GameState, grid: NavGrid, entity: Entity): void {
  if (entity.order.kind !== 'gather') return;
  const speed = state.rules.units.villager.speed;
  const capacity = state.rules.carryCapacity;
  const carrying = entity.carrying;

  if (carrying && carrying.amount >= capacity) {
    const drop = nearestDropSite(state, entity);
    if (!drop) { becomeIdle(entity); return; }
    entity.activity = 'carrying';
    if (inRange(entity, drop, 0.3)) {
      state.players[entity.owner as PlayerId][carrying.kind] += carrying.amount;
      entity.carrying = undefined;
      clearPath(entity);
    } else {
      moveAlong(state, grid, entity, drop.position, speed, interactionRange(drop));
    }
    return;
  }

  const targetId = (entity.order as { targetId: number }).targetId;
  let node = state.entities.find(e => e.id === targetId
    && (e.amount ?? 0) > 0 && (!e.dead || isAnimal(e.kind)));
  if (!node) {
    // What it was working, so it can look for another of the same first.
    const was = state.entities.find(e => e.id === targetId)?.kind;
    const wanted = carrying?.kind ?? undefined;
    node = wanted ? nextToWork(state, grid, entity, wanted, was) : undefined;
    if (node) entity.order = { kind: 'gather', targetId: node.id };
    else if (carrying && carrying.amount > 0) {
      // Nothing left to gather: bank what is carried, then idle.
      const drop = nearestDropSite(state, entity);
      if (drop && inRange(entity, drop, 0.3)) {
        state.players[entity.owner as PlayerId][carrying.kind] += carrying.amount;
        entity.carrying = undefined;
        becomeIdle(entity);
      } else if (drop) {
        entity.activity = 'carrying';
        moveAlong(state, grid, entity, drop.position, speed, interactionRange(drop));
      } else becomeIdle(entity);
      return;
    } else { becomeIdle(entity); return; }
  }

  if (!inRange(entity, node, 0.3)) {
    entity.activity = carrying && carrying.amount > 0 ? 'carrying' : 'moving';
    // Walked as far as the ground allows and still out of reach: the tree is
    // inside a wood, or the node is behind a wall. Take the nearest thing it
    // can actually stand next to instead of shuffling at the edge forever, and
    // stop if there is nothing.
    if (moveAlong(state, grid, entity, node.position, speed, interactionRange(node))) {
      const reachable = nextToWork(state, grid, entity, node.resourceKind!, node.kind);
      if (reachable && reachable.id !== node.id) {
        entity.order = { kind: 'gather', targetId: reachable.id };
      } else {
        becomeIdle(entity);
      }
    }
    return;
  }
  clearPath(entity);

  // AoE2 turns a herdable into a carcass the moment a villager works it: the
  // sheep stops walking about and the food comes off the body.
  if (isAnimal(node.kind) && !node.dead) kill(state, node);

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
  // A worked-out farm is consumed, as in AoE2 where it must be rebuilt.
  if (node.kind === 'farm' && (node.amount ?? 0) <= 0) kill(state, node);
}

/**
 * A market a cart may trade with: a finished market belonging to somebody else.
 * Trading with your own market earns nothing in AoE2, and the route needs a
 * counterparty, so this is what makes an order a trade order rather than a walk.
 */
function isTradePartner(state: GameState, cart: Entity, target: Entity): boolean {
  return target.kind === 'market' && !target.dead
    && target.buildProgress === undefined && target.owner !== cart.owner && target.owner !== 0;
}

/** The cart's own nearest finished market: where a loaded cart unloads. */
function homeMarket(state: GameState, entity: Entity): Entity | undefined {
  let best: Entity | undefined;
  let bestDistance = Infinity;
  for (const candidate of state.entities) {
    if (candidate.dead || candidate.kind !== 'market') continue;
    if (candidate.owner !== entity.owner || candidate.buildProgress !== undefined) continue;
    const d = distance(entity.position, candidate.position);
    if (d < bestDistance || (d === bestDistance && best && candidate.id < best.id)) {
      best = candidate;
      bestDistance = d;
    }
  }
  return best;
}

/**
 * A trade cart shuttling between its own market and a foreign one.
 *
 * The gold is what the road pays: the cart earns at its DAT work rate for every
 * second it spends on the road, up to what it can hold, so a longer route is
 * worth more exactly as it is in AoE2. It loads at the far market and banks
 * whole gold at its own. The remainder rides on to the next run, the same way a
 * villager's gather progress does - flooring it away would leave a short route
 * paying nothing at all rather than paying a little.
 */
function updateTrader(state: GameState, grid: NavGrid, entity: Entity): void {
  if (entity.order.kind !== 'trade') return;
  const rules = state.rules.units['trade-cart'];
  const rate = rules.tradeRatePerSecond ?? 0;
  const capacity = rules.tradeCapacity ?? 0;
  const goods = () => Math.min(capacity, Math.floor(entity.gatherProgress ?? 0));
  const travel = () => {
    entity.gatherProgress = Math.min(capacity + 1, (entity.gatherProgress ?? 0) + rate * TICK_SECONDS);
  };

  if (!entity.carrying) {
    const far = state.entities.find(e => e.id === (entity.order as { targetId: number }).targetId);
    if (!far || !isTradePartner(state, entity, far)) { becomeIdle(entity); return; }
    entity.activity = 'moving';
    if (!inRange(entity, far, 0.3)) {
      travel();
      // `moveAlong` reports true for arrived *or* unreachable, and a market
      // walled in by trees is a real map outcome. Stopping short of one has to
      // end the order, or the cart walks on the spot for the rest of the match.
      if (moveAlong(state, grid, entity, far.position, rules.speed, interactionRange(far))) {
        becomeIdle(entity);
      }
      return;
    }
    clearPath(entity);
    entity.carrying = { kind: 'gold', amount: goods() };
    return;
  }

  const home = homeMarket(state, entity);
  if (!home) { becomeIdle(entity); return; }
  entity.activity = 'carrying';
  if (!inRange(entity, home, 0.3)) {
    travel();
    entity.carrying.amount = goods();
    if (moveAlong(state, grid, entity, home.position, rules.speed, interactionRange(home))) {
      becomeIdle(entity);
    }
    return;
  }
  clearPath(entity);
  const delivered = goods();
  state.players[entity.owner as PlayerId].gold += delivered;
  entity.gatherProgress = (entity.gatherProgress ?? 0) - delivered;
  entity.carrying = undefined;
}

/**
 * The next foundation a builder carries on to once its own is finished: one of
 * the same kind touching the one just built. A wall is placed a tile at a time
 * but dragged as a line, and AoE2 builds the whole line rather than leaving
 * nine foundations behind the one segment somebody happened to task last.
 */
function adjacentSite(state: GameState, site: Entity, builder: Entity): Entity | undefined {
  // The whole run the finished piece belongs to, walked through what is
  // already standing: a builder half way along a wall would otherwise dead-end
  // at the last thing it touches and leave the far half of the drag unbuilt.
  const run = state.entities.filter(e => !e.dead && e.owner === site.owner
    && sameRun(e.kind, site.kind));
  const connected = [site];
  const seen = new Set([site.id]);
  for (let i = 0; i < connected.length; i++) {
    for (const candidate of run) {
      if (seen.has(candidate.id) || !touching(connected[i], candidate)) continue;
      seen.add(candidate.id);
      connected.push(candidate);
    }
  }
  // And only as far as the builder can see. A dragged line is contiguous, so
  // each next piece is a tile away and the whole line still gets built; what
  // this stops is the walk to a foundation on the other side of the map that
  // happens to be joined to this one by a wall somebody built an hour ago.
  const range = autoContinueRange(state, builder);
  let best: Entity | undefined;
  let bestDistance = Infinity;
  for (const candidate of connected) {
    if (candidate.buildProgress === undefined) continue;
    const gap = distance(candidate.position, site.position);
    if (gap > range || gap >= bestDistance) continue;
    best = candidate;
    bestDistance = gap;
  }
  return best;
}

/** Whether two footprints share an edge or a corner. */
function touching(a: Entity, b: Entity): boolean {
  const halfA = halfExtent(a);
  const halfB = halfExtent(b);
  return Math.abs(a.position.x - b.position.x) <= halfA.x + halfB.x + 0.01
    && Math.abs(a.position.y - b.position.y) <= halfA.y + halfB.y + 0.01;
}

/** A palisade and the gate in it are one dragged line; anything else is not. */
const PALISADE = new Set<string>(['palisade-wall', 'palisade-gate']);
const sameRun = (a: Entity['kind'], b: Entity['kind']): boolean =>
  a === b || (PALISADE.has(a) && PALISADE.has(b));

function updateBuilder(state: GameState, grid: NavGrid, entity: Entity, builderCounts: Map<number, number>): void {
  if (entity.order.kind !== 'build') return;
  const site = state.entities.find(e => !e.dead && e.id === (entity.order as { targetId: number }).targetId);
  if (!site || site.buildProgress === undefined) { becomeIdle(entity); return; }
  if (!inRange(entity, site, 0.4)) {
    entity.activity = 'moving';
    moveAlong(state, grid, entity, site.position, state.rules.units.villager.speed, interactionRange(site));
    return;
  }
  clearPath(entity);
  entity.activity = 'building';
  builderCounts.set(site.id, (builderCounts.get(site.id) ?? 0) + 1);
}

function updateAttacker(state: GameState, grid: NavGrid, entity: Entity): void {
  if (entity.order.kind !== 'attack') return;
  const targetId = (entity.order as { targetId: number }).targetId;
  const target = state.entities.find(e => !e.dead && e.id === targetId);
  if (!target || target.owner === entity.owner || target.hp <= 0) {
    // A hunter carries home what it just killed rather than standing over it.
    const carcass = state.entities.find(e => e.id === targetId);
    if (entity.kind === 'villager' && carcass && isGatherable(state, carcass, entity)) {
      entity.order = { kind: 'gather', targetId };
      entity.activity = 'moving';
      return;
    }
    becomeIdle(entity);
    return;
  }
  const rules = state.rules.units[entity.kind as UnitKind];
  if (tooClose(state, entity, target)) {
    // Inside its minimum range a skirmisher cannot bring its javelin to bear.
    // AoE2 leaves it standing there rather than closing further, which is what
    // makes minimum range a weakness rather than a formality.
    entity.attackWindup = undefined;
    entity.activity = 'idle';
    clearPath(entity);
    return;
  }
  if (!inAttackRange(state, entity, target)) {
    // Leaving range cancels a started swing: no damage before release.
    entity.attackWindup = undefined;
    entity.activity = 'moving';
    moveAlong(state, grid, entity, target.position, rules.speed, interactionRange(target) + attackRange(state, entity));
    return;
  }
  clearPath(entity);
  entity.activity = 'attacking';
  if (entity.attackCooldown !== undefined && entity.attackCooldown > 0) {
    entity.attackCooldown -= 1;
    return;
  }
  if (entity.attackWindup === undefined) {
    entity.attackWindup = Math.max(1, Math.round(rules.attackReleaseSeconds * TICKS_PER_SECOND));
  }
  entity.attackWindup -= 1;
  if (entity.attackWindup <= 0) {
    releaseAttack(state, entity, target, rules.attacks, rules.projectileSpeed, rules.launchHeight);
    entity.attackWindup = undefined;
    entity.attackCooldown = Math.max(1, Math.round(rules.attackReloadSeconds * TICKS_PER_SECOND) - Math.max(1, Math.round(rules.attackReleaseSeconds * TICKS_PER_SECOND)));
  }
}

/**
 * Melee lands immediately; a ranged shot launches an arrow that resolves on
 * impact, so damage arrives when the projectile does.
 */
function releaseAttack(
  state: GameState, shooter: Entity, target: Entity,
  attacks: AttackValue[], projectileSpeed: number | undefined, launchHeight = 0,
): void {
  if (!projectileSpeed) {
    target.hp -= computeDamage(attacks, armorsOf(state, target));
    if (target.hp <= 0) kill(state, target);
    // A wounded boar turns on whoever wounded it, which is what makes luring
    // one a decision rather than a formality.
    else if (isAnimal(target.kind) && state.rules.units[target.kind].attacks.some(a => a.amount > 0)
      && target.order.kind !== 'attack') {
      target.order = { kind: 'attack', targetId: shooter.id };
      target.activity = 'moving';
    }
    return;
  }
  state.projectiles.push({
    id: state.nextId++,
    owner: shooter.owner as PlayerId,
    position: { ...shooter.position },
    origin: { ...shooter.position },
    targetId: target.id,
    attacks: attacks.map(a => ({ ...a })),
    speed: projectileSpeed,
    launchHeight,
  });
}

function updateProjectiles(state: GameState): void {
  const remaining: typeof state.projectiles = [];
  for (const projectile of state.projectiles) {
    const target = state.entities.find(e => e.id === projectile.targetId && !e.dead);
    // The target died or despawned first: the arrow is spent, not redirected.
    if (!target) continue;
    const dx = target.position.x - projectile.position.x;
    const dy = target.position.y - projectile.position.y;
    const gap = Math.hypot(dx, dy);
    const step = projectile.speed * TICK_SECONDS;
    if (gap <= step + target.radius) {
      target.hp -= computeDamage(projectile.attacks, armorsOf(state, target));
      if (target.hp <= 0) kill(state, target);
      continue;
    }
    projectile.position = {
      x: projectile.position.x + dx / gap * step,
      y: projectile.position.y + dy / gap * step,
    };
    remaining.push(projectile);
  }
  state.projectiles = remaining;
}

/** Idle military units acquire the nearest living enemy in line of sight. */
function autoAcquire(state: GameState, entity: Entity): void {
  if (!isMilitary(entity.kind) || entity.order.kind !== 'idle') return;
  const los = state.rules.units[entity.kind as UnitKind].lineOfSight;
  let best: Entity | undefined;
  let bestDistance = Infinity;
  for (const candidate of state.entities) {
    if (candidate.dead || candidate.owner === 0 || candidate.owner === entity.owner) continue;
    const d = distance(entity.position, candidate.position) - candidate.radius;
    if (d <= los && (d < bestDistance - 1e-9 || (Math.abs(d - bestDistance) <= 1e-9 && (best?.id ?? Infinity) > candidate.id))) {
      best = candidate;
      bestDistance = d;
    }
  }
  if (best) {
    entity.order = { kind: 'attack', targetId: best.id };
    entity.activity = 'moving';
  }
}

/**
 * Towers shoot the nearest enemy in range on the same windup/reload clock as
 * units. They never move or lose their target to separation, so this is the
 * attacker loop without the approach.
 */
function updateTower(state: GameState, entity: Entity): void {
  const attack = state.rules.buildings[entity.kind as BuildingKind].attack;
  if (!attack || entity.buildProgress !== undefined) return;
  let target: Entity | undefined;
  let bestDistance = Infinity;

  // An ordered target overrides the tower's own choice for as long as it lives
  // and stays in range; once it does not, the tower goes back to defending
  // itself rather than sitting idle on a target it can no longer reach.
  if (entity.order.kind === 'attack') {
    const ordered = state.entities.find(e => e.id === (entity.order as { targetId: number }).targetId && !e.dead);
    const reachable = ordered
      && distance(entity.position, ordered.position) - ordered.radius <= entity.radius + attack.range;
    if (ordered && reachable) {
      target = ordered;
    } else if (!ordered) {
      entity.order = { kind: 'idle' };
    }
  }

  for (const candidate of target ? [] : state.entities) {
    if (candidate.dead || candidate.owner === 0 || candidate.owner === entity.owner) continue;
    // Buildings are valid targets too, but a unit in range is the live threat,
    // so units outrank them however close the building is.
    if (target && isUnit(target.kind) && !isUnit(candidate.kind)) continue;
    const outranks = isUnit(candidate.kind) && target && !isUnit(target.kind);
    const d = distance(entity.position, candidate.position) - candidate.radius;
    if (d > entity.radius + attack.range) continue;
    if (outranks || d < bestDistance - 1e-9 || (Math.abs(d - bestDistance) <= 1e-9 && (target?.id ?? Infinity) > candidate.id)) {
      target = candidate;
      bestDistance = d;
    }
  }
  if (!target) { entity.attackWindup = undefined; return; }
  if (entity.attackCooldown !== undefined && entity.attackCooldown > 0) {
    entity.attackCooldown -= 1;
    return;
  }
  if (entity.attackWindup === undefined) {
    entity.attackWindup = Math.max(1, Math.round(attack.releaseSeconds * TICKS_PER_SECOND));
  }
  entity.attackWindup -= 1;
  if (entity.attackWindup <= 0) {
    releaseAttack(state, entity, target, attack.attacks, attack.projectileSpeed, attack.launchHeight);
    entity.attackWindup = undefined;
    entity.attackCooldown = Math.max(
      1,
      Math.round(attack.reloadSeconds * TICKS_PER_SECOND) - Math.max(1, Math.round(attack.releaseSeconds * TICKS_PER_SECOND)),
    );
  }
}

function updateUnit(state: GameState, grid: NavGrid, entity: Entity, builderCounts: Map<number, number>): void {
  switch (entity.order.kind) {
    case 'move': {
      entity.activity = 'moving';
      const rules = state.rules.units[entity.kind as UnitKind];
      if (moveAlong(state, grid, entity, entity.order.target, rules.speed)) becomeIdle(entity);
      return;
    }
    case 'gather': return updateGatherer(state, grid, entity);
    case 'trade': return updateTrader(state, grid, entity);
    case 'build': return updateBuilder(state, grid, entity, builderCounts);
    case 'attack': return updateAttacker(state, grid, entity);
    default:
      entity.activity = 'idle';
      if (state.tick % 10 === 0) autoAcquire(state, entity);
  }
}

/** A spot clear of the map edge and of every building and resource footprint. */
function spawnFree(state: GameState, point: Point, radius: number): boolean {
  if (point.x - radius < 0 || point.x + radius > state.width) return false;
  if (point.y - radius < 0 || point.y + radius > state.height) return false;
  for (const entity of state.entities) {
    if (entity.dead) continue;
    if (!isBuilding(entity.kind) && entity.kind !== 'resource') continue;
    if (footprintsOverlap(point, { x: radius, y: radius }, entity.position, halfExtent(entity))) return false;
  }
  return true;
}

/**
 * Where a freshly trained unit appears. It leaves by the side facing its rally
 * point, or by the screen-bottom corner when none is set, and sweeps outward
 * from there for a clear spot: a building against the map edge would otherwise
 * push its units off the map.
 */
function spawnPoint(state: GameState, building: Entity, unitRadius: number): Point {
  // Screen depth grows with x+y, so (1,1) is the corner nearest the viewer.
  let direction: Point = { x: 1, y: 1 };
  if (building.rally) {
    const dx = building.rally.target.x - building.position.x;
    const dy = building.rally.target.y - building.position.y;
    if (Math.abs(dx) + Math.abs(dy) > 1e-6) direction = { x: dx, y: dy };
  }
  const preferred = Math.atan2(direction.y, direction.x);
  const base = building.radius + unitRadius + 0.2;
  for (let ring = 0; ring < 10; ring++) {
    const distance = base + ring * 0.5;
    // Alternate to either side of the preferred heading, so the unit stays as
    // close to the intended side as the surroundings allow.
    for (let step = 0; step <= 16; step++) {
      const offset = (step % 2 === 0 ? 1 : -1) * Math.ceil(step / 2) * (Math.PI / 8);
      const angle = preferred + offset;
      const point = {
        x: building.position.x + Math.cos(angle) * distance,
        y: building.position.y + Math.sin(angle) * distance,
      };
      if (spawnFree(state, point, unitRadius)) return point;
    }
  }
  // Hemmed in on every side: place it on the building and let separation sort
  // it out rather than dropping the unit the player paid for.
  return { ...building.position };
}

function spawnTrainedUnit(state: GameState, building: Entity, kind: UnitKind): void {
  const rules = unitRulesFor(state, building.owner, kind);
  const spawn = spawnPoint(state, building, rules.radius);
  const unit = addEntity(state, kind, building.owner, spawn, rules);
  if (building.rally) {
    const target = building.rally.targetId
      ? state.entities.find(e => e.id === building.rally!.targetId)
      : undefined;
    assignOrder(state, unit, building.rally.target, target);
  }
}

/**
 * A finished technology moves the player on. An age is a number the rules read
 * for what may be built and trained; anything else is a flat change to a unit
 * kind, which existing units feel too — AoE2's Loom heals the villagers you
 * already have.
 */
function completeResearch(state: GameState, owner: PlayerId, key: string): void {
  const tech = state.rules.technologies[key as TechKey];
  const player = state.players[owner];
  if (!tech || player.researched.includes(key)) return;
  player.researched.push(key);
  if (tech.grantsAge !== undefined) player.age = Math.max(player.age, tech.grantsAge);
  for (const effect of tech.effects) {
    if (!effect.hitPoints) continue;
    for (const entity of state.entities) {
      if (entity.dead || entity.owner !== owner || entity.kind !== effect.unit) continue;
      entity.maxHp += effect.hitPoints;
      entity.hp += effect.hitPoints;
    }
  }
}

function updateBuildingResearch(state: GameState, entity: Entity): void {
  if (!entity.researching) return;
  entity.researching.remainingTicks -= 1;
  if (entity.researching.remainingTicks > 0) return;
  const key = entity.researching.tech;
  entity.researching = undefined;
  completeResearch(state, entity.owner as PlayerId, key);
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

function isDefeated(state: GameState, player: PlayerId): boolean {
  let townCenter = false;
  let unit = false;
  let production = false;
  for (const entity of state.entities) {
    if (entity.dead || entity.owner !== player || isAnimal(entity.kind)) continue;
    if (entity.kind === 'town-center') townCenter = true;
    if (isUnit(entity.kind)) unit = true;
    if ((entity.kind === 'barracks' || entity.kind === 'town-center')
      && entity.buildProgress === undefined) production = true;
  }
  // Domination: no units and nothing that can produce them (approximation of
  // AoE2 conquest, which requires razing everything).
  return !townCenter || (!unit && !production);
}

/**
 * Gaia's animals decide for themselves once a tick.
 *
 * A herdable walks over to whoever came closest and then follows them, which is
 * how a scout brings sheep home; two players' units in range and it stays where
 * it is, as in AoE2. A deer bolts from anything that is not gaia. A boar does
 * neither — its answer is in `releaseAttack`.
 */
const ANIMAL_INTERVAL = 5; // ticks; a quarter second is quick enough to herd by

function updateAnimals(state: GameState): void {
  if (state.tick % ANIMAL_INTERVAL !== 0) return;
  const animals: Entity[] = [];
  const units: Entity[] = [];
  for (const entity of state.entities) {
    if (entity.dead || !isUnit(entity.kind)) continue;
    if (isAnimal(entity.kind)) animals.push(entity);
    else if (entity.owner !== 0) units.push(entity);
  }
  if (!animals.length || !units.length) return;
  for (const animal of animals) {
    if (animal.order.kind === 'attack') continue;
    const rules = state.rules.units[animal.kind as AnimalKind];
    let nearest: Entity | undefined;
    let nearestDistance = Infinity;
    let claimant: PlayerId | 0 = 0;
    let contested = false;
    for (const other of units) {
      const d = distance(other.position, animal.position);
      if (d < nearestDistance) { nearest = other; nearestDistance = d; }
      if (rules.herdRange !== undefined && d <= rules.herdRange) {
        if (claimant && other.owner !== claimant) contested = true;
        claimant = other.owner as PlayerId;
      }
    }
    if (rules.herdRange !== undefined) {
      // A herdable joins whoever came closest, stops where it stands, and is
      // theirs to move from then on. Driving it after that — following the
      // nearest unit about — would overwrite every order given to it a moment
      // later, which is the same as not being able to command it at all.
      if (!contested && claimant && animal.owner !== claimant) {
        animal.owner = claimant;
        becomeIdle(animal);
      }
      continue;
    }
    if (rules.fleeRange === undefined || !nearest || nearestDistance > rules.fleeRange) continue;
    const dx = animal.position.x - nearest.position.x;
    const dy = animal.position.y - nearest.position.y;
    const away = Math.max(1e-6, Math.hypot(dx, dy));
    animal.order = {
      kind: 'move',
      target: {
        x: Math.min(state.width - 0.6, Math.max(0.6, animal.position.x + dx / away * rules.fleeRange)),
        y: Math.min(state.height - 0.6, Math.max(0.6, animal.position.y + dy / away * rules.fleeRange)),
      },
    };
  }
}

export function stepGame(state: GameState): void {
  if (state.winner) return;
  state.tick += 1;
  updateAnimals(state);
  const grid = buildNavGrid(state);
  // A gate is a hole in its owner's wall and a wall to everybody else, so the
  // owner of one walks a different map. Only players who have one pay for it.
  const owned = new Map<PlayerId, NavGrid>();
  for (const entity of state.entities) {
    if (entity.dead || entity.owner === 0 || entity.buildProgress !== undefined) continue;
    if (!state.rules.buildings[entity.kind as BuildingKind]?.passableForOwner) continue;
    const owner = entity.owner as PlayerId;
    if (!owned.has(owner)) owned.set(owner, buildNavGrid(state, undefined, owner));
  }
  const builderCounts = new Map<number, number>();
  const movable: Entity[] = [];
  for (const entity of [...state.entities]) {
    if (entity.dead) {
      entity.decayTicks = (entity.decayTicks ?? 0) - 1;
      continue;
    }
    if (isUnit(entity.kind)) {
      updateUnit(state, (entity.owner !== 0 && owned.get(entity.owner as PlayerId)) || grid, entity, builderCounts);
      movable.push(entity);
    } else if (isBuilding(entity.kind) && entity.buildProgress === undefined) {
      updateBuildingProduction(state, entity);
      updateBuildingResearch(state, entity);
      updateTower(state, entity);
    }
  }
  separateUnits(state, movable, grid);
  updateProjectiles(state);
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
      const farmAmount = state.rules.buildings[site.kind as BuildingKind].farmAmount;
      if (farmAmount !== undefined) {
        // A finished farm becomes a food source its owner can work until spent.
        site.resourceKind = 'food';
        site.amount = farmAmount;
        // Builders keep working it as gatherers instead of standing idle.
        for (const builder of state.entities) {
          if (builder.order.kind === 'build' && builder.order.targetId === site.id) {
            builder.order = { kind: 'gather', targetId: site.id };
            builder.activity = 'moving';
          }
        }
      }
      for (const builder of state.entities) {
        if (builder.order.kind === 'build' && builder.order.targetId === site.id) {
          const next = adjacentSite(state, site, builder);
          if (next) { builder.order = { kind: 'build', targetId: next.id }; builder.activity = 'moving'; }
          else becomeIdle(builder);
        }
      }
      recalculatePopulation(state);
    }
  }

  updateVisibility(state);

  const newlyDead = state.entities.some(e => !e.dead && (e.hp <= 0 || (e.kind === 'resource' && (e.amount ?? 0) <= 0)));
  if (newlyDead) {
    for (const entity of state.entities) {
      if (!entity.dead && (entity.hp <= 0 || (entity.kind === 'resource' && (entity.amount ?? 0) <= 0))) kill(state, entity);
    }
  }
  // A carcass outlasts the corpse window while it still has food on it: that is
  // what a hunted deer is for.
  const expired = state.entities.some(e => e.dead && (e.decayTicks ?? 0) <= 0 && (e.amount ?? 0) <= 0);
  if (expired) {
    state.entities = state.entities.filter(
      e => !e.dead || (e.decayTicks ?? 0) > 0 || (e.amount ?? 0) > 0,
    );
  }
  if (newlyDead || expired) recalculatePopulation(state);

  // Asked every tick, not only when `newlyDead` fired: an attack resolves its
  // own kill the moment the blow lands, so a town center razed in a fight never
  // reaches that flag. One match ran the full half hour with the loser's town
  // center rubble and nothing left to decide it.
  const p1Out = isDefeated(state, 1);
  const p2Out = isDefeated(state, 2);
  if (p1Out && !p2Out) state.winner = 2;
  else if (p2Out && !p1Out) state.winner = 1;
  else if (p1Out && p2Out) state.winner = 2; // simultaneous: attacker's tick order favors 2 deterministically
}

export function nearestEntity(state: GameState, point: Point, maxDistance = 1.3): Entity | undefined {
  return state.entities
    .map(entity => ({ entity, d: distance(entity.position, point) - entity.radius }))
    .filter(item => item.d <= maxDistance)
    .sort((a, b) => a.d - b.d || a.entity.id - b.entity.id)[0]?.entity;
}
