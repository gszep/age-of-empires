import {
  BUILDING_RESTRICTION, GARRISON_CATEGORY, FALLBACK_RULES, LAND_RESTRICTION, TICK_SECONDS, TICKS_PER_SECOND,
  OPEN_WATER_TERRAINS, groundAllows, isAnimal, isBuilding, isUnit, restrictionOf, rowAdmitsWater,
  terrainAllows, NODE_OF_RESOURCE,
} from './data';
import type {
  AttackValue, BuildingRules, Cost, GameRules, NodeKind, TechEffect, TechKey, UnitRules, VillagerGatherTask,
} from './data';
import { MAPS, generateMap } from './mapgen';
import { isWallLineKind } from './buildings';
import { elevationAt, elevationAllowsPlacement, elevationDamageMultiplier, levelStartingFootprint } from './elevation';
import {
  buildNavGrid, distance, entityGrid, findPath, halfExtent, isBlocked, separateUnits, terrainLayer, tileOf, type NavGrid,
} from './nav';
import { random01, seedFrom } from './random';
import { buildingLimitReached, buildingRulesFor, combine, inheritConvertedUnit, playerAttributeFor, unitRulesFor, unitRulesForEntity } from './rules';
import { civilizationRules, rulesForPlayer } from './civilizations';
import { technologyFor, technologyRequirementsMet } from './technologies';
import { relicOrder, transferRelic, releaseRelics, updateRelicIncome } from './relics';
import { conversionWindow, rechargeFaith, spendConversionFaith } from './monastery';
import { placeArabiaRelics } from './relic-placement';
import { createVisibility, isEntityVisible, updateVisibility } from './visibility';
import type {
  AnimalKind, BuildingKind, Command, Entity, GameState, Order, PlayerId, Point, Projectile, ResourceKind,
  UnitKind, ReadonlyGameState, DeepReadonly,
} from './types';


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

/** Gaia's node of this kind at this spot: the one constructor every tree, bush and mine goes through. */
export function addNode(state: GameState, node: NodeKind, position: Point): Entity {
  const rules = state.rules.nodes[node];
  return addEntity(state, 'resource', 0, position, { hp: 1, radius: rules.radius }, {
    resourceKind: rules.resource,
    amount: rules.amount,
    node,
  });
}

/** Which node rules a resource entity plays by: its own kind, or the one its
 * resource implies on a board dealt before nodes were told apart. */
export function nodeOf(entity: Entity): NodeKind {
  return entity.node ?? NODE_OF_RESOURCE[entity.resourceKind ?? 'wood'];
}

/** A fish, shore or deep: what a boat may gather and a villager may cast for from the bank. */
export function isFishNode(entity: Entity): boolean {
  return entity.kind === 'resource' && (entity.node === 'shore-fish' || entity.node === 'fish');
}

/**
 * AoE2's "tiny", square. The game's own string table encodes each map size's
 * tile dimension in its key: `MAPSIZE_TINY` is 25120, `MAPSIZE_SMALL` 25144,
 * `MAPSIZE_NORMAL` 25200. Tiny is what two players get, and it is the smallest
 * board the original's opening resources are laid out for.
 */
export const MAP_TILES = 120;

/** Default town-center position. Baked maps scale the same quarter-map
 * placement to their own dimensions; the other player mirrors across x. */
const startFor = (width: number, height: number): Point => ({
  x: width / 4,
  y: height / 2,
});

function addAnimal(state: GameState, kind: AnimalKind, position: Point): Entity {
  const rules = state.rules.units[kind];
  return addEntity(state, kind, 0, position, rules, {
    resourceKind: 'food',
    amount: rules.foodAmount ?? 0,
  });
}

/** A point inside the map, clear of every footprint already placed. Border
 * tiles count: a forest-based map seals its rim with trees, and a one-tile
 * walkable ring around the wood would be a route the road is meant to be. */
function freeSpot(state: GameState, at: Point): boolean {
  return spawnFree(state, at, 0.5);
}

export function createGame(
  seed = 42, rules: GameRules = FALLBACK_RULES,
  civilizations: Record<PlayerId, string> = { 1: rules.civilization.key, 2: rules.civilization.key },
  map = 'arabia',
): GameState {
  // A civilisation label is not a ruleset; both players must resolve before
  // generating the map or spending any resources.
  for (const player of [1, 2] as const) {
    if (!civilizationRules(rules, civilizations[player])) {
      throw new Error(`civilisation ${civilizations[player]} is not loaded for player ${player}`);
    }
  }
  const descriptor = MAPS[map];
  if (!descriptor) throw new Error(`unknown map type ${map}`);
  const width = descriptor.baked?.width ?? MAP_TILES;
  const height = descriptor.baked?.height ?? MAP_TILES;
  const start = startFor(width, height);
  const state: GameState = {
    rules, seed: seedFrom(seed || 1), matchSeed: seedFrom(seed || 1), tick: 0, nextId: 1, width, height,
    entities: [], projectiles: [], terrain: [], elevation: [],
    players: {
      1: {
        id: 1, civilization: civilizations[1], ...civilizationRules(rules, civilizations[1])!.startingResources,
        age: 0, researched: [], population: 0, populationCap: 0,
      },
      2: {
        id: 2, civilization: civilizations[2], ...civilizationRules(rules, civilizations[2])!.startingResources,
        age: 0, researched: [], population: 0, populationCap: 0,
      },
    },
    visibility: undefined as never,
  };
  state.visibility = createVisibility(state);
  const mirror = (point: Point): Point => ({ x: state.width - point.x, y: point.y });

  for (const player of [1, 2] as PlayerId[]) {
    const rules = rulesForPlayer(state, player);
    const at = (point: Point) => player === 1 ? point : mirror(point);
    addEntity(state, 'town-center', player, at(start), rules.buildings['town-center']);
    for (const dy of [-1, 0, 1]) {
      addEntity(state, 'villager', player, at({ x: start.x + 2.8, y: start.y + dy }), rules.units.villager);
    }
    // `create_object SCOUT`, one per player at 7-9 tiles. On a board this size
    // it is not a luxury: a town center sees eight tiles and the nearest food
    // the script places is ten away, so without something to ride out and look
    // there is nothing known to gather from and the game never starts.
    addEntity(state, 'scout-cavalry', player, at({ x: start.x + 8, y: start.y }), rules.units['scout-cavalry']);
  }
  // Real-world map landmarks are surveyed points in the baked descriptor,
  // represented with existing owned art. Place them before terrain objects so
  // a forest tile cannot grow a tree through Windsor Castle or the Copper Horse.
  for (const landmark of descriptor.baked?.landmarks ?? []) {
    if (isBuilding(landmark.kind)) {
      addEntity(state, landmark.kind, 0, { x: landmark.x, y: landmark.y }, rules.buildings[landmark.kind]);
    } else if (isUnit(landmark.kind)) {
      addEntity(state, landmark.kind, 0, { x: landmark.x, y: landmark.y }, rules.units[landmark.kind]);
    }
  }
  const { terrain, elevation } = generateMap(
    {
      rng: state, width: state.width, height: state.height,
      nodes: rules.nodes,
      free: at => freeSpot(state, at),
      place: (kind, at) => {
        if (kind === 'sheep' || kind === 'deer' || kind === 'boar') addAnimal(state, kind, at);
        else addNode(state, kind as NodeKind, at);
      },
    },
    descriptor, [start, mirror(start)], mirror,
  );
  state.terrain = terrain;
  state.elevation = elevation;
  if (map === 'arabia') placeArabiaRelics(state);
  for (const home of state.entities) {
    if (home.kind === 'town-center' && home.owner !== 0) {
      levelStartingFootprint(state, home.position, buildingFootprint(state, home.kind, 'x', home.owner));
    }
  }

  activateAutomaticTechnologies(state);
  recalculatePopulation(state);
  updateVisibility(state);
  return state;
}

export const gameTimeSeconds = (state: GameState): number => state.tick * TICK_SECONDS;

function recalculatePopulation(state: GameState): void {
  for (const player of [1, 2] as PlayerId[]) {
    const rules = rulesForPlayer(state, player);
    state.players[player].population = state.entities
      .filter(e => !e.dead && e.owner === player && isUnit(e.kind))
      .reduce((sum, e) => sum + unitRulesForEntity(state, e).popCost, 0)
      // A unit inside a building is out of the list and still a person.
      + state.entities
        .filter(e => !e.dead && e.owner === player && e.garrison?.length)
        .reduce((sum, e) => sum + e.garrison!.reduce(
          (inner, unit) => inner + unitRulesForEntity(state, unit).popCost, 0), 0);
    state.players[player].populationCap = rules.startingPopulationCap + state.entities
      .filter(e => !e.dead && e.owner === player && isBuilding(e.kind) && e.buildProgress === undefined)
      .reduce((sum, e) => sum + rules.buildings[e.kind as BuildingKind].popSupport, 0);
  }
}

/** The first resource a price cannot be met in, in the reference's own order. */
export function shortfall(state: GameState, player: PlayerId, cost: Cost): ResourceKind | undefined {
  const p = state.players[player];
  for (const resource of ['food', 'wood', 'stone', 'gold'] as ResourceKind[]) {
    if (p[resource] < cost[resource]) return resource;
  }
  return undefined;
}

function spendCost(state: GameState, player: PlayerId, cost: Cost): CommandResult {
  const p = state.players[player];
  // Named, as the reference names it: "Not enough wood." (issue #70).
  const short = shortfall(state, player, cost);
  if (short) return rejected(`not enough ${short}`);
  p.food -= cost.food;
  p.wood -= cost.wood;
  p.gold -= cost.gold;
  p.stone -= cost.stone;
  return { ok: true };
}

function spend(state: GameState, player: PlayerId, kind: UnitKind | BuildingKind): CommandResult {
  return spendCost(state, player, isUnit(kind)
    ? unitRulesFor(state, player, kind).cost : buildingRulesFor(state, player, kind).cost);
}

/**
 * Does this player's civilisation have the thing at all? An AoE2 civilisation
 * is mostly defined by what it withholds -- the Britons get no Thumb Ring, no
 * Paladin, no Hussar -- and the depot's own tech tree marks each of those
 * nodes `NotAvailable`. Anything the imported content has no DAT id for is
 * allowed: the question cannot be asked of it.
 */
export function civHas(
  state: GameState, player: PlayerId,
  table: 'technologies' | 'units' | 'buildings', datId: number | undefined,
): boolean {
  const civilization = civilizationRules(state.rules, state.players[player].civilization)?.civilization;
  if (!civilization) return false;
  if (datId === undefined) return true;
  return !civilization.unavailable[table].includes(datId);
}

const civNameOf = (state: GameState, player: PlayerId): string =>
  rulesForPlayer(state, player).civilization.name;

/**
 * Has this player upgraded past this unit? AoE2 does not let a barracks keep
 * offering the militia once the man-at-arms exists -- the upgrade replaces the
 * unit rather than adding a second one beside it.
 */
export function upgradedAway(state: GameState, player: PlayerId, kind: string): boolean {
  for (const key of state.players[player].researched) {
    for (const upgrade of technologyFor(rulesForPlayer(state, player), key)?.upgrades ?? []) {
      if (upgrade.from === kind) return true;
    }
  }
  return false;
}

/**
 * ...and the other side of it: a unit that only exists as the far end of an
 * upgrade cannot be trained until that upgrade is researched. The DAT gives
 * the man-at-arms no enabling technology of its own -- being upgraded into is
 * how it becomes available -- so without this it would sit in the Dark Age
 * barracks beside the militia it is supposed to replace.
 */
export function notYetUpgradedInto(state: GameState, player: PlayerId, kind: string): boolean {
  let isUpgradeTarget = false;
  for (const [key, tech] of Object.entries(rulesForPlayer(state, player).technologies)) {
    for (const upgrade of tech.upgrades ?? []) {
      if (upgrade.to !== kind) continue;
      isUpgradeTarget = true;
      if (state.players[player].researched.includes(key)) return false;
    }
  }
  return isUpgradeTarget;
}

// unitRulesFor and buildingRulesFor live in rules.ts (visibility needs them
// too); re-exported here because every consumer of the sim imports them from
// the game module.
export { buildingRulesFor, playerAttributeFor, unitRulesFor, unitRulesForEntity } from './rules';
export { rulesForPlayer } from './civilizations';

/**
 * How much food a farm this player builds now holds. The DAT keeps it as a
 * player attribute (resource 36, 175 to begin with) rather than on the farm,
 * which is exactly why the mill's technologies can change it: Horse Collar
 * adds 75 and Heavy Plow another 125, and neither touches a unit this game
 * models. A farm already in the ground keeps what is left in it, as in AoE2 --
 * the research pays off on the next one sown.
 */
export function farmFoodAmountFor(state: GameState, owner: Entity['owner']): number | undefined {
  const amount = playerAttributeFor(state, owner, 'farmFoodAmount');
  return amount === undefined ? undefined : Math.round(amount);
}

/**
 * Sow a fallow farm again where it stood. Returns the new foundation, or
 * nothing when the player has not asked for it, cannot pay, or the ground is
 * no longer free -- each of which leaves the villager to the ordinary rule for
 * what to work next.
 */
function reseedFarm(state: GameState, builder: Entity, fallow: Entity): Entity | undefined {
  const owner = builder.owner;
  if (owner === 0 || !state.players[owner as PlayerId].autoReseedFarms) return undefined;
  const at = { ...fallow.position };
  if (!placementLegal(state, 'farm', at, 'x', owner).ok) return undefined;
  if (!spend(state, owner as PlayerId, 'farm').ok) return undefined;
  const rules = buildingRulesFor(state, owner, 'farm');
  const site = addEntity(state, 'farm', owner, at, rules, { hp: 1, buildProgress: 0 });
  site.maxHp = rules.hp;
  return site;
}

/**
 * How fast this player gathers a resource, and how much a villager carries.
 * The DAT puts both on the villager's task variants -- the gold miner is its
 * own unit -- so Gold Shaft Mining is a work-rate change to `villager-goldminer`
 * and Wheelbarrow a carry-capacity change to every one of them.
 */
const GATHER_TASK: Record<ResourceKind, VillagerGatherTask> = {
  food: 'forager', wood: 'lumberjack', gold: 'goldminer', stone: 'stonemason',
};

export function gatherRateFor(
  state: GameState, owner: Entity['owner'], resource: ResourceKind,
): number {
  const task = GATHER_TASK[resource];
  return researchedAttribute(state, owner, `villager-${task}`, 'workRate', rulesForPlayer(state, owner).villagerGather[task].ratePerSecond);
}

export function carryCapacityFor(state: GameState, owner: Entity['owner'], task: VillagerGatherTask = 'forager'): number {
  return researchedAttribute(state, owner, `villager-${task}`, 'carryCapacity', rulesForPlayer(state, owner).villagerGather[task].capacity);
}

/** A technology's running change to one attribute of one unit key. */
function researchedAttribute(
  state: GameState, owner: Entity['owner'], unit: string, attribute: string, base: number,
): number {
  let value = base;
  if (owner === 0) return value;
  for (const key of state.players[owner as PlayerId].researched) {
    for (const effect of technologyFor(rulesForPlayer(state, owner), key)?.effects ?? []) {
      if (effect.attribute !== attribute || effect.unit !== unit) continue;
      value = combine(effect.operation, value, effect.amount);
    }
  }
  return value;
}

/** Task identity is about the food source, not the shared food stockpile. */
function villagerTaskOn(state: GameState, node: Entity): VillagerGatherTask {
  if (node.kind === 'farm') return 'farmer';
  if (isAnimal(node.kind)) return rulesForPlayer(state, node.owner).units[node.kind].herdRange !== undefined ? 'shepherd' : 'hunter';
  if (isFishNode(node)) return 'fisher';
  return GATHER_TASK[node.resourceKind ?? 'food'];
}

/** The task's capacity, including its own technology effects. The load keeps
 * its task when a depleted target disappears during the walk to a drop site. */
