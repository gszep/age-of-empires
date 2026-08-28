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
  /** Which civilisation this player is; public knowledge in AoE2. */
  civilization: string;
  winner?: PlayerId;
  mapWidth: number;
  mapHeight: number;
  food: number;
  wood: number;
  gold: number;
  stone: number;
  population: number;
  populationCap: number;
  /** 0 is the Dark Age; a completed age technology moves it on. */
  age: number;
  /** Technology keys this player has finished researching. */
  researched: string[];
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
  /**
   * Which civilisation each player is. Absent means both take whichever the
   * imported content is for, which is the Britons; a match recorded without
   * the field therefore replays as it was played.
   */
  civilizations?: { 1: string; 2: string };
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
  /**
   * Who each side was playing. A replay rebuilds the match from this record
   * alone, and a civilisation decides what may be researched, so leaving it
   * out would let a replay diverge the moment two civilisations differ.
   */
  civilizations: { 1: string; 2: string };
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
