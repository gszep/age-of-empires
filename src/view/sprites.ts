import * as THREE from 'three/webgpu';
import type { ContentAssets, Atlas, AnimationInfo } from './assets';
import { worldToIso, isoDepth } from './iso';
import type { Entity, GameState } from '../sim/types';

/** AoE2DE player colors (blue player 1, red player 2). */
export const PLAYER_COLORS: Record<number, number> = { 0: 0xffffff, 1: 0x1a6cff, 2: 0xe02b2b };

interface Piece {
  mesh: THREE.Mesh;
  atlasKey?: string;
}

export interface EntityView {
  group: THREE.Group;
  body: Piece;
  annexes: Piece[];
  fallback: boolean;
  animationState?: string;
  animationStartedAt?: number;
  facing: number; // radians, world space
  lastPosition?: { x: number; y: number };
}

const material = () => new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, depthTest: false });

function makePiece(): Piece {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material());
  mesh.visible = false;
  return { mesh };
}

export function createEntityView(assets: ContentAssets | undefined, entity: Entity): EntityView {
  const group = new THREE.Group();
  const body = makePiece();
  group.add(body.mesh);
  const annexes: Piece[] = [];
  const key = entityKey(entity);
  const imported = assets?.entities[key];
  if (imported?.annexes) {
    for (const _ of imported.annexes) {
      const piece = makePiece();
      annexes.push(piece);
      group.add(piece.mesh);
    }
  }
  const view: EntityView = { group, body, annexes, fallback: !imported, facing: entity.owner === 2 ? Math.PI : 0 };
  if (!imported) buildFallback(view, entity);
  return view;
}

function buildFallback(view: EntityView, entity: Entity): void {
  const mesh = view.body.mesh;
  mesh.visible = true;
  const color = entity.kind === 'resource'
    ? entity.resourceKind === 'wood' ? 0x2c6b36 : entity.resourceKind === 'gold' ? 0xd9b23f : 0xc4506e
    : PLAYER_COLORS[entity.owner];
  (mesh.material as THREE.MeshBasicMaterial).color.set(color);
  const size = entity.radius * 2 * 48;
  mesh.scale.set(Math.max(18, size), Math.max(18, size * (entity.kind === 'resource' ? 0.5 : 1)), 1);
}

export function entityKey(entity: Entity): string {
  if (entity.kind === 'resource') {
    return entity.resourceKind === 'food' ? 'berries' : entity.resourceKind === 'gold' ? 'gold' : 'tree-oak';
  }
  return entity.kind;
}

/** Choose the imported sprite source (entity variant) and animation name. */
function chooseAnimation(state: GameState, entity: Entity): { key: string; name: string } {
  const kind = entity.kind;
  if (kind === 'resource') {
    return { key: entityKey(entity), name: entity.dead ? 'death' : 'idle' };
  }
  if (kind === 'town-center' || kind === 'barracks' || kind === 'house') {
    if (entity.dead) return { key: kind, name: 'death' };
    if (entity.buildProgress !== undefined) return { key: kind, name: 'construction' };
    return { key: kind, name: 'idle' };
  }
  if (kind === 'militia') {
    if (entity.dead) return { key: kind, name: 'death' };
    if (entity.activity === 'attacking') return { key: kind, name: 'attack' };
    if (entity.activity === 'moving') return { key: kind, name: 'walk' };
    return { key: kind, name: 'idle' };
  }
  // Villager task variants follow the DAT task units.
  let variant = 'villager';
  if (entity.order.kind === 'build') variant = 'villager-builder';
  else if (entity.order.kind === 'gather' || entity.carrying) {
    const resource = entity.carrying?.kind ?? gatherTargetResource(state, entity);
    if (resource === 'food') variant = 'villager-forager';
    else if (resource === 'wood') variant = 'villager-lumberjack';
    else if (resource === 'gold') variant = 'villager-goldminer';
  }
  if (entity.dead) return { key: variant, name: 'death' };
  switch (entity.activity) {
    case 'gathering': return { key: variant, name: 'work' };
    case 'building': return { key: variant, name: 'work' };
    case 'carrying': return { key: variant, name: 'carry' };
    case 'attacking': return { key: 'villager', name: 'attack' };
    case 'moving': return { key: variant, name: 'walk' };
    default: return { key: variant, name: 'idle' };
  }
}

