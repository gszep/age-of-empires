import type { BuildingRules, TechRules } from './data';

/** Semantic keys shared by placement, renderer and command validation. */
export const isWallKind = (kind: string): boolean =>
  kind === 'palisade-wall' || kind === 'stone-wall' || kind === 'fortified-wall';
export const isGateKind = (kind: string): boolean =>
  kind === 'palisade-gate' || kind === 'stone-gate' || kind === 'fortified-gate';
export const isWallLineKind = (kind: string): boolean => isWallKind(kind) || isGateKind(kind);

const armor = (melee: number, pierce: number, building: number) =>
  [{ class: 21, amount: 0 }, { class: 11, amount: building }, { class: 4, amount: melee },
    { class: 3, amount: pierce }, { class: 13, amount: 0 }, { class: 22, amount: 0 }, { class: 31, amount: melee }];
const wall = (hp: number, melee: number, pierce: number, building: number): BuildingRules => ({
  hp, radius: 0.5, lineOfSight: 2, age: 1, terrainRestriction: 10, hillMode: 0,
  datClass: 27,
  cost: { food: 0, wood: 0, gold: 0, stone: 5 }, buildSeconds: 10, buildButton: 8,
  buildable: true, popSupport: 0, accepts: [], armors: armor(melee, pierce, building),
});
const gate = (hp: number, pierce: number): BuildingRules => ({
  ...wall(hp, 6, pierce, 20), datClass: 39, radius: 2, footprint: { x: 2, y: 0.5 },
  gateOpening: 1, passableForOwner: true, lineOfSight: 6,
  cost: { food: 0, wood: 0, gold: 0, stone: 30 }, buildSeconds: 70, buildButton: 11,
});
const tower = (hp: number, melee: number, pierce: number, attack: number, age: number): BuildingRules => ({
  ...wall(hp, melee, pierce, 0), datClass: 52, age, terrainRestriction: 4, lineOfSight: 10,
  armors: armor(melee, pierce, 0).filter(a => a.class !== 22),
  cost: { food: 0, wood: 35, gold: 0, stone: 125 }, buildSeconds: 80, buildButton: 9,
  confirmDelete: true,
  attack: { range: 8, minRange: 1, attacks: [{ class: 27, amount: 2 }, { class: 11, amount: 0 },
    { class: 16, amount: attack }, { class: 3, amount: attack }, { class: 30, amount: 1 }],
    reloadSeconds: 2, releaseSeconds: 0, projectileSpeed: 7, launchHeight: 5, accuracyPercent: 100 },
  garrison: { capacity: 5, types: 11, healRate: 0.1,
    volley: { base: 1, max: 5, ownProjectile: true, arrowSpeed: 7, arrowAttacks: [{ class: 3, amount: attack }] } },
});

/** Open fallback; reviewed DAT values, not a second imported-mode table. */
export const BUILDING_ROSTER = {
  'stone-wall': { ...wall(1080, 8, 10, 16), datId: 117 },
  'fortified-wall': { ...wall(3000, 12, 12, 24), datId: 155, age: 2 },
  'stone-gate': { ...gate(1650, 6), datId: 64 },
  'fortified-gate': { ...gate(4000, 7), datId: 63, age: 2 },
  'guard-tower': { ...tower(1500, 2, 8, 7, 2), datId: 234 },
  keep: { ...tower(2250, 3, 9, 8, 3), datId: 235 },
} satisfies Record<string, BuildingRules>;

export const BUILDING_TECHS: Record<string, TechRules> = {
  'guard-tower': { techId: 140, name: 'Guard Tower', researchedAt: 'university', requiresAge: 2,
    cost: { food: 100, wood: 250, gold: 0, stone: 0 }, researchSeconds: 30, effects: [],
    upgrades: [{ from: 'watch-tower', to: 'guard-tower' }] },
  keep: { techId: 63, name: 'Keep', researchedAt: 'university', requiresAge: 3, requires: ['guard-tower'],
    cost: { food: 500, wood: 350, gold: 0, stone: 0 }, researchSeconds: 75, effects: [],
    upgrades: [{ from: 'watch-tower', to: 'keep' }, { from: 'guard-tower', to: 'keep' }] },
  'fortified-wall': { techId: 194, name: 'Fortified Wall', researchedAt: 'university', requiresAge: 2,
    cost: { food: 200, wood: 100, gold: 0, stone: 0 }, researchSeconds: 50, effects: [],
    upgrades: [{ from: 'stone-wall', to: 'fortified-wall' }, { from: 'stone-gate', to: 'fortified-gate' }] },
};
