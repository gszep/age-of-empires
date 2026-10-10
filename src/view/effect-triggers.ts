/** View-only O(entities + researched technologies) feedback diff. */
import type { Entity, GameState, PlayerId, Point } from '../sim/types';
import { isUnit } from '../sim/data';
import type { ImportedEntity } from './assets';

export interface EffectRequest {
  name: string;
  position: Point;
  type: 'spawn' | 'start' | 'stop';
  entityId: number;
}

interface SnapshotEntity {
  owner: Entity['owner'];
  researching?: string;
  visible: boolean;
  glow?: string;
  position: Point;
}

export interface ViewSnapshot {
  nextId: number;
  entities: Map<number, SnapshotEntity>;
  researchedByPlayer: Map<PlayerId, Set<string>>;
  visibleIds: Set<number>;
}

/** Visibility is the renderer's predicate, including replay/reveal mode.
 * Track hidden IDs too: discovering an old unit/foundation is not its creation.
 * Reset by discarding the snapshot, never by guessing at population size.
 */
export function detectEffectTriggers(
  game: GameState,
  previous: ViewSnapshot | undefined,
  getEntityData: (e: Entity) => { imported?: ImportedEntity; visible: boolean },
): { effects: EffectRequest[]; snapshot: ViewSnapshot } {
  const effects: EffectRequest[] = [];
  const snapshot: ViewSnapshot = {
    nextId: game.nextId,
    entities: new Map(), visibleIds: new Set(),
    researchedByPlayer: new Map(Object.values(game.players).map(p => [p.id, new Set(p.researched)])),
  };
  for (const entity of game.entities) {
    const { imported, visible: inSight } = getEntityData(entity);
    const visible = inSight && !entity.dead;
    const current: SnapshotEntity = {
      owner: entity.owner, visible, position: { ...entity.position },
      researching: visible ? entity.researching?.tech : undefined,
      glow: visible ? imported?.researchingEffect : undefined,
    };
    snapshot.entities.set(entity.id, current);
    if (!visible) continue;
    snapshot.visibleIds.add(entity.id);
    const prev = previous?.entities.get(entity.id);
    const emit = (name: string, type: EffectRequest['type']): void => {
      effects.push({ name, type, position: current.position, entityId: entity.id });
    };
    // Current-state loops can resume after a load; historical one-shots cannot.
    if (current.researching && current.glow
      && (!prev?.researching || !prev.visible || prev.glow !== current.glow)) emit(current.glow, 'start');
    if (prev?.researching && prev.glow && !current.researching) emit(prev.glow, 'stop');
    if (!previous) continue;
    if (!prev && entity.id >= previous.nextId && entity.owner !== 0) {
      if (isUnit(entity.kind) && imported?.spawnEffect) emit(imported.spawnEffect, 'spawn');
      if (entity.buildProgress !== undefined && imported?.constructionEffect) emit(imported.constructionEffect, 'spawn');
    }
    // The exact technology must have completed, not another building's research
    // during this building's cancellation. Also handles queued research handoff.
    if (prev?.visible && prev.owner === entity.owner && prev.researching
      && prev.researching !== current.researching && entity.owner !== 0
      && imported?.researchCompleteEffect
      && !previous.researchedByPlayer.get(entity.owner)?.has(prev.researching)
      && snapshot.researchedByPlayer.get(entity.owner)?.has(prev.researching)) {
      emit(imported.researchCompleteEffect, 'spawn');
    }
  }
  // Disappearing/hidden entities are culled immediately by EffectPlayer using
  // visibleIds, including their one-shots (no stop fade leaking through fog).
  return { effects, snapshot };
}
