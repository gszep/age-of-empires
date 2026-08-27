import type { Command, ResourceKind } from './types';
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

  const idleBuilder = villagers.find(e => e.order === 'idle') ?? villagers[0];
  const housesUnderway = mine.some(e => e.kind === 'house' && (e.buildProgress ?? 1) < 1);
  const headroom = observation.populationCap - observation.population;
  if (idleBuilder && headroom <= 1 && !housesUnderway && observation.wood >= 25) {
    // Cycle deterministically through candidate spots so a blocked placement
    // is retried elsewhere on the next decision.
    const attempt = mine.filter(e => e.kind === 'house').length + Math.floor(observation.time / 2);
    const spot = HOUSE_SPOTS[attempt % HOUSE_SPOTS.length];
    commands.push({ kind: 'build', player, builderIds: [idleBuilder.id], building: 'house', target: place(spot) });
  }
  if (!barracks && idleBuilder && observation.wood >= 175) {
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
    const enemyBuilding = known
      .filter(e => e.owner !== 0 && e.owner !== player && e.kind !== 'resource'
        && e.kind !== 'villager' && e.kind !== 'militia')
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
