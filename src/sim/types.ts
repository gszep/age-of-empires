import type { GameRules } from './data';
import type { PlayerVisibility } from './visibility';

export type PlayerId = 1 | 2;
export type ResourceKind = 'food' | 'wood' | 'gold' | 'stone';
export type UnitKind =
  | 'villager' | 'militia' | 'man-at-arms' | 'long-swordsman'
  | 'two-handed-swordsman' | 'champion'
  | 'spearman' | 'pikeman' | 'halberdier'
  | 'archer' | 'crossbowman' | 'arbalester' | 'skirmisher' | 'elite-skirmisher'
  | 'scout-cavalry' | 'light-cavalry' | 'trade-cart'
  | 'knight' | 'cavalier' | 'cavalry-archer' | 'heavy-cavalry-archer'
  | 'longbowman' | 'elite-longbowman'
  | 'battering-ram' | 'capped-ram' | 'mangonel' | 'onager' | 'monk'
  | 'trebuchet'
  | AnimalKind;
/** Gaia's food on the hoof: herded, or hunted where it stands. */
export type AnimalKind = 'sheep' | 'deer' | 'boar';
export type BuildingKind =
  | 'town-center' | 'barracks' | 'house'
  | 'mill' | 'lumber-camp' | 'mining-camp' | 'farm'
  | 'outpost' | 'watch-tower'
  | 'archery-range' | 'blacksmith' | 'market' | 'stable'
  | 'monastery' | 'siege-workshop' | 'castle' | 'university' | 'wonder'
  | 'palisade-wall' | 'palisade-gate';
export type EntityKind = UnitKind | BuildingKind | 'resource';
export type Activity =
  | 'idle' | 'moving' | 'gathering' | 'carrying' | 'building' | 'attacking' | 'dying'
  /** A monk's two works: mending its own side, and preaching at somebody else's. */
  | 'healing' | 'converting';

export interface Point { x: number; y: number }

export type Order =
  | { kind: 'idle' }
  | { kind: 'move'; target: Point }
  | { kind: 'gather'; targetId: number }
  | { kind: 'build'; targetId: number }
  | { kind: 'attack'; targetId: number }
  /** A trade cart shuttling to the market with this id and back to its own. */
  | { kind: 'trade'; targetId: number }
  /** A monk restoring a wounded ally's hit points. */
  | { kind: 'heal'; targetId: number }
  /** A monk working on somebody else's unit until it changes sides. */
  | { kind: 'convert'; targetId: number };

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
  /** Fractional progress towards the next whole unit: a villager's gathering,
   * or a trade cart's goods earned on the road. */
  gatherProgress?: number;
  /**
   * What this worker last put its hands on, so "another of the same first"
   * survives the thing itself being gone. A carcass is removed once it is
   * eaten and its corpse window has passed, which is most of a long meal, and
   * reading the kind off the vanished entity therefore failed exactly when it
   * mattered.
   */
  lastWorked?: Entity['kind'];
  /** Buildings. */
  /** Half-extents in tiles when the footprint is not the square `radius` says:
   * a gate is two tiles by one, and which way round is its orientation. */
  footprint?: { x: number; y: number };
  buildProgress?: number; // 0..1; undefined once complete
  training?: { kind: UnitKind; remainingTicks: number };
  researching?: { tech: string; remainingTicks: number };
  rally?: { target: Point; targetId?: number };
  attackCooldown?: number; // ticks until a new swing may start
  attackWindup?: number; // ticks until the started swing releases damage
  /**
   * A siege engine that has to be set up: a trebuchet travels packed and
   * shoots unpacked, and is two units in the DAT (331 and 42) with the
   * pairing left to the engine. Absent means packed, which is how it is
   * trained.
   */
  unpacked?: boolean;
  /** Ticks left in a pack or unpack; the engine can do nothing else meanwhile. */
  packingTicks?: number;
  /** Monks: ticks spent working on the current conversion target. Reset the
   * moment the monk stops, so a broken-off attempt is not banked. */
  convertTicks?: number;
  /** Deer: ticks left before something can startle it again, so a hop is
   * followed by grazing rather than by another hop. */
  fleeCooldown?: number;
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
  /** Which civilisation they are playing; it decides what their tree allows. */
  civilization: string;
  /** 0 is the Dark Age; a completed age technology moves it on. */
  age: number;
  /** Technology keys already researched, in the order they completed. */
  researched: string[];
  food: number;
  wood: number;
  gold: number;
  stone: number;
  population: number;
  populationCap: number;
  /**
   * Whether a villager whose farm goes fallow sows it again on the spot,
   * paying the farm's wood. Off unless the player turns it on at a mill: the
   * DAT gives the farm one build location, the villager, so a mill that
   * re-sows is the engine's behaviour rather than the data's, and nothing
   * about an existing match changes until it is asked for (issue #24).
   */
  autoReseedFarms?: boolean;
}

/**
 * An arrow in flight. Ranged attackers resolve damage on impact rather than on
 * release, so a shot crosses the gap the way it does in AoE2 and a target that
 * dies first simply takes the arrow into empty ground.
 */
export interface Projectile {
  id: number;
  owner: PlayerId;
  position: Point;
  /** Launch point, so the renderer can tell how far through its flight it is. */
  origin: Point;
  targetId: number;
  /** Who loosed it, so a wounded animal knows whom to charge. */
  shooterId: number;
  /** Fixed at launch, so the shot lands even if the shooter dies mid-flight. */
  attacks: { class: number; amount: number }[];
  speed: number; // tiles per second
  /** Height it left from, in tiles: a tower shoots from its top. */
  launchHeight: number;
  /** Tiles around the impact that also take the hit, for a siege shot. */
  blastRadius?: number;
  /**
   * Where it is actually going. Fixed at release: a shot is aimed once and
   * then flies, so a target that walks away is missed. Ballistics moves this
   * to where the target will be; a failed accuracy roll moves it off the
   * target altogether.
   */
  aim: Point;
}

export interface GameState {
  rules: GameRules;
  seed: number;
  tick: number;
  nextId: number;
  width: number;
  height: number;
  entities: Entity[];
  projectiles: Projectile[];
  players: Record<PlayerId, PlayerState>;
  visibility: Record<PlayerId, PlayerVisibility>;
  winner?: PlayerId;
}

export type Command =
  | { kind: 'order'; player: PlayerId; entityIds: number[]; target: Point; targetId?: number }
  | { kind: 'train'; player: PlayerId; buildingId: number; unit: UnitKind }
  | { kind: 'build'; player: PlayerId; builderIds: number[]; building: BuildingKind; target: Point;
      /** Which way a building longer than it is wide lies. Defaults to `x`. */
      orientation?: 'x' | 'y' }
  | { kind: 'rally'; player: PlayerId; buildingId: number; target: Point; targetId?: number }
  | { kind: 'stop'; player: PlayerId; entityIds: number[] }
  | { kind: 'research'; player: PlayerId; buildingId: number; tech: string }
  /** Turn automatic farm re-sowing on or off, from one of the player's mills. */
  | { kind: 'reseed'; player: PlayerId; buildingId: number; enabled: boolean }
  /** Set a siege engine up to shoot, or pack it up to travel. */
  | { kind: 'pack'; player: PlayerId; entityIds: number[]; unpacked: boolean };
