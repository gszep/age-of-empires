import { readFileSync, existsSync } from 'node:fs';
import { rulesFromManifest, type ContentManifest, type GameRules } from '../data';
import { applyCommand, placementLegal, stepGame } from '../game';
import type { BuildingKind, Entity, GameState, ResourceKind } from '../types';


export const MANIFEST_PATH = 'public/imported/aoe2/manifest.json';
export const importedRules: GameRules | undefined = existsSync(MANIFEST_PATH)
  ? rulesFromManifest(JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as ContentManifest)
  : undefined;
export const AUDIO_PATH = 'public/imported/aoe2/audio/manifest.json';
export const importedAudio: { audio: Record<string, unknown> } | undefined = existsSync(AUDIO_PATH)
  ? JSON.parse(readFileSync(AUDIO_PATH, 'utf8')) as { audio: Record<string, unknown> }
  : undefined;

export const run = (state: GameState, ticks: number) => {
  for (let i = 0; i < ticks; i++) stepGame(state);
};

/**
 * Skip the age-up. Markets, towers, stables and ranges are Feudal in the DAT,
 * so tests about what they do rather than about when they unlock start there;
 * `feudal age > gates` covers the gate itself.
 */
export const inFeudal = (state: GameState) => {
  state.players[1].age = 1;
  state.players[2].age = 1;
};

export const villagerOf = (state: GameState) =>
  state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;

/**
 * The node a player would actually work: the nearest one to whoever is asking,
 * or to their town center. Picking the leftmost on the map used to mean the
 * same thing; on a full-size board it means the other player's, fifty tiles
 * away and guarded.
 */
export const nodeOf = (state: GameState, resource: ResourceKind, from?: Entity) => {
  const origin = from ?? state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
  return state.entities
    .filter(e => e.kind === 'resource' && e.resourceKind === resource)
    .sort((a, b) => distanceBetween(origin, a) - distanceBetween(origin, b) || a.id - b.id)[0];
};

/** Clear an order the way the public `stop` command does. */
export const becomeIdleFor = (state: GameState, units: Entity[]) => {
  applyCommand(state, { kind: 'stop', player: 1, entityIds: units.map(u => u.id) });
};

export const distanceBetween = (a: Entity, b: Entity) =>
  Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y);

/**
 * Send both players' scouts to opposite corners. The opening hands each player
 * one, and a scout fights on its own initiative — a test about what a tower
 * chooses to shoot needs the tower to be the only thing shooting.
 */
export const parkScouts = (state: GameState) => {
  for (const scout of state.entities.filter(e => e.kind === 'scout-cavalry')) {
    scout.position = scout.owner === 1
      ? { x: 1, y: state.height - 1 }
      : { x: state.width - 1, y: 1 };
  }
};

export function totalOf(state: GameState, resource: ResourceKind): number {
  const banked = state.players[1][resource] + state.players[2][resource];
  const inNodes = state.entities
    .filter(e => e.kind === 'resource' && e.resourceKind === resource)
    .reduce((sum, e) => sum + (e.amount ?? 0), 0);
  const carried = state.entities
    .filter(e => e.carrying?.kind === resource)
    .reduce((sum, e) => sum + e.carrying!.amount, 0);
  return banked + inNodes + carried;
}

/** Nearest legal spot to `near`, so tests do not hardcode map coordinates. */
export function freeSpot(state: GameState, kind: BuildingKind, near: { x: number; y: number }) {
  for (let radius = 1; radius <= 12; radius += 0.5) {
    for (let step = 0; step < 16; step++) {
      const angle = step * Math.PI / 8;
      const spot = { x: near.x + Math.cos(angle) * radius, y: near.y + Math.sin(angle) * radius };
      if (placementLegal(state, kind, spot).ok) return spot;
    }
  }
  throw new Error(`no legal ${kind} placement near ${near.x},${near.y}`);
}
