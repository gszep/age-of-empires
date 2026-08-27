import type { BuildingKind, EntityKind, ResourceKind, UnitKind } from './types';

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
}

export interface BuildingRules {
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
}

export type NodeKind = 'berries' | 'tree' | 'gold' | 'stone';

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
      hp: 45, radius: 0.2, speed: 0.9, lineOfSight: 4, cost: cost(35, 25), trainSeconds: 22,
      trainedAt: 'barracks', popCost: 1,
      attacks: [{ class: 4, amount: 3 }, { class: 8, amount: 15 }, { class: 21, amount: 1 }],
      armors: [{ class: 1, amount: 0 }, { class: 4, amount: 0 }, { class: 3, amount: 0 }],
      attackReloadSeconds: 3, attackReleaseSeconds: 0.5,
    },
    skirmisher: {
      hp: 30, radius: 0.2, speed: 0.96, lineOfSight: 6, cost: cost(25, 35), trainSeconds: 26,
      trainedAt: 'archery-range', popCost: 1,
      attacks: [{ class: 27, amount: 3 }, { class: 15, amount: 3 }, { class: 3, amount: 2 }, { class: 35, amount: 2 }],
      armors: [{ class: 4, amount: 0 }, { class: 15, amount: 0 }, { class: 3, amount: 3 }, { class: 31, amount: 0 }, { class: 38, amount: 0 }],
      attackReloadSeconds: 3, attackReleaseSeconds: 0.63,
      range: 4, minRange: 1, projectileSpeed: 7, launchHeight: 1.5,
    },
    'scout-cavalry': {
      hp: 45, radius: 0.25, speed: 1.2, lineOfSight: 4, cost: cost(80), trainSeconds: 30,
      trainedAt: 'stable', popCost: 1,
      attacks: [{ class: 25, amount: 6 }, { class: 4, amount: 3 }, { class: 39, amount: -3 }],
      armors: [{ class: 4, amount: 0 }, { class: 8, amount: 0 }, { class: 3, amount: 2 }, { class: 31, amount: 0 }],
      attackReloadSeconds: 2, attackReleaseSeconds: 0.4,
    },
    'trade-cart': {
      hp: 70, radius: 0.25, speed: 1.25, lineOfSight: 7, cost: cost(0, 100, 50), trainSeconds: 51,
      trainedAt: 'market', popCost: 1,
      attacks: [],
      armors: [{ class: 4, amount: 0 }, { class: 3, amount: 0 }],
      attackReloadSeconds: 0, attackReleaseSeconds: 0,
      tradeRatePerSecond: 0.2875, tradeCapacity: 100,
    },
    archer: {
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
      hp: 850, radius: 0.5, lineOfSight: 8, cost: cost(0, 25, 0, 125), buildSeconds: 27,
      popSupport: 0, buildable: true, accepts: [],
      armors: [{ class: 21, amount: 0 }, { class: 11, amount: 0 }, { class: 4, amount: 0 }, { class: 3, amount: 8 }],
      attack: {
        range: 8, attacks: [{ class: 3, amount: 5 }], reloadSeconds: 2, releaseSeconds: 0.35,
        projectileSpeed: 7, launchHeight: 5,
      },
    },
    'archery-range': {
      hp: 1500, radius: 1.5, lineOfSight: 6, cost: cost(0, 175), buildSeconds: 50,
      popSupport: 0, buildable: true, accepts: [],
      armors: [{ class: 21, amount: 0 }, { class: 11, amount: 0 }, { class: 4, amount: 0 }, { class: 3, amount: 7 }],
    },
    blacksmith: {
      hp: 1800, radius: 1.5, lineOfSight: 6, cost: cost(0, 150), buildSeconds: 40,
      popSupport: 0, buildable: true, accepts: [],
      armors: [{ class: 21, amount: 0 }, { class: 11, amount: 0 }, { class: 4, amount: 0 }, { class: 3, amount: 7 }],
    },
    market: {
      hp: 1800, radius: 1.5, lineOfSight: 6, cost: cost(0, 175), buildSeconds: 60,
      popSupport: 0, buildable: true, accepts: [],
      armors: [{ class: 21, amount: 0 }, { class: 11, amount: 0 }, { class: 4, amount: 0 }, { class: 3, amount: 7 }],
    },
    stable: {
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
  storage?: Partial<Record<ResourceKind, number>>;
  popSupport?: number;
  animations?: Record<string, { frameSeconds: number }>;
}

export interface ContentManifest { entities: Record<string, ManifestEntity> }

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
      range: e[key].combat?.maximumRange || fallback?.range,
      minRange: e[key].combat?.minimumRange || fallback?.minRange,
      projectileSpeed: fallback?.projectileSpeed,
      launchHeight: e[key].combat?.launchOffset?.[2] ?? fallback?.launchHeight,
    };
  };
  const building = (key: string, buildable: boolean): BuildingRules => {
    const fallback = FALLBACK_RULES.buildings[key as BuildingKind];
    if (!e[key]) return { ...fallback, buildable };
    return {
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
  };
}

const UNIT_KINDS = new Set<string>([
  'villager', 'militia', 'spearman', 'archer', 'skirmisher', 'scout-cavalry', 'trade-cart',
]);
const BUILDING_KINDS = new Set<string>([
  'town-center', 'barracks', 'house', 'mill', 'lumber-camp', 'mining-camp', 'farm',
  'outpost', 'watch-tower', 'archery-range', 'blacksmith', 'market', 'stable',
]);

export const isUnit = (kind: EntityKind): kind is UnitKind => UNIT_KINDS.has(kind);
export const isBuilding = (kind: EntityKind): kind is BuildingKind => BUILDING_KINDS.has(kind);
/** Units that fight on their own initiative; workers only fight when told. */
export const isMilitary = (kind: EntityKind): boolean =>
  isUnit(kind) && kind !== 'villager' && kind !== 'trade-cart';
