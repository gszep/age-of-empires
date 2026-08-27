import type { AnimalKind, BuildingKind, Entity, EntityKind, ResourceKind, UnitKind } from './types';

export const TICK_SECONDS = 0.05;
export const TICKS_PER_SECOND = 20;

export interface Cost { food: number; wood: number; gold: number; stone: number }

export interface AttackValue { class: number; amount: number }

export interface UnitRules {
  hp: number;
  radius: number;
  speed: number; // tiles per second
  lineOfSight: number;
  cost: Cost;
  trainSeconds: number;
  trainedAt: BuildingKind;
  popCost: number;
  attacks: AttackValue[];
  armors: AttackValue[];
  attackReloadSeconds: number;
  /** Seconds into the swing when damage lands (DAT frame delay x frame time). */
  attackReleaseSeconds: number;
  /** Tiles a ranged unit may strike from; melee units leave this unset. */
  range?: number;
  /** Tiles a shot needs to clear: a skirmisher cannot hit what is on top of it. */
  minRange?: number;
  /** Arrow travel speed in tiles per second; set only for ranged attackers. */
  projectileSpeed?: number;
  /** Height the shot leaves from, in tiles (DAT graphic displacement z). */
  launchHeight?: number;
  /** Tiles around the point of impact that also take the hit: a mangonel's
   * stone hurts what it lands beside, not only what it was aimed at. */
  blastRadius?: number;
  /** Monks: hit points restored a second, and how close they must come. */
  heal?: { hitPointsPerSecond: number; range: number };
  /** Monks: the DAT's window for a conversion — the earliest second it can
   * succeed and the second by which it must — and the reach it works at. */
  convert?: { minSeconds: number; maxSeconds: number; range: number };
  /**
   * Villagers: the bow they hunt with. The DAT keeps the hunter as its own
   * unit (122, `VMHUN`) with a reach and a projectile the plain villager has
   * neither of — which is how a hunter hits a deer that is walking away.
   */
  hunt?: { range: number; projectileSpeed: number; launchHeight: number; releaseSeconds: number };
  /** Trade carts: goods earned per second on the road, and the most they hold. */
  tradeRatePerSecond?: number;
  tradeCapacity?: number;
  /**
   * The DAT's `fog_visibility`: 1 keeps the thing drawn once its tile goes
   * dark. Everything gaia puts on the map -- resources, sheep, deer, boar --
   * is 1; everything a player trains or builds is 0, which is why an enemy
   * soldier vanishes with the light instead of standing there in a neutral
   * pose.
   */
  fogVisibility?: number;
  /** Animals: the food their carcass holds. */
  foodAmount?: number;
  /** Animals: how close a player's unit must come to claim a herdable. */
  herdRange?: number;
  /**
   * Deer: what startles one and what it does about it. AoE2 does not send a
   * deer running across the map — it hops a short way and then grazes again
   * for a quarter of a minute, which is what lets a hunter walk up to it and
   * what makes pushing deer toward a town center a thing a player can do. The
   * trigger is the DAT's own `search_radius` (1 tile for a deer); the hop and
   * the wait are the reference's, recorded in `docs/status.md`.
   */
  startle?: { range: number; distance: number; restSeconds: [number, number] };
  /** The age this becomes available in; 0 is the Dark Age. */
  age?: number;
}

export interface BuildingRules {
  /** The age this becomes available in; 0 is the Dark Age. */
  age?: number;
  hp: number;
  radius: number; // half footprint edge in tiles
  lineOfSight: number;
  cost: Cost;
  buildSeconds: number;
  popSupport: number;
  buildable: boolean;
  armors: AttackValue[];
  /** Resources villagers may deposit here; empty for buildings that take none. */
  accepts: ResourceKind[];
  /** Food a farm holds; undefined for everything else. */
  farmAmount?: number;
  /** Half-extents in tiles when the building is not the square `radius` says.
   * A gate lies along x by default and swaps both when placed along y. */
  footprint?: { x: number; y: number };
  /** A gate: its owner walks through it, everybody else has to knock it down. */
  passableForOwner?: boolean;
  /** Set for buildings that shoot: range in tiles plus the militia-style timing. */
  attack?: {
    range: number;
    attacks: AttackValue[];
    reloadSeconds: number;
    releaseSeconds: number;
    projectileSpeed: number;
    launchHeight: number;
  };
}

export interface ResourceNodeRules {
  resource: ResourceKind;
  radius: number;
  amount: number;
  /** As `UnitRules.fogVisibility`: gaia's nodes are all 1. */
  fogVisibility?: number;
}

export interface GameRules {
  origin: 'fallback' | 'imported';
  startingResources: Cost;
  startingPopulationCap: number;
  units: Record<UnitKind, UnitRules>;
  buildings: Record<BuildingKind, BuildingRules>;
  nodes: Record<NodeKind, ResourceNodeRules>;
  gatherRatePerSecond: Record<ResourceKind, number>;
  carryCapacity: number;
  technologies: Record<TechKey, TechRules>;
}

export type NodeKind = 'berries' | 'tree' | 'gold' | 'stone';

