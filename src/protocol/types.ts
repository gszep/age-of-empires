import type { Activity, Command, EntityKind, Order, PlayerId, ResourceKind, UnitKind } from '../sim/types';
import type { NodeKind } from '../sim/data';

/** v11 adds public population ceilings and Wonder countdowns; v10 added public scores; v9 added waiting research. */
export const PROTOCOL_VERSION = 11;
/** v5 deals all Arabia biomes; v4 records score receipts; v3 enables research queues. */
export const MATCH_FORMAT_VERSION = 5;

export interface ObservedEntity {
  id: number;
  kind: EntityKind;
  owner: PlayerId | 0;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  resource?: ResourceKind;
  node?: NodeKind;
  amount?: number;
  buildProgress?: number;
  /** Own entities only; hidden from opponents. */
  activity?: Activity;
  order?: Order['kind'];
  /** Own builders only, including those still walking to the foundation. */
  buildTargetId?: number;
  /** Own gatherers only, including those walking to or banking from the node. */
  gatherTargetId?: number;
  carrying?: { kind: ResourceKind; amount: number; node?: NodeKind };
  carryingRelic?: boolean;
  relics?: number;
  faith?: number;
  charge?: { current: number; maximum: number };
  training?: { kind: UnitKind; remainingSeconds: number };
  /** What it is researching; own buildings only, like `training`. */
  researching?: { tech: string; remainingSeconds: number };
  /** Waiting research technologies in FIFO order; own buildings only. */
  researchQueue?: string[];
  /** Own carriers/buildings only: all occupants, including nested passengers.
   * They are not separate entries in the visible entity list. */
  garrisoned?: number;
  /** A visible flag reveals occupancy (units or stored building relics),
   * not private counts or contents. */
  hasGarrison?: boolean;
  /** Own town centers only. */
  townBell?: boolean;
}

export type TerrainRun = [length: number, terrain: number, elevation: number];

export interface PlayerObservation {
  /** Per-row [run length, terrain ID, elevation] tuples; -1 means unexplored.
   * Emitted by observe; optional for older handcrafted strategy fixtures. */
  terrain?: TerrainRun[][];
  mode: import('../sim/types').GameMode;
  draw?: boolean;
  treason?: { goldCost: number; available: boolean; untilTick: number; kings: { owner: PlayerId; x: number; y: number }[] };
  version: typeof PROTOCOL_VERSION;
  /** Public scoreboard totals, even for unseen opponents. Optional in older fixtures. */
  scores?: Record<PlayerId, number>;
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
  /** This observer's effective ceiling (match/rules base plus own bonuses), not
   * housing. In v11 absence means unbounded legacy rules; never emits Infinity. */
  populationLimit?: number;
  /** 0 is the Dark Age; a completed age technology moves it on. */
  age: number;
  /** Whether this player's fallow farms re-sow themselves (issue #24). Their
   * own setting, visible so a strategy can decide without remembering. */
  autoReseedFarms?: boolean;
  /** Technology keys this player has finished researching. */
  researched: string[];
  /** Current public prices; Spies' quote deliberately reveals its villager-based price. */
  researchCosts?: Record<string, { food: number; wood: number; gold: number; stone: number }>;
  market?: { buy: Record<'wood' | 'food' | 'stone', number>; sell: Record<'wood' | 'food' | 'stone', number>; tributeFee: number };
  /** Announced, surviving completed Wonders of both players, independent of fog.
   * Absence means no active timers (including disabled victory). Coordinates do
   * not reveal terrain/stats or authorize targeting a hidden entityId. */
  wonderCountdowns?: Array<{ owner: PlayerId; entityId: number; x: number; y: number; remainingSeconds: number }>;
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
  wonderVictory?: boolean;
  populationLimit?: number;
  version: 1 | 2 | 3 | 4 | typeof MATCH_FORMAT_VERSION;
  seed: number;
  maxTimeSeconds?: number;
  decideIntervalSeconds?: number;
  /**
   * Which civilisation each player is. Absent means both take whichever the
   * imported content is for, which is the Britons; a match recorded without
   * the field therefore replays as it was played.
   */
  civilizations?: { 1: string; 2: string };
  /** Which map type generates the board. Absent means `arabia`, so a match
   * recorded before map types existed replays as it was played. */
  map?: string;
  mode?: import('../sim/types').GameMode;
}

export interface PlayerSummary {
  food: number;
  wood: number;
  gold: number;
  stone: number;
  population: number;
  entities: number;
  /** 0 is the Dark Age. What a batch needs to say whether anybody aged up. */
  age: number;
  /** Technologies finished, in the order they completed. */
  researched: string[];
}

export interface MatchResult {
  mode?: import('../sim/types').GameMode;
  draw?: boolean;
  version: 1 | 2 | 3 | 4 | typeof MATCH_FORMAT_VERSION;
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
  node?: NodeKind;
  amount?: number;
  buildProgress?: number;
  /** Seconds of game time when this entity was last seen. */
  lastSeenAt: number;
  /** Last-seen occupancy flag, on the same terms as ObservedEntity.hasGarrison. */
  hasGarrison?: boolean;
}

/** Everything needed to reproduce a match tick-for-tick. */
export interface MatchRecord {
  wonderVictory?: boolean;
  populationLimit?: number;
  mode?: import('../sim/types').GameMode;
  version: 1 | 2 | 3 | 4 | typeof MATCH_FORMAT_VERSION;
  seed: number;
  rulesOrigin: 'fallback' | 'imported';
  /**
   * Who each side was playing. A replay rebuilds the match from this record
   * alone, and a civilisation decides what may be researched, so leaving it
   * out would let a replay diverge the moment two civilisations differ.
   */
  civilizations: { 1: string; 2: string };
  /** The map type the board was generated from; absent means `arabia`. */
  map?: string;
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
