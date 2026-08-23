import type { BuildingKind, EntityKind, ResourceKind, UnitKind } from './types';

export const TICK_SECONDS = 0.05;
export const TICKS_PER_SECOND = 20;

export interface Cost { food: number; wood: number; gold: number }

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
  nodes: Record<'berries' | 'tree' | 'gold', ResourceNodeRules>;
  gatherRatePerSecond: Record<ResourceKind, number>;
  carryCapacity: number;
}

const cost = (food = 0, wood = 0, gold = 0): Cost => ({ food, wood, gold });

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
  },
  buildings: {
    'town-center': {
      hp: 2400, radius: 2, lineOfSight: 8, cost: cost(0, 275), buildSeconds: 100,
      popSupport: 5, buildable: false,
      armors: [{ class: 21, amount: 0 }, { class: 11, amount: 0 }, { class: 4, amount: 3 }, { class: 3, amount: 5 }],
    },
    barracks: {
      hp: 1200, radius: 1.5, lineOfSight: 6, cost: cost(0, 175), buildSeconds: 50,
      popSupport: 0, buildable: true,
      armors: [{ class: 21, amount: 0 }, { class: 11, amount: 0 }, { class: 4, amount: 0 }, { class: 3, amount: 7 }],
    },
    house: {
      hp: 550, radius: 1, lineOfSight: 2, cost: cost(0, 25), buildSeconds: 25,
      popSupport: 5, buildable: true,
      armors: [{ class: 21, amount: 0 }, { class: 11, amount: 0 }, { class: 4, amount: -2 }, { class: 3, amount: 7 }],
    },
  },
  nodes: {
    berries: { resource: 'food', radius: 0.5, amount: 125 },
    tree: { resource: 'wood', radius: 0.5, amount: 100 },
    gold: { resource: 'gold', radius: 0.5, amount: 800 },
  },
  gatherRatePerSecond: { food: 0.31, wood: 0.39, gold: 0.38 },
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
    attacks: AttackValue[];
    armors: AttackValue[];
  };
  gather?: { resource: ResourceKind; ratePerSecond: number; capacity: number };
  storage?: Partial<Record<ResourceKind, number>>;
  popSupport?: number;
  animations?: Record<string, { frameSeconds: number }>;
}

export interface ContentManifest { entities: Record<string, ManifestEntity> }

const manifestCost = (entity: ManifestEntity): Cost =>
  cost(entity.cost?.food ?? 0, entity.cost?.wood ?? 0, entity.cost?.gold ?? 0);

// Zero-amount entries stay: armor-class membership decides bonus damage.
const attackValues = (values: AttackValue[] | undefined): AttackValue[] => values ?? [];

/** Build DAT-backed rules from the imported content manifest. */
export function rulesFromManifest(manifest: ContentManifest): GameRules {
  const e = manifest.entities;
  const unit = (key: string, trainedAt: BuildingKind): UnitRules => ({
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
  });
  const building = (key: string, buildable: boolean): BuildingRules => ({
    hp: e[key].hitPoints,
    radius: e[key].collision[0],
    lineOfSight: e[key].lineOfSight,
    cost: manifestCost(e[key]),
    buildSeconds: e[key].build?.seconds ?? 25,
    popSupport: e[key].popSupport ?? 0,
    buildable,
    armors: attackValues(e[key].combat?.armors),
  });
  const node = (key: string, resource: ResourceKind): ResourceNodeRules => ({
    resource,
    radius: e[key].collision[0],
    amount: e[key].storage?.[resource] ?? FALLBACK_RULES.nodes.tree.amount,
  });
  return {
    origin: 'imported',
    startingResources: FALLBACK_RULES.startingResources,
    startingPopulationCap: 0,
    units: { villager: unit('villager', 'town-center'), militia: unit('militia', 'barracks') },
    buildings: {
      'town-center': building('town-center', false),
      barracks: building('barracks', true),
      house: building('house', true),
    },
    nodes: {
      berries: node('berries', 'food'),
      tree: node('tree-oak', 'wood'),
      gold: node('gold', 'gold'),
    },
    gatherRatePerSecond: {
      food: e['villager-forager'].gather?.ratePerSecond ?? 0.31,
      wood: e['villager-lumberjack'].gather?.ratePerSecond ?? 0.39,
      gold: e['villager-goldminer'].gather?.ratePerSecond ?? 0.38,
    },
    carryCapacity: e['villager-forager'].gather?.capacity ?? 10,
  };
}

export const isUnit = (kind: EntityKind): kind is UnitKind => kind === 'villager' || kind === 'militia';
export const isBuilding = (kind: EntityKind): kind is BuildingKind =>
  kind === 'town-center' || kind === 'barracks' || kind === 'house';
