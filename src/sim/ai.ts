import type { Command, ResourceKind } from './types';
import type { ObservedEntity, PlayerObservation } from '../protocol/types';

const distance = (a: ObservedEntity, b: ObservedEntity) => Math.hypot(a.x - b.x, a.y - b.y);

const ASSIGNMENT: ResourceKind[] = ['food', 'wood', 'food', 'gold', 'wood', 'food'];

const HOUSE_SPOTS: { x: number; y: number }[] = [
  { x: -1, y: -4 }, { x: 2, y: -4 }, { x: -4, y: -2 }, { x: 5, y: -4 }, { x: -4, y: 1 },
];
const BARRACKS_SPOT = { x: 1, y: 5 };

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
    const node = observation.entities
      .filter(e => e.kind === 'resource' && e.resource === wanted)
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
    commands.push({ kind: 'build', player, builderIds: [idleBuilder.id], building: 'barracks', target: place(BARRACKS_SPOT) });
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

  const idleMilitia = militia.filter(e => e.order === 'idle');
  if (idleMilitia.length && militia.length >= 3) {
    const enemyTc = observation.entities.find(e => e.kind === 'town-center' && e.owner !== 0 && e.owner !== player);
    // March toward the mirrored base position until the enemy town center is seen.
    const target = enemyTc
      ? { x: enemyTc.x, y: enemyTc.y }
      : tc ? { x: observation.mapWidth - tc.x, y: tc.y } : undefined;
    if (target) {
      commands.push({
        kind: 'order', player, entityIds: idleMilitia.map(e => e.id).sort((a, b) => a - b),
        target, targetId: enemyTc?.id,
      });
    }
  }
  return commands;
}