export function holdOf(state: GameState, entity: Entity, node?: Entity): number {
  const own = rulesForPlayer(state, entity.owner).units[entity.kind as UnitKind]?.gather;
  if (!own) {
    const targetId = entity.order.kind === 'gather' ? entity.order.targetId : undefined;
    const target = node ?? state.entities.find(e => e.id === targetId);
    const task = target ? villagerTaskOn(state, target) : entity.carrying?.task ?? 'forager';
    return carryCapacityFor(state, entity.owner, task);
  }
  return researchedAttribute(state, entity.owner, entity.kind, 'carryCapacity', own.capacity);
}

/**
 * How fast this gatherer works this node. A fishing ship is its own DAT
 * gatherer: its work rate times the task factor for the node's class (a deep
 * fish 1.75, a shore fish 1.0), under its own technologies. A villager on a
 * fish is the fisherman task unit; farms, game and herdables have distinct
 * task variants too, with distinct rates and technology effects.
 */
export function rateOn(state: GameState, entity: Entity, node: Entity): number {
  const own = rulesForPlayer(state, entity.owner).units[entity.kind as UnitKind]?.gather;
  if (own) {
    const rules = node.kind === 'resource' ? state.rules.nodes[nodeOf(node)] : undefined;
    const factor = node.kind === 'fish-trap' ? own.trapFactor ?? 1
      : rules?.datClass !== undefined ? own.classFactors[String(rules.datClass)] ?? 1 : 1;
    return researchedAttribute(state, entity.owner, entity.kind, 'workRate', own.ratePerSecond) * factor;
  }
  const task = villagerTaskOn(state, node);
  return researchedAttribute(state, entity.owner, `villager-${task}`, 'workRate', rulesForPlayer(state, entity.owner).villagerGather[task].ratePerSecond);
}

/** A completed building that shoots, so it can be given a target. */
function canShoot(state: GameState, entity: Entity): boolean {
  return isBuilding(entity.kind) && entity.buildProgress === undefined
    && rulesForPlayer(state, entity.owner).buildings[entity.kind as BuildingKind].attack !== undefined;
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
  state: GameState, building: BuildingKind, orientation: 'x' | 'y' = 'x', owner: Entity['owner'] = 0,
): { x: number; y: number } {
  const rules = buildingRulesFor(state, owner, building);
  const half = rules.footprint ?? { x: rules.radius, y: rules.radius };
  return orientation === 'y' ? { x: half.y, y: half.x } : { ...half };
}

