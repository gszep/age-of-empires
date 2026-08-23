import type { BuildingKind, EntityKind, UnitKind } from './types';

export const COST: Record<UnitKind | BuildingKind, { food: number; wood: number }> = {
  villager: { food: 50, wood: 0 },
  militia: { food: 60, wood: 20 },
  'town-center': { food: 0, wood: 0 },
  barracks: { food: 0, wood: 175 },
  house: { food: 0, wood: 25 },
};

export const STATS: Record<EntityKind, { hp: number; radius: number }> = {
  villager: { hp: 25, radius: 0.36 },
  militia: { hp: 40, radius: 0.44 },
  'town-center': { hp: 700, radius: 1.35 },
  barracks: { hp: 450, radius: 1.1 },
  house: { hp: 200, radius: 0.75 },
  resource: { hp: 1, radius: 0.55 },
};

export const isUnit = (kind: EntityKind): kind is UnitKind => kind === 'villager' || kind === 'militia';
export const isBuilding = (kind: EntityKind): kind is BuildingKind => kind === 'town-center' || kind === 'barracks' || kind === 'house';
