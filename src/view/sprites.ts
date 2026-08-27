import * as THREE from 'three/webgpu';
import { materialColor, materialOpacity, texture as textureNode, vec2 } from 'three/tsl';
import type { ContentAssets, Atlas, AnimationInfo } from './assets';
import { isBuilding, isUnit } from '../sim/data';
import { createTerrainPatch } from './world';
import { worldToIso, isoDepth, TILE_H } from './iso';
import type { Entity, GameState, Point } from '../sim/types';

/** Open-content player colours, used until the game palette is imported. */
export const PLAYER_COLORS: Record<number, number> = { 0: 0xffffff, 1: 0x1a6cff, 2: 0xe02b2b };

/**
 * What the game draws an obscured unit's contour in. The DAT names it directly
 * (`player_colours[i].unit_outline_color`), so nothing here is picked by eye.
 */
function outlineColorOf(assets: ContentAssets | undefined, owner: number): number | undefined {
  const color = assets?.playerColors?.players[String(owner)]?.outlineColor;
  return color ? (color[0] << 16) | (color[1] << 8) | color[2] : undefined;
}

/** The owner's colour as `#rrggbb`: the DAT's own minimap colour when imported. */
export function playerColorHex(assets: ContentAssets | undefined, owner: number): string | undefined {
  if (owner === 0) return undefined;
  const minimap = assets?.playerColors?.players[String(owner)]?.minimapColor;
  const color = minimap ? (minimap[0] << 16) | (minimap[1] << 8) | minimap[2] : PLAYER_COLORS[owner];
  return color === undefined ? undefined : `#${color.toString(16).padStart(6, '0')}`;
}

interface Piece {
  mesh: THREE.Mesh;
  atlasKey?: string;
  /**
   * Set on a piece drawn through a player's palette ramp: the sheet is bound to
   * the shader as a node rather than as `material.map`, so swapping animation
   * atlases means swapping this node's texture.
   */
  mapNode?: { value: THREE.Texture };
}

export interface EntityView {
  group: THREE.Group;
  /** Player-colour mask drawn over the body. */
  color: Piece;
  /** The owner's colour for reporting; the ramp shades it per pixel. */
  playerColor?: string;
  /** Farms draw as a terrain patch instead of a sprite. */
  patch?: THREE.Mesh;
  patchSlot?: string;
  shadow: Piece;
  body: Piece;
  /** Contour drawn in the owner's colour while a building hides the unit. */
  outline: Piece;
  outlineColor?: number;
  annexes: Piece[];
  /** Player-colour mask over each annex, in the same order. */
  annexColors: Piece[];
  fallback: boolean;
  animationState?: string;
  animationStartedAt?: number;
  /** When this entity was first seen dead, so the corpse chain can advance. */
  diedAt?: number;
  facing: number; // radians, world space
  lastPosition?: { x: number; y: number };
}

/**
 * Screen pixels per tile of height. Calibrated against the DAT's own launch
 * offsets: the archer's 1.5 puts its shot at 36px, exactly its sprite hotspot
 * height, and the watch tower's 5 lands two thirds up its 184px tower.
 */
const HEIGHT_PIXELS = TILE_H / 2;

const material = () => new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, depthTest: false });

function makePiece(): Piece {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material());
  mesh.visible = false;
  return { mesh };
}

/**
 * A 1x1 stand-in so the shader has a bound texture before the first frame is
 * applied. Nothing is drawn until `applyFrame` swaps in a real atlas.
 */
const placeholderTexture = (): THREE.DataTexture => {
  const texture = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
  texture.needsUpdate = true;
  return texture;
};

/**
 * The player-colour piece, drawn through the owner's imported palette ramp.
 *
 * AoE2 does not tint the cloth a flat colour: the main graphics layer paints it
 * in greys and the game palette turns each grey into one of the player's eight
 * shades. The importer packs that grey into the sheet's RGB and the mask's
 * coverage into its alpha, so one texture read gives both the ramp index and
 * how much of the pixel it covers.
 *
 * `material.color` still multiplies the result, which is what keeps the
 * placement preview's legality tint working on this piece like on every other.
 */
