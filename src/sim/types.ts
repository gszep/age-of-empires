import type { GameRules } from './data';
import type { PlayerVisibility } from './visibility';

export type PlayerId = 1 | 2;
export type ResourceKind = 'food' | 'wood' | 'gold' | 'stone';
export type UnitKind = 'villager' | 'militia' | 'spearman' | 'archer';
export type BuildingKind =
  | 'town-center' | 'barracks' | 'house'
  | 'mill' | 'lumber-camp' | 'mining-camp' | 'farm'
  | 'outpost' | 'watch-tower'
  | 'archery-range' | 'blacksmith' | 'market';
export type EntityKind = UnitKind | BuildingKind | 'resource';
export type Activity = 'idle' | 'moving' | 'gathering' | 'carrying' | 'building' | 'attacking' | 'dying';

export interface Point { x: number; y: number }

export type Order =
  | { kind: 'idle' }
  | { kind: 'move'; target: Point }
  | { kind: 'gather'; targetId: number }
  | { kind: 'build'; targetId: number }
  | { kind: 'attack'; targetId: number };

export interface Entity {
  id: number;
  kind: EntityKind;
  owner: PlayerId | 0;
  position: Point;
  hp: number;
  maxHp: number;
  radius: number;
  activity: Activity;
  order: Order;
  /** Resource nodes. */
  resourceKind?: ResourceKind;
  amount?: number;
  /** Villagers. */
  carrying?: { kind: ResourceKind; amount: number };
  gatherProgress?: number;
  /** Buildings. */
  buildProgress?: number; // 0..1; undefined once complete
  training?: { kind: UnitKind; remainingTicks: number };
  rally?: { target: Point; targetId?: number };
  attackCooldown?: number; // ticks until a new swing may start
  attackWindup?: number; // ticks until the started swing releases damage
  /** Corpse state: plays the death animation, then despawns. */
  dead?: boolean;
  decayTicks?: number;
  /** Navigation. */
  path?: Point[];
  pathGoal?: Point;
  stuckTicks?: number;
}

export interface PlayerState {
  id: PlayerId;
  food: number;
  wood: number;
  gold: number;
  stone: number;
  population: number;
  populationCap: number;
}

export interface GameState {
  rules: GameRules;
  seed: number;
  tick: number;
  nextId: number;
  width: number;
  height: number;
  entities: Entity[];
  players: Record<PlayerId, PlayerState>;
  visibility: Record<PlayerId, PlayerVisibility>;
  winner?: PlayerId;
}

export type Command =
  | { kind: 'order'; player: PlayerId; entityIds: number[]; target: Point; targetId?: number }
  | { kind: 'train'; player: PlayerId; buildingId: number; unit: UnitKind }
  | { kind: 'build'; player: PlayerId; builderIds: number[]; building: BuildingKind; target: Point }
  | { kind: 'rally'; player: PlayerId; buildingId: number; target: Point; targetId?: number }
  | { kind: 'stop'; player: PlayerId; entityIds: number[] };
