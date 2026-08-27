import type { Command, EntityKind, ResourceKind } from './types';
import { isBuilding } from './data';
import type { PlayerObservation } from '../protocol/types';

interface Spotted { id: number; kind: string; owner: number; x: number; y: number; resource?: ResourceKind; amount?: number; training?: unknown; buildProgress?: number; order?: string }

const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

const ASSIGNMENT: ResourceKind[] = ['food', 'wood', 'food', 'gold', 'wood', 'food'];

const HOUSE_SPOTS: { x: number; y: number }[] = [
  { x: -1, y: -4 }, { x: 2, y: -4 }, { x: -4, y: -2 }, { x: 5, y: -4 }, { x: -4, y: 1 },
];
const BARRACKS_SPOTS: { x: number; y: number }[] = [
  { x: 1, y: 5 }, { x: -2, y: 5 }, { x: 4, y: 4 }, { x: 1, y: -6 }, { x: -5, y: -4 },
];
const FARM_SPOTS: { x: number; y: number }[] = [
  { x: -3, y: 2 }, { x: -3, y: -1 }, { x: -1, y: 3 }, { x: 2, y: 3 }, { x: -6, y: 2 }, { x: -6, y: -1 },
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
  const militia = mine.filter(e => e.kind === 'militia');
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
        && (e.kind === 'resource' || (e.kind === 'farm' && e.owner === player && (e.buildProgress ?? 1) >= 1)))
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
  const housesUnderway = mine.some(e => e.kind === 'house' && (e.buildProgress ?? 1) < 1);
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
    commands.push({
      kind: 'build', player, builderIds: [idleBuilder.id], building: camp.building,
      target: { x: at.node.x + Math.cos(bearing) * reach, y: at.node.y + Math.sin(bearing) * reach },
    });
  }

  if (idleBuilder && headroom <= 1 && !housesUnderway && observation.wood >= 25) {
    // Cycle deterministically through candidate spots so a blocked placement
    // is retried elsewhere on the next decision.
    const attempt = mine.filter(e => e.kind === 'house').length + Math.floor(observation.time / 2);
    const spot = HOUSE_SPOTS[attempt % HOUSE_SPOTS.length];
    commands.push({ kind: 'build', player, builderIds: [idleBuilder.id], building: 'house', target: place(spot) });
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
  if (!barracks && idleBuilder && observation.wood >= 175 && woodIsHandy) {
    // Cycle candidate spots like houses do, so terrain under one spot cannot
    // block the barracks -- and the whole military opening -- permanently.
    const spot = BARRACKS_SPOTS[Math.floor(observation.time / 5) % BARRACKS_SPOTS.length];
    commands.push({ kind: 'build', player, builderIds: [idleBuilder.id], building: 'barracks', target: place(spot) });
  }

  // Farms keep the food supply alive once the berries are gone, which is what
  // lets a match run past the opening rush instead of stalling on starvation.
  const foodLeft = known.some(e => e.kind === 'resource' && e.resource === 'food' && (e.amount ?? 0) > 0);
  const farms = mine.filter(e => e.kind === 'farm');
  const farmsUnderway = farms.some(e => (e.buildProgress ?? 1) < 1);
  if (!foodLeft && idleBuilder && !farmsUnderway && farms.length < FARM_SPOTS.length
      && observation.wood >= 60) {
    const spot = FARM_SPOTS[(farms.length + Math.floor(observation.time / 3)) % FARM_SPOTS.length];
    commands.push({ kind: 'build', player, builderIds: [idleBuilder.id], building: 'farm', target: place(spot) });
  }

  if (tc && !tc.training && villagers.length < 8 && observation.food >= 50 && headroom > 0) {
    commands.push({ kind: 'train', player, buildingId: tc.id, unit: 'villager' });
  }
  if (
    barracks && (barracks.buildProgress ?? 1) >= 1 && !barracks.training &&
    observation.food >= 50 && observation.gold >= 20 && headroom > 0
  ) {
    commands.push({ kind: 'train', player, buildingId: barracks.id, unit: 'militia' });
  }

  const enemyUnits = observation.entities.filter(
    e => e.owner !== 0 && e.owner !== player && (e.kind === 'villager' || e.kind === 'militia'),
  );
  const enemyTcVisible = known.find(e => e.kind === 'town-center' && e.owner !== 0 && e.owner !== player);

  // Endgame raze: militia alone barely dent a town center (DAT armor), so
  // once the enemy field is clear, villagers join the demolition.
  if (enemyTcVisible && militia.length >= 3 && enemyUnits.length === 0) {
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