/** Which node rules a placed resource is playing by; its kind is not kept. */
const NODE_OF_RESOURCE: Record<ResourceKind, NodeKind> = {
  food: 'berries', wood: 'tree', gold: 'gold', stone: 'stone',
};

/**
 * Does this keep being drawn once its tile goes dark? The DAT answers for
 * everything gaia places -- resources, sheep, deer and boar are all
 * `fog_visibility` 1, and every unit a player trains is 0. Buildings are 0
 * too and are still remembered: that ghost is the engine's own last-seen
 * memory of the map, which no DAT field states.
 */
export function lingersInFog(rules: GameRules, entity: Entity): boolean {
  if (isBuilding(entity.kind)) return true;
  if (entity.kind === 'resource') {
    return entity.resourceKind !== undefined
      && rules.nodes[NODE_OF_RESOURCE[entity.resourceKind]]?.fogVisibility === 1;
  }
  return rules.units[entity.kind as UnitKind]?.fogVisibility === 1;
}
export type TechKey = 'loom' | 'feudal-age' | 'castle-age';

/** One researchable technology, as the DAT records it. */
export interface TechRules {
  techId: number;
  name: string;
  cost: Cost;
  researchSeconds: number;
  researchedAt: BuildingKind;
  requiresAge: number;
  /** Age techs move the player on; everything else changes rules. */
  grantsAge?: number;
  /** Flat additions to a unit kind, read off the DAT's effect commands. */
  effects: { unit: UnitKind; hitPoints?: number; armors?: AttackValue[] }[];
}

export const AGE_NAMES = ['Dark Age', 'Feudal Age', 'Castle Age', 'Imperial Age'];

const cost = (food = 0, wood = 0, gold = 0, stone = 0): Cost => ({ food, wood, gold, stone });

/**
 * Open fallback rules for users without the owned game. Values approximate the
 * AoE2DE Dark Age slice; when the imported manifest is available,
 * `rulesFromManifest` replaces them with DAT-backed data.
 */
