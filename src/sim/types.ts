import type { Cost, GameRules, NodeKind, UnitRules, VillagerGatherTask } from './data';
import type { PlayerVisibility } from './visibility';

export type PlayerId = 1 | 2;
export type ResourceKind = 'food' | 'wood' | 'gold' | 'stone';
export type NavalUnitKind = 'galley' | 'war-galley' | 'galleon' | 'hulk' | 'war-hulk'
  | 'fire-galley' | 'fire-ship' | 'fast-fire-ship'
  | 'demolition-raft' | 'demolition-ship' | 'heavy-demolition-ship'
  | 'cannon-galleon' | 'transport-ship' | 'trade-cog';
export type UnitKind =
  | `dat-unit-${number}`
  | 'villager' | 'militia' | 'man-at-arms' | 'long-swordsman'
  | 'two-handed-swordsman' | 'champion'
  | 'spearman' | 'pikeman' | 'halberdier'
  | 'archer' | 'crossbowman' | 'arbalester' | 'skirmisher' | 'elite-skirmisher'
  | 'scout-cavalry' | 'light-cavalry' | 'trade-cart' | 'fishing-ship'
  | 'knight' | 'cavalier' | 'cavalry-archer' | 'heavy-cavalry-archer'
  | 'longbowman' | 'elite-longbowman'
  | 'battering-ram' | 'capped-ram' | 'mangonel' | 'onager' | 'scorpion' | 'heavy-scorpion' | 'monk'
  | 'trebuchet' | 'petard' | 'siege-tower'
  | AnimalKind | NavalUnitKind;
/** Gaia's food on the hoof: herded, or hunted where it stands. */
export type AnimalKind = 'sheep' | 'deer' | 'boar';
export type BuildingKind =
  | 'town-center' | 'barracks' | 'house'
  | 'mill' | 'lumber-camp' | 'mining-camp' | 'farm'
  | 'outpost' | 'watch-tower'
  | 'archery-range' | 'blacksmith' | 'market' | 'stable'
  | 'monastery' | 'siege-workshop' | 'castle' | 'university' | 'wonder' | 'dock'
  | 'palisade-wall' | 'palisade-gate' | 'fish-trap'
  | 'stone-wall' | 'fortified-wall' | 'stone-gate' | 'fortified-gate' | 'guard-tower' | 'keep';
export type EntityKind = UnitKind | BuildingKind | 'resource' | 'relic';
export type Activity =
  | 'idle' | 'moving' | 'gathering' | 'carrying' | 'building' | 'attacking' | 'dying'
  /** A monk's two works: mending its own side, and preaching at somebody else's. */
  | 'healing' | 'converting'
  /** A villager mending a building or a siege engine. */
  | 'repairing';

export interface Point { x: number; y: number }

export type Order =
  | { kind: 'relic'; targetId: number }
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
  | { kind: 'convert'; targetId: number }
  /** A villager mending its own side's building or siege engine. */
  | { kind: 'repair'; targetId: number }
  /** A unit walking into its own side's building to shelter there. */
  | { kind: 'garrison'; targetId: number }
  | { kind: 'cross-wall'; targetId: number }
  | { kind: 'unload'; target: Point };

