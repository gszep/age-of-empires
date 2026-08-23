export type PlayerId = 1 | 2;
export type ResourceKind = 'food' | 'wood';
export type UnitKind = 'villager' | 'militia';
export type BuildingKind = 'town-center' | 'barracks' | 'house';
export type EntityKind = UnitKind | BuildingKind | 'resource';
export type Activity = 'idle' | 'moving' | 'gathering' | 'attacking';

export interface Point { x: number; y: number }

export type Order =
  | { kind: 'idle' }
  | { kind: 'move'; target: Point }
  | { kind: 'gather'; targetId: number }
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
  resourceKind?: ResourceKind;
  amount?: number;
  carrying?: { kind: ResourceKind; amount: number };
  training?: { kind: UnitKind; remaining: number };
}

export interface PlayerState {
  id: PlayerId;
  food: number;
  wood: number;
  population: number;
  populationCap: number;
}

export interface GameState {
  seed: number;
  time: number;
  nextId: number;
  width: number;
  height: number;
  entities: Entity[];
  players: Record<PlayerId, PlayerState>;
  winner?: PlayerId;
}

export type Command =
  | { kind: 'order'; player: PlayerId; entityIds: number[]; target: Point; targetId?: number }
  | { kind: 'train'; player: PlayerId; buildingId: number; unit: UnitKind }
  | { kind: 'build'; player: PlayerId; builderId: number; building: BuildingKind; target: Point };