export const FALLBACK_RULES: GameRules = {
  origin: 'fallback',
  startingResources: cost(200, 200, 100),
  startingPopulationCap: 0,
  units: {
    villager: {
      hp: 25, radius: 0.2, speed: 0.8, lineOfSight: 4, cost: cost(50), trainSeconds: 25,
      trainedAt: 'town-center', popCost: 1,
      attacks: [{ class: 11, amount: 3 }, { class: 4, amount: 3 }, { class: 13, amount: 6 }],
      armors: [{ class: 4, amount: 0 }, { class: 3, amount: 0 }],
      attackReloadSeconds: 2, attackReleaseSeconds: 0.5,
      hunt: { range: 3, projectileSpeed: 7, launchHeight: 1.5, releaseSeconds: 0.5 },
    },
    militia: {
      hp: 40, radius: 0.2, speed: 0.9, lineOfSight: 4, cost: cost(50, 0, 20), trainSeconds: 21,
      trainedAt: 'barracks', popCost: 1,
      attacks: [{ class: 4, amount: 4 }],
      armors: [{ class: 1, amount: 0 }, { class: 4, amount: 0 }, { class: 3, amount: 1 }],
      attackReloadSeconds: 2, attackReleaseSeconds: 0.5,
    },
    spearman: {
      age: 1,
      hp: 45, radius: 0.2, speed: 0.9, lineOfSight: 4, cost: cost(35, 25), trainSeconds: 22,
      trainedAt: 'barracks', popCost: 1,
      attacks: [{ class: 4, amount: 3 }, { class: 8, amount: 15 }, { class: 21, amount: 1 }],
      armors: [{ class: 1, amount: 0 }, { class: 4, amount: 0 }, { class: 3, amount: 0 }],
      attackReloadSeconds: 3, attackReleaseSeconds: 0.5,
    },
    // AoE2's herdables walk to whoever comes closest; its huntables bolt or
    // bite. Their food is what the DAT stores on the animal.
    sheep: {
      hp: 7, radius: 0.3, speed: 0.7, lineOfSight: 3, cost: cost(), trainSeconds: 0,
      trainedAt: 'town-center', popCost: 0,
      attacks: [], armors: [{ class: 4, amount: 0 }, { class: 3, amount: 0 }],
      attackReloadSeconds: 0, attackReleaseSeconds: 0,
      foodAmount: 100, herdRange: 2.5,
      fogVisibility: 1,
    },
    deer: {
      hp: 5, radius: 0.3, speed: 0.737, lineOfSight: 2, cost: cost(), trainSeconds: 0,
      trainedAt: 'town-center', popCost: 0,
      attacks: [], armors: [{ class: 4, amount: 0 }, { class: 3, amount: 0 }],
      attackReloadSeconds: 0, attackReleaseSeconds: 0,
      foodAmount: 140,
      fogVisibility: 1,
      startle: { range: 1, distance: 1.5, restSeconds: [14, 20] },
    },
    boar: {
      hp: 75, radius: 0.5, speed: 0.8, lineOfSight: 4, cost: cost(), trainSeconds: 0,
      trainedAt: 'town-center', popCost: 0,
      attacks: [{ class: 4, amount: 7 }, { class: 29, amount: 4 }, { class: 8, amount: 3 }, { class: 30, amount: 8 }],
      armors: [{ class: 4, amount: 0 }, { class: 3, amount: 0 }, { class: 24, amount: 0 }],
      attackReloadSeconds: 2, attackReleaseSeconds: 0,
      foodAmount: 340,
      fogVisibility: 1,
    },
    skirmisher: {
      age: 1,
      hp: 30, radius: 0.2, speed: 0.96, lineOfSight: 6, cost: cost(25, 35), trainSeconds: 26,
      trainedAt: 'archery-range', popCost: 1,
      attacks: [{ class: 27, amount: 3 }, { class: 15, amount: 3 }, { class: 3, amount: 2 }, { class: 35, amount: 2 }],
      armors: [{ class: 4, amount: 0 }, { class: 15, amount: 0 }, { class: 3, amount: 3 }, { class: 31, amount: 0 }, { class: 38, amount: 0 }],
      attackReloadSeconds: 3, attackReleaseSeconds: 0.63,
      range: 4, minRange: 1, projectileSpeed: 7, launchHeight: 1.5,
    },
    'scout-cavalry': {
      age: 1,
      hp: 45, radius: 0.25, speed: 1.2, lineOfSight: 4, cost: cost(80), trainSeconds: 30,
      trainedAt: 'stable', popCost: 1,
      attacks: [{ class: 25, amount: 6 }, { class: 4, amount: 3 }, { class: 39, amount: -3 }],
      armors: [{ class: 4, amount: 0 }, { class: 8, amount: 0 }, { class: 3, amount: 2 }, { class: 31, amount: 0 }],
      attackReloadSeconds: 2, attackReleaseSeconds: 0.4,
    },
    'trade-cart': {
      age: 1,
      hp: 70, radius: 0.25, speed: 1.25, lineOfSight: 7, cost: cost(0, 100, 50), trainSeconds: 51,
      trainedAt: 'market', popCost: 1,
      attacks: [],
      armors: [{ class: 4, amount: 0 }, { class: 3, amount: 0 }],
      attackReloadSeconds: 0, attackReleaseSeconds: 0,
      tradeRatePerSecond: 0.2875, tradeCapacity: 100,
    },
    archer: {
      age: 1,
      hp: 30, radius: 0.2, speed: 0.96, lineOfSight: 6, cost: cost(0, 25, 45), trainSeconds: 35,
      trainedAt: 'archery-range', popCost: 1,
      attacks: [{ class: 3, amount: 4 }],
      armors: [{ class: 1, amount: 0 }, { class: 4, amount: 0 }, { class: 3, amount: 0 }],
      attackReloadSeconds: 2, attackReleaseSeconds: 0.35,
      range: 4, projectileSpeed: 7, launchHeight: 1.5,
    },
    knight: {
      age: 2,
      hp: 100, radius: 0.25, speed: 1.35, lineOfSight: 4, cost: cost(60, 0, 75), trainSeconds: 30,
      trainedAt: 'stable', popCost: 1,
      attacks: [{ class: 4, amount: 10 }, { class: 39, amount: -3 }],
      armors: [{ class: 4, amount: 2 }, { class: 8, amount: 0 }, { class: 3, amount: 2 }, { class: 31, amount: 0 }],
      attackReloadSeconds: 1.8, attackReleaseSeconds: 0.67,
    },
    'cavalry-archer': {
      age: 2,
      hp: 50, radius: 0.25, speed: 1.4, lineOfSight: 5, cost: cost(0, 40, 60), trainSeconds: 37,
      trainedAt: 'archery-range', popCost: 1,
      attacks: [{ class: 27, amount: 2 }, { class: 3, amount: 6 }, { class: 39, amount: -3 }],
      armors: [{ class: 28, amount: 0 }, { class: 4, amount: 0 }, { class: 15, amount: 0 }, { class: 3, amount: 0 }, { class: 31, amount: 0 }],
      attackReloadSeconds: 2, attackReleaseSeconds: 0.91,
      range: 4, projectileSpeed: 7, launchHeight: 2,
    },
    // The British unique unit: the castle's own, and the reason to build one.
    longbowman: {
      age: 2,
      hp: 35, radius: 0.2, speed: 0.96, lineOfSight: 7, cost: cost(0, 35, 40), trainSeconds: 18,
      trainedAt: 'castle', popCost: 1,
      attacks: [{ class: 27, amount: 2 }, { class: 3, amount: 6 }],
      armors: [{ class: 4, amount: 0 }, { class: 15, amount: 0 }, { class: 3, amount: 0 }, { class: 19, amount: 0 }, { class: 31, amount: 0 }],
      attackReloadSeconds: 2, attackReleaseSeconds: 0.5,
      range: 5, projectileSpeed: 7, launchHeight: 1.65,
    },
    // Siege: slow, fragile against soldiers, and murderous against walls. The
    // ram's 150 against buildings and its -3 pierce armour are both the DAT's.
    'battering-ram': {
      age: 2,
      hp: 175, radius: 0.45, speed: 0.6, lineOfSight: 3, cost: cost(0, 160, 75), trainSeconds: 36,
      trainedAt: 'siege-workshop', popCost: 1,
      attacks: [{ class: 11, amount: 150 }, { class: 4, amount: 2 }, { class: 20, amount: 40 }],
      armors: [{ class: 4, amount: -3 }, { class: 3, amount: 180 }, { class: 17, amount: 0 }, { class: 20, amount: 0 }, { class: 31, amount: 0 }],
      attackReloadSeconds: 5, attackReleaseSeconds: 0.5,
    },
    mangonel: {
      age: 2,
      hp: 50, radius: 0.5, speed: 0.6, lineOfSight: 9, cost: cost(0, 160, 135), trainSeconds: 46,
      trainedAt: 'siege-workshop', popCost: 1,
      attacks: [{ class: 11, amount: 35 }, { class: 4, amount: 40 }, { class: 20, amount: 12 }, { class: 37, amount: 40 }],
      armors: [{ class: 4, amount: 0 }, { class: 3, amount: 6 }, { class: 20, amount: 0 }, { class: 31, amount: 0 }],
      attackReloadSeconds: 6, attackReleaseSeconds: 0.5,
      range: 7, minRange: 3, projectileSpeed: 3.5, launchHeight: 1.8, blastRadius: 1,
    },
    // No attack at all: a monk's work is mending its own side and preaching at
    // somebody else's.
    monk: {
      age: 2,
      hp: 30, radius: 0.2, speed: 0.7, lineOfSight: 11, cost: cost(0, 0, 100), trainSeconds: 51,
      trainedAt: 'monastery', popCost: 1,
      attacks: [],
      armors: [{ class: 25, amount: 0 }, { class: 4, amount: 0 }, { class: 3, amount: 0 }, { class: 31, amount: 0 }],
      attackReloadSeconds: 1.6, attackReleaseSeconds: 0,
      heal: { hitPointsPerSecond: 1.25, range: 0 },
      convert: { minSeconds: 5, maxSeconds: 9, range: 9 },
    },
  },
  buildings: {
    'town-center': {
      hp: 2400, radius: 2, lineOfSight: 8, cost: cost(0, 275), buildSeconds: 100,
      popSupport: 5, buildable: false, accepts: ['food', 'wood', 'gold', 'stone'],
      armors: [{ class: 21, amount: 0 }, { class: 11, amount: 0 }, { class: 4, amount: 3 }, { class: 3, amount: 5 }],
    },
    barracks: {
      hp: 1200, radius: 1.5, lineOfSight: 6, cost: cost(0, 175), buildSeconds: 50,
      popSupport: 0, buildable: true, accepts: [],
      armors: [{ class: 21, amount: 0 }, { class: 11, amount: 0 }, { class: 4, amount: 0 }, { class: 3, amount: 7 }],
    },
    house: {
      hp: 550, radius: 1, lineOfSight: 2, cost: cost(0, 25), buildSeconds: 25,
      popSupport: 5, buildable: true, accepts: [],
      armors: [{ class: 21, amount: 0 }, { class: 11, amount: 0 }, { class: 4, amount: -2 }, { class: 3, amount: 7 }],
    },
    mill: {
      hp: 600, radius: 1, lineOfSight: 6, cost: cost(0, 100), buildSeconds: 35,
      popSupport: 0, buildable: true, accepts: ['food'],
      armors: [{ class: 21, amount: 0 }, { class: 11, amount: 0 }, { class: 4, amount: 0 }, { class: 3, amount: 7 }],
    },
    'lumber-camp': {
      hp: 600, radius: 1, lineOfSight: 6, cost: cost(0, 100), buildSeconds: 35,
      popSupport: 0, buildable: true, accepts: ['wood'],
      armors: [{ class: 21, amount: 0 }, { class: 11, amount: 0 }, { class: 4, amount: 0 }, { class: 3, amount: 7 }],
    },
    'mining-camp': {
      hp: 600, radius: 1, lineOfSight: 6, cost: cost(0, 100), buildSeconds: 35,
      popSupport: 0, buildable: true, accepts: ['gold', 'stone'],
      armors: [{ class: 21, amount: 0 }, { class: 11, amount: 0 }, { class: 4, amount: 0 }, { class: 3, amount: 7 }],
    },
    farm: {
      hp: 480, radius: 1.5, lineOfSight: 1, cost: cost(0, 60), buildSeconds: 15,
      popSupport: 0, buildable: true, accepts: [], farmAmount: 175,
      armors: [{ class: 21, amount: 0 }, { class: 11, amount: 0 }, { class: 4, amount: 0 }, { class: 3, amount: 0 }],
    },
    outpost: {
      hp: 500, radius: 0.5, lineOfSight: 12, cost: cost(0, 25, 0, 5), buildSeconds: 15,
      popSupport: 0, buildable: true, accepts: [],
      armors: [{ class: 21, amount: 0 }, { class: 11, amount: 0 }, { class: 4, amount: 0 }, { class: 3, amount: 3 }],
    },
    'watch-tower': {
      age: 1,
      hp: 850, radius: 0.5, lineOfSight: 8, cost: cost(0, 25, 0, 125), buildSeconds: 27,
      popSupport: 0, buildable: true, accepts: [],
      armors: [{ class: 21, amount: 0 }, { class: 11, amount: 0 }, { class: 4, amount: 0 }, { class: 3, amount: 8 }],
      attack: {
        range: 8, attacks: [{ class: 3, amount: 5 }], reloadSeconds: 2, releaseSeconds: 0.35,
        projectileSpeed: 7, launchHeight: 5,
      },
    },
    'archery-range': {
      age: 1,
      hp: 1500, radius: 1.5, lineOfSight: 6, cost: cost(0, 175), buildSeconds: 50,
      popSupport: 0, buildable: true, accepts: [],
      armors: [{ class: 21, amount: 0 }, { class: 11, amount: 0 }, { class: 4, amount: 0 }, { class: 3, amount: 7 }],
    },
    blacksmith: {
      age: 1,
      hp: 1800, radius: 1.5, lineOfSight: 6, cost: cost(0, 150), buildSeconds: 40,
      popSupport: 0, buildable: true, accepts: [],
      armors: [{ class: 21, amount: 0 }, { class: 11, amount: 0 }, { class: 4, amount: 0 }, { class: 3, amount: 7 }],
    },
    market: {
      age: 1,
      hp: 1800, radius: 1.5, lineOfSight: 6, cost: cost(0, 175), buildSeconds: 60,
      popSupport: 0, buildable: true, accepts: [],
      armors: [{ class: 21, amount: 0 }, { class: 11, amount: 0 }, { class: 4, amount: 0 }, { class: 3, amount: 7 }],
    },
    'palisade-wall': {
      hp: 150, radius: 0.5, lineOfSight: 2, cost: cost(0, 3), buildSeconds: 7,
      popSupport: 0, buildable: true, accepts: [],
      armors: [{ class: 21, amount: 0 }, { class: 11, amount: 0 }, { class: 4, amount: 0 }, { class: 3, amount: 2 }],
    },
    'palisade-gate': {
      hp: 240, radius: 1, footprint: { x: 1, y: 0.5 }, passableForOwner: true,
      lineOfSight: 6, cost: cost(0, 30), buildSeconds: 30,
      popSupport: 0, buildable: true, accepts: [],
      armors: [{ class: 21, amount: 0 }, { class: 11, amount: 0 }, { class: 4, amount: 2 }, { class: 3, amount: 4 }],
    },
    stable: {
      age: 1,
      hp: 1500, radius: 1.5, lineOfSight: 6, cost: cost(0, 175), buildSeconds: 50,
      popSupport: 0, buildable: true, accepts: [],
      armors: [{ class: 21, amount: 0 }, { class: 11, amount: 0 }, { class: 4, amount: 0 }, { class: 3, amount: 7 }],
    },
    monastery: {
      age: 2,
      hp: 2100, radius: 1.5, lineOfSight: 6, cost: cost(0, 175), buildSeconds: 40,
      popSupport: 0, buildable: true, accepts: [],
      armors: [{ class: 21, amount: 0 }, { class: 11, amount: 0 }, { class: 4, amount: 0 }, { class: 3, amount: 7 }],
    },
    'siege-workshop': {
      age: 2,
      hp: 1500, radius: 2, lineOfSight: 6, cost: cost(0, 200), buildSeconds: 40,
      popSupport: 0, buildable: true, accepts: [],
      armors: [{ class: 21, amount: 0 }, { class: 11, amount: 0 }, { class: 4, amount: 0 }, { class: 3, amount: 7 }],
    },
    // Stone, slow to raise, and the only building besides the town center that
    // both shoots and houses people: the DAT gives it 20 population support.
    castle: {
      age: 2,
      hp: 4800, radius: 2, lineOfSight: 11, cost: cost(0, 0, 0, 650), buildSeconds: 200,
      popSupport: 20, buildable: true, accepts: [],
      armors: [{ class: 26, amount: 0 }, { class: 21, amount: 0 }, { class: 11, amount: 8 }, { class: 4, amount: 8 }, { class: 3, amount: 11 }, { class: 31, amount: 8 }],
      attack: {
        range: 8, attacks: [{ class: 27, amount: 2 }, { class: 3, amount: 11 }],
        reloadSeconds: 2, releaseSeconds: 0.35, projectileSpeed: 7, launchHeight: 4,
      },
    },
  },
  nodes: {
    berries: { resource: 'food', radius: 0.5, amount: 125, fogVisibility: 1 },
    tree: { resource: 'wood', radius: 0.5, amount: 100, fogVisibility: 1 },
    gold: { resource: 'gold', radius: 0.5, amount: 800, fogVisibility: 1 },
    stone: { resource: 'stone', radius: 0.5, amount: 350, fogVisibility: 1 },
  },
  gatherRatePerSecond: { food: 0.31, wood: 0.39, gold: 0.38, stone: 0.36 },
  carryCapacity: 10,
  technologies: {
    loom: {
      techId: 22, name: 'Loom', cost: cost(0, 0, 50), researchSeconds: 25,
      researchedAt: 'town-center', requiresAge: 0,
      effects: [{
        unit: 'villager', hitPoints: 15,
        armors: [{ class: 4, amount: 1 }, { class: 3, amount: 2 }],
      }],
    },
    'feudal-age': {
      techId: 101, name: 'Feudal Age', cost: cost(500), researchSeconds: 130,
      researchedAt: 'town-center', requiresAge: 0, grantsAge: 1, effects: [],
    },
    'castle-age': {
      techId: 102, name: 'Castle Age', cost: cost(800, 0, 200), researchSeconds: 160,
      researchedAt: 'town-center', requiresAge: 1, grantsAge: 2, effects: [],
    },
  },
};