function gatherTargetResource(state: GameState, entity: Entity) {
  if (entity.order.kind !== 'gather') return undefined;
  const targetId = entity.order.targetId;
  return state.entities.find(e => e.id === targetId)?.resourceKind;
}

function applyFrame(
  piece: Piece,
  assets: ContentAssets,
  atlas: Atlas,
  frameIndex: number,
  worldOffset: { x: number; y: number },
  entity: Entity,
  tint: number,
): void {
  const mesh = piece.mesh;
  const texture = assets.textures.get(atlas.image);
  const frame = atlas.frames[Math.min(frameIndex, atlas.frames.length - 1)];
  if (!texture || !frame) { mesh.visible = false; return; }
  mesh.visible = true;
  const meshMaterial = mesh.material as THREE.MeshBasicMaterial;
  if (meshMaterial.map !== texture) { meshMaterial.map = texture; meshMaterial.needsUpdate = true; }
  meshMaterial.color.set(tint);
  const [atlasWidth, atlasHeight] = atlas.size;
  const left = frame.x / atlasWidth;
  const right = (frame.x + frame.w) / atlasWidth;
  const top = 1 - frame.y / atlasHeight;
  const bottom = 1 - (frame.y + frame.h) / atlasHeight;
  const uv = mesh.geometry.getAttribute('uv') as THREE.BufferAttribute;
  if (uv.getX(0) !== left || uv.getY(0) !== top || uv.getX(1) !== right || uv.getY(2) !== bottom) {
    uv.setXY(0, left, top);
    uv.setXY(1, right, top);
    uv.setXY(2, left, bottom);
    uv.setXY(3, right, bottom);
    uv.needsUpdate = true;
  }
  mesh.scale.set(frame.w, frame.h, 1);
  const iso = worldToIso(entity.position.x + worldOffset.x, entity.position.y + worldOffset.y);
  // Anchor the hotspot at the entity ground position.
  mesh.position.set(iso.x + frame.w / 2 - frame.cx, iso.y - frame.h / 2 + frame.cy, 0);
}

/**
 * DE sprite frame 0 faces screen-east; frames rotate clockwise as the index
 * increases (openage's DE exporter encodes this as start_angle=270 with
 * degree 0 = south/front-facing, degree increasing clockwise; see
 * convert/entity_object/export/metadata_export.py in the pinned openage
 * checkout). facing is a world-space angle; convert to screen space first.
 */
function directionIndex(facing: number, directions: number): number {
  const dx = Math.cos(facing);
  const dy = Math.sin(facing);
  const screenX = dx - dy;
  const screenDown = (dx + dy) / 2;
  const angle = Math.atan2(-screenX, screenDown) + Math.PI / 2;
  const index = Math.round(angle / (2 * Math.PI) * directions);
  return ((index % directions) + directions) % directions;
}

