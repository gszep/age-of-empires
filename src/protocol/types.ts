import type { Activity, Command, EntityKind, Order, PlayerId, ResourceKind, UnitKind } from '../sim/types';

export const PROTOCOL_VERSION = 1;

export interface ObservedEntity {
  id: number;
  kind: EntityKind;
  owner: PlayerId | 0;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  resource?: ResourceKind;
  amount?: number;
  buildProgress?: number;
  /** Own entities only; hidden from opponents. */
  activity?: Activity;
  order?: Order['kind'];
  carrying?: { kind: ResourceKind; amount: number };
  training?: { kind: UnitKind; remainingSeconds: number };
}

export interface PlayerObservation {
  version: typeof PROTOCOL_VERSION;
  time: number;
  player: PlayerId;
  winner?: PlayerId;
  mapWidth: number;
  mapHeight: number;
  food: number;
  wood: number;
  gold: number;
  stone: number;
  population: number;
  populationCap: number;
  entities: ObservedEntity[];
  /** Last-seen snapshots of entities not currently visible. */
  memory: RememberedEntityObservation[];
  /** Row strings of 0/1 explored tiles, indexed [y][x]. */
  explored: string[];
}

export interface RejectedCommand {
  time: number;
  player: PlayerId;
  reason: string;
  command: Command;
}

export interface MatchConfig {
  version: typeof PROTOCOL_VERSION;
  seed: number;
  maxTimeSeconds?: number;
  decideIntervalSeconds?: number;
}

export interface PlayerSummary {
  food: number;
  wood: number;
  gold: number;
  stone: number;
  population: number;
  entities: number;
}

export interface MatchResult {
  version: typeof PROTOCOL_VERSION;
  seed: number;
  timeSeconds: number;
  winner?: PlayerId;
  players: Record<PlayerId, PlayerSummary>;
  rejectedCommands: RejectedCommand[];
}

export interface RememberedEntityObservation {
  id: number;
  kind: EntityKind;
  owner: PlayerId | 0;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  resource?: ResourceKind;
  amount?: number;
  buildProgress?: number;
  /** Seconds of game time when this entity was last seen. */
  lastSeenAt: number;
}

/** Everything needed to reproduce a match tick-for-tick. */
export interface MatchRecord {
  version: typeof PROTOCOL_VERSION;
  seed: number;
  rulesOrigin: 'fallback' | 'imported';
  decideIntervalSeconds: number;
  maxTimeSeconds: number;
  commands: { tick: number; command: Command }[];
  checksums: { tick: number; hash: string }[];
  result: MatchResult;
}

/** Runner -> strategy JSONL line. */
export interface StrategyInputMessage {
  type: 'observation';
  observation: PlayerObservation;
  text: string;
  rejected: RejectedCommand[];
}

/** Strategy -> runner JSONL line. */
export interface StrategyOutputMessage {
  type: 'commands';
  time: number;
  commands: Command[];
}
