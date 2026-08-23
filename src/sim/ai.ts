import { applyCommand } from './game';
import type { Entity, GameState, PlayerId } from './types';

const distance = (a: Entity, b: Entity) => Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y);

export function runExampleAi(state: GameState, player: PlayerId): void {
  if (state.winner) return;
  const mine = state.entities.filter(e => e.owner === player);
  const villagers = mine.filter(e => e.kind === 'villager');
  const militia = mine.filter(e => e.kind === 'militia');
  const tc = mine.find(e => e.kind === 'town-center');
  let barracks = mine.find(e => e.kind === 'barracks');

  for (const [index, villager] of villagers.entries()) {
    if (villager.order.kind !== 'idle') continue;
    const wanted = index % 3 === 0 ? 'food' : 'wood';
    const resource = state.entities
      .filter(e => e.kind === 'resource' && e.resourceKind === wanted)
      .sort((a, b) => distance(villager, a) - distance(villager, b))[0];
    if (resource) applyCommand(state, { kind: 'order', player, entityIds: [villager.id], target: resource.position, targetId: resource.id });
  }

  if (!barracks && villagers[0] && state.players[player].wood >= 175) {
    const direction = player === 1 ? 1 : -1;
    applyCommand(state, { kind: 'build', player, builderId: villagers[0].id, building: 'barracks', target: { x: tc!.position.x + direction * 3, y: tc!.position.y + 3 } });
    barracks = state.entities.find(e => e.owner === player && e.kind === 'barracks');
  }
  if (tc && !tc.training && villagers.length < 6) applyCommand(state, { kind: 'train', player, buildingId: tc.id, unit: 'villager' });
  if (barracks && !barracks.training) applyCommand(state, { kind: 'train', player, buildingId: barracks.id, unit: 'militia' });

  const enemyTc = state.entities.find(e => e.kind === 'town-center' && e.owner !== player);
  if (enemyTc && militia.length >= 3) {
    for (const unit of militia.filter(e => e.order.kind === 'idle')) {
      applyCommand(state, { kind: 'order', player, entityIds: [unit.id], target: enemyTc.position, targetId: enemyTc.id });
    }
  }
}
