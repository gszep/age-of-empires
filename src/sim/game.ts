import { FALLBACK_RULES, TICK_SECONDS, TICKS_PER_SECOND, isAnimal, isBuilding, isMilitary, isUnit } from './data';
import type {
  AttackValue, BuildingRules, Cost, GameRules, NodeKind, TechEffect, TechKey, UnitRules,
} from './data';
import { buildNavGrid, findPath, halfExtent, isBlocked, separateUnits, tileOf, type NavGrid } from './nav';
import { random01 } from './random';
import { createVisibility, isEntityVisible, updateVisibility } from './visibility';
import type {
  AnimalKind, BuildingKind, Command, Entity, GameState, PlayerId, Point, Projectile, ResourceKind,
  UnitKind,
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

export function createGame(
  seed = 42, rules: GameRules = FALLBACK_RULES,
  civilizations: Record<PlayerId, string> = { 1: rules.civilization.key, 2: rules.civilization.key },
): GameState {
  const state: GameState = {
    rules, seed: seed || 1, tick: 0, nextId: 1, width: MAP_TILES, height: MAP_TILES,
    entities: [], projectiles: [],
    players: {
      1: {
        id: 1, civilization: civilizations[1], ...rules.startingResources,
        age: 0, researched: [], population: 0, populationCap: 0,
      },
      2: {
        id: 2, civilization: civilizations[2], ...rules.startingResources,
        age: 0, researched: [], population: 0, populationCap: 0,
      },
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
  if (datId === undefined) return true;
  const civilization = state.rules.civilization;
  if (state.players[player].civilization !== civilization.key) return true;
  return !civilization.unavailable[table].includes(datId);
}

const civNameOf = (state: GameState, player: PlayerId): string =>
  state.players[player].civilization === state.rules.civilization.key
    ? state.rules.civilization.name
    : state.players[player].civilization;

/**
 * Has this player upgraded past this unit? AoE2 does not let a barracks keep
 * offering the militia once the man-at-arms exists -- the upgrade replaces the
 * unit rather than adding a second one beside it.
 */
export function upgradedAway(state: GameState, player: PlayerId, kind: string): boolean {
  for (const key of state.players[player].researched) {
    for (const upgrade of state.rules.technologies[key]?.upgrades ?? []) {
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
  for (const [key, tech] of Object.entries(state.rules.technologies)) {
    for (const upgrade of tech.upgrades ?? []) {
      if (upgrade.to !== kind) continue;
      isUpgradeTarget = true;
      if (state.players[player].researched.includes(key)) return false;
    }
  }
  return isUpgradeTarget;
}

/** What a player has researched, applied to one unit kind's rules. */
export function unitRulesFor(state: GameState, owner: Entity['owner'], kind: UnitKind): UnitRules {
  const base = state.rules.units[kind];
  if (owner === 0) return base;
  const researched = state.players[owner as PlayerId].researched;
  if (!researched.length) return base;
  let rules = base;
  for (const key of researched) {
    for (const effect of state.rules.technologies[key]?.effects ?? []) {
      if (effect.unit !== kind) continue;
      if (rules === base) {
        rules = {
          ...base,
          armors: base.armors.map(a => ({ ...a })),
          attacks: base.attacks.map(a => ({ ...a })),
        };
      }
      applyEffect(rules, effect);
    }
  }
  return rules;
}

/** Apply one number to one attribute, in the way the DAT's command says. */
function combine(operation: TechEffect['operation'], current: number, amount: number): number {
  if (operation === 'set') return amount;
  if (operation === 'multiply') return current * amount;
  return current + amount;
}

/**
 * One technology effect against one thing's rules. Armour and attack are
 * per-class lists rather than single numbers -- Forging is "+1 against melee",
 * not "+1 attack" -- so a class the thing has no entry for gains one, which is
 * what makes a bonus against a class it never fought before take effect.
 */
function applyEffect(rules: UnitRules, effect: TechEffect): void {
  const armorClass = effect.armorClass ?? 0;
  switch (effect.attribute) {
    case 'hitPoints': rules.hp = combine(effect.operation, rules.hp, effect.amount); break;
    case 'lineOfSight':
      rules.lineOfSight = combine(effect.operation, rules.lineOfSight, effect.amount); break;
    case 'speed': rules.speed = combine(effect.operation, rules.speed, effect.amount); break;
    case 'reloadSeconds':
      rules.attackReloadSeconds =
        combine(effect.operation, rules.attackReloadSeconds, effect.amount); break;
    case 'accuracyPercent':
      rules.accuracyPercent = combine(effect.operation, rules.accuracyPercent ?? 100, effect.amount);
      break;
    case 'range':
      if (rules.range !== undefined) {
        rules.range = combine(effect.operation, rules.range, effect.amount);
      }
      break;
    case 'armor': {
      const existing = rules.armors.find(a => a.class === armorClass);
      if (existing) existing.amount = combine(effect.operation, existing.amount, effect.amount);
      else rules.armors.push({ class: armorClass, amount: effect.amount });
      break;
    }
    case 'attack': {
      const existing = rules.attacks.find(a => a.class === armorClass);
      if (existing) existing.amount = combine(effect.operation, existing.amount, effect.amount);
      else rules.attacks.push({ class: armorClass, amount: effect.amount });
      break;
    }
    default: break; // workRate and carryCapacity are not unit attributes here
  }
}

/**
 * A building's rules under what its owner has researched. The Castle Age gives
 * a watch tower a fifth more hit points, Arrowslits gives it another arrow,
 * Heated Shot multiplies what it does to ships, and Murder Holes takes away
 * the minimum range that stops it shooting somebody stood against its wall --
 * so this reaches the same attributes a unit's does, not hit points alone.
 */
/**
 * How much food a farm this player builds now holds. The DAT keeps it as a
 * player attribute (resource 36, 175 to begin with) rather than on the farm,
 * which is exactly why the mill's technologies can change it: Horse Collar
 * adds 75 and Heavy Plow another 125, and neither touches a unit this game
 * models. A farm already in the ground keeps what is left in it, as in AoE2 --
 * the research pays off on the next one sown.
 */
export function farmFoodAmountFor(state: GameState, owner: Entity['owner']): number | undefined {
  const base = state.rules.buildings.farm.farmAmount;
  if (base === undefined || owner === 0) return base;
  let amount = base;
  for (const key of state.players[owner as PlayerId].researched) {
    for (const effect of state.rules.technologies[key]?.effects ?? []) {
      if (effect.resource !== 'farmFoodAmount') continue;
      amount = combine(effect.operation, amount, effect.amount);
    }
  }
  return Math.round(amount);
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
  if (!placementLegal(state, 'farm', at).ok) return undefined;
  if (!spend(state, owner as PlayerId, 'farm').ok) return undefined;
  const rules = state.rules.buildings.farm;
  const site = addEntity(state, 'farm', owner, at, rules, { hp: 1, buildProgress: 0 });
  site.maxHp = rules.hp;
  return site;
}

export function buildingRulesFor(
  state: GameState, owner: Entity['owner'], kind: BuildingKind,
): BuildingRules {
  const base = state.rules.buildings[kind];
  if (owner === 0) return base;
  const researched = state.players[owner as PlayerId].researched;
  if (!researched.length) return base;
  let rules = base;
  for (const key of researched) {
    for (const effect of state.rules.technologies[key]?.effects ?? []) {
      if (effect.unit !== kind) continue;
      if (rules === base) {
        rules = {
          ...base,
          armors: base.armors.map(a => ({ ...a })),
          ...(base.attack ? { attack: { ...base.attack, attacks: base.attack.attacks.map(a => ({ ...a })) } } : {}),
        };
      }
      applyBuildingEffect(rules, effect);
    }
  }
  return rules;
}

function applyBuildingEffect(rules: BuildingRules, effect: TechEffect): void {
  const armorClass = effect.armorClass ?? 0;
  switch (effect.attribute) {
    case 'hitPoints': rules.hp = combine(effect.operation, rules.hp, effect.amount); break;
    case 'lineOfSight':
      rules.lineOfSight = combine(effect.operation, rules.lineOfSight, effect.amount); break;
    case 'armor': {
      const existing = rules.armors.find(a => a.class === armorClass);
      if (existing) existing.amount = combine(effect.operation, existing.amount, effect.amount);
      else rules.armors.push({ class: armorClass, amount: effect.amount });
      break;
    }
    case 'attack': {
      if (!rules.attack) break;
      const existing = rules.attack.attacks.find(a => a.class === armorClass);
      if (existing) existing.amount = combine(effect.operation, existing.amount, effect.amount);
      else rules.attack.attacks.push({ class: armorClass, amount: effect.amount });
      break;
    }
    case 'range':
      if (rules.attack) rules.attack.range = combine(effect.operation, rules.attack.range, effect.amount);
      break;
    case 'minRange':
      if (rules.attack) {
        rules.attack.minRange = combine(effect.operation, rules.attack.minRange ?? 0, effect.amount);
      }
      break;
    case 'reloadSeconds':
      if (rules.attack) {
        rules.attack.reloadSeconds =
          combine(effect.operation, rules.attack.reloadSeconds, effect.amount);
      }
      break;
    case 'accuracyPercent':
      if (rules.attack) {
        rules.attack.accuracyPercent =
          combine(effect.operation, rules.attack.accuracyPercent ?? 100, effect.amount);
      }
      break;
    default: break;
  }
}

/**
 * How fast this player gathers a resource, and how much a villager carries.
 * The DAT puts both on the villager's task variants -- the gold miner is its
 * own unit -- so Gold Shaft Mining is a work-rate change to `villager-goldminer`
 * and Wheelbarrow a carry-capacity change to every one of them.
 */
const GATHER_VARIANT: Record<ResourceKind, string> = {
  food: 'villager-forager', wood: 'villager-lumberjack',
  gold: 'villager-goldminer', stone: 'villager-stonemason',
};

export function gatherRateFor(
  state: GameState, owner: Entity['owner'], resource: ResourceKind,
): number {
  let rate = state.rules.gatherRatePerSecond[resource];
  if (owner === 0) return rate;
  const variant = GATHER_VARIANT[resource];
  for (const key of state.players[owner as PlayerId].researched) {
    for (const effect of state.rules.technologies[key]?.effects ?? []) {
      if (effect.attribute !== 'workRate' || effect.unit !== variant) continue;
      rate = combine(effect.operation, rate, effect.amount);
    }
  }
  return rate;
}

export function carryCapacityFor(state: GameState, owner: Entity['owner']): number {
  let capacity = state.rules.carryCapacity;
  if (owner === 0) return capacity;
  for (const key of state.players[owner as PlayerId].researched) {
    for (const effect of state.rules.technologies[key]?.effects ?? []) {
      // The DAT states it once per villager variant; they all carry the same.
      if (effect.attribute !== 'carryCapacity' || effect.unit !== 'villager-forager') continue;
      capacity = combine(effect.operation, capacity, effect.amount);
    }
  }
  return capacity;
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
  const unitRules = isUnit(entity.kind) ? state.rules.units[entity.kind as UnitKind] : undefined;
  // A unit with no attack is never given one by a right-click: a monk sent at
  // a boar would otherwise stand over it forever, swinging nothing.
  const armed = !unitRules || combatOf(state, entity).attacks.some(attack => attack.amount > 0);
  if (entity.kind === 'trade-cart' && targetEntity && isTradePartner(state, entity, targetEntity)) {
    entity.order = { kind: 'trade', targetId: targetEntity.id };
    entity.carrying = undefined;
  } else if (targetEntity && isGatherable(state, targetEntity, entity) && entity.kind === 'villager') {
    entity.order = { kind: 'gather', targetId: targetEntity.id };
  } else if (
    unitRules?.heal && targetEntity && targetEntity.id !== entity.id
    && targetEntity.owner === entity.owner && isUnit(targetEntity.kind)
    && targetEntity.hp < targetEntity.maxHp
  ) {
    entity.order = { kind: 'heal', targetId: targetEntity.id };
  } else if (
    // Conversion reaches somebody else's soldiers only. Buildings need
    // Redemption, which is not researchable here.
    unitRules?.convert && targetEntity && isUnit(targetEntity.kind)
    && targetEntity.owner !== 0 && targetEntity.owner !== entity.owner
  ) {
    entity.order = { kind: 'convert', targetId: targetEntity.id };
    entity.convertTicks = undefined;
  } else if (targetEntity && isHuntable(state, targetEntity) && armed) {
    // Gaia owns it, so the usual "somebody else's" test never fires; hunting
    // is what an order onto a live deer or boar means.
    entity.order = { kind: 'attack', targetId: targetEntity.id };
  } else if (
    targetEntity && targetEntity.owner === entity.owner &&
    isBuilding(targetEntity.kind) && targetEntity.buildProgress !== undefined && entity.kind === 'villager'
  ) {
    entity.order = { kind: 'build', targetId: targetEntity.id };
  } else if (targetEntity && targetEntity.owner !== 0 && targetEntity.owner !== entity.owner && armed) {
    entity.order = { kind: 'attack', targetId: targetEntity.id };
  } else {
    // Told to go somewhere, a siege engine that is set up packs itself away
    // first, as the reference does. An order to *attack* does not: an engine
    // in range should shoot rather than fold up.
    if (entity.unpacked && unitRules?.unpacked) {
      entity.packingTicks = Math.max(
        1, Math.round(unitRules.unpacked.seconds * TICKS_PER_SECOND));
    }
    entity.order = { kind: 'move', target: { ...target } };
  }
  entity.activity = 'moving';
  entity.gatherProgress = 0;
}

export function applyCommand(state: GameState, command: Command): CommandResult {
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
      return rejected(`target ${command.targetId} does not exist`);
    }
    let matched = 0;
    for (const entity of state.entities) {
      if (entity.dead || !command.entityIds.includes(entity.id) || entity.owner !== command.player) continue;
      const defensive = canShoot(state, entity);
      if (!isUnit(entity.kind) && !defensive) continue;
      matched++;
      // Retasking aborts a swing in progress -- the reference's own rule, and
      // the reason the windup survives a target drifting out of reach but not
      // an order.
      entity.attackWindup = undefined;
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
    if (queuedCount(building) >= TRAINING_QUEUE_LIMIT) return rejected('training queue is full');
    const unitRules = state.rules.units[command.unit];
    if (upgradedAway(state, command.player, command.unit)) {
      return rejected(`${command.unit} has been upgraded`);
    }
    if (notYetUpgradedInto(state, command.player, command.unit)) {
      return rejected(`${command.unit} needs its upgrade researched`);
    }
    if (!civHas(state, command.player, 'units', unitRules.datId)) {
      return rejected(`the ${civNameOf(state, command.player)} do not have ${command.unit}`);
    }
    if (unitRules.trainedAt !== building.kind) return rejected(`${building.kind} cannot train ${command.unit}`);
    const player = state.players[command.player];
    if ((unitRules.age ?? 0) > player.age) return rejected(`${command.unit} needs a later age`);
    // What is already queued is already spoken for: counting only the units on
    // the map would let fifteen villagers be ordered into five places.
    if (player.population + committedPopulation(state, building) + unitRules.popCost > player.populationCap) {
      return rejected('population cap reached');
    }
    const paid = spend(state, command.player, command.unit);
    if (!paid.ok) return paid;
    // Paid for when it is asked for, as in AoE2, and refunded if cancelled.
    if (building.training) {
      building.trainingQueue = [...(building.trainingQueue ?? []), command.unit];
    } else {
      building.training = { kind: command.unit, remainingTicks: Math.round(unitRules.trainSeconds * TICKS_PER_SECOND) };
    }
    return { ok: true };
  }

  if (command.kind === 'cancel-train') {
    const building = state.entities.find(e => e.id === command.buildingId && e.owner === command.player && !e.dead);
    if (!building) return rejected(`building ${command.buildingId} is not owned`);
    // The last one asked for is the first one taken back, which is what makes
    // a queue safe to fill: nothing is spent that cannot be undone.
    const queue = building.trainingQueue ?? [];
    let refund: UnitKind | undefined;
    if (queue.length) {
      refund = queue[queue.length - 1];
      building.trainingQueue = queue.slice(0, -1);
      if (!building.trainingQueue.length) building.trainingQueue = undefined;
    } else if (building.training) {
      refund = building.training.kind;
      building.training = undefined;
    }
    if (!refund) return rejected('nothing is being trained');
    const cost = state.rules.units[refund].cost;
    const player = state.players[command.player];
    player.food += cost.food; player.wood += cost.wood;
    player.gold += cost.gold; player.stone += cost.stone;
    return { ok: true };
  }

  if (command.kind === 'research') {
    const building = state.entities.find(e => e.id === command.buildingId && e.owner === command.player && !e.dead);
    if (!building) return rejected(`building ${command.buildingId} is not owned`);
    if (building.buildProgress !== undefined) return rejected('building is under construction');
    if (building.researching) return rejected('building is already researching');
    const tech = state.rules.technologies[command.tech as TechKey];
    if (!tech) return rejected(`unknown technology ${command.tech}`);
    if (!civHas(state, command.player, 'technologies', tech.techId)) {
      return rejected(`the ${civNameOf(state, command.player)} do not have ${command.tech}`);
    }
    if (tech.researchedAt !== building.kind) return rejected(`${building.kind} cannot research ${command.tech}`);
    const player = state.players[command.player];
    if (player.researched.includes(command.tech)) return rejected(`${command.tech} is already researched`);
    if (player.age < tech.requiresAge) return rejected(`${command.tech} needs a later age`);
    const missing = (tech.requires ?? []).find(other => !player.researched.includes(other));
    if (missing) return rejected(`${command.tech} needs ${missing} first`);
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
        && unitRulesFor(state, entity.owner, entity.kind as UnitKind).unpacked;
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
  const rules = buildingRulesFor(state, command.player, command.building);
  if (!rules.buildable) return rejected(`${command.building} cannot be built`);
  if (!civHas(state, command.player, 'buildings', rules.datId)) {
    return rejected(`the ${civNameOf(state, command.player)} do not have ${command.building}`);
  }
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

/**
 * What a unit fights with at this moment. A siege engine that has to be set up
 * is two DAT units, and only one of them has an attack: a packed trebuchet
 * carries nothing and an unpacked one carries the whole of it, so the answer
 * depends on the entity and not only on its kind (issue #28).
 */
function combatOf(state: GameState, entity: Entity): {
  attacks: AttackValue[]; range: number; minRange: number;
  reloadSeconds: number; releaseSeconds: number;
  projectileSpeed?: number; launchHeight?: number; blastRadius?: number;
} {
  const rules = unitRulesFor(state, entity.owner, entity.kind as UnitKind);
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
    attacks: rules.attacks,
    range: rules.range ?? 0,
    minRange: rules.minRange ?? 0,
    reloadSeconds: rules.attackReloadSeconds,
    releaseSeconds: rules.attackReleaseSeconds,
    projectileSpeed: rules.projectileSpeed,
    launchHeight: rules.launchHeight,
    blastRadius: rules.blastRadius,
  };
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
  const rules = unitRulesFor(state, entity.owner, entity.kind as UnitKind);
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
  entity.lastWorked = undefined;
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

function kill(state: GameState, entity: Entity): void {
  entity.dead = true;
  entity.activity = 'dying';
  entity.order = { kind: 'idle' };
  entity.training = undefined;
  // Whatever was waiting behind it dies with the building; AoE2 does not
  // refund a queue that is razed, and neither does this.
  entity.trainingQueue = undefined;
  // The DAT states how long a body lies there, on the corpse unit itself.
  // Never shorter than the death graphic, or the thing vanishes mid-fall.
  const rules = isBuilding(entity.kind)
    ? state.rules.buildings[entity.kind]
    : state.rules.units[entity.kind as UnitKind];
  const seconds = Math.max(
    rules?.corpseSeconds ?? FALLBACK_CORPSE_SECONDS,
    rules?.deathSeconds ?? 0,
  );
  entity.decayTicks = Math.round(seconds * TICKS_PER_SECOND);
  clearPath(entity);
}

function updateGatherer(state: GameState, grid: NavGrid, entity: Entity): void {
  if (entity.order.kind !== 'gather') return;
  const speed = unitRulesFor(state, entity.owner, 'villager').speed;
  const capacity = carryCapacityFor(state, entity.owner);
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
    && (e.amount ?? 0) > 0 && (!e.dead || isCarcass(e)));
  if (!node) {
    // A farm that has gone fallow is sown again where it stood, by the
    // villager who emptied it, if its owner has asked for that and can pay
    // the wood. AoE2's own words for a farm are that it "must be rebuilt";
    // what the option removes is the clicking, not the cost (issue #24).
    const fallow = state.entities.find(e => e.id === targetId && e.kind === 'farm');
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
    // (issue #19).
    const previous = state.entities.find(e => e.id === targetId);
    const was = previous?.kind ?? entity.lastWorked;
    const wanted = carrying?.kind ?? previous?.resourceKind;
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
  entity.lastWorked = node.kind;
  const resource = node.resourceKind!;
  entity.gatherProgress = (entity.gatherProgress ?? 0)
    + gatherRateFor(state, entity.owner, resource) * TICK_SECONDS;
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
  const rules = unitRulesFor(state, entity.owner, entity.kind as UnitKind);
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
  if (!inAttackRange(state, entity, target)) {
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
    releaseAttack(
      state, entity, target, combat.attacks,
      profile.projectileSpeed, profile.launchHeight, combat.blastRadius,
    );
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
  const rules = state.rules.units[entity.kind as UnitKind];
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
 * A monk works on somebody else's soldier until it changes sides. The DAT
 * gives the window rather than the odds — the earliest second a conversion may
 * succeed and the second by which it must — so the roll is spread uniformly
 * across it: at `minSeconds` nothing has happened yet, at `maxSeconds` the
 * chance is 1. The real game's per-second roll is not in the owned files
 * (recorded in `docs/status.md`); this keeps both ends the DAT states.
 */
function updateConverter(state: GameState, grid: NavGrid, entity: Entity): void {
  if (entity.order.kind !== 'convert') return;
  const rules = state.rules.units[entity.kind as UnitKind];
  const convert = rules.convert;
  const target = state.entities.find(e => !e.dead && e.id === (entity.order as { targetId: number }).targetId);
  if (!convert || !target || target.owner === 0 || target.owner === entity.owner) {
    entity.convertTicks = undefined;
    becomeIdle(entity);
    return;
  }
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
  target.owner = entity.owner;
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
): void {
  target.hp -= computeDamage(attacks, armorsOf(state, target));
  if (target.hp <= 0) {
    kill(state, target);
    return;
  }
  // A wounded boar turns on whoever wounded it, which is what makes luring one
  // a decision rather than a formality. It hangs off taking damage rather than
  // off the swing that dealt it: villagers hunt with a bow, so the blow that
  // angers a boar usually arrives as an arrow.
  if (isAnimal(target.kind) && state.rules.units[target.kind].attacks.some(a => a.amount > 0)
    && target.order.kind !== 'attack') {
    const attacker = state.entities.find(e => e.id === attackerId && !e.dead);
    if (attacker && attacker.owner !== target.owner) {
      target.order = { kind: 'attack', targetId: attackerId };
      target.activity = 'moving';
    }
  }
}

/**
 * How far a shot that goes wide lands from where it was aimed.
 *
 * The DAT states the odds (`accuracy_percent`) but not what a miss looks like,
 * so this is an approximation and is recorded as one in `docs/status.md`. One
 * tile is the board's own unit and the smallest distance that means anything
 * here; it is also comfortably wider than any unit and comfortably narrower
 * than a building, which is why an arrow that goes wide of a villager still
 * lands inside the town center behind it -- as it does in AoE2.
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
  const speed = isUnit(entity.kind) ? state.rules.units[entity.kind as UnitKind].speed : 0;
  return { x: dx / gap * speed, y: dy / gap * speed };
}

function releaseAttack(
  state: GameState, shooter: Entity, target: Entity,
  attacks: AttackValue[], projectileSpeed: number | undefined, launchHeight = 0,
  blastRadius?: number,
): void {
  if (!projectileSpeed) {
    applyDamage(state, target, attacks, shooter.id);
    return;
  }
  // A shot is aimed once and then flies. Without Ballistics it goes to where
  // the target stands at the moment of release, which is why a unit that keeps
  // walking is missed; with it, to where the target will be.
  const leads = shooterLeadsTarget(state, shooter);
  const aim = leads
    ? leadPoint(state, shooter, target, projectileSpeed)
    : { ...target.position };
  // ...and whether it was aimed true at all is the DAT's own accuracy.
  const accuracy = accuracyOf(state, shooter);
  if (accuracy < 100 && random01(state) * 100 >= accuracy) {
    const angle = random01(state) * Math.PI * 2;
    aim.x += Math.cos(angle) * MISS_TILES;
    aim.y += Math.sin(angle) * MISS_TILES;
  }
  state.projectiles.push({
    id: state.nextId++,
    owner: shooter.owner as PlayerId,
    position: { ...shooter.position },
    origin: { ...shooter.position },
    targetId: target.id,
    shooterId: shooter.id,
    attacks: attacks.map(a => ({ ...a })),
    speed: projectileSpeed,
    launchHeight,
    aim,
    ...(blastRadius ? { blastRadius } : {}),
  });
}

/**
 * The shooter's `accuracy_percent`, or 100 for anything the DAT gives none.
 * Read through the owner's research, because Thumb Ring is exactly a change to
 * this number.
 */
function accuracyOf(state: GameState, shooter: Entity): number {
  if (isBuilding(shooter.kind)) {
    return buildingRulesFor(state, shooter.owner, shooter.kind).attack?.accuracyPercent ?? 100;
  }
  return unitRulesFor(state, shooter.owner, shooter.kind as UnitKind)?.accuracyPercent ?? 100;
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
    for (const effect of state.rules.technologies[key]?.effects ?? []) {
      if (effect.attribute === 'leadsTarget' && effect.amount >= 1) return true;
    }
  }
  return false;
}

/**
 * A siege shot hurts what it lands beside. AoE2's mangonel is no respecter of
 * sides — its own army takes the same stone — which is what makes one a
 * decision rather than free damage. The DAT gives the radius; the falloff its
 * `blast_attack_level` implies is not in the owned files, so everything inside
 * takes the full hit (recorded in `docs/status.md`).
 */
function applyBlast(
  state: GameState, at: Point, radius: number, attacks: AttackValue[], directHitId: number,
): void {
  for (const other of [...state.entities]) {
    if (other.dead || other.id === directHitId || other.kind === 'resource') continue;
    if (isBuilding(other.kind)) continue; // a stone lands among soldiers, not through walls
    if (distance(other.position, at) - other.radius > radius) continue;
    other.hp -= computeDamage(attacks, armorsOf(state, other));
    if (other.hp <= 0) kill(state, other);
  }
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

    // Anything not the shooter's own can be struck, gaia's animals included:
    // a hunter's arrow is the same arrow.
    const intended = state.entities.find(e => e.id === projectile.targetId
      && !e.dead && e.owner !== projectile.owner);
    if (intended && pointToSegment(intended.position, projectile.position, next) <= intended.radius) {
      const at = { ...intended.position };
      applyDamage(state, intended, projectile.attacks, projectile.shooterId);
      if (projectile.blastRadius) {
        applyBlast(state, at, projectile.blastRadius, projectile.attacks, intended.id);
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
    if (struck) applyDamage(state, struck, projectile.attacks, projectile.shooterId);
    if (projectile.blastRadius) {
      applyBlast(state, at, projectile.blastRadius, projectile.attacks, struck?.id ?? -1);
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
  const attack = buildingRulesFor(state, entity.owner, entity.kind as BuildingKind).attack;
  if (!attack || entity.buildProgress !== undefined) return;
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
    releaseAttack(state, entity, target, attack.attacks, attack.projectileSpeed, attack.launchHeight);
    entity.attackWindup = undefined;
    entity.attackCooldown = Math.max(
      1,
      Math.round(attack.reloadSeconds * TICKS_PER_SECOND) - Math.max(1, Math.round(attack.releaseSeconds * TICKS_PER_SECOND)),
    );
  }
}

function updateUnit(state: GameState, grid: NavGrid, entity: Entity, builderCounts: Map<number, number>): void {
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
    case 'heal': return updateHealer(state, grid, entity);
    case 'convert': return updateConverter(state, grid, entity);
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
  // An upgrade replaces what you own: every militia becomes a man-at-arms the
  // moment it lands, keeping the wounds it had rather than being healed by
  // promotion. AoE2 does the same, and it is why the barracks stops offering
  // the militia at all afterwards (see `upgradedAway`).
  for (const upgrade of tech.upgrades ?? []) {
    const to = state.rules.units[upgrade.to as UnitKind];
    if (!to) continue;
    for (const entity of state.entities) {
      if (entity.dead || entity.owner !== owner || entity.kind !== upgrade.from) continue;
      const damage = entity.maxHp - entity.hp;
      const promoted = unitRulesFor(state, owner, upgrade.to as UnitKind);
      entity.kind = upgrade.to as UnitKind;
      entity.maxHp = promoted.hp;
      entity.hp = Math.max(1, promoted.hp - damage);
      entity.radius = promoted.radius;
    }
  }

  // Hit points reach what is already standing, as AoE2's Loom heals the
  // villagers you already have. Everything else is read off the rules when it
  // is next asked for, so nothing has to be walked.
  for (const effect of tech.effects) {
    if (effect.attribute !== 'hitPoints') continue;
    for (const entity of state.entities) {
      if (entity.dead || entity.owner !== owner || entity.kind !== effect.unit) continue;
      const raised = combine(effect.operation, entity.maxHp, effect.amount);
      const gained = raised - entity.maxHp;
      entity.maxHp = raised;
      entity.hp = Math.min(raised, entity.hp + gained);
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

/** How many units a building has spoken for: the one on the anvil and the queue. */
export const queuedCount = (entity: Entity): number =>
  (entity.training ? 1 : 0) + (entity.trainingQueue?.length ?? 0);

/** The population every unit this building has been paid for will take. */
function committedPopulation(state: GameState, entity: Entity): number {
  const kinds = [
    ...(entity.training ? [entity.training.kind] : []),
    ...(entity.trainingQueue ?? []),
  ];
  return kinds.reduce((total, kind) => total + state.rules.units[kind].popCost, 0);
}

/**
 * How many units may be waiting at one building, the one being trained
 * included. AoE2's own limit, and the number the request asked for.
 */
export const TRAINING_QUEUE_LIMIT = 15;

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
  // Straight on to the next one asked for; it was paid for when it was queued.
  const queue = entity.trainingQueue;
  if (queue && queue.length) {
    const next = queue[0];
    entity.trainingQueue = queue.length > 1 ? queue.slice(1) : undefined;
    entity.training = {
      kind: next,
      remainingTicks: Math.round(state.rules.units[next].trainSeconds * TICKS_PER_SECOND),
    };
  }
}

/** Whether the rules train any unit at this kind of building. */
function trainsAnything(state: GameState, kind: Entity['kind']): boolean {
  if (!isBuilding(kind)) return false;
  return Object.values(state.rules.units).some(rules => rules.trainedAt === kind);
}

function isDefeated(state: GameState, player: PlayerId): boolean {
  let townCenter = false;
  let unit = false;
  let production = false;
  for (const entity of state.entities) {
    if (entity.dead || entity.owner !== player || isAnimal(entity.kind)) continue;
    if (entity.kind === 'town-center') townCenter = true;
    if (isUnit(entity.kind)) unit = true;
    // "Can still produce" is asked of the rules, not of a list of building
    // names: a player left with only a stable or a castle is not beaten.
    if (entity.buildProgress === undefined && trainsAnything(state, entity.kind)) production = true;
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
      // Only a farm stores food. How *much* is a player attribute the mill's
      // technologies raise, but whether this building stores any at all is
      // still the building's own rule -- asking the player attribute first
      // turned every finished wall into a farm.
      const farmAmount = state.rules.buildings[site.kind as BuildingKind].farmAmount === undefined
        ? undefined
        : farmFoodAmountFor(state, site.owner);
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
