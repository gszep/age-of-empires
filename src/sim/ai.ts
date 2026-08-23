import type { Command } from './types';
import type { ObservedEntity, PlayerObservation } from '../protocol/types';

const distance = (a: ObservedEntity, b: ObservedEntity) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * The example strategy. It sees only its canonical player observation and
 * expresses every intent through public commands, exactly like an external
 * agent.
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

  for (const [index, villager] of villagers.entries()) {
    if (villager.order !== 'idle') continue;
    const wanted = index % 3 === 0 ? 'food' : 'wood';
    const resource = observation.entities
      .filter(e => e.kind === 'resource' && e.resource === wanted)
      .sort((a, b) => distance(villager, a) - distance(villager, b))[0];
    if (resource) {
      commands.push({
        kind: 'order', player, entityIds: [villager.id],
        target: { x: resource.x, y: resource.y }, targetId: resource.id,
      });
    }
  }

  if (!barracks && villagers[0] && tc && observation.wood >= 175) {
    const direction = tc.x < 16 ? 1 : -1;
    commands.push({
      kind: 'build', player, builderId: villagers[0].id, building: 'barracks',
      target: { x: tc.x + direction * 3, y: tc.y + 3 },
    });
  }
  if (tc && !tc.training && villagers.length < 6 && observation.food >= 50) {
    commands.push({ kind: 'train', player, buildingId: tc.id, unit: 'villager' });
  }
  if (barracks && !barracks.training && observation.food >= 60 && observation.wood >= 20) {
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
        kind: 'order', player, entityIds: idleMilitia.map(e => e.id),
        target, targetId: enemyTc?.id,
      });
    }
  }
  return commands;
}