export function updateEntityView(
  view: EntityView,
  assets: ContentAssets | undefined,
  state: GameState,
  entity: Entity,
  time: number,
): void {
  const depth = isoDepth(entity.position.x, entity.position.y);
  if (view.fallback || !assets) {
    const iso = worldToIso(entity.position.x, entity.position.y);
    view.body.mesh.position.set(iso.x, iso.y + view.body.mesh.scale.y / 2, 0);
    view.body.mesh.renderOrder = 1000 + depth * 10;
    (view.body.mesh.material as THREE.MeshBasicMaterial).opacity = entity.dead ? 0.4 : 1;
    return;
  }

  // Track facing from movement.
  if (view.lastPosition) {
    const dx = entity.position.x - view.lastPosition.x;
    const dy = entity.position.y - view.lastPosition.y;
    if (Math.abs(dx) + Math.abs(dy) > 1e-4) view.facing = Math.atan2(dy, dx);
  }
  view.lastPosition = { x: entity.position.x, y: entity.position.y };
  if ((entity.activity === 'attacking' || entity.activity === 'gathering' || entity.activity === 'building') && 'targetId' in entity.order) {
    const target = state.entities.find(e => e.id === (entity.order as { targetId: number }).targetId);
    if (target) view.facing = Math.atan2(target.position.y - entity.position.y, target.position.x - entity.position.x);
  }

  const choice = chooseAnimation(state, entity);
  const imported = assets.entities[choice.key] ?? assets.entities[entityKey(entity)];
  let animation: AnimationInfo | undefined = imported?.animations[choice.name];
  let atlas: Atlas | undefined = imported?.atlases[choice.name];
  if (!animation || !atlas) {
    animation = imported?.animations['idle'];
    atlas = imported?.atlases['idle'];
  }
  if (!animation || !atlas) { view.body.mesh.visible = false; return; }

  const stateKey = `${choice.key}/${choice.name}`;
  if (view.animationState !== stateKey) {
    view.animationState = stateKey;
    view.animationStartedAt = time;
  }
  const elapsed = time - (view.animationStartedAt ?? time);

  let frameIndex: number;
  if (entity.kind === 'resource' || (entity.kind === 'house' && choice.name === 'idle')) {
    // Angle count encodes art variations for scenery; pick one by id.
    frameIndex = entity.id % atlas.framesInFile;
  } else if (choice.name === 'construction') {
    frameIndex = Math.min(
      atlas.framesInFile - 1,
      Math.floor((entity.buildProgress ?? 0) * atlas.framesInFile),
    );
  } else {
    const framesPerDirection = animation.frames;
    const directionsInFile = Math.max(1, Math.floor(atlas.framesInFile / framesPerDirection));
    const direction = directionIndex(view.facing, animation.directions) % directionsInFile;
    const frameSeconds = animation.frameSeconds > 0 ? animation.frameSeconds : 0.1;
    let frameInDirection = Math.floor(elapsed / frameSeconds);
    if (choice.name === 'death') frameInDirection = Math.min(frameInDirection, framesPerDirection - 1);
    else frameInDirection %= framesPerDirection;
    frameIndex = direction * framesPerDirection + frameInDirection;
  }

  // Player-color masks are unavailable (decoder evidence in tools/README.md);
  // approximate ownership with a light tint on units.
  const tint = entity.owner !== 0 && (entity.kind === 'villager' || entity.kind === 'militia')
    ? (entity.owner === 1 ? 0xcdd8ff : 0xffcdc4)
    : 0xffffff;

  applyFrame(view.body, assets, atlas, frameIndex, { x: 0, y: 0 }, entity, tint);
  view.body.mesh.renderOrder = 1000 + depth * 10;
  (view.body.mesh.material as THREE.MeshBasicMaterial).opacity =
    entity.buildProgress !== undefined ? 0.85 : 1;

  const annexes = imported?.annexes ?? [];
  for (const [index, piece] of view.annexes.entries()) {
    const annex = annexes[index];
    const annexAtlas = annex?.atlases[`annex${index}-idle`];
    if (!annex || !annexAtlas || entity.buildProgress !== undefined || entity.dead) {
      piece.mesh.visible = false;
      continue;
    }
    // Annex art is anchored by its own frame hotspot; the DAT misplacement
    // is display-order metadata here, not an additional world offset.
    applyFrame(piece, assets, annexAtlas, 0, { x: 0, y: 0 }, entity, 0xffffff);
    piece.mesh.renderOrder = 1000 + isoDepth(entity.position.x, entity.position.y) * 10 + 1 + index;
  }
}