export interface Entity {
  id: number;
  kind: EntityKind;
  owner: PlayerId | 0;
  /** Unit-local attributes locked at conversion, independent of either side's
   * subsequent research. Player-level resources/tree permissions still follow
   * owner. Plain data so saves and replays preserve the same inheritance. */
  convertedRules?: UnitRules;
  /** Intact off-map relics: one on a monk, up to capacity in a monastery. */
  relics?: Entity[];
  relicGoldProgress?: number;
  /** 0..100 conversion faith; absent means full, including legacy saves. */
  faith?: number;
  /** Fire Ship charge reservoir; absent means the current maximum. */
  charge?: number;
  position: Point;
  hp: number;
  maxHp: number;
  radius: number;
  activity: Activity;
  order: Order;
  /** Resource nodes. */
  resourceKind?: ResourceKind;
  amount?: number;
  /** Which node a resource is (a shore fish and a bush are both food);
   * absent on a board dealt before nodes were told apart. */
  node?: NodeKind;
  /** Villagers and fishing ships: the load, and which node it came off, since
   * a dock takes fish and not berries. */
  carrying?: { kind: ResourceKind; amount: number; node?: NodeKind; task?: VillagerGatherTask };
  /** Fractional progress towards the next whole unit: a villager's gathering,
   * or a trade cart's goods earned on the road. */
  gatherProgress?: number;
  /** Hit points this repairer has put back on its target, so the price is
   * charged whole resource by whole resource as they come. */
  repaired?: number;
  /**
   * Buildings: the units sheltering inside, whole, and out of the entity
   * list while they are -- nothing sees, hits or walks round a garrisoned
   * unit, and the building shoots for them (issue #75).
   */
  garrison?: Entity[];
  /** Town-bell state, and the worker's interrupted public order/route. */
  townBell?: boolean;
  bellReturn?: { townCenterId: number; order: Order; queue?: Entity['orderQueue'] };
  /**
   * What this worker last put its hands on, so "another of the same first"
   * survives the thing itself being gone. A carcass is removed once it is
   * eaten and its corpse window has passed, which is most of a long meal, and
   * reading the kind off the vanished entity therefore failed exactly when it
   * mattered.
   */
  lastWorked?: Entity['kind'];
  /**
   * And what that thing yielded. The kind alone does not say: every tree,
   * bush, gold and stone node is kind `resource`, so a worker whose node has
   * been swept away has nothing to name the resource it was after unless it
   * kept it (issue #32).
   */
  lastResource?: ResourceKind;
  /** Last working position at sea. A fish can disappear during a dock trip;
   * return here before looking for a visible replacement (#87). */
  fishingPosition?: Point;
  /**
   * Clicks waiting behind the current order, in the order they were given.
   *
   * What is kept is the click, not the order it became: what a right-click
   * *means* depends on the target's state, and a waypoint's target may have
   * been felled, eaten or finished by the time the unit reaches it. Deciding
   * at the moment the unit takes the order is both simpler and more correct.
   * Thrown away by `stop`, and by any order that is not itself queued.
   */
  orderQueue?: { target: Point; targetId?: number }[];
  /** Buildings. */
  /** Half-extents in tiles when the footprint is not the square `radius` says:
   * a gate is two tiles by one, and which way round is its orientation. */
  footprint?: { x: number; y: number };
  buildProgress?: number; // 0..1; undefined once complete
  training?: { kind: UnitKind; remainingTicks: number; paidCost?: Cost };
  /**
   * Units waiting behind the one being trained, in the order they were asked
   * for. Each was paid for when it was queued, as in AoE2, and is refunded if
   * it is cancelled.
   */
  trainingQueue?: UnitKind[];
  /** Original paid prices, aligned with the waiting queue; legacy entries may be absent. */
  trainingQueueCosts?: (Cost | undefined)[];
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
  /** Fraction of the next whole food unit spoiled on an animal carcass. */
  foodDecayProgress?: number;
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
  impactEffect?: string;
  impactSeconds?: number;
  impact?: { effect: string; remainingTicks: number; totalTicks: number };
  /** Persist shot art and pass-through damage even when the shooter dies or upgrades. */
  art?: string;
  piercing?: { radius: number; attacks: { class: number; amount: number }[]; hitIds: number[] };
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
   * The DAT's `blast_attack_level`: what the blast may hurt. A thing is caught
   * when its own defense level is at least this -- 2 reaches soldiers and
   * buildings, 1 fells trees as well.
   */
  blastAttackLevel?: number;
  /**
   * Where it is actually going. Fixed at release: a shot is aimed once and
   * then flies, so a target that walks away is missed. Ballistics moves this
   * to where the target will be; a failed accuracy roll moves it off the
   * target altogether.
   */
  aim: Point;
}

export interface GameState {
  /** Shared commodity base prices, independent of each player's researched fee. */
  marketPrices?: Record<'wood' | 'food' | 'stone', number>;
  rules: GameRules;
  seed: number;
  /**
   * The seed the match was dealt from, kept as it was before anything drew
   * on it. Nothing in the simulation reads it back: it is for streams that
   * must vary between matches without touching this one -- a villager's
   * face is rolled from it and her id in the view (`skins.ts`).
   */
  matchSeed: number;
  tick: number;
  nextId: number;
  width: number;
  height: number;
  entities: Entity[];
  projectiles: Projectile[];
  /** Per-tile DAT terrain id, row-major width x height. Fixed at generation. */
  terrain: number[];
  /** Surveyed height levels on the same grid; generated maps are level zero. */
  elevation: number[];
  players: Record<PlayerId, PlayerState>;
  visibility: Record<PlayerId, PlayerVisibility>;
  winner?: PlayerId;
}

/**
 * The simulation's state as the view, the HUD, the debug bridge and the
 * agents may hold it: readable to any depth, writable nowhere. `src/sim` is
 * authoritative and everything else reaches it through `applyCommand`; this
 * type makes that boundary a compile error instead of a discipline.
 */
export type DeepReadonly<T> =
  T extends (...args: never[]) => unknown ? T
    : T extends Uint8Array | Uint16Array | Uint32Array | Int32Array | Float32Array | Float64Array ? T
      : T extends (infer U)[] ? readonly DeepReadonly<U>[]
        : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
          : T;
export type ReadonlyGameState = DeepReadonly<GameState>;

export type Command =
  | { kind: 'exchange'; player: PlayerId; marketId: number; resource: 'wood' | 'food' | 'stone'; side: 'buy' | 'sell'; amount: 100 | 500 }
  | { kind: 'tribute'; player: PlayerId; recipient: PlayerId; resource: ResourceKind; amount: number }
  | { kind: 'order'; player: PlayerId; entityIds: number[]; target: Point; targetId?: number;
      /** Fall in behind what the unit is already doing instead of replacing
       * it: the reference's shift-click, which is how a player lays a route
       * or a sequence of jobs without waiting for each to finish. */
      queue?: boolean }
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
  | { kind: 'pack'; player: PlayerId; entityIds: number[]; unpacked: boolean }
  /** Take the last unit off a building's queue and refund it. */
  | { kind: 'cancel-train'; player: PlayerId; buildingId: number; index?: number }
  /** Everybody sheltering in this building comes out onto the ground round it. */
  | { kind: 'ungarrison'; player: PlayerId; buildingId: number; target?: Point }
  | { kind: 'town-bell'; player: PlayerId; buildingId: number; enabled: boolean }
  /**
   * Destroy your own things, as the reference's Delete does: a unit you no
   * longer want, or a building in the way. Nothing is refunded and nothing
   * belonging to anybody else can be named.
   */
  | { kind: 'delete'; player: PlayerId; entityIds: number[] };