function makeRampPiece(ramp: THREE.Texture): Piece {
  const sheet = textureNode(placeholderTexture());
  // The ramp holds one texel per grey the sheet can carry, so the shade is the
  // lookup; the scale lands byte 0 and byte 255 on their own texel centres.
  const steps = ramp.image.width as number;
  const u = sheet.r.mul((steps - 1) / steps).add(0.5 / steps);
  const nodeMaterial = new THREE.MeshBasicNodeMaterial({
    transparent: true, depthWrite: false, depthTest: false,
  });
  nodeMaterial.colorNode = textureNode(ramp).sample(vec2(u, 0.5)).rgb.mul(materialColor);
  nodeMaterial.opacityNode = sheet.a.mul(materialOpacity);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), nodeMaterial);
  mesh.visible = false;
  return { mesh, mapNode: sheet };
}

export function createEntityView(assets: ContentAssets | undefined, entity: Entity): EntityView {
  const group = new THREE.Group();
  // Added first so it draws under the body; renderOrder keeps it under every
  // other entity's body too, so a unit never stands inside its neighbour's
  // shadow.
  const shadow = makePiece();
  group.add(shadow.mesh);
  const body = makePiece();
  group.add(body.mesh);
  const ramp = assets?.playerRamps.get(entity.owner);
  const color = ramp ? makeRampPiece(ramp) : makePiece();
  group.add(color.mesh);
  const outline = makePiece();
  group.add(outline.mesh);
  const annexes: Piece[] = [];
  const annexColors: Piece[] = [];
  const key = entityKey(entity);
  const imported = assets?.entities[key];
  if (imported?.annexes) {
    for (const _ of imported.annexes) {
      const piece = makePiece();
      annexes.push(piece);
      group.add(piece.mesh);
      // The town center's own art carries no player-colour layer at all: its
      // colour lives entirely in the annex pieces, so each needs the same
      // treatment as a body.
      const annexColor = ramp ? makeRampPiece(ramp) : makePiece();
      annexColors.push(annexColor);
      group.add(annexColor.mesh);
    }
  }
  const view: EntityView = {
    group, shadow, body, color, outline, annexes, annexColors, fallback: !imported,
    facing: entity.owner === 2 ? Math.PI : 0,
    playerColor: playerColorHex(assets, entity.owner),
    outlineColor: outlineColorOf(assets, entity.owner),
  };
  if (entity.kind === 'farm') {
    view.fallback = false;
    return view;
  }
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
    if (entity.resourceKind === 'food') return 'berries';
    if (entity.resourceKind === 'gold') return 'gold';
    if (entity.resourceKind === 'stone') return 'stone';
    return 'tree-oak';
  }
  return entity.kind;
}

/**
 * Whether a tree has been cut into. The DAT models a tree as the standing
 * trunk plus a `dying` graphic that is the felled trunk lying on the ground,
 * not a corpse: AoE2 shows it from the first chop and leaves it there while the
 * wood lasts, so the state is read from what the node has left.
 */
export function treeIsFelled(state: GameState, entity: Entity): boolean {
  return entity.kind === 'resource' && entity.resourceKind === 'wood'
    && (entity.amount ?? 0) < state.rules.nodes.tree.amount;
}

