import type { BuildingKind, Command, EntityKind, ResourceKind } from './types';
import { isBuilding } from './data';
import type { PlayerObservation } from '../protocol/types';

interface Spotted {
  id: number; kind: string; owner: number; x: number; y: number;
  resource?: ResourceKind; amount?: number; training?: unknown; researching?: unknown;
  buildProgress?: number; order?: string;
}

const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Which resource each villager works, by its place in the line.
 *
 * Food is what everything costs -- a villager, a militia, and every age -- and
 * three-food-two-wood-one-gold ended matches with twelve hundred wood banked
 * and twenty food, which is a lumber yard rather than an economy. But cutting
 * wood to one in six was worse in a way that took a while to see: the first
 * hundred wood buys the lumber camp and the next hundred and seventy-five the
 * barracks, so halving wood income pushed the first militia out past
 * twenty-five minutes and the strategy could no longer finish off an opponent
 * who did nothing at all. Five food, two wood and a gold in eight keeps both.
 */
const ASSIGNMENT: ResourceKind[] = [
  'food', 'wood', 'food', 'gold', 'food', 'wood', 'food', 'food',
];

/**
 * Food that walks. These observe exactly like a berry bush -- `resource:
 * 'food'` and an `amount` -- and were invisible to this strategy only because
 * it asked for `kind === 'resource'`, so the whole Dark Age food opening went
 * past it and its economy ran on berries and farms.
 *
 * The boar is deliberately not here. It has seventy-five hit points and hits
 * back for seven, and AoE2's answer is to lure it home with one villager while
 * the rest wait -- a manoeuvre, not a gather order. Sending two villagers at
 * one loses both. Recorded in `docs/backlog.md`.
 */
const HERD: string[] = ['sheep', 'deer'];

const HOUSE_SPOTS: { x: number; y: number }[] = [
  { x: -1, y: -4 }, { x: 2, y: -4 }, { x: -4, y: -2 }, { x: 5, y: -4 }, { x: -4, y: 1 },
  { x: 8, y: -4 }, { x: -7, y: -2 }, { x: 8, y: -1 }, { x: -7, y: 1 }, { x: 5, y: 7 },
];
/**
 * Where the archery range goes. Reaching the Feudal Age and then fighting the
 * rest of the match with Dark Age militia is most of an age wasted: the range
 * is what the age opened, and an archer outranges everything the other side
 * has until it builds one too.
 */
const RANGE_SPOTS: { x: number; y: number }[] = [
  { x: 4, y: 6 }, { x: -5, y: 6 }, { x: 7, y: 2 }, { x: -8, y: 2 }, { x: 4, y: -7 },
];
const BARRACKS_SPOTS: { x: number; y: number }[] = [
  { x: 1, y: 5 }, { x: -2, y: 5 }, { x: 4, y: 4 }, { x: 1, y: -6 }, { x: -5, y: -4 },
];
/**
 * Where farms go: a ring around the town center, far enough out that they do
 * not sit inside it -- a town center is two tiles of radius and a farm one and
 * a half, so the old spots were inside it once a placement had to be genuinely
 * clear.
 *
 * Six of them, and the number is a decision rather than an oversight. Twelve
 * spots build twelve farms, and twelve farms feed a Castle Age economy on both
 * sides: six of sixteen matches reached the Castle Age and six ran out the
 * thirty-minute clock, because neither side could finish an opponent as rich
 * as itself. Six spots is the balance measured -- every match reaches the
 * Feudal Age, some reach the Castle Age, and fourteen of sixteen still end in
 * a win. What is actually missing is a strategy that can close out a game; see
 * `docs/backlog.md`.
 */
const FARM_SPOTS: { x: number; y: number }[] = [
  { x: -4, y: 3 }, { x: -4, y: -2 }, { x: -1, y: 4 }, { x: 3, y: 4 }, { x: -7, y: 3 },
  { x: -7, y: -2 },
];

/**
 * Drop sites, and which resource each one banks. On a full-size map the
 * nearest trees are twenty tiles out, and a villager that walks that twice for
 * ten wood is not an economy — it is a queue. AoE2's answer is a camp by the
 * resource, and it is the difference between the two.
 */
