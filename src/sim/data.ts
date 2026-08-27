import type { AnimalKind, BuildingKind, EntityKind, ResourceKind, UnitKind } from './types';

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
  /** Trade carts: goods earned per second on the road, and the most they hold. */
  tradeRatePerSecond?: number;
  tradeCapacity?: number;
  /** Animals: the food their carcass holds. */
  foodAmount?: number;
  /** Animals: how close a player's unit must come to claim a herdable. */
  herdRange?: number;
  /** Animals: how far one bolts from anything that is not gaia. */
  fleeRange?: number;
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
export type TechKey = 'loom' | 'feudal-age';

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
    },
    deer: {
      hp: 5, radius: 0.3, speed: 0.737, lineOfSight: 2, cost: cost(), trainSeconds: 0,
      trainedAt: 'town-center', popCost: 0,
      attacks: [], armors: [{ class: 4, amount: 0 }, { class: 3, amount: 0 }],
      attackReloadSeconds: 0, attackReleaseSeconds: 0,
      foodAmount: 140, fleeRange: 5,
    },
    boar: {
      hp: 75, radius: 0.5, speed: 0.8, lineOfSight: 4, cost: cost(), trainSeconds: 0,
      trainedAt: 'town-center', popCost: 0,
      attacks: [{ class: 4, amount: 7 }, { class: 29, amount: 4 }, { class: 8, amount: 3 }, { class: 30, amount: 8 }],
      armors: [{ class: 4, amount: 0 }, { class: 3, amount: 0 }, { class: 24, amount: 0 }],
      attackReloadSeconds: 2, attackReleaseSeconds: 0,
      foodAmount: 340,
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
    stable: {
      age: 1,
      hp: 1500, radius: 1.5, lineOfSight: 6, cost: cost(0, 175), buildSeconds: 50,
      popSupport: 0, buildable: true, accepts: [],
      armors: [{ class: 21, amount: 0 }, { class: 11, amount: 0 }, { class: 4, amount: 0 }, { class: 3, amount: 7 }],
    },
  },
  nodes: {
    berries: { resource: 'food', radius: 0.5, amount: 125 },
    tree: { resource: 'wood', radius: 0.5, amount: 100 },
    gold: { resource: 'gold', radius: 0.5, amount: 800 },
    stone: { resource: 'stone', radius: 0.5, amount: 350 },
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
    attacks: AttackValue[];
    armors: AttackValue[];
  };
  gather?: { resource: ResourceKind; ratePerSecond: number; capacity: number };
  trade?: { ratePerSecond: number; capacity: number; buildingId: number };
  age?: number;
  id?: number;
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
      fleeRange: fallback.fleeRange,
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
    };
  };
  return {
    origin: 'imported',
    startingResources: FALLBACK_RULES.startingResources,
    startingPopulationCap: 0,
    units: {
      villager: unit('villager', 'town-center'),
      militia: unit('militia', 'barracks'),
      spearman: unit('spearman', 'barracks'),
      archer: { ...unit('archer', 'archery-range'), range: FALLBACK_RULES.units.archer.range },
      skirmisher: {
        ...unit('skirmisher', 'archery-range'),
        projectileSpeed: FALLBACK_RULES.units.skirmisher.projectileSpeed,
      },
      'scout-cavalry': unit('scout-cavalry', 'stable'),
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
  'sheep', 'deer', 'boar',
]);
const BUILDING_KINDS = new Set<string>([
  'town-center', 'barracks', 'house', 'mill', 'lumber-camp', 'mining-camp', 'farm',
  'outpost', 'watch-tower', 'archery-range', 'blacksmith', 'market', 'stable',
]);

export const isUnit = (kind: EntityKind): kind is UnitKind => UNIT_KINDS.has(kind);
export const isBuilding = (kind: EntityKind): kind is BuildingKind => BUILDING_KINDS.has(kind);
const ANIMAL_KINDS = new Set<string>(['sheep', 'deer', 'boar']);
export const isAnimal = (kind: EntityKind): kind is AnimalKind => ANIMAL_KINDS.has(kind);

/** Units that fight on their own initiative; workers only fight when told. */
export const isMilitary = (kind: EntityKind): boolean =>
  isUnit(kind) && kind !== 'villager' && kind !== 'trade-cart' && !isAnimal(kind);
