import type { BuildingKind, EntityKind, UnitKind } from './types';

export const COST: Record<UnitKind | BuildingKind, { food: number; wood: number }> = {
  villager: { food: 50, wood: 0 },
  militia: { food: 60, wood: 20 },
  'town-center': { food: 0, wood: 0 },
  barracks: { food: 0, wood: 175 },
  house: { food: 0, wood: 25 },
};

// Fallback stats; lineOfSight values follow the imported DAT evidence
// (militia/villager 4, town center 8, barracks 6, house 2 tiles).
export const STATS: Record<EntityKind, { hp: number; radius: number; lineOfSight: number }> = {
  villager: { hp: 25, radius: 0.36, lineOfSight: 4 },
  militia: { hp: 40, radius: 0.44, lineOfSight: 4 },
  'town-center': { hp: 700, radius: 1.35, lineOfSight: 8 },
  barracks: { hp: 450, radius: 1.1, lineOfSight: 6 },
  house: { hp: 200, radius: 0.75, lineOfSight: 2 },
  resource: { hp: 1, radius: 0.55, lineOfSight: 0 },
};

export const isUnit = (kind: EntityKind): kind is UnitKind => kind === 'villager' || kind === 'militia';
export const isBuilding = (kind: EntityKind): kind is BuildingKind => kind === 'town-center' || kind === 'barracks' || kind === 'house';