interface ManifestEntity {
  hitPoints: number;
  collision: [number, number];
  lineOfSight: number;
  speedTilesPerSecond?: number;
  cost?: Partial<Record<ResourceKind, number>>;
  populationCost?: number;
  train?: { buildingId: number; seconds: number };
  build?: { builderId: number; seconds: number };
  combat?: {
    reloadSeconds: number;
    frameDelay: number;
    minimumRange?: number;
    maximumRange?: number;
    projectileUnitId?: number;
    launchOffset?: number[];
    blastRadius?: number;
    attacks: AttackValue[];
    armors: AttackValue[];
  };
  heal?: { hitPointsPerSecond: number; range: number };
  convert?: { minSeconds: number; maxSeconds: number; range: number };
  searchRadius?: number;
  gather?: { resource: ResourceKind; ratePerSecond: number; capacity: number };
  trade?: { ratePerSecond: number; capacity: number; buildingId: number };
  age?: number;
  id?: number;
  /** The DAT's `fog_visibility`; 1 keeps it drawn once its tile goes dark. */
  fogVisibility?: number;
  storage?: Partial<Record<ResourceKind, number>>;
  popSupport?: number;
  animations?: Record<string, { frameSeconds: number }>;
}

interface ManifestTech {
  techId: number;
  name: string;
  cost?: Partial<Record<ResourceKind, number>>;
  researchSeconds: number;
  researchedAt: number;
  requiresAge: number;
  grantsAge?: number;
  effects?: { unit: string; hitPoints?: number; armors?: AttackValue[] }[];
}