export function placementLegal(
  state: GameState, building: BuildingKind, target: Point, orientation: 'x' | 'y' = 'x', owner: Entity['owner'] = 0,
): CommandResult {
  const half = buildingFootprint(state, building, orientation, owner);
  const rules = rulesForPlayer(state, owner);
  if (target.x - half.x < 0 || target.x + half.x > state.width
    || target.y - half.y < 0 || target.y + half.y > state.height) {
    return rejected('placement is outside the map');
  }
  // The ground under every tile of the footprint has to take the building:
  // the DAT's restriction row for it (4 for a house, 10 for a wall), which
  // is what keeps a house out of a pond and would put a dock on the shore.
  if (state.terrain.length === state.width * state.height) {
    const row = rules.buildings[building].terrainRestriction ?? BUILDING_RESTRICTION;
    const minX = Math.max(0, Math.floor(target.x - half.x + 1e-6));
    const maxX = Math.min(state.width - 1, Math.ceil(target.x + half.x - 1e-6) - 1);
    const minY = Math.max(0, Math.floor(target.y - half.y + 1e-6));
    const maxY = Math.min(state.height - 1, Math.ceil(target.y + half.y - 1e-6) - 1);
    let wet = 0;
    let dry = 0;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const terrain = state.terrain[y * state.width + x];
        if (!terrainAllows(rules, row, terrain)) {
          return rejected('placement is on ground that cannot take it');
        }
        if (OPEN_WATER_TERRAINS.has(terrain)) wet++;
        else dry++;
      }
    }
    // A building whose row admits the sea -- the dock's row 6 takes water
    // and beach -- is a shore building: it has to reach the water and to
    // touch the land, which is the engine's own placement rule for it and
    // what a table of terrains alone cannot say.
    const admitsWater = rowAdmitsWater(rules, row);
    if (admitsWater && wet === 0) return rejected('placement does not reach the water');
    if (building === 'fish-trap' && dry > 0) return rejected('fish traps must be on water');
    if (admitsWater && dry === 0 && building !== 'fish-trap') return rejected('placement does not touch the shore');
  }
  const hillMode = rules.buildings[building].hillMode ?? FALLBACK_RULES.buildings[building].hillMode ?? 0;
  if (!elevationAllowsPlacement(state, target, half, hillMode)) {
    return rejected('placement is on unsuitable elevation');
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
/**
 * A corpse that is still worth something. AoE2 lets a player click a hunted
 * animal to read the food left on it, and the thing that separates that from a
 * dead soldier is what it carries: in the DAT only the huntables and herdables
 * store food, and here only a carcass keeps an `amount` after it dies. Corpses
 * with nothing left decay unselected, as they should.
 */
export function isCarcass(entity: Entity): boolean {
  return !!entity.dead && (entity.amount ?? 0) > 0;
}

/** A farmer's gather order reserves the farm while walking and banking too.
 * Derive the claim from live orders so Stop, death and retasking release it
 * immediately. Lowest id resolves duplicate orders in pre-fix saved matches. */
function farmAvailable(state: GameState, farm: Entity, gatherer: Entity): boolean {
  let farmer: Entity | undefined;
  for (const worker of state.entities) {
    if (worker.dead || worker.kind !== (farm.kind === 'fish-trap' ? 'fishing-ship' : 'villager') || worker.owner !== farm.owner
      || worker.order.kind !== 'gather' || worker.order.targetId !== farm.id) continue;
    if (!farmer || worker.id < farmer.id) farmer = worker;
  }
  return !farmer || farmer.id === gatherer.id;
}

function isGatherable(state: GameState, entity: Entity, gatherer: Entity): boolean {
  // A boat gathers fish and nothing else; a villager casts for fish from the
  // bank as it picks a bush, and its reach is what decides which fish.
  if (gatherer.kind !== 'villager' && gatherer.kind !== 'fishing-ship') return false;
  if (gatherer.kind === 'fishing-ship') return (isFishNode(entity) || (entity.kind === 'fish-trap'
    && entity.owner === gatherer.owner && entity.buildProgress === undefined && farmAvailable(state, entity, gatherer)))
    && !entity.dead && (entity.amount ?? 0) > 0;
  if (entity.kind === 'resource') return true;
  if (isAnimal(entity.kind)) {
    // A carcass is food for whoever reaches it. A live herdable is food only
    // for the player it has walked over to; a live deer or boar has to be
    // hunted down first.
    if ((entity.amount ?? 0) <= 0) return false;
    if (entity.dead) return true;
    return rulesForPlayer(state, entity.owner).units[entity.kind].herdRange !== undefined && entity.owner === gatherer.owner;
  }
  return entity.kind === 'farm' && entity.owner === gatherer.owner
    && !entity.dead && entity.buildProgress === undefined && (entity.amount ?? 0) > 0
    && farmAvailable(state, entity, gatherer);
}

/** A group sent to an occupied farm spreads to visible free farms nearby. */
function nearbyFreeFarm(state: GameState, worker: Entity, origin: Point): Entity | undefined {
  let best: Entity | undefined;
  let bestDistance = autoContinueRange(state, worker);
  for (const candidate of state.entities) {
    if (candidate.kind !== (worker.kind === 'fishing-ship' ? 'fish-trap' : 'farm') || !isGatherable(state, candidate, worker)
      || !isEntityVisible(state, worker.owner as PlayerId, candidate)) continue;
    const d = distance(origin, candidate.position);
    if (d < bestDistance || (d === bestDistance && (!best || candidate.id < best.id))) {
      best = candidate;
      bestDistance = d;
    }
  }
  return best;
}

/** A live animal a hunter has to kill before there is anything to carry. */
function isHuntable(state: GameState, entity: Entity): boolean {
  return isAnimal(entity.kind) && !entity.dead && (entity.amount ?? 0) > 0
    && rulesForPlayer(state, entity.owner).units[entity.kind].herdRange === undefined;
}

/** Pure right-click classification, shared by execution and cursor feedback.
 * In particular, checking a hover must not reserve farms or reset work progress.
 */
export function resolveUnitOrder(state: GameState, entity: Entity, target: Point, targetEntity?: Entity): Order {
  const relic = relicOrder(state, entity, targetEntity);
  if (relic) return relic;
  const unitRules = isUnit(entity.kind) ? unitRulesForEntity(state, entity) : undefined;
  // A unit with no attack is never given one by a right-click: a monk sent at
  // a boar would otherwise stand over it forever, swinging nothing.
  const armed = !unitRules || combatOf(state, entity).attacks.some(attack => attack.amount > 0);
  if (targetEntity && canCrossWall(state, entity, targetEntity)) {
    return { kind: 'cross-wall', targetId: targetEntity.id };
  }
  if ((entity.kind === 'trade-cart' || entity.kind === 'trade-cog') && targetEntity && isTradePartner(state, entity, targetEntity)) {
    return { kind: 'trade', targetId: targetEntity.id };
  } else if (((entity.kind === 'villager' && targetEntity?.kind === 'farm')
    || (entity.kind === 'fishing-ship' && targetEntity?.kind === 'fish-trap'))
    && !targetEntity.dead && targetEntity.owner === entity.owner
    && targetEntity.buildProgress === undefined && (targetEntity.amount ?? 0) > 0) {
    const farm = isGatherable(state, targetEntity, entity)
      ? targetEntity : nearbyFreeFarm(state, entity, targetEntity.position);
    return farm ? { kind: 'gather', targetId: farm.id } : { kind: 'idle' };
  } else if (targetEntity && isGatherable(state, targetEntity, entity)) {
    return { kind: 'gather', targetId: targetEntity.id };
  } else if (
    unitRules?.heal && !entity.relics?.length && targetEntity && targetEntity.id !== entity.id
    && targetEntity.owner === entity.owner && isUnit(targetEntity.kind)
    && targetEntity.hp < targetEntity.maxHp
  ) {
    return { kind: 'heal', targetId: targetEntity.id };
  } else if (
    // Conversion reaches somebody else's soldiers only. Buildings need
    // Redemption, which is not researchable here.
    unitRules?.convert && !entity.relics?.length && targetEntity && isUnit(targetEntity.kind)
    && targetEntity.owner !== 0 && targetEntity.owner !== entity.owner
  ) {
    return { kind: 'convert', targetId: targetEntity.id };
  } else if (targetEntity && isHuntable(state, targetEntity) && armed) {
    // Gaia owns it, so the usual "somebody else's" test never fires; hunting
    // is what an order onto a live deer or boar means.
    return { kind: 'attack', targetId: targetEntity.id };
  } else if (
    targetEntity && targetEntity.owner === entity.owner &&
    isBuilding(targetEntity.kind) && targetEntity.buildProgress !== undefined
    && entity.kind === (rulesForPlayer(state, targetEntity.owner).buildings[targetEntity.kind].builderKind ?? 'villager')
  ) {
    return { kind: 'build', targetId: targetEntity.id };
  } else if (targetEntity && isRepairable(state, entity, targetEntity)) {
    return { kind: 'repair', targetId: targetEntity.id };
  } else if (targetEntity && canGarrison(state, entity, targetEntity)) {
    return { kind: 'garrison', targetId: targetEntity.id };
  } else if (targetEntity && targetEntity.owner !== 0 && targetEntity.owner !== entity.owner && armed) {
    return { kind: 'attack', targetId: targetEntity.id };
  }
  return { kind: 'move', target: { ...target } };
}

function assignOrder(state: GameState, entity: Entity, target: Point, targetEntity?: Entity): void {
  const order = resolveUnitOrder(state, entity, target, targetEntity);
  entity.fishingPosition = undefined;
  if (order.kind === 'idle') { becomeIdle(entity); return; }
  if (order.kind === 'trade') entity.carrying = undefined;
  if (order.kind === 'convert') entity.convertTicks = undefined;
  if (order.kind === 'repair') entity.repaired = 0;
  if (order.kind === 'move') {
    const unitRules = isUnit(entity.kind) ? unitRulesForEntity(state, entity) : undefined;
    // Told to go somewhere, a siege engine that is set up packs itself away
    // first, as the reference does. An order to *attack* does not: an engine
    // in range should shoot rather than fold up.
    if (entity.unpacked && unitRules?.unpacked) {
      entity.packingTicks = Math.max(
        1, Math.round(unitRules.unpacked.seconds * TICKS_PER_SECOND));
    }
  }
  entity.order = order;
  entity.activity = 'moving';
  entity.gatherProgress = 0;
}

/** The command grid and right-click use the same trainability test. */
export function trainableUnitsAt(state: GameState, player: PlayerId, building: BuildingKind): UnitKind[] {
  const rules = rulesForPlayer(state, player);
  return (Object.keys(rules.units) as UnitKind[]).filter(kind => {
    const unit = rules.units[kind];
    return unit.trainedAt === building && (unit.age ?? 0) <= state.players[player].age
      && (unit.requires ?? []).every(key => state.players[player].researched.includes(key))
      && !isAnimal(kind) && civHas(state, player, 'units', unit.treeUnitId ?? unit.datId)
      && !upgradedAway(state, player, kind) && !notYetUpgradedInto(state, player, kind);
  });
}

/** Read-only dispatch shared by actual right-clicks and their hover cursor. */
export function planContextCommand(
  state: GameState, player: PlayerId, selection: Entity[], target: Point, targetEntity?: Entity, queue = false,
): Command | undefined {
  const own = selection.filter(e => !e.dead && e.owner === player);
  const units = own.filter(e => isUnit(e.kind));
  if (units.length) return { kind: 'order', player, entityIds: units.map(e => e.id), target,
    targetId: targetEntity && targetEntity.id !== units[0].id ? targetEntity.id : undefined,
    ...(queue ? { queue: true } : {}) };
  const hostile = targetEntity !== undefined && targetEntity.owner !== 0 && targetEntity.owner !== player;
  const towers = own.filter(e => canShoot(state, e)
    && (hostile || trainableUnitsAt(state, player, e.kind as BuildingKind).length === 0));
  if (towers.length) return { kind: 'order', player, entityIds: towers.map(e => e.id), target,
    targetId: hostile ? targetEntity!.id : undefined };
  const building = own.find(e => isBuilding(e.kind) && e.buildProgress === undefined
    && trainableUnitsAt(state, player, e.kind as BuildingKind).length > 0);
  if (building) return { kind: 'rally', player, buildingId: building.id, target, targetId: targetEntity?.id };
  return undefined;
}

export function applyCommand(state: GameState, command: Command): CommandResult {
  if (!civilizationRules(state.rules, state.players[command.player]?.civilization)) {
    return rejected(`civilisation is not loaded for player ${command.player}`);
  }
  if (state.winner) return rejected('match is over');
  if (command.player !== 1 && command.player !== 2) return rejected('unknown player');

  if (command.kind === 'order' || command.kind === 'stop') {
    // A carcass is a thing orders may name: the gatherer loop has always been
    // able to work one, so refusing it here was the only reason a villager
    // could not be sent to a kill it had not made itself.
    const targetEntity = 'targetId' in command && command.targetId
      ? state.entities.find(e => e.id === command.targetId && (!e.dead || isCarcass(e)))
      : undefined;
    if (command.kind === 'order' && command.targetId && !targetEntity) {
      // A remembered Gaia object may have vanished out of sight. Keep walking
      // to the clicked last-seen location instead of exposing that via a refusal.
      if (state.visibility[command.player].memory[command.targetId]?.owner !== 0) {
        return rejected(`target ${command.targetId} does not exist`);
      }
    }
    // A point with no numbers in it is refused here, at the one entry every
    // caller shares. The schema keeps it from a strategy; the debug bridge
    // does not, and an order to NaN sent the pathfinder round a parent chain
    // that never ends -- every tick after it threw, and the match was gone.
    if (command.kind === 'order'
      && !(Number.isFinite(command.target?.x) && Number.isFinite(command.target?.y))) {
      return rejected('target is not a point');
    }
    let matched = 0;
    for (const entity of state.entities) {
      if (entity.dead || !command.entityIds.includes(entity.id) || entity.owner !== command.player) continue;
      const defensive = canShoot(state, entity);
      if (!isUnit(entity.kind) && !defensive) continue;
      matched++;
      // A new player order supersedes a bell's remembered work assignment.
      if (entity.bellReturn) entity.bellReturn = undefined;
      // Retasking aborts a swing in progress -- the reference's own rule, and
      // the reason the windup survives a target drifting out of reach but not
      // an order.
      entity.attackWindup = undefined;
      if (command.kind === 'stop') {
        entity.order = { kind: 'idle' };
        entity.activity = 'idle';
        entity.orderQueue = undefined;
        entity.fishingPosition = undefined;
      } else if (command.queue && entity.order.kind !== 'idle') {
        // Shift-click: fall in behind what it is doing. Only a unit already
        // busy has anything to queue behind -- an idle one takes the order
        // now, which is what a player expects of the first click of a route.
        entity.orderQueue = [
          ...(entity.orderQueue ?? []),
          { target: { ...command.target }, targetId: command.targetId },
        ];
      } else if (defensive) {
        // A tower cannot be sent anywhere, so only a hostile target means
        // anything to it: pointing at the ground releases it back to
        // picking its own targets.
        entity.order = targetEntity && targetEntity.owner !== 0 && targetEntity.owner !== entity.owner
          ? { kind: 'attack', targetId: targetEntity.id }
          : { kind: 'idle' };
      } else {
        // A fresh order replaces the whole plan, not just the current step.
        entity.orderQueue = undefined;
        assignOrder(state, entity, command.target, targetEntity);
      }
    }
    return matched ? { ok: true } : rejected('no owned units matched');
  }

  if (command.kind === 'train') {
    if (!Object.hasOwn(rulesForPlayer(state, command.player).units, command.unit)) return rejected(`unit ${command.unit} is not loaded`);
    const building = state.entities.find(e => e.id === command.buildingId && e.owner === command.player && !e.dead);
    if (!building) return rejected(`building ${command.buildingId} is not owned`);
    if (building.buildProgress !== undefined) return rejected('building is under construction');
    if (queuedCount(building) >= TRAINING_QUEUE_LIMIT) return rejected('training queue is full');
    const unitRules = unitRulesFor(state, command.player, command.unit);
    if (upgradedAway(state, command.player, command.unit)) {
      return rejected(`${command.unit} has been upgraded`);
    }
    if (notYetUpgradedInto(state, command.player, command.unit)) {
      return rejected(`${command.unit} needs its upgrade researched`);
    }
    if (!civHas(state, command.player, 'units', unitRules.treeUnitId ?? unitRules.datId)) {
      return rejected(`the ${civNameOf(state, command.player)} do not have ${command.unit}`);
    }
    if (unitRules.trainedAt !== building.kind) return rejected(`${building.kind} cannot train ${command.unit}`);
    const player = state.players[command.player];
    if ((unitRules.age ?? 0) > player.age) return rejected(`${command.unit} needs a later age`);
    const missingUnitTech = unitRules.requires?.find(key => !player.researched.includes(key));
    if (missingUnitTech) return rejected(`${command.unit} needs ${missingUnitTech} first`);
    // Housing gates emergence, not the paid queue (#143). A completed unit
    // waits in its building until population has room for it.
    const paid = spend(state, command.player, command.unit);
    if (!paid.ok) return paid;
    // Paid for when it is asked for, as in AoE2, and refunded if cancelled.
    if (building.training) {
      building.trainingQueueCosts = [...(building.trainingQueueCosts ?? (building.trainingQueue ?? []).map(() => undefined)), { ...unitRules.cost }];
      building.trainingQueue = [...(building.trainingQueue ?? []), command.unit];
    } else {
      building.training = { kind: command.unit, remainingTicks: Math.round(unitRules.trainSeconds * TICKS_PER_SECOND), paidCost: { ...unitRules.cost } };
    }
    return { ok: true };
  }

  if (command.kind === 'delete') {
    // The reference's Delete: your own thing, gone, with nothing back. It is
    // deliberately not a refund — that is what cancelling a queued unit is —
    // and it cannot name anything that is not yours, which is the whole of the
    // safety this command needs.
    const doomed = state.entities.filter(e =>
      command.entityIds.includes(e.id) && e.owner === command.player && !e.dead);
    if (!doomed.length) return rejected('nothing of yours was named');
    for (const entity of doomed) {
      // Through the same door as any other death, so a corpse, its decay and
      // the population it freed all behave as they would in a fight.
      entity.hp = 0;
      kill(state, entity);
    }
    recalculatePopulation(state);
    return { ok: true };
  }

  if (command.kind === 'cancel-train') {
    const building = state.entities.find(e => e.id === command.buildingId && e.owner === command.player && !e.dead);
    if (!building) return rejected(`building ${command.buildingId} is not owned`);
    const queue = building.trainingQueue ?? [];
    const index = command.index ?? queuedCount(building) - 1;
    if (!queuedCount(building)) return rejected('nothing is being trained');
    if (!Number.isInteger(index) || index < 0 || index >= queuedCount(building)) return rejected('invalid training queue index');
    let refund: UnitKind | undefined;
    let paidCost: Cost | undefined;
    if (index > 0 || !building.training) {
      const waitingIndex = index - (building.training ? 1 : 0);
      refund = queue[waitingIndex];
      paidCost = building.trainingQueueCosts?.[waitingIndex];
      building.trainingQueueCosts = building.trainingQueueCosts?.filter((_, i) => i !== waitingIndex);
      building.trainingQueue = queue.filter((_, i) => i !== waitingIndex);
      if (!building.trainingQueue.length) building.trainingQueue = undefined;
    } else if (building.training) {
      refund = building.training.kind;
      paidCost = building.training.paidCost;
      building.training = undefined;
      startNextTraining(state, building);
    }
    if (!refund) return rejected('nothing is being trained');
    const cost = paidCost ?? unitRulesFor(state, command.player, refund).cost;
    const player = state.players[command.player];
    player.food += cost.food; player.wood += cost.wood;
    player.gold += cost.gold; player.stone += cost.stone;
    return { ok: true };
  }

  if (command.kind === 'town-bell') {
    const tc = state.entities.find(e => e.id === command.buildingId && !e.dead
      && e.owner === command.player && e.kind === 'town-center' && e.buildProgress === undefined);
    if (!tc) return rejected('town bell requires an owned completed town center');
    if (typeof command.enabled !== 'boolean') return rejected('town bell needs an enabled state');
    if (!!tc.townBell === command.enabled) return { ok: true };
    if (!command.enabled) {
      releaseTownBell(state, tc);
    } else {
      tc.townBell = true;
      const capacity = buildingRulesFor(state, command.player, 'town-center').garrison?.capacity ?? 0;
      const reserved = state.entities.filter(e => !e.dead && e.order.kind === 'garrison' && e.order.targetId === tc.id).length;
      const places = Math.max(0, capacity - (tc.garrison?.length ?? 0) - reserved);
      const workers = state.entities.filter(e => !e.dead && e.owner === command.player && e.kind === 'villager'
        && !e.bellReturn && e.order.kind !== 'garrison')
        .sort((a, b) => distance(a.position, tc.position) - distance(b.position, tc.position) || a.id - b.id);
      for (const worker of workers.slice(0, places)) {
        worker.bellReturn = { townCenterId: tc.id, order: structuredClone(worker.order),
          ...(worker.orderQueue ? { queue: structuredClone(worker.orderQueue) } : {}) };
        worker.order = { kind: 'garrison', targetId: tc.id };
        worker.orderQueue = undefined;
        worker.attackWindup = undefined;
        clearPath(worker);
      }
    }
    return { ok: true };
  }

  if (command.kind === 'ungarrison') {
    const building = state.entities.find(e => e.id === command.buildingId && e.owner === command.player && !e.dead);
    if (!building) return rejected(`building ${command.buildingId} is not owned`);
    if (building.relics?.length) {
      releaseRelics(state, building, isBuilding(building.kind) ? spawnPoint(state, building, 0.5) : building.position);
      if (!building.garrison?.length) return { ok: true };
    }
    if (!building.garrison?.length) return rejected('nobody is garrisoned');
    if (isUnit(building.kind) && unitRulesForEntity(state, building).transportCapacity && command.target) {
      if (!Number.isFinite(command.target.x) || !Number.isFinite(command.target.y)) return rejected('target is not a point');
      building.order = { kind: 'unload', target: { ...command.target } };
      clearPath(building);
      return { ok: true };
    }
    for (const unit of ungarrisonAll(state, building)) unit.bellReturn = undefined;
    return { ok: true };
  }

  if (command.kind === 'research') {
    const building = state.entities.find(e => e.id === command.buildingId && e.owner === command.player && !e.dead);
    if (!building) return rejected(`building ${command.buildingId} is not owned`);
    if (building.buildProgress !== undefined) return rejected('building is under construction');
    if (building.researching) return rejected('building is already researching');
    const tech = rulesForPlayer(state, command.player).technologies[command.tech as TechKey];
    if (!tech) return rejected(`unknown technology ${command.tech}`);
    if (!civHas(state, command.player, 'technologies', tech.techId)) {
      return rejected(`the ${civNameOf(state, command.player)} do not have ${command.tech}`);
    }
    if (tech.researchedAt !== building.kind) return rejected(`${building.kind} cannot research ${command.tech}`);
    const player = state.players[command.player];
    if (player.researched.includes(command.tech)) return rejected(`${command.tech} is already researched`);
    if (rulesForPlayer(state, command.player).civilizationBonuses?.nodes[tech.techId]?.disabled) {
      return rejected(`${command.tech} is disabled by the technology tree`);
    }
    if (tech.requiredTechCount === undefined && player.age < tech.requiresAge) return rejected(`${command.tech} needs a later age`);
    if (!technologyRequirementsMet(state, command.player, tech)) {
      const missing = (tech.requires ?? []).find(other => !player.researched.includes(other));
      return rejected(`${command.tech} needs ${player.age < tech.requiresAge ? 'a later age'
        : missing ? `${missing} first` : 'prerequisites first'}`);
    }
    const paid = spendCost(state, command.player, tech.cost);
    if (!paid.ok) return paid;
    building.researching = {
      tech: command.tech,
      remainingTicks: Math.round(tech.researchSeconds * TICKS_PER_SECOND),
    };
    return { ok: true };
  }

  if (command.kind === 'reseed') {
    // Asked for at a mill, because that is where the player looks for it, and
    // because a player with no mill has no farms to re-sow either.
    const mill = state.entities.find(
      e => e.id === command.buildingId && e.owner === command.player && !e.dead && e.kind === 'mill');
    if (!mill) return rejected(`building ${command.buildingId} is not an owned mill`);
    if (mill.buildProgress !== undefined) return rejected('building is under construction');
    state.players[command.player].autoReseedFarms = command.enabled;
    return { ok: true };
  }

  if (command.kind === 'pack') {
    let matched = 0;
    for (const entity of state.entities) {
      if (entity.dead || !command.entityIds.includes(entity.id) || entity.owner !== command.player) continue;
      const setup = isUnit(entity.kind)
        && unitRulesForEntity(state, entity).unpacked;
      if (!setup) continue;
      matched++;
      if ((entity.unpacked === true) === command.unpacked) continue;  // already there
      // Setting up takes the DAT's own time, and nothing else happens while it
      // does: the order is dropped so a half-packed engine does not keep
      // walking or shooting.
      entity.packingTicks = Math.max(1, Math.round(setup.seconds * TICKS_PER_SECOND));
      entity.attackWindup = undefined;
      entity.order = { kind: 'idle' };
      entity.activity = 'idle';
      clearPath(entity);
    }
    return matched ? { ok: true } : rejected('no siege engine matched');
  }

  if (command.kind === 'rally') {
    const building = state.entities.find(e => e.id === command.buildingId && e.owner === command.player && !e.dead);
    if (!building || !isBuilding(building.kind)) return rejected(`building ${command.buildingId} is not owned`);
    building.rally = { target: { ...command.target }, targetId: command.targetId };
    return { ok: true };
  }

  // Read through research: the Castle Age gives a watch tower a fifth more
  // hit points, and one placed after it should be built to the new number.
  if (!isBuilding(command.building) || !rulesForPlayer(state, command.player).buildings[command.building]) {
    return rejected(`unknown building ${command.building}`);
  }
  if (upgradedAway(state, command.player, command.building)
    || notYetUpgradedInto(state, command.player, command.building)) {
    return rejected(`${command.building} is not the current building upgrade`);
  }
  const rules = buildingRulesFor(state, command.player, command.building);
  if (!rules.buildable) return rejected(`${command.building} cannot be built`);
  if (!civHas(state, command.player, 'buildings', rules.availabilityId ?? rules.datId)) {
    return rejected(`the ${civNameOf(state, command.player)} do not have ${command.building}`);
  }
  if ((rules.age ?? 0) > state.players[command.player].age) {
    return rejected(`${command.building} needs a later age`);
  }
  if (buildingLimitReached(state, command.player, command.building)) {
    return rejected(`${command.building} limit reached for this age`);
  }
  const builders = state.entities.filter(
    e => !e.dead && command.builderIds.includes(e.id) && e.owner === command.player && e.kind === (rules.builderKind ?? 'villager'),
  );
  if (!builders.length) return rejected(rules.builderKind === 'fishing-ship' ? 'builders must be owned fishing ships' : 'builders must be owned villagers');
  const orientation = command.orientation ?? 'x';
  const legal = placementLegal(state, command.building, command.target, orientation, command.player);
  if (!legal.ok) return legal;
  const paid = spend(state, command.player, command.building);
  if (!paid.ok) return paid;
  const footprint = buildingFootprint(state, command.building, orientation, command.player);
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

/**
 * The final approach straight at an interaction target whose footprint
 * blocks the grid, stopping at the water's edge: a footprint may be walked
 * into, the ground under it may not be if the walker cannot stand there. A
 * villager casting for a fish stops on the bank, and a boat unloading at the
 * dock stays off the sand (the dock straddles both). Returns true when the
 * walker is as close as the ground lets it come.
 */
function moveTowardOnGround(state: GameState, entity: Entity, target: Point, speed: number): boolean {
  const layer = terrainLayer(state, restrictionOf(rulesForPlayer(state, entity.owner), entity), entity.owner);
  const refused = (p: Point): boolean => {
    const tile = tileOf(p);
    return tile.x < 0 || tile.y < 0 || tile.x >= state.width || tile.y >= state.height
      || layer[tile.y * state.width + tile.x] === 1;
  };
  const before = { ...entity.position };
  const arrived = moveToward(entity, target, speed);
  if (!refused(entity.position)) return arrived;
  // The straight line leaves the ground: slide along the bank instead, one
  // axis at a time, which is what brings a caster to the corner of its tile
  // nearest the fish rather than leaving it a step short on the diagonal.
  const step = speed * TICK_SECONDS;
  for (const axis of ['x', 'y'] as const) {
    const delta = target[axis] - before[axis];
    if (Math.abs(delta) < 1e-9) continue;
    const slid = { ...before, [axis]: before[axis] + Math.sign(delta) * Math.min(step, Math.abs(delta)) };
    if (!refused(slid)) {
      entity.position = slid;
      return false;
    }
  }
  entity.position = before;
  return true;
}

function moveAlong(state: GameState, grid: NavGrid, entity: Entity, destination: Point, speed: number, directRange = 0): boolean {
  speed += infantryCrewCount(state, entity) * (unitRulesForEntity(state, entity).infantryCrew?.speed ?? 0);
  // Final approach straight at an interaction target whose footprint blocks
  // the grid; the caller's range check stops movement at its edge.
  if (directRange > 0 && distance(entity.position, destination) <= directRange) {
    return moveTowardOnGround(state, entity, destination, speed);
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

/**
 * What a unit fights with at this moment. A siege engine that has to be set up
 * is two DAT units, and only one of them has an attack: a packed trebuchet
 * carries nothing and an unpacked one carries the whole of it, so the answer
 * depends on the entity and not only on its kind (issue #28).
 */
function combatOf(state: GameState, entity: Entity): {
  attacks: AttackValue[]; range: number; minRange: number;
  reloadSeconds: number; releaseSeconds: number;
  projectileSpeed?: number; launchHeight?: number;
} & Shot {
  const rules = unitRulesForEntity(state, entity);
  const setup = rules.unpacked;
  if (setup) {
    return entity.unpacked
      ? { ...setup, reloadSeconds: setup.attackReloadSeconds, releaseSeconds: setup.attackReleaseSeconds }
      : {
        attacks: [], range: 0, minRange: 0,
        reloadSeconds: rules.attackReloadSeconds, releaseSeconds: rules.attackReleaseSeconds,
      };
  }
  return {
    attacks: rules.infantryCrew ? rules.attacks.map(attack => attack.class === 11
      ? { ...attack, amount: attack.amount + infantryCrewCount(state, entity) * rules.infantryCrew!.buildingAttack }
      : attack) : rules.attacks,
    range: rules.range ?? 0,
    minRange: rules.minRange ?? 0,
    reloadSeconds: rules.attackReloadSeconds,
    releaseSeconds: rules.attackReleaseSeconds,
    projectileSpeed: rules.projectileSpeed,
    piercing: rules.piercing,
    piercingRange: rules.piercing ? (rules.range ?? 0) + 3 : undefined,
    launchHeight: rules.launchHeight,
    blastRadius: rules.blastRadius,
    blastAttackLevel: rules.blastAttackLevel,
    accuracyPercent: rules.accuracyPercent,
    accuracyDispersion: rules.accuracyDispersion,
  };
}

/**
 * How far into its current swing an attacker is, in seconds, or undefined when
 * it is not mid-swing or mid-reload. The view runs the attack animation off
 * this rather than its own clock, so the arm and the stone agree: the
 * projectile leaves at `releaseSeconds`, which is the DAT's `frame_delay`
 * frames into the animation, and a trebuchet's 2.2 seconds of art are
 * followed by 7.8 of standing rather than four more swings (issue #72). The
 * numbers are the same ones the swing itself uses above.
 */
export function swingSeconds(state: GameState, entity: Entity): number | undefined {
  if (entity.activity !== 'attacking') return undefined;
  let releaseSeconds: number;
  let reloadSeconds: number;
  if (isBuilding(entity.kind)) {
    const attack = buildingRulesFor(state, entity.owner, entity.kind as BuildingKind).attack;
    if (!attack) return undefined;
    releaseSeconds = attack.releaseSeconds;
    reloadSeconds = attack.reloadSeconds;
  } else {
    const rules = unitRulesForEntity(state, entity);
    const target = 'targetId' in entity.order
      ? state.entities.find(e => e.id === (entity.order as { targetId: number }).targetId)
      : undefined;
    releaseSeconds = attackProfile(state, entity, target).releaseSeconds ?? rules.attackReleaseSeconds;
    reloadSeconds = combatOf(state, entity).reloadSeconds;
  }
  const releaseTicks = Math.max(1, Math.round(releaseSeconds * TICKS_PER_SECOND));
  const cooldownTicks = Math.max(1, Math.round(reloadSeconds * TICKS_PER_SECOND) - releaseTicks);
  if (entity.attackWindup !== undefined) return (releaseTicks - entity.attackWindup) * TICK_SECONDS;
  if (entity.attackCooldown !== undefined) {
    return (releaseTicks + cooldownTicks - entity.attackCooldown) * TICK_SECONDS;
  }
  return undefined;
}

/**
 * What a shooter's shot carries besides its damage: how likely it is to be
 * aimed true, how far off it lands when it is not, and what its blast may
 * hurt. All four are the DAT's own fields on the shooter.
 */
interface Shot {
  piercing?: UnitRules['piercing'];
  piercingRange?: number;
  blastRadius?: number;
  blastAttackLevel?: number;
  accuracyPercent?: number;
  accuracyDispersion?: number;
}

/** Melee units close to contact; ranged ones stop at their weapon range. */
/**
 * How a unit fights this particular target. A villager swings a tool at
 * anything that can hit back and looses an arrow at game: the DAT keeps the
 * hunter as its own unit with a three-tile reach and a projectile the plain
 * villager has neither of, which is the whole reason a hunt catches a deer
 * that is walking away.
 */
function attackProfile(
  state: GameState, entity: Entity, target: Entity | undefined,
): { range: number; projectileSpeed?: number; launchHeight?: number; releaseSeconds?: number } {
  if (!isUnit(entity.kind)) {
    const attack = buildingRulesFor(state, entity.owner, entity.kind as BuildingKind).attack;
    return {
      range: attack?.range ?? 0,
      projectileSpeed: attack?.projectileSpeed,
      launchHeight: attack?.launchHeight,
      releaseSeconds: attack?.releaseSeconds,
    };
  }
  const rules = unitRulesForEntity(state, entity);
  if (rules.hunt && target && isAnimal(target.kind)) return { ...rules.hunt };
  const combat = combatOf(state, entity);
  return {
    range: combat.range,
    projectileSpeed: combat.projectileSpeed,
    launchHeight: combat.launchHeight,
    releaseSeconds: combat.releaseSeconds,
  };
}

function attackRange(state: GameState, entity: Entity, target?: Entity): number {
  return attackProfile(state, entity, target).range;
}

const inAttackRange = (state: GameState, entity: Entity, target: Entity): boolean =>
  inRange(entity, target, 0.35 + attackRange(state, entity, target));

/**
 * Nearer than a shooter's minimum range, where its shot has nowhere to go.
 * A tower has one too -- the DAT gives a watch tower and a castle a tile of it
 * -- which is exactly what Murder Holes exists to take away.
 */
function tooClose(state: GameState, entity: Entity, target: Entity): boolean {
  const minimum = isBuilding(entity.kind)
    ? buildingRulesFor(state, entity.owner, entity.kind).attack?.minRange ?? 0
    : combatOf(state, entity).minRange;
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
  const los = isUnit(entity.kind) ? unitRulesForEntity(state, entity).lineOfSight : 0;
  return los * 3;
}

/**
 * Whether anything can stand next to a node to work it. A wood is a solid
 * clump of tiles, so the trees inside it are nobody's to cut until the ones
 * around them come down. Test outside the whole footprint: a deep fish has
 * radius 1, so the four tiles beside its centre can all be the fish itself.
 */
function hasElbowRoom(grid: NavGrid, node: Entity): boolean {
  const x = Math.floor(node.position.x);
  const y = Math.floor(node.position.y);
  if (!isBlocked(grid, x, y)) return true;
  const half = halfExtent(node);
  const minX = Math.floor(node.position.x - half.x + 1e-6);
  const maxX = Math.ceil(node.position.x + half.x - 1e-6) - 1;
  const minY = Math.floor(node.position.y - half.y + 1e-6);
  const maxY = Math.ceil(node.position.y + half.y - 1e-6) - 1;
  for (let xx = minX; xx <= maxX; xx++) {
    if (!isBlocked(grid, xx, minY - 1) || !isBlocked(grid, xx, maxY + 1)) return true;
  }
  for (let yy = minY; yy <= maxY; yy++) {
    if (!isBlocked(grid, minX - 1, yy) || !isBlocked(grid, maxX + 1, yy)) return true;
  }
  return false;
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
    // A claimed herdable is an asset its owner walked home, not a pile
    // anybody may wander onto. Carrying on from a bush onto the flock spends
    // it without being asked (issue #21); carrying on from one sheep to the
    // next is the same job and stays, and a carcass is already spent.
    if (isAnimal(candidate.kind) && !candidate.dead && candidate.kind !== was) continue;
    const d = distance(entity.position, candidate.position);
    if (d > range) continue;
    if (!isEntityVisible(state, owner, candidate)) continue;
    if (!hasElbowRoom(grid, candidate)) continue;
    // Same kind first, then distance. Adding a whole range to everything else
    // orders the two groups without a second pass, and ids break exact ties so
    // two runs of the same match choose the same thing.
    // Finish a carcass before opening another live animal. When the old one
    // runs out, follow a fellow worker's next animal rather than each killing
    // whichever member of the flock happens to be closest (#85).
    const alreadyWorked = isAnimal(candidate.kind) && state.entities.some(worker =>
      worker.owner === entity.owner && !worker.dead && worker.order.kind === 'gather'
      && worker.order.targetId === candidate.id);
    const herdPriority = isAnimal(candidate.kind) ? candidate.dead ? 0 : alreadyWorked ? 1 : 2 : 0;
    const key = d + (candidate.kind === was ? 0 : 4 * (range + 1)) + herdPriority * (range + 1);
    if (key < bestKey - 1e-9 || (Math.abs(key - bestKey) <= 1e-9 && best && candidate.id < best.id)) {
      best = candidate;
      bestKey = key;
    }
  }
  return best;
}

/** #79's construction continuation is narrower than food drop-off acceptance:
 * a mill recruits foragers/farmers, never hunters, shepherds or fishermen. */
function workAfterBuilding(state: GameState, grid: NavGrid, builder: Entity, site: Entity): Entity | undefined {
  if (builder.dead || builder.kind !== 'villager' || builder.owner !== site.owner
    || builder.activity !== 'building' || builder.orderQueue?.length) return;
  if (site.kind !== 'lumber-camp' && site.kind !== 'mining-camp' && site.kind !== 'mill') return;
  let best: Entity | undefined;
  let bestDistance = Infinity;
  for (const candidate of state.entities) {
    const node = candidate.kind === 'resource' ? nodeOf(candidate) : undefined;
    const appropriate = site.kind === 'lumber-camp' ? node === 'tree'
      : site.kind === 'mining-camp' ? node === 'gold' || node === 'stone'
      : node === 'berries' || candidate.kind === 'farm';
    if (!appropriate || candidate.dead || (candidate.amount ?? 0) <= 0
      || !isGatherable(state, candidate, builder)
      || !isEntityVisible(state, builder.owner as PlayerId, candidate)
      || !hasElbowRoom(grid, candidate)) continue;
    const d = distance(builder.position, candidate.position);
    if (d > autoContinueRange(state, builder)) continue;
    if (d < bestDistance - 1e-9 || (Math.abs(d - bestDistance) <= 1e-9 && best && candidate.id < best.id)) {
      best = candidate;
      bestDistance = d;
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
  // A fishing ship banks where the DAT's `drop_sites` say, the dock; a
  // villager wherever the building takes the resource -- except that the
  // dock takes fish and not berries, which is the fisherman's own site list
  // (town center, mill, dock) against the forager's (town center, mill).
  const fishOnly = new Set<NodeKind>(['shore-fish', 'fish']);
  const rules = rulesForPlayer(state, entity.owner);
  const task = entity.carrying?.task
    ?? (fishOnly.has(entity.carrying?.node ?? 'berries') ? 'fisher' : GATHER_TASK[wanted ?? 'food']);
  const sites = entity.kind === 'villager' ? rules.villagerGather[task].dropSites
    : unitRulesForEntity(state, entity)?.dropSites;
  let best: Entity | undefined;
  let bestDistance = Infinity;
  for (const candidate of state.entities) {
    if (candidate.dead || candidate.owner !== entity.owner || candidate.buildProgress !== undefined) continue;
    if (!isBuilding(candidate.kind)) continue;
    if (sites && !sites.includes(candidate.kind as BuildingKind)) continue;
    const accepts = rulesForPlayer(state, candidate.owner).buildings[candidate.kind as BuildingKind].accepts;
    if (!wanted || !accepts.includes(wanted)) continue;
    if (!sites && candidate.kind === 'dock' && !fishOnly.has(entity.carrying?.node ?? 'berries')) continue;
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
  entity.lastWorked = undefined;
  entity.lastResource = undefined;
  entity.fishingPosition = undefined;
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
    // The Hulk's -3 against standard buildings is a damage penalty, not an
    // absent bonus. Positive attacks still cannot become negative via armour.
    total += attack.amount < 0 ? attack.amount - armor.amount : Math.max(0, attack.amount - armor.amount);
  }
  return Math.max(1, total);
}

function armorsOf(state: GameState, entity: Entity): AttackValue[] {
  if (isUnit(entity.kind)) return unitRulesForEntity(state, entity).armors;
  if (isBuilding(entity.kind)) {
    return buildingRulesFor(state, entity.owner, entity.kind as BuildingKind).armors;
  }
  return [];
}

/**
 * What a corpse gets when the content does not say -- the open fallback, and
 * the flat window everything used to get. It is shorter than a building's
 * collapse, which is why a razed barracks used to disappear a third of the
 * way through falling down and never reach its rubble.
 */
const FALLBACK_CORPSE_SECONDS = 3;

function corpseLifetimeTicks(state: ReadonlyGameState, entity: DeepReadonly<Entity>): number {
  const rules = isBuilding(entity.kind)
    ? rulesForPlayer(state, entity.owner).buildings[entity.kind]
    : isUnit(entity.kind) ? unitRulesForEntity(state, entity) : undefined;
  return Math.round(Math.max(rules?.corpseSeconds ?? FALLBACK_CORPSE_SECONDS,
    rules?.deathSeconds ?? 0) * TICKS_PER_SECOND);
}

/** Death age survives view recreation and JSON saves in the existing corpse clock. */
export function corpseAgeSeconds(state: ReadonlyGameState, entity: DeepReadonly<Entity>): number | undefined {
  if (!entity.dead || entity.decayTicks === undefined) return undefined;
  return Math.max(0, corpseLifetimeTicks(state, entity) - entity.decayTicks) * TICK_SECONDS;
}

function kill(state: GameState, entity: Entity): void {
  // Whoever was sheltering inside comes out as it falls, as the reference's
  // do from a razed town center or castle.
  if (entity.dead) return;
  if (entity.relics?.length) releaseRelics(state, entity,
    isBuilding(entity.kind) ? spawnPoint(state, entity, 0.5) : entity.position);
  if (entity.bellReturn) entity.bellReturn = undefined;
  if (entity.kind === 'town-center' && entity.townBell) releaseTownBell(state, entity);
  const transport = isUnit(entity.kind) && unitRulesForEntity(state, entity).transportCapacity;
  if (transport) entity.garrison = undefined; // a sinking transport loses its passengers
  else if (entity.garrison?.length) ungarrisonAll(state, entity);
  entity.dead = true;
  entity.activity = 'dying';
  entity.order = { kind: 'idle' };
  entity.training = undefined;
  // Whatever was waiting behind it dies with the building; AoE2 does not
  // refund a queue that is razed, and neither does this.
  entity.trainingQueue = undefined;
  entity.trainingQueueCosts = undefined;
  // The DAT states how long a body lies there, on the corpse unit itself.
  // Never shorter than the death graphic, or the thing vanishes mid-fall.
  entity.decayTicks = corpseLifetimeTicks(state, entity);
  clearPath(entity);
  if (isUnit(entity.kind) && unitRulesForEntity(state, entity).selfDestruct
    && !unitRulesForEntity(state, entity).detonateOnAttackOnly && entity.hp <= 0) {
    const combat = unitRulesForEntity(state, entity);
    applyBlast(state, entity.position, combat.blastRadius ?? 0, combat.blastAttackLevel ?? 2,
      combat.attacks, entity.id, entity.owner as PlayerId);
  }
  recalculatePopulation(state);
}

function updateGatherer(state: GameState, grid: NavGrid, entity: Entity): void {
  if (entity.order.kind !== 'gather') return;
  const assignedId = entity.order.targetId;
  // Resolve the id once for this update. Searching for id AND farm kind scans
  // the whole array for every ordinary tree/mineral gatherer (#167).
  let assigned = state.entities.find(e => e.id === assignedId);
  const assignedFarm = assigned && (assigned.kind === 'farm' || assigned.kind === 'fish-trap') ? assigned : undefined;
  if (assignedFarm && !farmAvailable(state, assignedFarm, entity)) {
    // Repair old snapshots before either gathering or banking. An incumbent's
    // load and progress are untouched; the duplicate keeps any carried food.
    const next = nearbyFreeFarm(state, entity, entity.position);
    if (!next) { becomeIdle(entity); return; }
    entity.order = { kind: 'gather', targetId: next.id };
    assigned = next;
    entity.gatherProgress = 0;
    clearPath(entity);
  }
  const speed = unitRulesForEntity(state, entity).speed;
  const capacity = holdOf(state, entity, assigned);
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

  let node = assigned && (assigned.amount ?? 0) > 0 && (!assigned.dead || isCarcass(assigned)) ? assigned : undefined;
  if (!node) {
    // A full hold took the ship to a dock while its fish was swept away. Its
    // order still means this fishing ground, not whatever the dock can see.
    // Remember our own working position, never hidden fish: once back, the
    // ordinary bounded visible-target search below chooses what is left.
    if (entity.kind === 'fishing-ship' && !carrying?.amount && entity.fishingPosition) {
      const at = entity.fishingPosition;
      if (distance(entity.position, at) > 0.12) {
        entity.activity = 'moving';
        if (moveAlong(state, grid, entity, at, speed)) {
          entity.fishingPosition = undefined;
          clearPath(entity);
        }
        return;
      }
      entity.fishingPosition = undefined;
      clearPath(entity);
    }
    // A farm that has gone fallow is sown again where it stood, by the
    // villager who emptied it, if its owner has asked for that and can pay
    // the wood. AoE2's own words for a farm are that it "must be rebuilt";
    // what the option removes is the clicking, not the cost (issue #24).
    const fallow = assigned?.kind === 'farm' ? assigned : undefined;
    if (fallow) {
      const sown = reseedFarm(state, entity, fallow);
      if (sown) {
        entity.order = { kind: 'build', targetId: sown.id };
        entity.activity = 'moving';
        return;
      }
    }
    // What it was working, so it can look for another of the same first --
    // and what that thing yielded, because a villager that has just emptied
    // its hands at the mill is carrying nothing to ask for. Reading the want
    // off the load alone sent it idle the moment its bush ran out while it
    // was away banking, with the rest of the cluster a tile in front of it
    // (issue #19). Reading it off the spent node only works while that node
    // is still there, and it is swept up three seconds after it empties --
    // less than the walk to the drop site, so a lumberjack banked its load
    // and went idle at the camp with a wood all around it (issue #32). Both
    // memories therefore outlive the node itself.
    const previous = assigned;
    const was = previous?.kind ?? entity.lastWorked;
    const wanted = carrying?.kind ?? previous?.resourceKind ?? entity.lastResource;
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
  if (entity.kind === 'fishing-ship') entity.fishingPosition = { ...entity.position };
  entity.lastWorked = node.kind;
  const resource = node.resourceKind!;
  entity.lastResource = resource;
  // Automatic continuation may have changed tasks since the banking check.
  const activeCapacity = holdOf(state, entity, node);
  if ((entity.carrying?.amount ?? 0) >= activeCapacity) return;
  entity.gatherProgress = (entity.gatherProgress ?? 0) + rateOn(state, entity, node) * TICK_SECONDS;
  while ((entity.gatherProgress ?? 0) >= 1 && (node.amount ?? 0) > 0 && (entity.carrying?.amount ?? 0) < activeCapacity) {
    entity.gatherProgress! -= 1;
    node.amount! -= 1;
    // Switching resource types discards the old load, as in AoE2.
    if (!entity.carrying || entity.carrying.kind !== resource) entity.carrying = { kind: resource, amount: 0 };
    entity.carrying.amount += 1;
    entity.carrying.node = node.kind === 'resource' ? nodeOf(node) : undefined;
    if (entity.kind === 'villager') entity.carrying.task = villagerTaskOn(state, node);
  }
  // A worked-out farm is consumed, as in AoE2 where it must be rebuilt.
  if ((node.kind === 'farm' || node.kind === 'fish-trap') && (node.amount ?? 0) <= 0) kill(state, node);
}

/**
 * A market a cart may trade with: a finished market belonging to somebody else.
 * Trading with your own market earns nothing in AoE2, and the route needs a
 * counterparty, so this is what makes an order a trade order rather than a walk.
 */
function isTradePartner(state: GameState, cart: Entity, target: Entity): boolean {
  return target.kind === (cart.kind === 'trade-cog' ? 'dock' : 'market') && !target.dead
    && target.buildProgress === undefined && target.owner !== cart.owner && target.owner !== 0;
}

/** The cart's own nearest finished market: where a loaded cart unloads. */
function homeMarket(state: GameState, entity: Entity): Entity | undefined {
  let best: Entity | undefined;
  let bestDistance = Infinity;
  for (const candidate of state.entities) {
    if (candidate.dead || candidate.kind !== (entity.kind === 'trade-cog' ? 'dock' : 'market')) continue;
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
  const rules = unitRulesForEntity(state, entity);
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

/** Wall materials and their gates share automatic construction continuation. */
const sameRun = (a: Entity['kind'], b: Entity['kind']): boolean =>
  a === b || (isWallLineKind(a) && isWallLineKind(b));

function updateBuilder(state: GameState, grid: NavGrid, entity: Entity, builderCounts: Map<number, number>): void {
  if (entity.order.kind !== 'build') return;
  const site = state.entities.find(e => !e.dead && e.id === (entity.order as { targetId: number }).targetId);
  if (!site || site.buildProgress === undefined) { becomeIdle(entity); return; }
  if (!inRange(entity, site, 0.4)) {
    entity.activity = 'moving';
    moveAlong(state, grid, entity, site.position, unitRulesForEntity(state, entity).speed, interactionRange(site));
    return;
  }
  clearPath(entity);
  entity.activity = 'building';
  builderCounts.set(site.id, (builderCounts.get(site.id) ?? 0) + 1);
}

function updateAttacker(state: GameState, grid: NavGrid, entity: Entity): void {
  if (entity.order.kind !== 'attack') return;
  // Everything below reads the *researched* rules. Reading the base ones here
  // is how a blacksmith upgrade could change `unitRulesFor` and change nothing
  // a target ever felt: Fletching moved the archer's attack from 4 to 5 and a
  // villager went on taking 4 (issue #26). The tower path has always gone
  // through `buildingRulesFor`, which is why Murder Holes worked and this did
  // not.
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
  const rules = unitRulesForEntity(state, entity);
  // A siege engine that is packed has no attack, and one that is set up cannot
  // walk to reach anything: either way there is nothing to do but stand.
  if (rules.unpacked) {
    if (!entity.unpacked) { becomeIdle(entity); return; }
    if (!inAttackRange(state, entity, target)) { entity.activity = 'idle'; clearPath(entity); return; }
  }
  if (tooClose(state, entity, target)) {
    // Inside its minimum range a skirmisher cannot bring its javelin to bear.
    // AoE2 leaves it standing there rather than closing further, which is what
    // makes minimum range a weakness rather than a formality.
    entity.attackWindup = undefined;
    entity.activity = 'idle';
    clearPath(entity);
    return;
  }
  // A small contact blast must cover the ordered target before it is spent.
  // The ordinary melee tolerance can exceed the petard's owned blast radius.
  const targetInBlast = !rules.detonateOnAttackOnly
    || distance(entity.position, target.position) <= target.radius + (rules.blastRadius ?? 0);
  if (!inAttackRange(state, entity, target) || !targetInBlast) {
    // A swing in progress is kept, not thrown away. It is only spent while the
    // attacker is actually in reach, so nothing lands early -- but a target
    // drifting a few tenths of a tile no longer costs the whole windup. It
    // used to, and the swing then started again from nothing, so anything
    // with a real windup could never land a blow on a target that kept
    // walking: a scout has 0.6s of windup and a villager covers 0.48 tiles in
    // it, which is further than the reach margin, so the scout swung, lost
    // the swing, closed the gap and swung again, for ever (issue #18).
    // Retasking is what aborts a swing, as it does in the reference, and that
    // is handled where an order is given.
    entity.activity = 'moving';
    moveAlong(state, grid, entity, target.position, rules.speed, interactionRange(target) + attackRange(state, entity, target));
    return;
  }
  // In reach -- but a target that is walking away has to be kept up with. The
  // reach margin is tolerance for landing a blow, not a place to stand: a
  // scout that stopped the moment it was inside the margin let the villager
  // step back out of it between every swing, and took six seconds a hit
  // against a two-second reload (issue #18). Closing to the weapon's own
  // range keeps a melee unit in contact and leaves an archer at four tiles.
  if (inRange(entity, target, attackRange(state, entity, target))) {
    clearPath(entity);
  } else {
    moveAlong(state, grid, entity, target.position, rules.speed,
      interactionRange(target) + attackRange(state, entity, target));
  }
  entity.activity = 'attacking';
  if (entity.attackCooldown !== undefined && entity.attackCooldown > 0) {
    entity.attackCooldown -= 1;
    return;
  }
  // The bow a villager hunts with has its own reach, arrow and swing time.
  const profile = attackProfile(state, entity, target);
  const releaseSeconds = profile.releaseSeconds ?? rules.attackReleaseSeconds;
  if (entity.attackWindup === undefined) {
    entity.attackWindup = Math.max(1, Math.round(releaseSeconds * TICKS_PER_SECOND));
  }
  entity.attackWindup -= 1;
  if (entity.attackWindup <= 0) {
    const combat = combatOf(state, entity);
    if (rules.selfDestruct) {
      entity.hp = 0;
      kill(state, entity);
      if (rules.detonateOnAttackOnly) {
        applyBlast(state, entity.position, rules.blastRadius ?? 0, rules.blastAttackLevel ?? 2,
          combat.attacks, entity.id, entity.owner);
      }
      return;
    }
    for (let shot = 0; shot < (rules.projectilesPerAttack ?? 1); shot++) {
      releaseAttack(state, entity, target, combat.attacks, profile.projectileSpeed, profile.launchHeight, combat);
    }
    entity.attackWindup = undefined;
    entity.attackCooldown = Math.max(1, Math.round(combat.reloadSeconds * TICKS_PER_SECOND) - Math.max(1, Math.round(releaseSeconds * TICKS_PER_SECOND)));
  }
}

/**
 * A monk mends a wounded ally. The DAT's heal task has no reach of its own
 * (`work_range` is 0), so the monk has to come alongside exactly as a gatherer
 * comes to a bush, and the rate is the unit's work rate in hit points a second.
 */
function updateHealer(state: GameState, grid: NavGrid, entity: Entity): void {
  if (entity.order.kind !== 'heal') return;
  const rules = unitRulesForEntity(state, entity);
  const heal = rules.heal;
  const target = state.entities.find(e => !e.dead && e.id === (entity.order as { targetId: number }).targetId);
  if (!heal || !target || target.owner !== entity.owner || target.hp >= target.maxHp) {
    becomeIdle(entity);
    return;
  }
  if (!inRange(entity, target, heal.range + target.radius)) {
    entity.activity = 'moving';
    moveAlong(state, grid, entity, target.position, rules.speed, interactionRange(target) + heal.range);
    return;
  }
  clearPath(entity);
  entity.activity = 'healing';
  entity.gatherProgress = (entity.gatherProgress ?? 0) + heal.hitPointsPerSecond * TICK_SECONDS;
  const whole = Math.floor(entity.gatherProgress);
  if (whole >= 1) {
    entity.gatherProgress -= whole;
    target.hp = Math.min(target.maxHp, target.hp + whole);
  }
}

/**
 * What a villager will mend: its own side's finished building, or a unit of
 * a class the repairer's task table names (siege, and ships when there are
 * any) -- and only while there is something to mend (issue #74).
 */
export function isRepairable(state: GameState, repairer: Entity, target: Entity): boolean {
  if (!isUnit(repairer.kind)) return false;
  const repair = unitRulesForEntity(state, repairer)?.repair;
  if (!repair || target.dead || target.owner !== repairer.owner || target.id === repairer.id) return false;
  if (target.hp >= target.maxHp) return false;
  if (isBuilding(target.kind)) return target.buildProgress === undefined;
  if (!isUnit(target.kind)) return false;
  const datClass = unitRulesForEntity(state, target).datClass;
  return datClass !== undefined && String(datClass) in repair.classFactors;
}

/** The DAT's rate for mending this target: a building whole, siege by its class. */
export function repairRateFor(state: GameState, repairer: Entity, target: Entity): number {
  const repair = unitRulesForEntity(state, repairer).repair!;
  if (isBuilding(target.kind)) return repair.hitPointsPerSecond;
  const datClass = unitRulesForEntity(state, target).datClass;
  return repair.hitPointsPerSecond * (repair.classFactors[String(datClass)] ?? 1);
}

/**
 * A villager mends a building at the repairer's rate and pays for it as it
 * goes: a full repair costs the DAT's fraction of the price (0.5 for a
 * building and for a unit alike), so each hit point put back is that
 * fraction of the price over the hit points, and every resource is charged
 * the moment a whole unit of it falls due. When the player cannot pay the
 * next unit the work stops where it is, as the reference's does.
 */
function updateRepairer(state: GameState, grid: NavGrid, entity: Entity): void {
  if (entity.order.kind !== 'repair') return;
  const rules = unitRulesForEntity(state, entity);
  const target = state.entities.find(e => !e.dead && e.id === (entity.order as { targetId: number }).targetId);
  if (!rules.repair || !target || !isRepairable(state, entity, target)) {
    entity.repaired = undefined;
    becomeIdle(entity);
    return;
  }
  if (!inRange(entity, target, 0.4)) {
    entity.activity = 'moving';
    moveAlong(state, grid, entity, target.position, rules.speed, interactionRange(target));
    return;
  }
  clearPath(entity);
  entity.activity = 'repairing';
  entity.gatherProgress = (entity.gatherProgress ?? 0) + repairRateFor(state, entity, target) * TICK_SECONDS;
  const whole = Math.min(Math.floor(entity.gatherProgress), target.maxHp - target.hp);
  if (whole < 1) return;
  const price = isBuilding(target.kind)
    ? buildingRulesFor(state, target.owner, target.kind as BuildingKind).cost
    : unitRulesForEntity(state, target).cost;
  const fraction = playerAttributeFor(state, entity.owner,
    isBuilding(target.kind) ? 'buildingRepairCost' : 'unitRepairCost')!;
  const before = entity.repaired ?? 0;
  const after = before + whole;
  const due = (amount: number): number =>
    Math.floor(after * amount * fraction / target.maxHp) - Math.floor(before * amount * fraction / target.maxHp);
  const bill: Cost = { food: due(price.food), wood: due(price.wood), gold: due(price.gold), stone: due(price.stone) };
  if (!spendCost(state, entity.owner as PlayerId, bill).ok) {
    entity.repaired = undefined;
    becomeIdle(entity);
    return;
  }
  entity.gatherProgress -= whole;
  entity.repaired = after;
  target.hp = Math.min(target.maxHp, target.hp + whole);
}

/** The garrison category a unit falls in, from the editor's table by DAT class. */
function garrisonCategory(state: GameState, unit: Entity): number {
  const datClass = unitRulesForEntity(state, unit)?.datClass;
  return datClass === undefined ? 0 : GARRISON_CATEGORY[datClass] ?? 0;
}

/** Cargo remains live on converted carriers; never bake crew into a snapshot. */
function infantryCrewCount(state: GameState, carrier: Entity): number {
  return carrier.garrison?.filter(unit => !unit.dead && unitRulesForEntity(state, unit).datClass === 6).length ?? 0;
}

function canCrossWall(state: GameState, carrier: Entity, wall: Entity): boolean {
  const task = isUnit(carrier.kind) && unitRulesForEntity(state, carrier).unloadOverWall;
  return !!task && !wall.dead && wall.buildProgress === undefined && wall.owner !== 0
    && wall.owner !== carrier.owner && !!carrier.garrison?.length && isBuilding(wall.kind)
    && buildingRulesFor(state, wall.owner, wall.kind).datClass === task.targetClass;
}

/** Task 14 unloads passengers, never moves the carrier through the wall.
 * The one-footprint cardinal landing algorithm is inferred (ledger specialists).
 * No free landing means cargo stays aboard; a second wall cannot be jumped. */
function updateWallUnloader(state: GameState, grid: NavGrid, carrier: Entity): void {
  if (carrier.order.kind !== 'cross-wall') return;
  const id = carrier.order.targetId;
  const wall = state.entities.find(entity => entity.id === id);
  if (!wall || !canCrossWall(state, carrier, wall)) { becomeIdle(carrier); return; }
  const half = halfExtent(wall);
  const dx = carrier.position.x - wall.position.x, dy = carrier.position.y - wall.position.y;
  const axis = Math.abs(dx) / half.x >= Math.abs(dy) / half.y ? 'x' : 'y';
  const side = (axis === 'x' ? dx : dy) < 0 ? -1 : 1;
  const approach = { ...wall.position, [axis]: wall.position[axis] + side * (half[axis] + carrier.radius + 0.1) };
  if (distance(carrier.position, approach) > 0.2) {
    carrier.activity = 'moving';
    moveAlong(state, grid, carrier, approach, unitRulesForEntity(state, carrier).speed);
    return;
  }
  carrier.activity = 'attacking';
  clearPath(carrier);
  const released: Entity[] = [];
  for (const unit of carrier.garrison ?? []) {
    const otherAxis = axis === 'x' ? 'y' : 'x';
    for (const offset of [0, -0.5, 0.5]) {
      const landing = { ...wall.position,
        [axis]: wall.position[axis] - side * (half[axis] + unit.radius + 0.1),
        [otherAxis]: wall.position[otherAxis] + offset * half[otherAxis] };
      if (!spawnFree(state, landing, unit.radius, restrictionOf(rulesForPlayer(state, unit.owner), unit), unit.owner)
        || released.some(other => distance(other.position, landing) < other.radius + unit.radius)) continue;
      unit.position = landing;
      becomeIdle(unit);
      state.entities.push(unit);
      released.push(unit);
      break;
    }
  }
  carrier.garrison = carrier.garrison?.filter(unit => !released.includes(unit));
  if (!carrier.garrison?.length) { carrier.garrison = undefined; becomeIdle(carrier); }
}

/**
 * Whether this unit may shelter in that building (issue #75): its own side's,
 * finished, with a garrison the DAT gives a capacity and a type mask that
 * names the unit's category, and room left.
 */
export function canGarrison(state: GameState, unit: Entity, building: Entity): boolean {
  if (!isUnit(unit.kind) || unit.dead || building.dead || unit.id === building.id) return false;
  if (building.owner !== unit.owner || building.buildProgress !== undefined) return false;
  if (isUnit(building.kind)) {
    const carrier = unitRulesForEntity(state, building);
    if (carrier.infantryCapacity) {
      const category = unitRulesForEntity(state, unit).datClass;
      const admitted = carrier.passengerTypes === undefined ? category === 4 || category === 6
        : !!(carrier.passengerTypes & garrisonCategory(state, unit));
      return admitted && (building.garrison?.length ?? 0) < carrier.infantryCapacity;
    }
    const capacity = carrier.transportCapacity;
    const rules = rulesForPlayer(state, unit.owner);
    return !!capacity && !unit.unpacked && !rowAdmitsWater(rules, restrictionOf(rules, unit))
      && (building.garrison?.length ?? 0) < capacity;
  }
  if (!isBuilding(building.kind)) return false;
  const garrison = buildingRulesFor(state, building.owner, building.kind as BuildingKind).garrison;
  if (!garrison || garrison.capacity <= 0) return false;
  if (!(garrison.types & garrisonCategory(state, unit))) return false;
  return (building.garrison?.length ?? 0) < garrison.capacity;
}

function restoreBellWork(unit: Entity): void {
  const saved = unit.bellReturn;
  if (!saved) return;
  unit.bellReturn = undefined;
  unit.order = saved.order;
  unit.orderQueue = saved.queue;
  unit.activity = 'idle';
  clearPath(unit);
}

function releaseTownBell(state: GameState, tc: Entity): void {
  tc.townBell = false;
  // Only this bell's workers leave. Manually garrisoned units stay inside.
  const shelter = tc.garrison ?? [];
  tc.garrison = shelter.filter(e => e.bellReturn?.townCenterId === tc.id);
  const released = ungarrisonAll(state, tc);
  tc.garrison = [...(tc.garrison ?? []), ...shelter.filter(e => e.bellReturn?.townCenterId !== tc.id)];
  if (!tc.garrison.length) tc.garrison = undefined;
  for (const worker of released) restoreBellWork(worker);
  for (const worker of state.entities) {
    if (!worker.dead && worker.owner === tc.owner && worker.bellReturn?.townCenterId === tc.id) restoreBellWork(worker);
  }
}

/**
 * How many arrows a building's volley has: the DAT's base plus what those
 * inside add, capped at its maximum. Positive firepower multiplies ranged DPS;
 * negative firepower adds its absolute value as flat DPS (UGC attribute 130).
 * The town center's absent primary projectile contributes neither its nominal
 * base arrow nor the corresponding slot in the DAT maximum.
 */
export function volleyArrows(state: GameState, building: Entity): number {
  const volley = rulesForPlayer(state, building.owner).buildings[building.kind as BuildingKind].garrison?.volley;
  if (!volley) return 1;
  const attack = buildingRulesFor(state, building.owner, building.kind as BuildingKind).attack;
  const buildingDps = (attack?.attacks.find(a => a.class === 3)?.amount ?? 0) / (attack?.reloadSeconds || 1);
  let power = 0;
  for (const unit of building.garrison ?? []) {
    const rules = unitRulesForEntity(state, unit);
    const firepower = rules.garrisonFirepower ?? 0;
    const dps = (rules.attacks.find(a => a.class === 3)?.amount ?? 0) / (rules.attackReloadSeconds || 1);
    power += firepower < 0 ? dps - firepower : dps * firepower;
  }
  const base = volley.ownProjectile ? volley.base : 0;
  const max = volley.max - (volley.ownProjectile ? 0 : 1);
  return Math.max(0, Math.min(max, Math.floor(base + (buildingDps > 0 ? power / buildingDps : 0))));
}

/**
 * A town center with nobody inside has one arrow on paper and no projectile
 * to fire it with -- the DAT's `projectile_unit_id` is -1 -- so it holds its
 * fire until the garrison gives it one. A tower and a castle carry their own.
 */
function volleyFires(state: GameState, building: Entity): boolean {
  const volley = rulesForPlayer(state, building.owner).buildings[building.kind as BuildingKind].garrison?.volley;
  if (!volley || volley.ownProjectile) return true;
  return (building.garrison?.length ?? 0) > 0 && volleyArrows(state, building) >= 1;
}

function updateGarrisoner(state: GameState, grid: NavGrid, entity: Entity): void {
  if (entity.order.kind !== 'garrison') return;
  const rules = unitRulesForEntity(state, entity);
  const building = state.entities.find(e => !e.dead && e.id === (entity.order as { targetId: number }).targetId);
  if (!building || !canGarrison(state, entity, building)) { becomeIdle(entity); return; }
  if (!inRange(entity, building, 0.4)) {
    entity.activity = 'moving';
    moveAlong(state, grid, entity, building.position, rules.speed, interactionRange(building));
    return;
  }
  // In: off the map and into the building. A villager's load is banked on
  // the way, as the reference banks it.
  clearPath(entity);
  if (entity.carrying && isBuilding(building.kind)) {
    state.players[entity.owner as PlayerId][entity.carrying.kind] += entity.carrying.amount;
    entity.carrying = undefined;
  }
  becomeIdle(entity);
  entity.orderQueue = undefined;
  entity.path = undefined;
  entity.position = { ...building.position };
  state.entities = state.entities.filter(e => e.id !== entity.id);
  (building.garrison ??= []).push(entity);
}

/**
 * Those inside mend at the building's `garrison_heal_rate`, a hit point at a
 * time; the fraction rides on each unit's own progress counter.
 */
function updateGarrison(state: GameState, building: Entity): void {
  const garrison = buildingRulesFor(state, building.owner, building.kind as BuildingKind).garrison;
  if (!garrison || !building.garrison?.length || garrison.healRate <= 0) return;
  for (const unit of building.garrison) {
    if (unit.hp >= unit.maxHp) continue;
    unit.gatherProgress = (unit.gatherProgress ?? 0) + garrison.healRate * TICK_SECONDS;
    const whole = Math.floor(unit.gatherProgress);
    if (whole >= 1) {
      unit.gatherProgress -= whole;
      unit.hp = Math.min(unit.maxHp, unit.hp + whole);
    }
  }
}

/**
 * Everybody out, onto the ground around the building: the nearest free
 * places round its footprint, in a fixed order so a replay agrees.
 */
export function ungarrisonAll(state: GameState, building: Entity): Entity[] {
  const inside = building.garrison ?? [];
  if (isUnit(building.kind) && unitRulesForEntity(state, building).transportCapacity) {
    const released: Entity[] = [];
    for (const unit of inside) {
      let landing: Point | undefined;
      // Adjacent coast only: cargo must not teleport across a strip of water.
      for (let step = 0; step < 32 && !landing; step++) {
        const angle = step * 2 * Math.PI / 32;
        const reach = building.radius + unit.radius + 0.6;
        const at = { x: building.position.x + Math.cos(angle) * reach, y: building.position.y + Math.sin(angle) * reach };
        if (spawnFree(state, at, unit.radius, restrictionOf(rulesForPlayer(state, unit.owner), unit), unit.owner)) landing = at;
      }
      if (!landing) continue;
      unit.position = landing;
      becomeIdle(unit);
      state.entities.push(unit);
      released.push(unit);
    }
    building.garrison = inside.filter(unit => !released.includes(unit));
    if (!building.garrison.length) building.garrison = undefined;
    return released;
  }
  if (!inside.length) return [];
  const half = halfExtent(building);
  const released: Entity[] = [];
  for (const unit of inside) {
    let spot: Point | undefined;
    for (let ring = 0; ring < 4 && !spot; ring++) {
      const rx = half.x + unit.radius + 0.5 + ring;
      const ry = half.y + unit.radius + 0.5 + ring;
      const steps = 8 + ring * 8;
      for (let step = 0; step < steps; step++) {
        const angle = step * 2 * Math.PI / steps;
        const candidate = { x: building.position.x + Math.cos(angle) * rx, y: building.position.y + Math.sin(angle) * ry };
        if (spawnFree(state, candidate, unit.radius, restrictionOf(rulesForPlayer(state, unit.owner), unit), unit.owner)
          && released.every(other => distance(other.position, candidate) >= other.radius + unit.radius)) {
          spot = candidate;
          break;
        }
      }
    }
    if (!spot) continue;
    unit.position = { x: spot.x, y: spot.y };
    unit.gatherProgress = 0;
    unit.activity = 'idle';
    unit.order = { kind: 'idle' };
    state.entities.push(unit);
    released.push(unit);
  }
  building.garrison = inside.filter(unit => !released.includes(unit));
  if (!building.garrison.length) building.garrison = undefined;
  return released;
}

/**
 * A monk works on somebody else's soldier until it changes sides. The DAT
 * gives the window rather than the odds — the earliest second a conversion may
 * succeed and the second by which it must — so the roll is spread uniformly
 * across it: at `minSeconds` nothing has happened yet, at `maxSeconds` the
 * chance is 1. The real game's per-second roll is not in the owned files
 * (recorded in `docs/ledger.md`); this keeps both ends the DAT states.
 */
function updateConverter(state: GameState, grid: NavGrid, entity: Entity): void {
  if (entity.order.kind !== 'convert') return;
  const rules = unitRulesForEntity(state, entity);
  const target = state.entities.find(e => !e.dead && e.id === (entity.order as { targetId: number }).targetId);
  if (!rules.convert || entity.relics?.length || !target || target.owner === 0 || target.owner === entity.owner) {
    entity.convertTicks = undefined;
    becomeIdle(entity);
    return;
  }
  const convert = conversionWindow(state, entity, target);
  if ((entity.faith ?? 100) < 100) { entity.activity = 'idle'; entity.convertTicks = undefined; return; }
  if (!inRange(entity, target, convert.range)) {
    // Breaking off loses the work: a monk cannot bank half a conversion,
    // which is what makes running out of a monk's reach an escape.
    entity.convertTicks = undefined;
    entity.activity = 'moving';
    moveAlong(state, grid, entity, target.position, rules.speed, interactionRange(target) + convert.range);
    return;
  }
  clearPath(entity);
  entity.activity = 'converting';
  entity.convertTicks = (entity.convertTicks ?? 0) + 1;
  const seconds = entity.convertTicks * TICK_SECONDS;
  if (seconds < convert.minSeconds) return;
  const ticksLeft = Math.max(1, Math.round((convert.maxSeconds - seconds) / TICK_SECONDS) + 1);
  if (random01(state) >= 1 / ticksLeft) return;
  spendConversionFaith(state, entity, target);
  inheritConvertedUnit(state, target, entity.owner as PlayerId);
  becomeIdle(target);
  clearPath(target);
  target.convertTicks = undefined;
  recalculatePopulation(state);
  entity.convertTicks = undefined;
  becomeIdle(entity);
}

/**
 * Melee lands immediately; a ranged shot launches an arrow that resolves on
 * impact, so damage arrives when the projectile does.
 */
function applyDamage(
  state: GameState, target: Entity, attacks: AttackValue[], attackerId: number,
  origin: Point,
): void {
  if (target.kind === 'relic') return;
  target.hp -= computeDamage(attacks, armorsOf(state, target)) * elevationDamageMultiplier(
    elevationAt(state, origin.x, origin.y), elevationAt(state, target.position.x, target.position.y),
  );
  if (target.hp <= 0) {
    kill(state, target);
    return;
  }
  // A wounded boar turns on whoever wounded it, which is what makes luring one
  // a decision rather than a formality. It hangs off taking damage rather than
  // off the swing that dealt it: villagers hunt with a bow, so the blow that
  // angers a boar usually arrives as an arrow.
  if (isAnimal(target.kind) && unitRulesForEntity(state, target).attacks.some(a => a.amount > 0)
    && target.order.kind !== 'attack') {
    const attacker = state.entities.find(e => e.id === attackerId && !e.dead);
    if (attacker && attacker.owner !== target.owner) {
      target.order = { kind: 'attack', targetId: attackerId };
      target.activity = 'moving';
    }
  }
}

/**
 * How far a shot that goes wide lands from where it was aimed, when the rules
 * say nothing. The DAT states it per shooter (`accuracy_dispersion`, issue
 * #45) and every imported shooter that can miss carries it; this stands in
 * only for hand-written rules, where one tile is the board's own unit.
 */
const MISS_TILES = 1;

/** Where a target will be when a shot fired now reaches it. */
function leadPoint(state: GameState, shooter: Entity, target: Entity, speed: number): Point {
  const velocity = velocityOf(state, target);
  if (velocity.x === 0 && velocity.y === 0) return { ...target.position };
  // Two passes: guess the flight time from the present distance, then re-time
  // it against where that guess puts the target. Deterministic and close
  // enough at these speeds -- the reference calls it "where the unit should be
  // when the arrow reaches it".
  let time = distance(shooter.position, target.position) / speed;
  for (let pass = 0; pass < 2; pass++) {
    const at = { x: target.position.x + velocity.x * time, y: target.position.y + velocity.y * time };
    time = distance(shooter.position, at) / speed;
  }
  return { x: target.position.x + velocity.x * time, y: target.position.y + velocity.y * time };
}

/** A unit's present velocity in tiles a second, from the step it is taking. */
function velocityOf(state: GameState, entity: Entity): Point {
  const next = entity.path?.[0];
  if (!next || entity.activity !== 'moving') return { x: 0, y: 0 };
  const dx = next.x - entity.position.x;
  const dy = next.y - entity.position.y;
  const gap = Math.hypot(dx, dy);
  if (gap < 1e-6) return { x: 0, y: 0 };
  const unit = isUnit(entity.kind) ? unitRulesForEntity(state, entity) : undefined;
  const speed = unit ? unit.speed + infantryCrewCount(state, entity) * (unit.infantryCrew?.speed ?? 0) : 0;
  return { x: dx / gap * speed, y: dy / gap * speed };
}

function releaseAttack(
  state: GameState, shooter: Entity, target: Entity,
  attacks: AttackValue[], projectileSpeed: number | undefined, launchHeight = 0,
  shot: Shot = {},
): void {
  if (!projectileSpeed) {
    applyDamage(state, target, attacks, shooter.id, shooter.position);
    return;
  }
  // A shot is aimed once and then flies. Without Ballistics it goes to where
  // the target stands at the moment of release, which is why a unit that keeps
  // walking is missed; with it, to where the target will be.
  const leads = shooterLeadsTarget(state, shooter);
  const aim = leads
    ? leadPoint(state, shooter, target, projectileSpeed)
    : { ...target.position };
  // ...and whether it was aimed true at all is the DAT's own accuracy, read
  // through the owner's research because Thumb Ring is exactly a change to
  // it. A miss lands the shooter's own dispersion away, in a random direction.
  const accuracy = shot.accuracyPercent ?? 100;
  if (accuracy < 100 && random01(state) * 100 >= accuracy) {
    const angle = random01(state) * Math.PI * 2;
    const scatter = shot.accuracyDispersion ?? MISS_TILES;
    aim.x += Math.cos(angle) * scatter;
    aim.y += Math.sin(angle) * scatter;
  }
  if (shot.piercing && shot.piercingRange) {
    const dx = aim.x - shooter.position.x;
    const dy = aim.y - shooter.position.y;
    const length = Math.hypot(dx, dy);
    if (length > 1e-6) {
      aim.x = shooter.position.x + dx / length * shot.piercingRange;
      aim.y = shooter.position.y + dy / length * shot.piercingRange;
    }
  }
  state.projectiles.push({
    id: state.nextId++,
    owner: shooter.owner as PlayerId,
    position: { ...shooter.position },
    origin: { ...shooter.position },
    targetId: target.id,
    shooterId: shooter.id,
    art: isUnit(shooter.kind) ? (shooter.unpacked ? unitRulesForEntity(state, shooter).unpacked?.projectileArt
      : unitRulesForEntity(state, shooter).projectileArt) : undefined,
    attacks: attacks.map(a => ({ ...a })),
    speed: projectileSpeed,
    launchHeight,
    aim,
    ...(shot.piercing ? {
      art: shot.piercing.unit,
      piercing: { radius: shot.piercing.radius, attacks: shot.piercing.attacks.map(a => ({ ...a })), hitIds: [] },
    } : {}),
    ...(shot.blastRadius ? { blastRadius: shot.blastRadius, blastAttackLevel: shot.blastAttackLevel } : {}),
  });
}

/**
 * Whether this shooter's owner has the technology that leads a moving target.
 *
 * Read off the effects rather than by name: Ballistics is one `set` of the
 * projectile's `smart_mode`, and asking what the researched technologies
 * actually do keeps the rule true for any content that turns it on elsewhere.
 */
function shooterLeadsTarget(state: GameState, shooter: Entity): boolean {
  if (shooter.owner === 0) return false;
  for (const key of state.players[shooter.owner as PlayerId].researched) {
    for (const effect of technologyFor(rulesForPlayer(state, shooter.owner), key)?.effects ?? []) {
      if (effect.attribute === 'leadsTarget' && effect.amount >= 1) return true;
    }
  }
  return false;
}

/**
 * A siege shot hurts what it lands beside. AoE2's mangonel is no respecter of
 * sides — its own army takes the same stone — which is what makes one a
 * decision rather than free damage. The DAT gives the radius, and its
 * `blast_attack_level` against each bystander's `blast_defense_level` decides
 * who is caught: a thing is hit when its defense level is at least the
 * attack level. Units are 3, buildings 2, trees 1, bushes and mines 0, so a
 * mangonel (2) reaches soldiers and the house they stand beside, and an
 * onager (1) fells the trees as well (issue #46). Everything caught takes the
 * full hit; the DAT states no falloff.
 */
function applyBlast(
  state: GameState, at: Point, radius: number, attackLevel: number, attacks: AttackValue[],
  directHitId: number, excludeOwner?: Entity['owner'], origin: Point = at,
): void {
  for (const other of [...state.entities]) {
    if (other.dead || other.id === directHitId) continue;
    if (excludeOwner !== undefined && other.owner === excludeOwner) continue;
    if (blastDefenseLevelOf(state, other) < attackLevel) continue;
    if (distance(other.position, at) - other.radius > radius) continue;
    if (other.kind === 'resource') {
      // A tree caught by an onager's stone comes down and yields nothing, as
      // in AoE2: a felled node is a spent one.
      other.amount = 0;
      continue;
    }
    other.hp -= computeDamage(attacks, armorsOf(state, other)) * elevationDamageMultiplier(
      elevationAt(state, origin.x, origin.y), elevationAt(state, other.position.x, other.position.y),
    );
    if (other.hp <= 0) kill(state, other);
  }
}

/**
 * How resistant a thing is to a blast that lands beside it, from its rules.
 * Where the rules say nothing, the DAT's own division stands in: every unit
 * 3, every building 2, a tree 1 and any other node 0.
 */
function blastDefenseLevelOf(state: GameState, entity: Entity): number {
  if (isBuilding(entity.kind)) return rulesForPlayer(state, entity.owner).buildings[entity.kind].blastDefenseLevel ?? 2;
  if (entity.kind === 'resource') {
    const node = Object.values(state.rules.nodes).find(n => n.resource === entity.resourceKind);
    return node?.blastDefenseLevel ?? (entity.resourceKind === 'wood' ? 1 : 0);
  }
  return isUnit(entity.kind) ? unitRulesForEntity(state, entity).blastDefenseLevel ?? 3 : 3;
}

/** Closest approach of the segment a->b to a point, for a swept hit test. */
function pointToSegment(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 1e-12) return distance(point, a);
  let t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t));
}

/**
 * An arrow flies to the spot it was aimed at, and does not steer on the way.
 *
 * It hits its target if the target's body is still somewhere along the line it
 * travels, which is what makes the reference's three cases come out right: a
 * unit standing still is hit, one walking across the shot is missed, and one
 * walking straight at the shooter is hit anyway because it is still on the
 * line. Missing a moving target is the whole reason Ballistics exists.
 *
 * If the shot reaches its aim without touching the target it lands there, and
 * whoever else happens to be standing on that spot takes it instead -- an
 * arrow does not know it was meant for somebody else.
 */
function updateProjectiles(state: GameState): void {
  const remaining: typeof state.projectiles = [];
  for (const projectile of state.projectiles) {
    const step = projectile.speed * TICK_SECONDS;
    const dx = projectile.aim.x - projectile.position.x;
    const dy = projectile.aim.y - projectile.position.y;
    const gap = Math.hypot(dx, dy);
    const landing = gap <= step;
    const next = landing ? { ...projectile.aim } : {
      x: projectile.position.x + dx / gap * step,
      y: projectile.position.y + dy / gap * step,
    };

    if (projectile.piercing) {
      const bolt = projectile.piercing;
      for (const other of state.entities) {
        if (other.dead || other.kind === 'resource' || other.owner === projectile.owner || bolt.hitIds.includes(other.id)) continue;
        if (pointToSegment(other.position, projectile.position, next) > other.radius + bolt.radius) continue;
        bolt.hitIds.push(other.id);
        applyDamage(state, other, other.id === projectile.targetId ? projectile.attacks : bolt.attacks, projectile.shooterId, projectile.origin);
      }
      if (!landing) {
        projectile.position = next;
        remaining.push(projectile);
      }
      continue;
    }

    // Anything not the shooter's own can be struck, gaia's animals included:
    // a hunter's arrow is the same arrow.
    const intended = state.entities.find(e => e.id === projectile.targetId
      && !e.dead && e.owner !== projectile.owner);
    if (intended && pointToSegment(intended.position, projectile.position, next) <= intended.radius) {
      const at = { ...intended.position };
      applyDamage(state, intended, projectile.attacks, projectile.shooterId, projectile.origin);
      if (projectile.blastRadius) {
        applyBlast(state, at, projectile.blastRadius, projectile.blastAttackLevel ?? 0,
          projectile.attacks, intended.id, undefined, projectile.origin);
      }
      continue;
    }
    if (!landing) {
      projectile.position = next;
      remaining.push(projectile);
      continue;
    }
    const at = { ...projectile.aim };
    const struck = struckBy(state, projectile, at);
    if (struck) applyDamage(state, struck, projectile.attacks, projectile.shooterId, projectile.origin);
    if (projectile.blastRadius) {
      applyBlast(state, at, projectile.blastRadius, projectile.blastAttackLevel ?? 0,
        projectile.attacks, struck?.id ?? -1, undefined, projectile.origin);
    }
  }
  state.projectiles = remaining;
}

/** Who is standing where a shot came down, if anybody. */
function struckBy(state: GameState, projectile: Projectile, at: Point): Entity | undefined {
  let closest: Entity | undefined;
  let best = Infinity;
  for (const entity of state.entities) {
    if (entity.dead || entity.kind === 'resource' || entity.owner === projectile.owner) continue;
    const gap = distance(entity.position, at);
    if (gap > entity.radius) continue;
    // Ties broken by id, so the same shot lands on the same head in a replay.
    if (gap < best || (gap === best && closest !== undefined && entity.id < closest.id)) {
      best = gap;
      closest = entity;
    }
  }
  return closest;
}

/** Idle military units acquire the nearest living enemy in line of sight. */
function autoAcquire(state: GameState, entity: Entity): void {
  if (entity.order.kind !== 'idle' || !isUnit(entity.kind) || entity.kind === 'villager'
    || entity.kind === 'trade-cart' || isAnimal(entity.kind)) return;
  const rules = unitRulesForEntity(state, entity);
  if (!rules.attacks.some(attack => attack.amount > 0)) return;
  const los = Math.min(rules.lineOfSight, rules.searchRadius ?? rules.lineOfSight);
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
  const attack = buildingRulesFor(state, entity.owner, entity.kind as BuildingKind).attack;
  if (!attack || entity.buildProgress !== undefined) return;
  if (!volleyFires(state, entity)) { entity.attackWindup = undefined; return; }
  let target: Entity | undefined;
  let bestDistance = Infinity;

  // An ordered target overrides the tower's own choice for as long as it lives
  // and stays in range; once it does not, the tower goes back to defending
  // itself rather than sitting idle on a target it can no longer reach.
  if (entity.order.kind === 'attack') {
    const ordered = state.entities.find(e => e.id === (entity.order as { targetId: number }).targetId && !e.dead);
    const reachable = ordered
      && distance(entity.position, ordered.position) - ordered.radius <= entity.radius + attack.range
      && !tooClose(state, entity, ordered);
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
    // ...and not somebody stood against the wall, inside the minimum range
    // the DAT gives a tower. Murder Holes is the technology that removes it.
    if (tooClose(state, entity, candidate)) continue;
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
    const volley = buildingRulesFor(state, entity.owner, entity.kind as BuildingKind).garrison?.volley;
    // The building's own arrow first, where it has one...
    if (!volley || volley.ownProjectile) {
      releaseAttack(state, entity, target, attack.attacks, attack.projectileSpeed, attack.launchHeight,
        { accuracyPercent: attack.accuracyPercent });
    }
    // ...then the rest of the volley (issue #75): the DAT's base arrows and
    // those the garrison adds, each the secondary projectile's own shot at
    // the same target. A town center's are all of this kind.
    if (volley) {
      const extra = volleyArrows(state, entity) - (volley.ownProjectile ? 1 : 0);
      for (let arrow = 0; arrow < extra; arrow++) {
        releaseAttack(state, entity, target, volley.arrowAttacks ?? attack.attacks,
          volley.arrowSpeed ?? attack.projectileSpeed, attack.launchHeight,
          { accuracyPercent: attack.accuracyPercent });
      }
    }
    entity.attackWindup = undefined;
    entity.attackCooldown = Math.max(
      1,
      Math.round(attack.reloadSeconds * TICKS_PER_SECOND) - Math.max(1, Math.round(attack.releaseSeconds * TICKS_PER_SECOND)),
    );
  }
}

function updateUnit(state: GameState, grid: NavGrid, entity: Entity, builderCounts: Map<number, number>): void {
  rechargeFaith(state, entity);
  // A siege engine being set up or packed away does nothing else while it is:
  // the DAT gives the pair a work rate and this spends it (issue #28).
  if (entity.packingTicks !== undefined) {
    entity.activity = 'idle';
    entity.packingTicks -= 1;
    if (entity.packingTicks > 0) return;
    entity.packingTicks = undefined;
    entity.unpacked = !entity.unpacked;
    return;
  }
  // A finished order hands over to whatever was queued behind it. The click
  // is turned into an order here rather than when it was given, so a waypoint
  // onto a tree that has since been felled becomes a walk to where it stood
  // instead of an order to gather nothing.
  if (entity.order.kind === 'idle' && entity.orderQueue?.length) {
    const [next, ...rest] = entity.orderQueue;
    entity.orderQueue = rest.length ? rest : undefined;
    const target = next.targetId === undefined
      ? undefined
      : state.entities.find(e => e.id === next.targetId && (!e.dead || isCarcass(e)));
    assignOrder(state, entity, next.target, target);
  }
  switch (entity.order.kind) {
    case 'relic': {
      const target = state.entities.find(e => e.id === (entity.order as { targetId: number }).targetId);
      if (!target || !relicOrder(state, entity, target)) { becomeIdle(entity); return; }
      const reach = target.kind === 'monastery' ? 1 : 0;
      if (inRange(entity, target, reach)) {
        transferRelic(state, entity, target);
        becomeIdle(entity);
        clearPath(entity);
        if (entity.relics?.length && !entity.orderQueue?.length) {
          const home = state.entities.filter(e => e.kind === 'monastery' && relicOrder(state, entity, e))
            .sort((a, b) => distance(entity.position, a.position) - distance(entity.position, b.position) || a.id - b.id)[0];
          if (home) entity.order = { kind: 'relic', targetId: home.id };
        }
      } else {
        entity.activity = 'moving';
        moveAlong(state, grid, entity, target.position, unitRulesForEntity(state, entity).speed, interactionRange(target) + reach);
      }
      return;
    }
    case 'unload': {
      entity.activity = 'moving';
      if (moveAlong(state, grid, entity, entity.order.target, unitRulesForEntity(state, entity).speed)) {
        ungarrisonAll(state, entity);
        becomeIdle(entity);
      }
      return;
    }
    case 'move': {
      entity.activity = 'moving';
      const rules = unitRulesForEntity(state, entity);
      if (moveAlong(state, grid, entity, entity.order.target, rules.speed)) becomeIdle(entity);
      return;
    }
    case 'gather': return updateGatherer(state, grid, entity);
    case 'trade': return updateTrader(state, grid, entity);
    case 'build': return updateBuilder(state, grid, entity, builderCounts);
    case 'attack': return updateAttacker(state, grid, entity);
    case 'heal': return updateHealer(state, grid, entity);
    case 'repair': return updateRepairer(state, grid, entity);
    case 'garrison': return updateGarrisoner(state, grid, entity);
    case 'cross-wall': return updateWallUnloader(state, grid, entity);
    case 'convert': return updateConverter(state, grid, entity);
    default:
      entity.activity = 'idle';
      if (state.tick % 10 === 0) autoAcquire(state, entity);
  }
}

/** A spot clear of the map edge and of every building and resource footprint. */
function spawnFree(
  state: GameState, point: Point, radius: number, restriction = LAND_RESTRICTION, owner: Entity['owner'] = 0,
): boolean {
  if (point.x - radius < 0 || point.x + radius > state.width) return false;
  if (point.y - radius < 0 || point.y + radius > state.height) return false;
  // Nothing appears on ground it could not walk to. The generator asks this
  // before the board has terrain, and a board without terrain is all land.
  if (state.terrain.length === state.width * state.height) {
    const tile = Math.floor(point.y) * state.width + Math.floor(point.x);
    if (!groundAllows(rulesForPlayer(state, owner), restriction, state.terrain[tile])) return false;
  }
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
function spawnPoint(
  state: GameState, building: Entity, unitRadius: number, restriction = LAND_RESTRICTION,
): Point {
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
      if (spawnFree(state, point, unitRadius, restriction, building.owner)) return point;
    }
  }
  // Hemmed in on every side: place it on the building and let separation sort
  // it out rather than dropping the unit the player paid for.
  return { ...building.position };
}

function spawnTrainedUnit(state: GameState, building: Entity, kind: UnitKind): void {
  const rules = unitRulesFor(state, building.owner, kind);
  const spawn = spawnPoint(state, building, rules.radius, rules.terrainRestriction ?? LAND_RESTRICTION);
  const unit = addEntity(state, kind, building.owner, spawn, rules);
  const capacity = rulesForPlayer(state, building.owner).buildings[building.kind as BuildingKind].garrison?.capacity ?? 0;
  if ((building.rally?.targetId === building.id || (building.townBell && kind === 'villager'))
    && (building.garrison?.length ?? 0) < capacity) {
    unit.position = { ...building.position };
    if (building.townBell && kind === 'villager') {
      const target = state.entities.find(e => e.id === building.rally?.targetId);
      if (building.rally && target?.id !== building.id) assignOrder(state, unit, building.rally.target, target);
      unit.bellReturn = { townCenterId: building.id, order: structuredClone(unit.order) };
      becomeIdle(unit);
    }
    state.entities = state.entities.filter(e => e.id !== unit.id);
    (building.garrison ??= []).push(unit);
    return;
  }
  // Overflow appears outside rather than disappearing or walking into itself.
  if (building.rally?.targetId === building.id) return;
  if (building.rally) {
    const target = building.rally.targetId
      ? state.entities.find(e => e.id === building.rally!.targetId)
      : undefined;
    assignOrder(state, unit, building.rally.target, target);
  }
}

/** Fixed-point activation preserves DAT count gates and completion order. */
export function activateAutomaticTechnologies(state: GameState): void {
  for (const owner of [1, 2] as const) {
    const rules = rulesForPlayer(state, owner);
    const nodes = rules.civilizationBonuses?.nodes;
    if (!nodes) continue;
    const player = state.players[owner];
    const buildings = new Set(state.entities.filter(e => !e.dead && e.owner === owner
      && e.buildProgress === undefined && isBuilding(e.kind)).map(e => e.kind));
    const hasBuilding = (kinds: string[]) => kinds.some(kind => buildings.has(kind as BuildingKind));
    let changed: boolean;
    do {
      changed = false;
      for (const node of Object.values(nodes)) {
        if (node.disabled || player.researched.includes(node.key) || !technologyFor(rules, node.key)) continue;
        const triggered = node.triggeredByBuildings && hasBuilding(node.triggeredByBuildings);
        const aged = node.age !== undefined && player.age >= node.age;
        if (!triggered && !aged && (!node.automatic || !technologyRequirementsMet(state, owner, node))) continue;
        if (node.researchedAt && !hasBuilding([node.researchedAt])) continue;
        completeResearch(state, owner, node.key);
        changed = true;
      }
    } while (changed);
  }
}

/** Apply completed research once, including existing and garrisoned entities. */
function completeResearch(state: GameState, owner: PlayerId, key: string): void {
  const tech = technologyFor(rulesForPlayer(state, owner), key);
  const player = state.players[owner];
  if (!tech || player.researched.includes(key)) return;
  player.researched.push(key);
  if ('grantsAge' in tech && tech.grantsAge !== undefined) player.age = Math.max(player.age, tech.grantsAge);
  const promotedIds = new Set<number>();
  // An upgrade replaces what you own: every militia becomes a man-at-arms the
  // moment it lands, keeping the wounds it had rather than being healed by
  // promotion. AoE2 does the same, and it is why the barracks stops offering
  // the militia at all afterwards (see `upgradedAway`).
  for (const upgrade of tech.upgrades ?? []) {
    const to = rulesForPlayer(state, owner).units[upgrade.to as UnitKind]
      ?? rulesForPlayer(state, owner).buildings[upgrade.to as BuildingKind];
    if (!to) continue;
    for (const entity of state.entities.flatMap(e => [e, ...(e.garrison ?? [])])) {
      if (entity.dead || entity.owner !== owner || entity.convertedRules) continue;
      if (entity.training?.kind === upgrade.from) entity.training.kind = upgrade.to as UnitKind;
      if (entity.trainingQueue) entity.trainingQueue = entity.trainingQueue.map(kind =>
        kind === upgrade.from ? upgrade.to as UnitKind : kind);
      if (entity.kind !== upgrade.from) continue;
      const damage = entity.maxHp - entity.hp;
      const promoted = isBuilding(upgrade.to as Entity['kind'])
        ? buildingRulesFor(state, owner, upgrade.to as BuildingKind)
        : unitRulesFor(state, owner, upgrade.to as UnitKind);
      entity.kind = upgrade.to as Entity['kind'];
      entity.hp = entity.buildProgress === undefined ? Math.max(1, promoted.hp - damage)
        : Math.max(1, entity.hp + (promoted.hp - entity.maxHp) * entity.buildProgress);
      entity.maxHp = promoted.hp;
      entity.radius = promoted.radius;
      promotedIds.add(entity.id);
    }
  }

  // Synchronize age/paid building baselines once, including this research's
  // effects. Foundation HP gains only its constructed fraction of the delta.
  for (const entity of state.entities) {
    if (entity.dead || entity.owner !== owner || !isBuilding(entity.kind)) continue;
    const hp = buildingRulesFor(state, owner, entity.kind).hp;
    const gained = hp - entity.maxHp;
    entity.hp = Math.max(1, Math.min(hp, entity.hp + gained * (entity.buildProgress ?? 1)));
    entity.maxHp = hp;
  }

  // Hit points reach what is already standing, as AoE2's Loom heals the
  // villagers you already have. Everything else is read off the rules when it
  // is next asked for, so nothing has to be walked.
  for (const effect of tech.effects) {
    if (effect.attribute !== 'hitPoints') continue;
    for (const entity of state.entities.flatMap(e => [e, ...(e.garrison ?? [])])) {
      if (entity.convertedRules || promotedIds.has(entity.id) || isBuilding(entity.kind)
        || entity.dead || entity.owner !== owner || entity.kind !== effect.unit) continue;
      const raised = combine(effect.operation, entity.maxHp, effect.amount);
      const gained = raised - entity.maxHp;
      entity.maxHp = raised;
      entity.hp = Math.min(raised, entity.hp + gained);
    }
  }
}

function updateBuildingResearch(state: GameState, entity: Entity): void {
  if (!entity.researching) return;
  entity.researching.remainingTicks -= buildingRulesFor(state, entity.owner, entity.kind as BuildingKind).workRate ?? 1;
  if (entity.researching.remainingTicks > 0) return;
  const key = entity.researching.tech;
  entity.researching = undefined;
  completeResearch(state, entity.owner as PlayerId, key);
  activateAutomaticTechnologies(state);
}

/** How many units a building has spoken for: the one on the anvil and the queue. */
export const queuedCount = (entity: Entity): number =>
  (entity.training ? 1 : 0) + (entity.trainingQueue?.length ?? 0);

/**
 * How many units may be waiting at one building, the one being trained
 * included. AoE2's own limit, and the number the request asked for.
 */
export const TRAINING_QUEUE_LIMIT = 15;

function updateBuildingProduction(state: GameState, entity: Entity): void {
  if (!entity.training) return;
  entity.training.remainingTicks = Math.max(0, entity.training.remainingTicks
    - (buildingRulesFor(state, entity.owner, entity.kind as BuildingKind).workRate ?? 1));
  if (entity.training.remainingTicks > 0) return;
  const kind = entity.training.kind;
  const player = state.players[entity.owner as PlayerId];
  if (player.population + unitRulesFor(state, entity.owner, kind).popCost > player.populationCap) {
    // Keep the finished unit at 100%, with the rest of the queue untouched.
    return;
  }
  entity.training = undefined;
  spawnTrainedUnit(state, entity, kind);
  recalculatePopulation(state);
  startNextTraining(state, entity);
}

/** Start the next paid entry after completion or cancellation of the active one. */
function startNextTraining(state: GameState, entity: Entity): void {
  const queue = entity.trainingQueue;
  if (queue && queue.length) {
    const next = queue[0];
    entity.trainingQueue = queue.length > 1 ? queue.slice(1) : undefined;
    entity.training = {
      kind: next,
      remainingTicks: Math.round(unitRulesFor(state, entity.owner, next).trainSeconds * TICKS_PER_SECOND),
      paidCost: entity.trainingQueueCosts?.[0],
    };
    entity.trainingQueueCosts = queue.length > 1 ? entity.trainingQueueCosts?.slice(1) : undefined;
  }
}

/** Whether the rules train any unit at this kind of building. */
function trainsAnything(state: GameState, kind: Entity['kind'], player: PlayerId): boolean {
  if (!isBuilding(kind)) return false;
  return Object.values(rulesForPlayer(state, player).units)
    .some(rules => rules.trainedAt === kind && civHas(state, player, 'units', rules.treeUnitId ?? rules.datId));
}

function isDefeated(state: GameState, player: PlayerId): boolean {
  let townCenter = false;
  let unit = false;
  let production = false;
  for (const entity of state.entities) {
    if (entity.dead || entity.owner !== player || isAnimal(entity.kind)) continue;
    if (entity.kind === 'town-center') townCenter = true;
    if (isUnit(entity.kind) || entity.garrison?.length) unit = true;
    // "Can still produce" is asked of the rules, not of a list of building
    // names: a player left with only a stable or a castle is not beaten.
    if (entity.buildProgress === undefined && trainsAnything(state, entity.kind, player)) production = true;
  }
  // Domination: no units and nothing that can produce them (approximation of
  // AoE2 conquest, which requires razing everything).
  return !townCenter || (!unit && !production);
}

/**
 * Gaia's animals decide for themselves once a tick.
 *
 * A herdable joins whoever came closest and then stands where it is, ordered
 * about by hand from then on; two players' units in range and it stays gaia's,
 * as in AoE2. A deer is startled only from close by, hops a short way and then
 * grazes through a cooldown — the numbers are the rules', not this comment's.
 * A boar does neither: its answer to being wounded is in `applyDamage`.
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
    const rules = rulesForPlayer(state, animal.owner).units[animal.kind as AnimalKind];
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
    // A startled deer hops a short way and then grazes again for a quarter of
    // a minute. Running for as long as anything stands near it — which is what
    // this did — meant a deer walked away from its hunters indefinitely and
    // was only ever caught against an obstacle.
    const startle = rules.startle;
    if (!startle) continue;
    if (animal.fleeCooldown !== undefined && animal.fleeCooldown > 0) {
      animal.fleeCooldown -= ANIMAL_INTERVAL;
      continue;
    }
    if (!nearest || nearestDistance > startle.range) continue;
    const dx = animal.position.x - nearest.position.x;
    const dy = animal.position.y - nearest.position.y;
    const away = Math.max(1e-6, Math.hypot(dx, dy));
    animal.order = {
      kind: 'move',
      target: {
        x: Math.min(state.width - 0.6, Math.max(0.6, animal.position.x + dx / away * startle.distance)),
        y: Math.min(state.height - 0.6, Math.max(0.6, animal.position.y + dy / away * startle.distance)),
      },
    };
    const [least, most] = startle.restSeconds;
    animal.fleeCooldown = Math.round((least + random01(state) * (most - least)) * TICKS_PER_SECOND);
  }
}

export function stepGame(state: GameState): void {
  if (state.winner) return;
  activateAutomaticTechnologies(state);
  state.tick += 1;
  updateAnimals(state);
  const land = terrainLayer(state, LAND_RESTRICTION);
  const grid = entityGrid(state, undefined, undefined, land);
  // A gate is a hole in its owner's wall and a wall to everybody else, so the
  // owner of one walks a different map; and a unit on another restriction
  // row than the villager's walks another map again. Rows that agree over
  // the board's terrains share one layer object, so on a board with no water
  // this is one grid per gate owner and no more.
  const gateOwners = new Set<PlayerId>();
  for (const entity of state.entities) {
    if (entity.dead || entity.owner === 0 || entity.buildProgress !== undefined) continue;
    if (!rulesForPlayer(state, entity.owner).buildings[entity.kind as BuildingKind]?.passableForOwner) continue;
    gateOwners.add(entity.owner as PlayerId);
  }
  const grids = new Map<Uint8Array, Map<PlayerId | 0, NavGrid>>([[land, new Map([[0, grid]])]]);
  const gridFor = (entity: Entity): NavGrid => {
    const layer = terrainLayer(state, restrictionOf(rulesForPlayer(state, entity.owner), entity), entity.owner);
    const owner = entity.owner !== 0 && gateOwners.has(entity.owner as PlayerId)
      ? entity.owner as PlayerId : 0;
    let byOwner = grids.get(layer);
    if (!byOwner) {
      byOwner = new Map();
      grids.set(layer, byOwner);
    }
    let built = byOwner.get(owner);
    if (!built) {
      built = entityGrid(state, undefined, owner || undefined, layer);
      byOwner.set(owner, built);
    }
    return built;
  };
  const builderCounts = new Map<number, number>();
  const movable: Entity[] = [];
  for (const entity of [...state.entities]) {
    if (entity.dead) {
      entity.decayTicks = (entity.decayTicks ?? 0) - 1;
      if (isAnimal(entity.kind) && (entity.amount ?? 0) > 0) {
        const rate = rulesForPlayer(state, entity.owner).units[entity.kind].foodDecayPerSecond ?? 0;
        const progress = (entity.foodDecayProgress ?? 0) + rate * TICK_SECONDS;
        const spoiled = Math.floor(progress + 1e-9);
        entity.foodDecayProgress = Math.max(0, progress - spoiled);
        entity.amount = Math.max(0, entity.amount! - spoiled);
      }
      continue;
    }
    if (isUnit(entity.kind)) {
      updateUnit(state, gridFor(entity), entity, builderCounts);
      movable.push(entity);
    } else if (isBuilding(entity.kind) && entity.buildProgress === undefined) {
      updateBuildingProduction(state, entity);
      updateBuildingResearch(state, entity);
      if (entity.kind === 'monastery') updateRelicIncome(state, entity);
      updateGarrison(state, entity);
      updateTower(state, entity);
    }
  }
  separateUnits(state, movable, gridFor);
  updateProjectiles(state);
  for (const site of state.entities) {
    if (site.buildProgress === undefined) continue;
    const builders = builderCounts.get(site.id) ?? 0;
    if (!builders) continue;
    const siteRules = buildingRulesFor(state, site.owner, site.kind as BuildingKind);
    const seconds = siteRules.buildSeconds;
    // AoE2 rule: k builders finish in 3T/(k+2) seconds.
    const delta = TICK_SECONDS * (builders + 2) / (3 * seconds);
    site.buildProgress = Math.min(1, site.buildProgress + delta);
    site.hp = Math.min(site.maxHp, site.hp + site.maxHp * delta);
    if (site.buildProgress >= 1) {
      site.buildProgress = undefined;
      site.hp = Math.min(site.maxHp, Math.round(site.hp));
      // Only a farm stores food. How *much* is a player attribute the mill's
      // technologies raise, but whether this building stores any at all is
      // still the building's own rule -- asking the player attribute first
      // turned every finished wall into a farm.
      const farmAmount = siteRules.farmAmount === undefined
        ? undefined
        : farmFoodAmountFor(state, site.owner);
      if (farmAmount !== undefined) {
        // A finished farm becomes a food source its owner can work until spent.
        site.resourceKind = 'food';
        site.amount = farmAmount;
        // Only one builder becomes its farmer (owned string 26149). Others
        // retain build orders for the adjacent-site continuation below.
        for (const builder of state.entities) {
          if (!builder.dead && builder.kind === 'villager' && builder.owner === site.owner
            && builder.activity === 'building'
            && builder.order.kind === 'build' && builder.order.targetId === site.id
            && farmAvailable(state, site, builder)) {
            builder.order = { kind: 'gather', targetId: site.id };
            builder.activity = 'moving';
          }
        }
      }
      if (site.kind === 'fish-trap') {
        site.resourceKind = 'food';
        site.amount = siteRules.fishTrapAmount;
        for (const builder of state.entities) {
          if (!builder.dead && builder.kind === 'fishing-ship' && builder.owner === site.owner
            && builder.order.kind === 'build' && builder.order.targetId === site.id && farmAvailable(state, site, builder)) {
            builder.order = { kind: 'gather', targetId: site.id };
            builder.activity = 'moving';
          }
        }
      }
      for (const builder of state.entities) {
        if (builder.order.kind === 'build' && builder.order.targetId === site.id) {
          const work = workAfterBuilding(state, gridFor(builder), builder, site);
          if (work) {
            assignOrder(state, builder, work.position, work);
            continue;
          }
          if (builder.orderQueue?.length) { becomeIdle(builder); continue; }
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