const CAMPS: { resource: ResourceKind; building: 'lumber-camp' | 'mining-camp' | 'mill' }[] = [
  { resource: 'wood', building: 'lumber-camp' },
  { resource: 'gold', building: 'mining-camp' },
  { resource: 'food', building: 'mill' },
];
const CAMP_COST_WOOD = 100;
/** How far from home food still counts as food you are eating. */
const FOOD_WALK = 20;
/** Food in hand above which nothing more needs planting today. */
const FOOD_COMFORTABLE = 400;
/**
 * What the next age costs, in the order they come. Written out here like every
 * other price this strategy knows (a house is 25 wood, a barracks 175): a
 * strategy sees only its observation, and the observation carries what it has
 * researched rather than what everything costs.
 *
 * Ageing up is the whole difference between a Dark Age militia war and a match
 * in which the market, the archery range, the stable, the blacksmith, the
 * monastery, the siege workshop and the castle exist at all.
 */
const AGE_UP: { tech: string; food: number; gold: number }[] = [
  { tech: 'feudal-age', food: 500, gold: 0 },
  { tech: 'castle-age', food: 800, gold: 200 },
  { tech: 'imperial-age', food: 1000, gold: 800 },
];
/**
 * Technologies worth buying with what is left over, in the order it wants
 * them, and the building each happens at. Only ones this strategy actually
 * builds somewhere for: a wish list naming a blacksmith it never puts up
 * would be a list of commands that are always refused.
 *
 * Prices are written out like every other price here, because a strategy sees
 * only its observation and the observation carries what it has researched
 * rather than what everything costs.
 */
const WISH_LIST: {
  tech: string; at: 'town-center' | 'barracks' | 'archery-range';
  food: number; wood: number; gold: number;
}[] = [
  { tech: 'loom', at: 'town-center', food: 0, wood: 0, gold: 50 },
  { tech: 'man-at-arms', at: 'barracks', food: 100, wood: 0, gold: 40 },
  { tech: 'crossbowman', at: 'archery-range', food: 175, wood: 0, gold: 100 },
];

/**
 * How many soldiers are worth keeping before saving for the age. Below this it
 * builds the army first: a player with nothing standing loses the match long
 * before the age arrives. Above it, every fifty food spent on another militia
 * is fifty food the age is waiting for.
 *
 * Measured twice. Banking with no floor at all stalled four of sixteen matches
 * into timeouts, because neither side ever fielded enough to finish the other
 * off. A single floor of five did the same once the Feudal Age was reached:
 * the strategy held exactly five soldiers and saved for the Castle Age
 * forever. So the floor rises with the age -- an army the age can afford.
 */
const ARMY_BEFORE_AGE = [5, 14, 16];
/**
 * How many villagers to keep, by age. Eight is an opening, not an economy: it
 * is enough to reach the Feudal Age and nowhere near the eight hundred food
 * and two hundred gold the Castle Age wants. AoE2 players keep making them all
 * game; this at least keeps making them each time the age moves on.
 */
const VILLAGERS_BY_AGE = [8, 14, 20, 20];
/** How far a resource may be from a drop site before one is worth building. */
const CAMP_RANGE = 8;
const CAMPS_PER_RESOURCE = 3;
/**
 * Where a camp goes: between the resource and home, which is where a player
 * puts one and the only side of the node that shortens anything. A camp on the
 * far side is a hundred wood that leaves the walk exactly as long as it was.
 * The candidates fan out from that line, and the radius steps out, so a
 * blocked spot is retried nearby rather than behind the trees.
 */
const CAMP_FAN = [0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05, 1.4];
const CAMP_RADII = [2.5, 3.5, 4.5];
const BANKS: Record<string, ResourceKind[]> = {
  'town-center': ['food', 'wood', 'gold', 'stone'],
  'lumber-camp': ['wood'],
  'mining-camp': ['gold', 'stone'],
  mill: ['food'],
};

/**
 * The example strategy: gather food/wood/gold, keep housing ahead of
 * population, build a barracks, train villagers and militia, and attack with
 * groups of three. It sees only its canonical observation and acts only
 * through public commands.
 */