export interface ContentManifest {
  entities: Record<string, ManifestEntity>;
  technologies?: Record<string, ManifestTech>;
}

const manifestCost = (entity: ManifestEntity): Cost =>
  cost(entity.cost?.food ?? 0, entity.cost?.wood ?? 0, entity.cost?.gold ?? 0, entity.cost?.stone ?? 0);

// Zero-amount entries stay: armor-class membership decides bonus damage.
const attackValues = (values: AttackValue[] | undefined): AttackValue[] => values ?? [];

/** Build DAT-backed rules from the imported content manifest. */
export function rulesFromManifest(manifest: ContentManifest): GameRules {
  const e = manifest.entities;
  // A manifest generated before an entity existed must not break the game: fall
  // back to that entity's open-content rules and keep everything else imported.
  const unit = (key: string, trainedAt: BuildingKind): UnitRules => {
    const fallback = FALLBACK_RULES.units[key as UnitKind];
    if (!e[key]) return { ...fallback, trainedAt };
    return {
      hp: e[key].hitPoints,
      radius: e[key].collision[0],
      speed: e[key].speedTilesPerSecond ?? 0.8,
      lineOfSight: e[key].lineOfSight,
      cost: manifestCost(e[key]),
      trainSeconds: e[key].train?.seconds ?? 25,
      trainedAt,
      popCost: e[key].populationCost ?? 1,
      attacks: attackValues(e[key].combat?.attacks),
      armors: attackValues(e[key].combat?.armors),
      attackReloadSeconds: e[key].combat?.reloadSeconds ?? 2,
      attackReleaseSeconds: Math.round(
        (e[key].combat?.frameDelay ?? 10) * (e[key].animations?.attack?.frameSeconds ?? 0.05) * 100,
      ) / 100,
      age: e[key].age ?? fallback?.age,
      range: e[key].combat?.maximumRange || fallback?.range,
      minRange: e[key].combat?.minimumRange || fallback?.minRange,
      projectileSpeed: fallback?.projectileSpeed,
      launchHeight: e[key].combat?.launchOffset?.[2] ?? fallback?.launchHeight,
      blastRadius: e[key].combat?.blastRadius ?? fallback?.blastRadius,
      heal: e[key].heal ?? fallback?.heal,
      convert: e[key].convert ?? fallback?.convert,
      fogVisibility: e[key].fogVisibility ?? fallback?.fogVisibility,
    };
  };
  /** Gaia's animals: their own rules plus the food the DAT stores on them. */
  const animal = (key: AnimalKind): UnitRules => {
    const fallback = FALLBACK_RULES.units[key];
    return {
      ...unit(key, fallback.trainedAt),
      popCost: 0,
      foodAmount: e[key]?.storage?.food ?? fallback.foodAmount,
      herdRange: fallback.herdRange,
      // Which animals startle is a rule; how close you have to come is the
      // DAT's `search_radius` for that animal.
      startle: fallback.startle && {
        ...fallback.startle,
        range: e[key]?.searchRadius ?? fallback.startle.range,
      },
    };
  };
  const building = (key: string, buildable: boolean): BuildingRules => {
    const fallback = FALLBACK_RULES.buildings[key as BuildingKind];
    if (!e[key]) return { ...fallback, buildable };
    return {
      age: e[key].age ?? fallback.age,
      hp: e[key].hitPoints,
      radius: e[key].collision[0],
      lineOfSight: e[key].lineOfSight,
      cost: manifestCost(e[key]),
      buildSeconds: e[key].build?.seconds ?? 25,
      popSupport: e[key].popSupport ?? 0,
      buildable,
      armors: attackValues(e[key].combat?.armors),
      // Which resources a drop site takes, what a farm holds, and whether a
      // building shoots are gameplay roles, not DAT fields the importer reads.
      accepts: fallback.accepts,
      farmAmount: e[key].storage?.food ?? fallback.farmAmount,
      // The DAT's collision box is a pair of half-extents; only a gate's two
      // differ. Whether that footprint is a doorway is a role, not a field.
      footprint: fallback.footprint && { x: e[key].collision[0], y: e[key].collision[1] },
      passableForOwner: fallback.passableForOwner,
      attack: fallback.attack && {
        ...fallback.attack,
        range: e[key].combat?.maximumRange || fallback.attack.range,
        launchHeight: e[key].combat?.launchOffset?.[2] ?? fallback.attack.launchHeight,
        attacks: attackValues(e[key].combat?.attacks).length
          ? attackValues(e[key].combat?.attacks)
          : fallback.attack.attacks,
        reloadSeconds: e[key].combat?.reloadSeconds ?? fallback.attack.reloadSeconds,
      },
    };
  };
  const node = (key: string, resource: ResourceKind, fallbackKey: NodeKind): ResourceNodeRules => {
    if (!e[key]) return FALLBACK_RULES.nodes[fallbackKey];
    return {
      resource,
      radius: e[key].collision[0],
      amount: e[key].storage?.[resource] ?? FALLBACK_RULES.nodes[fallbackKey].amount,
      fogVisibility: e[key].fogVisibility ?? FALLBACK_RULES.nodes[fallbackKey].fogVisibility,
    };
  };
  return {
    origin: 'imported',
    startingResources: FALLBACK_RULES.startingResources,
    startingPopulationCap: 0,
    units: {
      // A villager hunting is the DAT's hunter unit: its reach and its arrow
      // ride along on the plain villager, used only against animals.
      villager: {
        ...unit('villager', 'town-center'),
        hunt: e['villager-hunter']?.combat?.maximumRange
          ? {
            range: e['villager-hunter'].combat!.maximumRange!,
            projectileSpeed: FALLBACK_RULES.units.villager.hunt!.projectileSpeed,
            launchHeight: e['villager-hunter'].combat!.launchOffset?.[2]
              ?? FALLBACK_RULES.units.villager.hunt!.launchHeight,
            releaseSeconds: Math.round(
              (e['villager-hunter'].combat!.frameDelay ?? 10)
              * (e['villager-hunter'].animations?.attack?.frameSeconds ?? 0.05) * 100,
            ) / 100,
          }
          : FALLBACK_RULES.units.villager.hunt,
      },
      militia: unit('militia', 'barracks'),
      spearman: unit('spearman', 'barracks'),
      archer: { ...unit('archer', 'archery-range'), range: FALLBACK_RULES.units.archer.range },
      skirmisher: {
        ...unit('skirmisher', 'archery-range'),
        projectileSpeed: FALLBACK_RULES.units.skirmisher.projectileSpeed,
      },
      'scout-cavalry': unit('scout-cavalry', 'stable'),
      knight: unit('knight', 'stable'),
      'cavalry-archer': {
        ...unit('cavalry-archer', 'archery-range'),
        projectileSpeed: FALLBACK_RULES.units['cavalry-archer'].projectileSpeed,
      },
      longbowman: {
        ...unit('longbowman', 'castle'),
        projectileSpeed: FALLBACK_RULES.units.longbowman.projectileSpeed,
      },
      'battering-ram': unit('battering-ram', 'siege-workshop'),
      mangonel: {
        ...unit('mangonel', 'siege-workshop'),
        projectileSpeed: FALLBACK_RULES.units.mangonel.projectileSpeed,
      },
      monk: unit('monk', 'monastery'),
      sheep: animal('sheep'),
      deer: animal('deer'),
      boar: animal('boar'),
      'trade-cart': {
        ...unit('trade-cart', 'market'),
        tradeRatePerSecond: e['trade-cart']?.trade?.ratePerSecond
          ?? FALLBACK_RULES.units['trade-cart'].tradeRatePerSecond,
        tradeCapacity: e['trade-cart']?.trade?.capacity
          ?? FALLBACK_RULES.units['trade-cart'].tradeCapacity,
      },
    },
    buildings: {
      'town-center': building('town-center', false),
      barracks: building('barracks', true),
      house: building('house', true),
      mill: building('mill', true),
      'lumber-camp': building('lumber-camp', true),
      'mining-camp': building('mining-camp', true),
      farm: building('farm', true),
      outpost: building('outpost', true),
      'watch-tower': building('watch-tower', true),
      'archery-range': building('archery-range', true),
      blacksmith: building('blacksmith', true),
      market: building('market', true),
      stable: building('stable', true),
      monastery: building('monastery', true),
      'siege-workshop': building('siege-workshop', true),
      castle: building('castle', true),
      'palisade-wall': building('palisade-wall', true),
      'palisade-gate': building('palisade-gate', true),
    },
    nodes: {
      berries: node('berries', 'food', 'berries'),
      tree: node('tree-oak', 'wood', 'tree'),
      gold: node('gold', 'gold', 'gold'),
      stone: node('stone', 'stone', 'stone'),
    },
    gatherRatePerSecond: {
      food: e['villager-forager']?.gather?.ratePerSecond ?? FALLBACK_RULES.gatherRatePerSecond.food,
      wood: e['villager-lumberjack']?.gather?.ratePerSecond ?? FALLBACK_RULES.gatherRatePerSecond.wood,
      gold: e['villager-goldminer']?.gather?.ratePerSecond ?? FALLBACK_RULES.gatherRatePerSecond.gold,
      stone: e['villager-stonemason']?.gather?.ratePerSecond ?? FALLBACK_RULES.gatherRatePerSecond.stone,
    },
    carryCapacity: e['villager-forager']?.gather?.capacity ?? FALLBACK_RULES.carryCapacity,
    technologies: technologies(manifest, e),
  };
}

