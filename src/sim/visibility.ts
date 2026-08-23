/**
 * Authoritative per-player visibility: explored tiles, currently-visible
 * tiles recomputed from line of sight, and last-seen memory of non-owned
 * entities. Observations and the viewer read only this state.
 */
import { isBuilding, isUnit } from './data';
import type { Entity, GameState, PlayerId, UnitKind } from './types';

export interface RememberedEntity {
  id: number;
  kind: Entity['kind'];
  owner: Entity['owner'];
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  resource?: Entity['resourceKind'];
  amount?: number;
  buildProgress?: number;
  lastSeenAt: number; // tick
}

export interface PlayerVisibility {
  explored: number[]; // width*height, 0/1
  visible: number[]; // width*height, 0/1, recomputed every tick
  memory: Record<number, RememberedEntity>;
}

export function createVisibility(state: GameState): Record<PlayerId, PlayerVisibility> {
  const size = state.width * state.height;
  return {
    1: { explored: new Array(size).fill(0), visible: new Array(size).fill(0), memory: {} },
    2: { explored: new Array(size).fill(0), visible: new Array(size).fill(0), memory: {} },
  };
}

export function lineOfSightOf(state: GameState, entity: Entity): number {
  if (isUnit(entity.kind)) return state.rules.units[entity.kind as UnitKind].lineOfSight;
  if (isBuilding(entity.kind)) return state.rules.buildings[entity.kind].lineOfSight;
  return 0;
}

const tileIndex = (state: GameState, x: number, y: number) => y * state.width + x;

function remember(state: GameState, player: PlayerId, entity: Entity): void {
  const snapshot: RememberedEntity = {
    id: entity.id,
    kind: entity.kind,
    owner: entity.owner,
    x: Math.round(entity.position.x * 100) / 100,
    y: Math.round(entity.position.y * 100) / 100,
    hp: Math.max(0, Math.ceil(entity.hp)),
    maxHp: entity.maxHp,
    lastSeenAt: state.tick,
  };
  if (entity.resourceKind) snapshot.resource = entity.resourceKind;
  if (entity.amount !== undefined) snapshot.amount = Math.floor(entity.amount);
  if (entity.buildProgress !== undefined) snapshot.buildProgress = Math.round(entity.buildProgress * 1000) / 1000;
  state.visibility[player].memory[entity.id] = snapshot;
}

export function updateVisibility(state: GameState): void {
  for (const player of [1, 2] as PlayerId[]) {
    const visibility = state.visibility[player];
    visibility.visible.fill(0);
    for (const entity of state.entities) {
      if (entity.dead || entity.owner !== player) continue;
      const los = lineOfSightOf(state, entity);
      const losSquared = los * los;
      const cx = entity.position.x;
      const cy = entity.position.y;
      const minX = Math.max(0, Math.floor(cx - los));
      const maxX = Math.min(state.width - 1, Math.ceil(cx + los));
      const minY = Math.max(0, Math.floor(cy - los));
      const maxY = Math.min(state.height - 1, Math.ceil(cy + los));
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const dx = x + 0.5 - cx;
          const dy = y + 0.5 - cy;
          if (dx * dx + dy * dy > losSquared) continue;
          const index = tileIndex(state, x, y);
          visibility.visible[index] = 1;
          visibility.explored[index] = 1;
        }
      }
    }

    // Refresh or create memory for visible non-owned entities.
    for (const entity of state.entities) {
      if (entity.owner === player) continue;
      if (entity.dead) continue;
      if (isEntityVisible(state, player, entity)) remember(state, player, entity);
    }
    // Forget remembered entities whose last position is seen empty.
    for (const key of Object.keys(visibility.memory)) {
      const remembered = visibility.memory[Number(key)];
      const index = tileIndex(state, Math.floor(remembered.x), Math.floor(remembered.y));
      if (!visibility.visible[index]) continue;
      const stillThere = state.entities.some(e => e.id === remembered.id && !e.dead);
      if (!stillThere) delete visibility.memory[Number(key)];
      else if (remembered.lastSeenAt !== state.tick) {
        // Seen tile but entity moved elsewhere invisible: drop the stale spot.
        const entity = state.entities.find(e => e.id === remembered.id)!;
        if (!isEntityVisible(state, player, entity)) delete visibility.memory[Number(key)];
      }
    }
  }
}

export function isTileVisible(state: GameState, player: PlayerId, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= state.width || y >= state.height) return false;
  return state.visibility[player].visible[tileIndex(state, Math.floor(x), Math.floor(y))] === 1;
}

export function isTileExplored(state: GameState, player: PlayerId, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= state.width || y >= state.height) return false;
  return state.visibility[player].explored[tileIndex(state, Math.floor(x), Math.floor(y))] === 1;
}

export function isEntityVisible(state: GameState, player: PlayerId, entity: Entity): boolean {
  if (entity.owner === player) return true;
  return isTileVisible(state, player, entity.position.x, entity.position.y);
}