export function exampleAiCommands(observation: PlayerObservation): Command[] {
  if (observation.winner) return [];
  const player = observation.player;
  const commands: Command[] = [];
  // Visible entities plus fogged memory: everything legitimately known.
  const known: Spotted[] = [...observation.entities, ...observation.memory];
  const mine = observation.entities.filter(e => e.owner === player);
  const villagers = mine.filter(e => e.kind === 'villager');
  // Everything that fights. The army is not militia any more once the Feudal
  // Age opens the archery range, and the attack, the endgame raze and the
  // decision to keep saving all count soldiers rather than militia.
  const army = mine.filter(
    e => e.kind === 'militia' || e.kind === 'man-at-arms' || e.kind === 'archer');
  const militia = army;
  const tc = mine.find(e => e.kind === 'town-center');
  const barracks = mine.find(e => e.kind === 'barracks');
  const direction = tc && tc.x < observation.mapWidth / 2 ? 1 : -1;
  const place = (offset: { x: number; y: number }) =>
    tc ? { x: tc.x + direction * offset.x, y: tc.y + offset.y } : offset;

  for (const [index, villager] of villagers.entries()) {
    if (villager.order !== 'idle') continue;
    const wanted = ASSIGNMENT[index % ASSIGNMENT.length];
    // Farms are food sources too once complete, so they keep villagers fed
    // after the berries run out.
    const node = known
      .filter(e => e.resource === wanted && (e.amount ?? 1) > 0
        && (e.kind === 'resource' || HERD.includes(e.kind)
          || (e.kind === 'farm' && e.owner === player && (e.buildProgress ?? 1) >= 1)))
      .sort((a, b) => distance(villager, a) - distance(villager, b) || a.id - b.id)[0];
    if (node) {
      commands.push({
        kind: 'order', player, entityIds: [villager.id],
        target: { x: node.x, y: node.y }, targetId: node.id,
      });
    }
  }

  // The scout's job, and the reason the map hands one out: a town center sees
  // eight tiles and the nearest berries are ten away, so until somebody rides
  // out there is nothing known to gather. It walks a widening ring around the
  // base, taking its next heading from the clock so no state has to be kept
  // between decisions and two runs of the same match scout identically.
  for (const scout of mine.filter(e => e.kind === 'scout-cavalry' && e.order === 'idle')) {
    const leg = Math.floor(observation.time / 12);
    // A turn of about 137 degrees a leg never repeats a heading soon, and the
    // radius steps out and starts again, so the ring is covered rather than
    // one spoke walked over and over.
    const bearing = leg * 2.4;
    const radius = 12 + (leg % 6) * 9;
    const home = tc ?? scout;
    commands.push({
      kind: 'order', player, entityIds: [scout.id],
      target: {
        x: Math.max(1, Math.min(observation.mapWidth - 1, home.x + Math.cos(bearing) * radius)),
        y: Math.max(1, Math.min(observation.mapHeight - 1, home.y + Math.sin(bearing) * radius)),
      },
    });
  }

  const idleBuilder = villagers.find(e => e.order === 'idle') ?? villagers[0];
  /**
   * One building per decision. Every `build` retasks the villager it names, so
   * asking the same one for a camp, then a house, then a barracks in a single
   * pass leaves it walking to the last of the three and the first two as
   * foundations nobody is coming back to. Measured: the population sat at 5/5
   * for the first four minutes because the house was always overwritten.
   */
  let builderTasked = false;
  const build = (building: BuildingKind, target: { x: number; y: number }) => {
    if (builderTasked || !idleBuilder) return;
    builderTasked = true;
    commands.push({ kind: 'build', player, builderIds: [idleBuilder.id], building, target });
  };
  /**
   * The first of these spots with nothing already standing on it.
   *
   * Cycling blindly through candidates and letting the simulation refuse the
   * bad ones looked harmless and was not: with every farm spot occupied, this
   * strategy asked for a farm on every decision of every match -- twenty-three
   * thousand build commands across sixteen matches, all refused -- and each
   * one retasked the villager that was going to build it, so it stood there
   * being told to start something it could never start. Asking what is
   * already there costs one pass over what it can see.
   */
  /**
   * Roughly how much room a thing takes, for deciding whether a spot is free.
   * Centre to centre, so both footprints count -- and a tree is not a town
   * center. Using one number for everything was measurably wrong in both
   * directions: two and a half tiles let a farm be asked for inside the town
   * center every decision, and five tiles ruled out every barracks spot on the
   * map, because there is always a tree within five tiles of home. The AI
   * cannot read the rules, so these are the same order of approximation as the
   * prices it already knows.
   */
  const bulk = (kind: string): number =>
    kind === 'town-center' || kind === 'castle' ? 2
      : isBuilding(kind as EntityKind) ? 1.5
      : kind === 'resource' ? 0.5 : 0.3;
  const clearSpot = (spots: { x: number; y: number }[], half: number) => {
    const offset = Math.floor(observation.time / 3);
    for (let i = 0; i < spots.length; i++) {
      const at = place(spots[(i + offset) % spots.length]);
      if (at.x < 2 || at.y < 2 || at.x > observation.mapWidth - 2 || at.y > observation.mapHeight - 2) continue;
      // Only what stays put. A villager standing on the spot walks away when
      // the foundation goes down; counting them meant that every candidate
      // near home was "occupied" by whoever happened to be wandering past, and
      // the barracks -- and with it the entire army -- was never built at all.
      const blocked = [...known, ...mine].some(
        e => (isBuilding(e.kind as EntityKind) || e.kind === 'resource')
          && distance(e, at) < half + bulk(e.kind) + 0.4,
      );
      if (blocked) continue;
      return at;
    }
    return undefined;
  };
  const headroom = observation.populationCap - observation.population;
  // Economy before barracks: the starting wood is exactly enough for either a
  // barracks or a camp and a house, and on a map where the trees are twenty
  // tiles out, spending it all on the barracks buys one militia and then a
  // wood queue that never clears.
  // A drop site beside whatever is being gathered furthest from home.
  /** The nearest known node of a resource, and how far it is from a drop site. */
  const supply = (resource: ResourceKind) => {
    const node = known
      .filter(e => e.kind === 'resource' && e.resource === resource && (e.amount ?? 0) > 0)
      .sort((a, b) => distance(tc ?? a, a) - distance(tc ?? b, b) || a.id - b.id)[0];
    if (!node) return undefined;
    const walk = mine
      .filter(e => (BANKS[e.kind] ?? []).includes(resource) && (e.buildProgress ?? 1) >= 1)
      .reduce((best, site) => Math.min(best, distance(site, node)), Infinity);
    return { node, walk };
  };

  // Housing before anything else it might spend wood on. Two hundred wood is
  // exactly one camp, and a player who buys the camp first is capped at five
  // population with one villager on wood -- which earns about ten wood a
  // minute, so the twenty-five for a house is four minutes away and nothing
  // else happens in them. Measured: pop 5/5 for the first four minutes of
  // every match, and no barracks until twenty.
  // Build ahead of the cap, not at it. A house takes time to go up, so
  // waiting until there is one place left means standing at the cap for as
  // long as it takes to build -- measured at pop 5/5 for the first four
  // minutes of a match, which starves the villagers that buy the wood that
  // buys the barracks. Two of them at once once the cap is actually reached.
  const houseHeadroom = 3;
  const housesAtOnce = headroom <= 0 ? 2 : 1;
  const building = mine.filter(e => e.kind === 'house' && (e.buildProgress ?? 1) < 1).length;
  if (idleBuilder && headroom <= houseHeadroom && building < housesAtOnce
      && observation.wood >= 25) {
    // Cycle deterministically through candidate spots so a blocked placement
    // is retried elsewhere on the next decision.
    const spot = clearSpot(HOUSE_SPOTS, 1);
    if (spot) build('house', spot);
  }
  for (const camp of CAMPS) {
    if (observation.wood < CAMP_COST_WOOD || !idleBuilder || !tc) continue;
    const built = mine.filter(e => e.kind === camp.building);
    if (built.length >= CAMPS_PER_RESOURCE) continue;
    // One of each until the barracks is up. Three camps and a mill is four
    // hundred wood, and a player who keeps buying them never saves the
    // hundred and seventy-five that starts an army.
    if (!barracks && built.length >= 1) continue;
    // One at a time: a second would be sited against the same node anyway.
    if (built.some(e => (e.buildProgress ?? 1) < 1)) continue;
    const at = supply(camp.resource);
    if (!at || at.walk <= CAMP_RANGE) continue;
    const step = Math.floor(observation.time / 3);
    const home = Math.atan2(tc.y - at.node.y, tc.x - at.node.x);
    const bearing = home + CAMP_FAN[step % CAMP_FAN.length];
    const reach = CAMP_RADII[Math.floor(step / CAMP_FAN.length) % CAMP_RADII.length];
    build(camp.building, { x: at.node.x + Math.cos(bearing) * reach, y: at.node.y + Math.sin(bearing) * reach });
  }

  // Not until the wood is banked somewhere near the trees. The starting wood
  // buys either a barracks or an economy, and a barracks bought first is one
  // militia followed by a wood queue that never clears — the town center is
  // twenty tiles from the nearest forest on a full-size map.
  // Either the trees are near a drop site already, or a camp has been built to
  // make them so. Asking only about the nearest tree to the town center meant
  // that a player whose camp served a different wood never built a barracks at
  // all, sitting on two hundred and forty wood for half an hour.
  const woodIsHandy = mine.some(e => e.kind === 'lumber-camp' && (e.buildProgress ?? 1) >= 1)
    || (supply('wood')?.walk ?? Infinity) <= CAMP_RANGE;
  const range = mine.find(e => e.kind === 'archery-range');
  if (!range && barracks && idleBuilder && observation.age >= 1 && observation.wood >= 175) {
    const spot = clearSpot(RANGE_SPOTS, 1.5);
    if (spot) build('archery-range', spot);
  }

  if (!barracks && idleBuilder && observation.wood >= 175 && woodIsHandy) {
    // Cycle candidate spots like houses do, so terrain under one spot cannot
    // block the barracks -- and the whole military opening -- permanently.
    const spot = clearSpot(BARRACKS_SPOTS, 1.5);
    if (spot) build('barracks', spot);
  }

  // Farms keep the food supply alive once the berries and the herd are gone.
  //
  // Waiting for the map to be empty of food was too late, and measurably so:
  // matches ended with eight hundred gold banked and twenty food, because the
  // strategy counted a remembered bush on the far side of the map as a reason
  // not to farm. Anything more than a walk away is not food you are eating, so
  // the question is what is near home -- and from the Feudal Age a player
  // farms whatever else it has, which is what pays for the Castle Age.
  const foodNearby = known.some(e => e.resource === 'food' && (e.amount ?? 0) > 0
    && (e.kind === 'resource' || HERD.includes(e.kind))
    && tc && distance(e, tc) <= FOOD_WALK);
  const farms = mine.filter(e => e.kind === 'farm');
  const farmsUnderway = farms.some(e => (e.buildProgress ?? 1) < 1);
  // Only when the food is actually short. "Farm from the Feudal Age" without
  // that condition asked for a farm every single decision -- twenty-four
  // thousand build commands across sixteen matches, almost all of them
  // rejected onto an occupied spot, and each one retasking the same villager
  // so it never finished anything else.
  const foodShort = observation.food < FOOD_COMFORTABLE;
  // The barracks comes first, exactly as it does before the second camp. A
  // farm is sixty wood and there is always another one worth building, so a
  // player who farms first spends the barracks' hundred and seventy-five wood
  // sixty at a time and never fields a soldier at all -- measured: the first
  // militia arrived after twenty-five minutes and the strategy could no
  // longer beat an opponent who did nothing. One farm before the barracks, so
  // a starving opening is not fatal; the rest afterwards.
  const mayFarm = barracks !== undefined || farms.length < 1;
  if ((!foodNearby || (observation.age >= 1 && foodShort)) && mayFarm && idleBuilder
      && !farmsUnderway && farms.length < FARM_SPOTS.length && observation.wood >= 60) {
    const spot = clearSpot(FARM_SPOTS, 1.5);
    if (spot) build('farm', spot);
  }

  // The next age, and whether it is close enough to be worth saving for.
  const nextAge = AGE_UP[observation.age];
  const ageing = nextAge !== undefined && !observation.researched.includes(nextAge.tech);
  // Save for the age once there is an army to hold the ground -- but only the
  // age's own price. Everything above that is spent, so a player who can
  // already afford the age is never also refusing to build soldiers.
  const banking = ageing && nextAge !== undefined
    && army.length >= ARMY_BEFORE_AGE[Math.min(observation.age, ARMY_BEFORE_AGE.length - 1)]
    && observation.food < nextAge.food + 50;
  if (ageing && nextAge && tc && !tc.researching
      && observation.food >= nextAge.food && observation.gold >= nextAge.gold) {
    commands.push({ kind: 'research', player, buildingId: tc.id, tech: nextAge.tech });
  }

  const wantVillagers = VILLAGERS_BY_AGE[Math.min(observation.age, VILLAGERS_BY_AGE.length - 1)];
  // Spend what the age is not waiting for. Anything on the list it can afford
  // outright, at a building of its own that is standing idle.
  if (!banking) {
    for (const want of WISH_LIST) {
      if (observation.researched.includes(want.tech)) continue;
      if (observation.food < want.food || observation.wood < want.wood
        || observation.gold < want.gold) continue;
      const at = mine.find(e => e.kind === want.at && (e.buildProgress ?? 1) >= 1 && !e.researching);
      if (!at) continue;
      commands.push({ kind: 'research', player, buildingId: at.id, tech: want.tech });
      break; // one at a time: the next decision will pick up the next one
    }
  }

  if (tc && !tc.training && villagers.length < wantVillagers
      && observation.food >= 50 && headroom > 0) {
    commands.push({ kind: 'train', player, buildingId: tc.id, unit: 'villager' });
  }
  if (
    barracks && (barracks.buildProgress ?? 1) >= 1 && !barracks.training && !banking &&
    observation.food >= 50 && observation.gold >= 20 && headroom > 0
  ) {
    // Whatever the barracks actually offers: once the upgrade lands the
    // militia is gone from it, and asking for one is refused for ever.
    const infantry = observation.researched.includes('man-at-arms') ? 'man-at-arms' : 'militia';
    commands.push({ kind: 'train', player, buildingId: barracks.id, unit: infantry });
  }
  // Archers cost wood and gold rather than food, so they are what a player
  // saving food for the next age can still afford to build.
  if (
    range && (range.buildProgress ?? 1) >= 1 && !range.training &&
    observation.wood >= 25 && observation.gold >= 45 && headroom > 0
  ) {
    commands.push({ kind: 'train', player, buildingId: range.id, unit: 'archer' });
  }

  // What could actually stop a demolition. Villagers are not it: counting them
  // meant that against an opponent who simply sat there -- the passive side of
  // every headless test -- the field was never "clear", the villagers never
  // joined the raze, and five militia were left to chew through a town center
  // with two thousand four hundred hit points on their own.
  const enemySoldiers = observation.entities.filter(
    e => e.owner !== 0 && e.owner !== player && e.kind !== 'villager' && !isBuilding(e.kind as EntityKind),
  );
  const enemyTcVisible = known.find(e => e.kind === 'town-center' && e.owner !== 0 && e.owner !== player);

  // Endgame raze: militia alone barely dent a town center (DAT armor), so
  // once the enemy field is clear, villagers join the demolition.
  if (enemyTcVisible && army.length >= 3 && enemySoldiers.length === 0) {
    const razers = villagers.filter(e => e.order !== 'attack');
    if (razers.length) {
      commands.push({
        kind: 'order', player, entityIds: razers.map(e => e.id).sort((a, b) => a - b),
        target: { x: enemyTcVisible.x, y: enemyTcVisible.y },
        targetId: observation.entities.some(e => e.id === enemyTcVisible.id) ? enemyTcVisible.id : undefined,
      });
    }
  }

  const idleMilitia = militia.filter(e => e.order === 'idle');
  if (idleMilitia.length && militia.length >= 3) {
    const enemyTc = enemyTcVisible;
    // Anything of theirs that is still standing, nearest first: an army whose
    // only heading was the mirror of its own town center had nowhere to go
    // once that town center fell, and stood in the ruins until the clock ran
    // out with the enemy barracks still up.
    // Buildings only: a negative list of unit names silently gained every
    // Castle Age unit the moment they existed, and sent the army marching at
    // whichever monk it last saw instead of at something that stays put.
    const enemyBuilding = known
      .filter(e => e.owner !== 0 && e.owner !== player && isBuilding(e.kind as EntityKind))
      .sort((a, b) => distance(idleMilitia[0], a) - distance(idleMilitia[0], b) || a.id - b.id)[0];
    // March toward the mirrored base position until the enemy town center is seen.
    const target = enemyTc
      ? { x: enemyTc.x, y: enemyTc.y }
      : tc ? { x: observation.mapWidth - tc.x, y: tc.y }
      : enemyBuilding ? { x: enemyBuilding.x, y: enemyBuilding.y } : undefined;
    if (target) {
      commands.push({
        kind: 'order', player, entityIds: idleMilitia.map(e => e.id).sort((a, b) => a - b),
        target,
        targetId: enemyTc && observation.entities.some(e => e.id === enemyTc.id) ? enemyTc.id : undefined,
      });
    }
  }
  return commands;
}