/** Choose the imported sprite source (entity variant) and animation name. */
export function chooseAnimation(state: GameState, entity: Entity): { key: string; name: string } {
  const kind = entity.kind;
  if (kind === 'resource') {
    const felled = entity.dead || treeIsFelled(state, entity);
    return { key: entityKey(entity), name: felled ? 'death' : 'idle' };
  }
  if (isBuilding(kind)) {
    if (entity.dead) return { key: kind, name: 'death' };
    if (entity.buildProgress !== undefined) return { key: kind, name: 'construction' };
    return { key: kind, name: 'idle' };
  }
  if (kind !== 'villager') {
    if (entity.dead) return { key: kind, name: 'death' };
    if (entity.activity === 'attacking') return { key: kind, name: 'attack' };
    // A laden trade cart has its own art: the DAT gives the trade task a
    // carrying graphic, which is the full cart on the road.
    if (entity.carrying) return { key: kind, name: 'carry' };
    if (entity.activity === 'moving' || entity.activity === 'carrying') return { key: kind, name: 'walk' };
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
    else if (resource === 'stone') variant = 'villager-stonemason';
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
  position: Point,
  tint: number,
): void {
  const mesh = piece.mesh;
  const texture = assets.textures.get(atlas.image);
  const frame = atlas.frames[Math.min(frameIndex, atlas.frames.length - 1)];
  // Shadow atlases hold zero-sized entries where a frame casts none.
  if (!texture || !frame || frame.w === 0 || frame.h === 0) { mesh.visible = false; return; }
  mesh.visible = true;
  const meshMaterial = mesh.material as THREE.MeshBasicMaterial;
  if (piece.mapNode) {
    if (piece.mapNode.value !== texture) piece.mapNode.value = texture;
  } else if (meshMaterial.map !== texture) {
    meshMaterial.map = texture;
    meshMaterial.needsUpdate = true;
  }
  meshMaterial.color.set(tint);
  const [atlasWidth, atlasHeight] = atlas.size;
  // Half-texel inset: linear filtering samples across the frame edge, which
  // would drag in whichever neighbouring frame the packer placed alongside.
  const insetX = 0.5 / atlasWidth;
  const insetY = 0.5 / atlasHeight;
  const left = frame.x / atlasWidth + insetX;
  const right = (frame.x + frame.w) / atlasWidth - insetX;
  const top = 1 - frame.y / atlasHeight - insetY;
  const bottom = 1 - (frame.y + frame.h) / atlasHeight + insetY;
  const uv = mesh.geometry.getAttribute('uv') as THREE.BufferAttribute;
  if (uv.getX(0) !== left || uv.getY(0) !== top || uv.getX(1) !== right || uv.getY(2) !== bottom) {
    uv.setXY(0, left, top);
    uv.setXY(1, right, top);
    uv.setXY(2, left, bottom);
    uv.setXY(3, right, bottom);
    uv.needsUpdate = true;
  }
  mesh.scale.set(frame.w, frame.h, 1);
  const iso = worldToIso(position.x, position.y);
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

/**
 * The gather-point flag. Like an arrow it is not simulation state, so it draws
 * from the order it marks rather than through the entity path — but it is the
 * owner's flag, so it gets the same player-colour ramp a unit does.
 */
export function createFlagView(assets: ContentAssets | undefined, owner: number): EntityView {
  const group = new THREE.Group();
  const shadow = makePiece();
  group.add(shadow.mesh);
  const body = makePiece();
  group.add(body.mesh);
  const ramp = assets?.playerRamps.get(owner);
  const color = ramp ? makeRampPiece(ramp) : makePiece();
  group.add(color.mesh);
  return {
    group, shadow, body, color, outline: makePiece(), annexes: [], annexColors: [],
    fallback: false, facing: 0, playerColor: playerColorHex(assets, owner),
  };
}

/** The flag waves on its own clock; it marks a place, not a moment. */
export function updateFlagView(
  view: EntityView, assets: ContentAssets | undefined,
  owner: number, position: Point, time: number,
): void {
  const flag = assets?.entities['rally-flag'];
  const atlas = flag?.atlases['idle'];
  const animation = flag?.animations['idle'];
  if (!assets || !atlas || !animation) {
    view.group.visible = false;
    return;
  }
  view.group.visible = true;
  const seconds = animation.frameSeconds > 0 ? animation.frameSeconds : 0.05;
  const frame = Math.floor(time / seconds) % Math.max(1, atlas.framesInFile);
  const depth = isoDepth(position.x, position.y);
  const shadowAtlas = flag?.atlases['idle-shadow'];
  if (shadowAtlas) {
    applyFrame(view.shadow, assets, shadowAtlas, frame, position, 0x000000);
    view.shadow.mesh.renderOrder = 500 + depth;
    (view.shadow.mesh.material as THREE.MeshBasicMaterial).opacity = 0.55;
  }
  // Over every sprite: the flag marks a point on the map, and a building
  // between the camera and that point must not swallow it.
  applyFrame(view.body, assets, atlas, frame, position, 0xffffff);
  view.body.mesh.renderOrder = 4600 + depth;
  const colorAtlas = flag?.atlases['idle-playercolor'];
  if (colorAtlas && owner !== 0) {
    applyFrame(
      view.color, assets, colorAtlas, frame, position,
      view.color.mapNode ? 0xffffff : PLAYER_COLORS[owner],
    );
    view.color.mesh.renderOrder = 4601 + depth;
    (view.color.mesh.material as THREE.MeshBasicMaterial).opacity = 1;
  } else {
    view.color.mesh.visible = false;
  }
}

/**
 * Arrows in flight. They are not entities in the simulation, so they render
 * from their own state rather than through the entity path, but they reuse the
 * atlas frame and direction machinery: `p_arrow_x1` carries 32 angles, so the
 * shaft points along its actual heading.
 */
export function createProjectileView(): EntityView {
  const group = new THREE.Group();
  const shadow = makePiece();
  const body = makePiece();
  group.add(body.mesh);
  return {
    group, shadow, body, color: makePiece(), outline: makePiece(),
    annexes: [], annexColors: [], fallback: false, facing: 0,
  };
}

export function updateProjectileView(
  view: EntityView,
  assets: ContentAssets | undefined,
  position: Point,
  heading: number,
  progress: number,
  span: number,
  launchHeight: number,
): void {
  const arrow = assets?.entities['arrow'];
  const atlas = arrow?.atlases['idle'];
  const animation = arrow?.animations['idle'];
  if (!assets || !atlas || !animation) { view.body.mesh.visible = false; return; }
  // Same indexing as animated entities: whole direction blocks laid end to end.
  const framesPerDirection = Math.max(1, animation.frames);
  const directionsInFile = Math.max(1, Math.floor(atlas.framesInFile / framesPerDirection));
  const direction = directionIndex(heading, animation.directions) % directionsInFile;
  // The frames within a direction are the shaft's pitch along the arc, from
  // steeply up through level to steeply down, so the frame tracks how far the
  // arrow has flown. Holding one frame is what made shots look rigid.
  // Trajectory: drop from the launch height to the ground over the flight,
  // bulged by the DAT's arc fraction of the span. A tower shoots from its top,
  // so a close shot is descending the whole way and never points up, while a
  // long one still lobs. The sign of `arc` varies between units in ways the
  // import does not interpret, so use its magnitude.
  const arc = Math.abs(arrow?.projectile?.arc ?? 0);
  const bulge = 4 * arc * span;
  const height = launchHeight * (1 - progress) + bulge * progress * (1 - progress);
  // Pitch is the trajectory's slope in screen space, where the ground track is
  // foreshortened by the projection but height is not.
  const climbPerFlight = -launchHeight + bulge * (1 - 2 * progress);
  const ground = worldToIso(Math.cos(heading) * span, Math.sin(heading) * span);
  const groundScreen = Math.hypot(ground.x, ground.y);
  const angle = Math.atan2(climbPerFlight * HEIGHT_PIXELS, Math.max(1e-6, groundScreen));
  const normalized = Math.max(-1, Math.min(1, angle / (Math.PI / 2)));
  const pitch = Math.round((1 - normalized) / 2 * (framesPerDirection - 1));

  applyFrame(view.body, assets, atlas, direction * framesPerDirection + pitch, position, 0xffffff);
  view.body.mesh.position.y += height * HEIGHT_PIXELS;
  view.body.mesh.renderOrder = 4000 + isoDepth(position.x, position.y);
}

/**
 * Show each unit's contour where something drawn in front of it hides it.
 *
 * A sprite occludes whatever sorts behind it, so the test is the one the
 * renderer already makes: a piece with a greater isometric depth, covering the
 * unit's own art. Buildings and trees are what stand tall enough to swallow a
 * unit; other units do not hide each other in AoE2.
 */
const HIDDEN_FRACTION = 0.5;

export function updateOcclusion(views: Map<string, EntityView>, state: GameState): void {
  const occluders: { depth: number; x: number; y: number; width: number; height: number }[] = [];
  for (const entity of state.entities) {
    if (entity.dead) continue;
    const tall = isBuilding(entity.kind) || (entity.kind === 'resource' && entity.resourceKind === 'wood');
    if (!tall) continue;
    const view = views.get(`e${entity.id}`);
    if (!view) continue;
    const depth = isoDepth(entity.position.x, entity.position.y);
    // Annexes are the building's art too — the town center's roofs are all
    // annex, and they are what a unit walks behind.
    for (const piece of [view.body, ...view.annexes]) {
      const mesh = piece.mesh;
      if (!mesh.visible) continue;
      occluders.push({
        depth,
        x: mesh.position.x, y: mesh.position.y,
        width: mesh.scale.x, height: mesh.scale.y,
      });
    }
  }
  if (!occluders.length) return;
  for (const entity of state.entities) {
    if (entity.dead || !isUnit(entity.kind)) continue;
    const view = views.get(`e${entity.id}`);
    const mesh = view?.outline.mesh;
    if (!view || !mesh || !view.body.mesh.visible) continue;
    const depth = isoDepth(entity.position.x, entity.position.y);
    const body = view.body.mesh;
    const area = body.scale.x * body.scale.y;
    // Most of the unit has to be behind the thing, not a sliver of it: a
    // sprite's box includes its transparent margins, so brushing past a tree
    // would otherwise light the contour up.
    mesh.visible = area > 0 && occluders.some(o => {
      const overlapX = Math.min(o.x + o.width / 2, body.position.x + body.scale.x / 2)
        - Math.max(o.x - o.width / 2, body.position.x - body.scale.x / 2);
      const overlapY = Math.min(o.y + o.height / 2, body.position.y + body.scale.y / 2)
        - Math.max(o.y - o.height / 2, body.position.y - body.scale.y / 2);
      return o.depth > depth && overlapX > 0 && overlapY > 0
        && (overlapX * overlapY) / area >= HIDDEN_FRACTION;
    });
  }
}

/** Farms swap between the construction and grown terrain slots. */
function updateFarmView(view: EntityView, assets: ContentAssets | undefined, entity: Entity): void {
  const slot = entity.buildProgress !== undefined ? 'farm-construction' : 'farm';
  if (view.patchSlot !== slot) {
    if (view.patch) { view.group.remove(view.patch); view.patch.geometry.dispose(); }
    view.patch = createTerrainPatch(assets, slot, entity.radius);
    view.patchSlot = slot;
    if (view.patch) view.group.add(view.patch);
  }
  if (!view.patch) return;
  const iso = worldToIso(entity.position.x - entity.radius, entity.position.y - entity.radius);
  view.patch.position.set(iso.x, iso.y, 0);
  view.patch.renderOrder = 10 + isoDepth(entity.position.x, entity.position.y);
  view.patch.visible = !entity.dead;
}

export function updateEntityView(
  view: EntityView,
  assets: ContentAssets | undefined,
  state: GameState,
  entity: Entity,
  time: number,
): void {
  const depth = isoDepth(entity.position.x, entity.position.y);
  if (entity.kind === 'farm') {
    updateFarmView(view, assets, entity);
    return;
  }
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
  // What is left behind is a chain in the DAT: the dying graphic plays once,
  // then the dead unit's own art lies there — a corpse rotting, a felled tree
  // reduced to its stump. Switch when the first has played out.
  if (entity.dead) {
    view.diedAt ??= time;
    const dying = imported?.animations['death'];
    const played = dying ? dying.frames * dying.frameSeconds : 0;
    if (imported?.atlases['decay'] && time - view.diedAt >= played) choice.name = 'decay';
  } else {
    view.diedAt = undefined;
  }
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
    // Neither a death nor a corpse loops: both hold their last frame.
    if (choice.name === 'death' || choice.name === 'decay') {
      frameInDirection = Math.min(frameInDirection, framesPerDirection - 1);
    }
    else frameInDirection %= framesPerDirection;
    frameIndex = direction * framesPerDirection + frameInDirection;
  }

  // The imported player-colour mask carries ownership, so the body itself is
  // drawn untinted.
  const tint = 0xffffff;

  // Imported shadow layer, anchored by its own hotspot like the body. Every
  // shadow draws below every body so entities never occlude each other's.
  const shadowAtlas = imported?.atlases[`${choice.name}-shadow`];
  if (shadowAtlas && !entity.dead) {
    // Mask sheets are neutral white, so the shadow asks for black here.
    applyFrame(view.shadow, assets, shadowAtlas, frameIndex, entity.position, 0x000000);
    view.shadow.mesh.renderOrder = 500 + depth;
    (view.shadow.mesh.material as THREE.MeshBasicMaterial).opacity = 0.55;
  } else {
    view.shadow.mesh.visible = false;
  }

  applyFrame(view.body, assets, atlas, frameIndex, entity.position, tint);
  view.body.mesh.renderOrder = 1000 + depth * 10;

  // Player colour: the DAT's mask layer marks the cloth that takes the owner's
  // colour, laid over the body at the same frame and hotspot. Gaia has none.
  const colorAtlas = imported?.atlases[`${choice.name}-playercolor`];
  if (colorAtlas && entity.owner !== 0 && !entity.dead) {
    // A ramp piece reads the colour from the palette, so it draws untinted;
    // without imported ramps the sheet is multiplied by the flat player colour.
    const colorTint = view.color.mapNode ? 0xffffff : PLAYER_COLORS[entity.owner];
    applyFrame(view.color, assets, colorAtlas, frameIndex, entity.position, colorTint);
    view.color.mesh.renderOrder = 1000 + depth * 10 + 1;
    (view.color.mesh.material as THREE.MeshBasicMaterial).opacity =
      entity.buildProgress !== undefined ? 0.85 : 1;
  } else {
    view.color.mesh.visible = false;
  }
  (view.body.mesh.material as THREE.MeshBasicMaterial).opacity =
    entity.buildProgress !== undefined ? 0.85 : 1;

  // The contour AoE2 shows through a building that hides a unit. It is
  // positioned every frame but stays hidden until `updateOcclusion` finds
  // something actually drawing in front of it.
  const outlineAtlas = imported?.atlases[`${choice.name}-outline`];
  if (outlineAtlas && view.outlineColor !== undefined && isUnit(entity.kind) && !entity.dead) {
    applyFrame(view.outline, assets, outlineAtlas, frameIndex, entity.position, view.outlineColor);
    // Above every body but under the fog, so a hidden unit reads through the
    // building without reading through the dark.
    view.outline.mesh.renderOrder = 4500 + depth;
  }
  view.outline.mesh.visible = false;

  const annexes = imported?.annexes ?? [];
  for (const [index, piece] of view.annexes.entries()) {
    const annex = annexes[index];
    const annexAtlas = annex?.atlases[`annex${index}-idle`];
    const colorPiece = view.annexColors[index];
    if (!annex || !annexAtlas || entity.buildProgress !== undefined || entity.dead) {
      piece.mesh.visible = false;
      if (colorPiece) colorPiece.mesh.visible = false;
      continue;
    }
    // Annex art is anchored by its own frame hotspot; the DAT misplacement
    // is display-order metadata here, not an additional world offset.
    const order = 1000 + depth * 10 + 1 + index * 2;
    applyFrame(piece, assets, annexAtlas, 0, entity.position, 0xffffff);
    piece.mesh.renderOrder = order;
    const annexColorAtlas = annex.atlases[`annex${index}-idle-playercolor`];
    if (colorPiece && annexColorAtlas && entity.owner !== 0) {
      applyFrame(
        colorPiece, assets, annexColorAtlas, 0, entity.position,
        colorPiece.mapNode ? 0xffffff : PLAYER_COLORS[entity.owner],
      );
      colorPiece.mesh.renderOrder = order + 1;
      (colorPiece.mesh.material as THREE.MeshBasicMaterial).opacity = 1;
    } else if (colorPiece) {
      colorPiece.mesh.visible = false;
    }
  }
}
