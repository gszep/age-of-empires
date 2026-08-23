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
  /** Own entities only; hidden from opponents. */
  activity?: Activity;
  order?: Order['kind'];
  training?: { kind: UnitKind; remaining: number };
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
  population: number;
  populationCap: number;
  entities: ObservedEntity[];
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