/**
 * The DAT names a technology's research building by unit id, so the imported
 * entity ids are what turn it back into one of our building kinds.
 */
function technologies(
  manifest: ContentManifest, e: Record<string, ManifestEntity>,
): Record<TechKey, TechRules> {
  const kindOf = new Map<number, BuildingKind>();
  for (const [key, entity] of Object.entries(e)) {
    if (entity.id !== undefined && key in FALLBACK_RULES.buildings) {
      kindOf.set(entity.id, key as BuildingKind);
    }
  }
  const result = { ...FALLBACK_RULES.technologies };
  for (const [key, tech] of Object.entries(manifest.technologies ?? {})) {
    const fallback = FALLBACK_RULES.technologies[key as TechKey];
    if (!fallback) continue;
    result[key as TechKey] = {
      techId: tech.techId,
      name: tech.name,
      cost: cost(tech.cost?.food ?? 0, tech.cost?.wood ?? 0, tech.cost?.gold ?? 0, tech.cost?.stone ?? 0),
      researchSeconds: tech.researchSeconds,
      researchedAt: kindOf.get(tech.researchedAt) ?? fallback.researchedAt,
      requiresAge: tech.requiresAge,
      grantsAge: tech.grantsAge,
      effects: (tech.effects ?? []).map(effect => ({
        unit: effect.unit as UnitKind,
        hitPoints: effect.hitPoints,
        armors: effect.armors,
      })),
    };
  }
  return result;
}

const UNIT_KINDS = new Set<string>([
  'villager', 'militia', 'spearman', 'archer', 'skirmisher', 'scout-cavalry', 'trade-cart',
  'knight', 'cavalry-archer', 'longbowman', 'battering-ram', 'mangonel', 'monk',
  'sheep', 'deer', 'boar',
]);
const BUILDING_KINDS = new Set<string>([
  'town-center', 'barracks', 'house', 'mill', 'lumber-camp', 'mining-camp', 'farm',
  'outpost', 'watch-tower', 'archery-range', 'blacksmith', 'market', 'stable',
  'monastery', 'siege-workshop', 'castle',
  'palisade-wall', 'palisade-gate',
]);

export const isUnit = (kind: EntityKind): kind is UnitKind => UNIT_KINDS.has(kind);
export const isBuilding = (kind: EntityKind): kind is BuildingKind => BUILDING_KINDS.has(kind);
const ANIMAL_KINDS = new Set<string>(['sheep', 'deer', 'boar']);
export const isAnimal = (kind: EntityKind): kind is AnimalKind => ANIMAL_KINDS.has(kind);

/**
 * Units that fight on their own initiative; workers only fight when told. A
 * monk is excluded by having no attack at all rather than by name — it would
 * otherwise walk at the nearest enemy it could never hurt.
 */
export const isMilitary = (kind: EntityKind): boolean =>
  isUnit(kind) && kind !== 'villager' && kind !== 'trade-cart' && !isAnimal(kind)
  && FALLBACK_RULES.units[kind as UnitKind].attacks.some(attack => attack.amount > 0);
