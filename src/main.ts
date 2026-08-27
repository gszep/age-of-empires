import * as THREE from 'three/webgpu';
import './view/style.css';
import { exampleAiCommands } from './sim/ai';
import { observe } from './sim/observe';
import { applyCommand, createGame, gameTimeSeconds, placementLegal, stepGame } from './sim/game';
import { FALLBACK_RULES, TICK_SECONDS, isBuilding, isUnit, rulesFromManifest, type ContentManifest, type Cost, type GameRules } from './sim/data';
import { isTileVisible } from './sim/visibility';
import { checksumState } from './sim/checksum';
import type { MatchRecord } from './protocol/types';
import type { BuildingKind, Entity, GameState, Point, UnitKind } from './sim/types';
import { clearSession, loadSession, saveSession } from './dev-session';
import { loadAudioAssets, loadContentAssets, loadUiAssets } from './view/assets';
import { worldToIso, isoToWorld, snapPlacement, TILE_W, TILE_H } from './view/iso';
import { createEntityView, createFlagView, createProjectileView, updateEntityView, updateFlagView, updateProjectileView, updateOcclusion, entityKey, type EntityView } from './view/sprites';
import { createGround, createFog, createFootprint } from './view/world';
import { Hud, type CommandButton, type SelectionInfo } from './view/hud';

/**
 * Mutable presentation bindings so Vite can hot-swap rendering, animation, and
 * HUD code into a running match (see the `import.meta.hot` block at the end of
 * this file). `src/sim` is deliberately excluded: patching tick logic into an
 * already-ticked GameState can silently diverge live state from what a
 * deterministic replay would produce, so simulation edits force a full reload.
 */
const view = {
  createGround, createFog, createFootprint,
  createEntityView, updateEntityView, createProjectileView, updateProjectileView,
  createFlagView, updateFlagView, updateOcclusion, entityKey, Hud,
};

const app = document.querySelector<HTMLDivElement>('#app')!;

const renderer = new THREE.WebGPURenderer({ antialias: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.domElement.classList.add('battlefield');
app.appendChild(renderer.domElement);
await renderer.init();

let [assets, uiAssets, audioAssets] = await Promise.all([
  loadContentAssets(), loadUiAssets(), loadAudioAssets(),
]);
let rules: GameRules = FALLBACK_RULES;
try {
  const response = await fetch('/imported/aoe2/manifest.json');
  if (response.ok) rules = rulesFromManifest(await response.json() as ContentManifest);
} catch { /* open fallback rules */ }

const restored = loadSession(rules);
let game = restored ?? createGame(42, rules);
if (restored) console.info(`[dev] resumed match at tick ${restored.tick}; menu restart starts a new one`);
let selectedIds: number[] = [];
let buildMode: BuildingKind | undefined;
let paused = false;
let aiClock = 0;

interface ReplayState {
  record: MatchRecord;
  commands: MatchRecord['commands'];
  checksums: Map<number, string>;
  lastTick: number;
  verified: number;
  failed: boolean;
}
let replay: ReplayState | undefined;

function startReplay(raw: unknown): void {
  const record = raw as MatchRecord;
  if (!record || record.version !== 1 || !Array.isArray(record.commands) || !Array.isArray(record.checksums)) {
    hud.showMessage('Not a valid replay file');
    return;
  }
  if (record.rulesOrigin !== rules.origin) {
    hud.showMessage(`Replay was recorded with ${record.rulesOrigin} rules; local rules are ${rules.origin}`);
    return;
  }
  // A replay drives its own command stream; snapshotting it would resume a
  // spectated match as if it were played.
  clearSession();
  game = createGame(record.seed, rules);
  selectedIds = [];
  buildMode = undefined;
  paused = false;
  hud.hideEnd();
  for (const entityView of views.values()) scene.remove(entityView.group);
  views.clear();
  replay = {
    record,
    commands: [...record.commands],
    checksums: new Map(record.checksums.map(entry => [entry.tick, entry.hash])),
    lastTick: record.checksums.at(-1)?.tick ?? 0,
    verified: 0,
    failed: false,
  };
  hud.showMessage(`Replaying seed ${record.seed}`);
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x18140c);
const camera = new THREE.OrthographicCamera(-innerWidth / 2, innerWidth / 2, innerHeight / 2, -innerHeight / 2, -1000, 1000);
camera.position.z = 10;
let cameraCenter = { ...worldToIso(8, 9) };
let zoom = 1;

let ground = view.createGround(game, assets);
scene.add(ground);
let fog = view.createFog(game);
scene.add(fog.mesh);

const views = new Map<string, EntityView>();
const ringGeometry = new THREE.RingGeometry(50, 53, 32);
const ringPool: THREE.Mesh[] = [];
const selectionRings = new THREE.Group();
selectionRings.renderOrder = 900;
scene.add(selectionRings);

/**
 * Placement preview: the building's own art where it will stand, over the tile
 * square it will occupy. Rebuilt whenever the chosen building changes, since
 * footprint size and sprite both depend on it.
 */
let ghostKind: BuildingKind | undefined;
let ghostFootprint: THREE.Mesh | undefined;
let ghostView: EntityView | undefined;
let pointerWorld: Point = { x: 16, y: 9 };

let soundSequence = 0;
function playSound(alias: string): void {
  const files = audioAssets?.audio[alias]?.files;
  if (!files?.length) return;
  const source = files[soundSequence++ % files.length];
  const element = new Audio(`${audioAssets!.base}${source.file}`);
  void element.play().catch(() => { /* browser gesture/autoplay policy */ });
}

/** A stand-in entity so the preview reuses the normal building rendering. */
function ghostEntity(kind: BuildingKind, at: Point): Entity {
  return {
    id: 0, kind, owner: 1, position: at,
    hp: 1, maxHp: 1, radius: rules.buildings[kind].radius,
    activity: 'idle', order: { kind: 'idle' },
  };
}

function disposeGhost(): void {
  if (ghostFootprint) {
    scene.remove(ghostFootprint);
    ghostFootprint.geometry.dispose();
    (ghostFootprint.material as THREE.Material).dispose();
    ghostFootprint = undefined;
  }
  if (ghostView) {
    scene.remove(ghostView.group);
    ghostView = undefined;
  }
  ghostKind = undefined;
}

function createHud(): Hud {
  return new view.Hud(app, uiAssets, {
    onCommand: id => runUiCommand(id),
    onMinimapNavigate: canvasPoint => {
      const world = hud.minimap.fromCanvas(game, canvasPoint.x, canvasPoint.y);
      cameraCenter = worldToIso(world.x, world.y);
    },
    onSelectIdleVillager: () => selectIdleVillager(),
    onMenu: action => {
      if (action === 'pause') paused = !paused;
      if (action === 'resume') paused = false;
      if (action === 'restart') restart();
    },
    onReplayFile: record => startReplay(record),
    onSound: alias => playSound(alias),
  });
}

let hud = createHud();

// Text-based debug protocol for the dev server's /__debug endpoint. Loaded
// dynamically so none of it reaches a production bundle.
if (import.meta.hot) {
  const { installDebug } = await import('./dev-debug');
  installDebug({
    game: () => game,
    cameraCenter: () => cameraCenter,
    zoom: () => zoom,
    selectedIds: () => selectedIds,
    apply: command => applyCommand(game, command),
    select: ids => { selectedIds = ids; },
    lookAt: point => { cameraCenter = worldToIso(point.x, point.y); },
    renderer,
    scene,
    camera,
    views,
  });
}

function restart(): void {
  replay = undefined;
  clearSession();
  game = createGame((Date.now() >>> 0) || 1, rules);
  selectedIds = [];
  buildMode = undefined;
  paused = false;
  hud.hideEnd();
  for (const entityView of views.values()) scene.remove(entityView.group);
  views.clear();
}

const ownSelected = (): Entity[] =>
  game.entities.filter(e => selectedIds.includes(e.id) && e.owner === 1 && !e.dead);

function selectIdleVillager(): void {
  const idle = game.entities.filter(e => e.owner === 1 && e.kind === 'villager' && !e.dead && e.order.kind === 'idle');
  if (!idle.length) { hud.showMessage('No idle villagers'); return; }
  const current = idle.findIndex(e => selectedIds.includes(e.id));
  const next = idle[(current + 1) % idle.length];
  selectedIds = [next.id];
  cameraCenter = worldToIso(next.position.x, next.position.y);
}

function runUiCommand(id: string): void {
  if (replay) return;
  const selection = ownSelected();
  if (id.startsWith('build-')) {
    buildMode = id.slice('build-'.length) as BuildingKind;
    return;
  }
  if (id === 'stop') {
    if (selection.length) applyCommand(game, { kind: 'stop', player: 1, entityIds: selection.map(e => e.id) });
    return;
  }
  if (id.startsWith('train-')) {
    const unit = id.slice('train-'.length) as UnitKind;
    const building = selection.find(e => isBuilding(e.kind) && e.buildProgress === undefined
      && rules.units[unit]?.trainedAt === e.kind);
    if (!building) return;
    const result = applyCommand(game, { kind: 'train', player: 1, buildingId: building.id, unit });
    if (!result.ok) hud.showMessage(result.reason);
    return;
  }
  if (id === 'cancel') buildMode = undefined;
}

/** Screen pixel -> world tile point under the current camera. */
function screenToWorld(clientX: number, clientY: number): Point {
  const rect = renderer.domElement.getBoundingClientRect();
  const sx = (clientX - rect.left - rect.width / 2) / zoom + cameraCenter.x;
  const sy = -((clientY - rect.top - rect.height / 2) / zoom) + cameraCenter.y;
  return isoToWorld(sx, sy);
}

function pickEntity(point: Point): Entity | undefined {
  let best: Entity | undefined;
  let bestDistance = Infinity;
  for (const entity of game.entities) {
    if (entity.dead) continue;
    if (entity.owner !== 1 && entity.owner !== 0 && !isTileVisible(game, 1, entity.position.x, entity.position.y)) continue;
    const d = Math.hypot(entity.position.x - point.x, entity.position.y - point.y) - entity.radius;
    if (d < Math.min(bestDistance, 0.9)) {
      best = entity;
      bestDistance = d;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Pointer input: left select / drag box, right context order, edge scrolling.
const selectionBox = document.createElement('div');
selectionBox.id = 'selection-box';
app.appendChild(selectionBox);
let dragStart: { x: number; y: number } | undefined;

renderer.domElement.addEventListener('contextmenu', event => event.preventDefault());
renderer.domElement.addEventListener('pointerdown', event => {
  const point = screenToWorld(event.clientX, event.clientY);
  if (event.button === 0) {
    if (buildMode && !replay) {
      const builder = ownSelected().find(e => e.kind === 'villager');
      // Commit exactly where the preview showed it, not the raw cursor point.
      const target = snapPlacement(point, rules.buildings[buildMode].radius);
      const result = builder
        ? applyCommand(game, { kind: 'build', player: 1, builderIds: ownSelected().filter(e => e.kind === 'villager').map(e => e.id), building: buildMode, target })
        : { ok: false as const, reason: 'Select a villager first' };
      if (!result.ok) hud.showMessage(result.reason);
      buildMode = undefined;
      return;
    }
    dragStart = { x: event.clientX, y: event.clientY };
  } else if (event.button === 2) {
    contextOrder(point, event.clientX, event.clientY);
  }
});
addEventListener('pointermove', event => {
  if (event.target === renderer.domElement || dragStart) {
    pointerWorld = screenToWorld(event.clientX, event.clientY);
  }
  if (!dragStart) return;
  const x = Math.min(dragStart.x, event.clientX);
  const y = Math.min(dragStart.y, event.clientY);
  selectionBox.style.display = 'block';
  selectionBox.style.left = `${x}px`;
  selectionBox.style.top = `${y}px`;
  selectionBox.style.width = `${Math.abs(event.clientX - dragStart.x)}px`;
  selectionBox.style.height = `${Math.abs(event.clientY - dragStart.y)}px`;
});
addEventListener('pointerup', event => {
  if (event.button !== 0 || !dragStart) return;
  selectionBox.style.display = 'none';
  const wasDrag = Math.abs(event.clientX - dragStart.x) + Math.abs(event.clientY - dragStart.y) > 8;
  if (wasDrag) {
    const a = screenToWorld(dragStart.x, dragStart.y);
    const b = screenToWorld(event.clientX, event.clientY);
    const c = screenToWorld(dragStart.x, event.clientY);
    const d = screenToWorld(event.clientX, dragStart.y);
    const minX = Math.min(a.x, b.x, c.x, d.x);
    const maxX = Math.max(a.x, b.x, c.x, d.x);
    const minY = Math.min(a.y, b.y, c.y, d.y);
    const maxY = Math.max(a.y, b.y, c.y, d.y);
    const units = game.entities.filter(e =>
      !e.dead && e.owner === 1 && isUnit(e.kind) &&
      e.position.x >= minX && e.position.x <= maxX && e.position.y >= minY && e.position.y <= maxY,
    );
    if (units.length) selectedIds = units.map(e => e.id);
  } else {
    const target = pickEntity(screenToWorld(event.clientX, event.clientY));
    if (target && target.owner === 1) {
      selectedIds = event.shiftKey ? [...new Set([...selectedIds, target.id])] : [target.id];
    } else if (target) {
      selectedIds = [target.id];
    } else if (!event.shiftKey) {
      selectedIds = [];
    }
  }
  dragStart = undefined;
});

function contextOrder(point: Point, _clientX: number, _clientY: number): void {
  if (replay) return; // spectating: inputs must not perturb the command stream
  const selection = ownSelected();
  const target = pickEntity(point);
  const units = selection.filter(e => isUnit(e.kind));
  if (units.length) {
    const result = applyCommand(game, {
      kind: 'order', player: 1, entityIds: units.map(e => e.id),
      target: point, targetId: target && target.id !== units[0].id ? target.id : undefined,
    });
    if (!result.ok) hud.showMessage(result.reason);
    return;
  }
  // Defensive buildings take a target the same way units do.
  const towers = selection.filter(e => rules.buildings[e.kind as BuildingKind]?.attack && e.buildProgress === undefined);
  if (towers.length) {
    const hostile = target && target.owner !== 0 && target.owner !== 1;
    const result = applyCommand(game, {
      kind: 'order', player: 1, entityIds: towers.map(e => e.id),
      target: point, targetId: hostile ? target.id : undefined,
    });
    if (!result.ok) hud.showMessage(result.reason);
    else hud.showMessage(hostile ? 'Target set' : 'Target cleared');
    return;
  }
  const building = selection.find(e => e.kind === 'town-center' || e.kind === 'barracks');
  if (building) {
    applyCommand(game, { kind: 'rally', player: 1, buildingId: building.id, target: point, targetId: target?.id });
    hud.showMessage('Rally point set');
  }
}

// Keyboard: camera, hotkeys, menu.
const heldKeys = new Set<string>();
addEventListener('keydown', event => {
  const key = event.key;
  if (key.startsWith('Arrow')) { heldKeys.add(key); event.preventDefault(); return; }
  if (key === 'Escape') {
    if (buildMode) buildMode = undefined;
    else if (hud.menuOpen) hud.toggleMenu(false);
    else hud.toggleMenu(true);
    return;
  }
  if (key === 'F3') { paused = !paused; event.preventDefault(); return; }
  if (key === 'F10') { hud.toggleMenu(); event.preventDefault(); return; }
  if (key === '.') { selectIdleVillager(); return; }
  if (key === 'h' || key === 'H') {
    const tc = game.entities.find(e => e.owner === 1 && e.kind === 'town-center' && !e.dead);
    if (tc) {
      selectedIds = [tc.id];
      cameraCenter = worldToIso(tc.position.x, tc.position.y);
    }
    return;
  }
  const commands = currentCommands();
  const match = commands.find(c => c.hotkey === key.toLowerCase() && c.enabled);
  if (match) runUiCommand(match.id);
});
addEventListener('keyup', event => heldKeys.delete(event.key));
addEventListener('wheel', event => {
  if ((event.target as HTMLElement).closest('#hud')) return;
  zoom = Math.max(0.4, Math.min(2, zoom * (event.deltaY > 0 ? 0.9 : 1.1)));
}, { passive: true });

function panCamera(dt: number): void {
  const speed = 900 * dt / zoom;
  let dx = 0;
  let dy = 0;
  if (heldKeys.has('ArrowLeft')) dx -= 1;
  if (heldKeys.has('ArrowRight')) dx += 1;
  if (heldKeys.has('ArrowUp')) dy += 1;
  if (heldKeys.has('ArrowDown')) dy -= 1;
  cameraCenter.x += dx * speed;
  cameraCenter.y += dy * speed;
  const bounds = worldToIso(game.width, game.height);
  const limitX = Math.abs((game.width + game.height) * TILE_W / 4);
  cameraCenter.x = Math.max(-limitX, Math.min(limitX, cameraCenter.x));
  cameraCenter.y = Math.max(bounds.y - TILE_H, Math.min(TILE_H * 2, cameraCenter.y));
}

// ---------------------------------------------------------------------------
// Command grid derived from the current selection and player resources.
function currentCommands(): CommandButton[] {
  const selection = ownSelected();
  const player = game.players[1];
  const buttons: CommandButton[] = [];
  if (buildMode) {
    return [{ id: 'cancel', label: 'Cancel placement', hotkey: 'escape', enabled: true, active: true }];
  }
  if (selection.some(e => e.kind === 'villager')) {
    for (const [index, kind] of buildableKinds().entries()) {
      const building = rules.buildings[kind];
      buttons.push({
        id: `build-${kind}`,
        label: `Build ${displayName(kind)} (${costLabel(building.cost)})`,
        hotkey: BUILD_HOTKEYS[index],
        enabled: affordable(building.cost),
        icon: hud.iconFor('Buildings', assets?.entities[kind]?.iconId),
      });
    }
  }
  if (selection.some(e => isUnit(e.kind))) {
    buttons.push({ id: 'stop', label: 'Stop', hotkey: 's', enabled: true });
  }
  // Every completed production building offers the units the rules train there.
  const producer = selection.find(e => isBuilding(e.kind) && e.buildProgress === undefined
    && trainableAt(e.kind as BuildingKind).length > 0);
  if (producer) {
    for (const [index, kind] of trainableAt(producer.kind as BuildingKind).entries()) {
      const unitRules = rules.units[kind];
      buttons.push({
        id: `train-${kind}`,
        label: `Train ${displayName(kind)} (${costLabel(unitRules.cost)})`,
        hotkey: TRAIN_HOTKEYS[index],
        enabled: !producer.training && affordable(unitRules.cost)
          && player.population < player.populationCap,
        icon: hud.iconFor('Units', assets?.entities[kind]?.iconId),
      });
    }
  }
  return buttons;
}

const BUILD_HOTKEYS = ['q', 'w', 'e', 'r', 't', 'a', 's', 'd', 'f', 'g', 'z', 'x'];
const TRAIN_HOTKEYS = ['q', 'w', 'e', 'r'];

const buildableKinds = (): BuildingKind[] =>
  (Object.keys(rules.buildings) as BuildingKind[]).filter(kind => rules.buildings[kind].buildable);

const trainableAt = (building: BuildingKind): UnitKind[] =>
  (Object.keys(rules.units) as UnitKind[]).filter(kind => rules.units[kind].trainedAt === building);

function affordable(cost: Cost): boolean {
  const player = game.players[1];
  return player.food >= cost.food && player.wood >= cost.wood
    && player.gold >= cost.gold && player.stone >= cost.stone;
}

function costLabel(cost: Cost): string {
  const parts = (['food', 'wood', 'gold', 'stone'] as const)
    .filter(resource => cost[resource] > 0)
    .map(resource => `${cost[resource]} ${resource}`);
  return parts.length ? parts.join(', ') : 'free';
}

function displayName(kind: string): string {
  return kind.split('-').map(part => part[0].toUpperCase() + part.slice(1)).join(' ');
}

function selectionInfo(): SelectionInfo | undefined {
  const selection = ownSelected().length ? ownSelected() : game.entities.filter(e => selectedIds.includes(e.id) && !e.dead);
  const entity = selection[0];
  if (!entity) return undefined;
  const names: Record<string, string> = { resource: 'Resource' };
  const name = entity.kind === 'resource'
    ? entity.resourceKind === 'food' ? 'Forage Bush' : entity.resourceKind === 'gold' ? 'Gold Mine' : 'Tree'
    : names[entity.kind] ?? displayName(entity.kind);
  const details: string[] = [];
  if (selection.length > 1) details.push(`${selection.length} selected`);
  if (entity.amount !== undefined) details.push(`${Math.floor(entity.amount)} ${entity.resourceKind}`);
  if (entity.carrying) details.push(`Carrying ${entity.carrying.amount} ${entity.carrying.kind}`);
  let progress: SelectionInfo['progress'];
  if (entity.buildProgress !== undefined) {
    progress = { label: 'Building', fraction: entity.buildProgress };
  } else if (entity.training) {
    const total = rules.units[entity.training.kind].trainSeconds / TICK_SECONDS;
    progress = {
      label: `Training ${entity.training.kind}`,
      fraction: 1 - entity.training.remainingTicks / total,
    };
  }
  const iconIndex = assets?.entities[view.entityKey(entity)]?.iconId;
  const category = isUnit(entity.kind) ? 'Units' : 'Buildings';
  return {
    name,
    icon: entity.kind !== 'resource' ? hud.iconFor(category, iconIndex) : undefined,
    hp: entity.hp,
    maxHp: entity.maxHp,
    details,
    progress,
  };
}

// ---------------------------------------------------------------------------
// Scene sync.
function entityVisible(entity: Entity): boolean {
  if (entity.owner === 1) return true;
  return isTileVisible(game, 1, entity.position.x, entity.position.y);
}

function syncScene(time: number): void {
  const wanted = new Set<string>();
  for (const entity of game.entities) {
    if (!entityVisible(entity)) continue;
    if (entity.owner === 0 && !isTileVisible(game, 1, entity.position.x, entity.position.y)) {
      // Gaia in unseen tiles is handled through memory below.
      continue;
    }
    const key = `e${entity.id}`;
    wanted.add(key);
    let entityView = views.get(key);
    // A herdable changes hands, and its player colour is bound into the view's
    // material when the view is built: a captured sheep needs a new one.
    if (entityView && entityView.owner !== entity.owner) {
      scene.remove(entityView.group);
      entityView = undefined;
    }
    if (!entityView) {
      entityView = view.createEntityView(assets, entity);
      views.set(key, entityView);
      scene.add(entityView.group);
    }
    view.updateEntityView(entityView, assets, game, entity, time);
  }
  // Remembered fogged entities render as static snapshots (fog dims them).
  for (const remembered of Object.values(game.visibility[1].memory)) {
    if (isTileVisible(game, 1, remembered.x, remembered.y)) continue;
    const key = `m${remembered.id}`;
    wanted.add(key);
    let entityView = views.get(key);
    if (!entityView) {
      const fake: Entity = {
        id: remembered.id, kind: remembered.kind, owner: remembered.owner,
        position: { x: remembered.x, y: remembered.y },
        hp: remembered.hp, maxHp: remembered.maxHp, radius: 0.5,
        activity: 'idle', order: { kind: 'idle' },
        resourceKind: remembered.resource, amount: remembered.amount,
      };
      entityView = view.createEntityView(assets, fake);
      view.updateEntityView(entityView, assets, game, fake, 0);
      views.set(key, entityView);
      scene.add(entityView.group);
    }
  }
  // Gather-point flags: AoE2 shows one where a selected building sends what it
  // trains, and only while that building is selected.
  for (const entity of game.entities) {
    if (entity.dead || !entity.rally || entity.owner !== 1) continue;
    if (!selectedIds.includes(entity.id)) continue;
    const key = `f${entity.id}`;
    wanted.add(key);
    let flagView = views.get(key);
    if (!flagView) {
      flagView = view.createFlagView(assets, entity.owner);
      views.set(key, flagView);
      scene.add(flagView.group);
    }
    view.updateFlagView(flagView, assets, entity.owner, entity.rally.target, time);
  }

  // Arrows in flight. They are simulation state, so they render from it
  // directly rather than being faked on the view side.
  for (const projectile of game.projectiles) {
    if (!isTileVisible(game, 1, projectile.position.x, projectile.position.y)) continue;
    const key = `p${projectile.id}`;
    wanted.add(key);
    const target = game.entities.find(e => e.id === projectile.targetId);
    const heading = target
      ? Math.atan2(target.position.y - projectile.position.y, target.position.x - projectile.position.x)
      : 0;
    // Progress along the shot, measured against the launch point so a moving
    // target still gives a sane 0..1 sweep.
    const flown = Math.hypot(
      projectile.position.x - projectile.origin.x,
      projectile.position.y - projectile.origin.y,
    );
    const left = target
      ? Math.hypot(target.position.x - projectile.position.x, target.position.y - projectile.position.y)
      : 0;
    const span = flown + left;
    const progress = span > 1e-6 ? flown / span : 0;
    let entityView = views.get(key);
    if (!entityView) {
      entityView = view.createProjectileView();
      views.set(key, entityView);
      scene.add(entityView.group);
    }
    view.updateProjectileView(
      entityView, assets, projectile.position, heading, progress, span, projectile.launchHeight,
    );
  }

  for (const [key, entityView] of views) {
    if (!wanted.has(key)) {
      scene.remove(entityView.group);
      views.delete(key);
    }
  }

  // Contours for units something else is drawing in front of, once every
  // piece this frame has been placed.
  view.updateOcclusion(views, game);

  // Selection rings from a reusable pool.
  while (ringPool.length < selectedIds.length) {
    const ring = new THREE.Mesh(
      ringGeometry,
      new THREE.MeshBasicMaterial({ color: 0xf5f0dc, transparent: true, depthTest: false, depthWrite: false }),
    );
    ring.renderOrder = 950;
    ringPool.push(ring);
    selectionRings.add(ring);
  }
  for (const [index, ring] of ringPool.entries()) {
    const entity = index < selectedIds.length
      ? game.entities.find(e => e.id === selectedIds[index] && !e.dead)
      : undefined;
    ring.visible = !!entity;
    if (!entity) continue;
    const iso = worldToIso(entity.position.x, entity.position.y);
    const radius = Math.max(0.4, entity.radius) * TILE_W * 0.75;
    ring.position.set(iso.x, iso.y, 0);
    ring.scale.set(radius / 50, radius / 50 * (TILE_H / TILE_W), 1);
  }

  // Placement preview.
  if (buildMode) {
    if (ghostKind !== buildMode) {
      disposeGhost();
      ghostKind = buildMode;
      ghostFootprint = view.createFootprint(rules.buildings[buildMode].radius);
      scene.add(ghostFootprint);
      ghostView = view.createEntityView(assets, ghostEntity(buildMode, pointerWorld));
      ghostView.group.renderOrder = 6000;
      scene.add(ghostView.group);
    }
    const target = placementTarget();
    const legal = placementLegal(game, buildMode, target).ok;
    const tint = legal ? 0x7fff9e : 0xff5f5f;
    const iso = worldToIso(target.x, target.y);
    ghostFootprint!.visible = true;
    ghostFootprint!.position.set(iso.x, iso.y, 0);
    (ghostFootprint!.material as THREE.MeshBasicMaterial).color.set(tint);

    // Draw the real building translucent and tinted, so its silhouette shows
    // exactly what will appear and whether the spot is legal.
    const preview = ghostEntity(buildMode, target);
    view.updateEntityView(ghostView!, assets, game, preview, time);
    ghostView!.group.visible = true;
    const ghostPieces = [
      ghostView!.body, ghostView!.shadow, ghostView!.color,
      ...ghostView!.annexes, ...ghostView!.annexColors,
    ];
    for (const mesh of ghostPieces.map(piece => piece.mesh)) {
      const material = mesh.material as THREE.MeshBasicMaterial;
      material.opacity = 0.55;
      material.color.set(tint);
      mesh.renderOrder = 6000;
    }
    if (ghostView!.patch) {
      const material = ghostView!.patch.material as THREE.MeshBasicMaterial;
      material.opacity = 0.55;
      material.color.set(tint);
      ghostView!.patch.renderOrder = 5950;
    }
  } else if (ghostKind) {
    disposeGhost();
  }
}

/** Where the pending building would actually land, snapped to the tile grid. */
function placementTarget(): Point {
  if (!buildMode) return pointerWorld;
  return snapPlacement(pointerWorld, rules.buildings[buildMode].radius);
}

function resize(): void {
  camera.left = -innerWidth / 2;
  camera.right = innerWidth / 2;
  camera.top = innerHeight / 2;
  camera.bottom = -innerHeight / 2;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}
addEventListener('resize', resize);
resize();

// Snapshot the live match so a full reload (a simulation edit, or any change
// HMR cannot accept) resumes instead of restarting. Reloads fire pagehide;
// visibilitychange also covers a tab being backgrounded and discarded.
const snapshot = (): void => { if (!replay) saveSession(game); };
addEventListener('pagehide', snapshot);
addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') snapshot(); });

let previous = performance.now();
let accumulator = 0;
let hudClock = 0;
let ended = false;

renderer.setAnimationLoop(now => {
  const elapsed = Math.min(0.1, (now - previous) / 1000);
  previous = now;
  panCamera(elapsed);

  if (!paused && !game.winner) {
    accumulator += elapsed;
    while (accumulator >= TICK_SECONDS) {
      if (replay) {
        if (game.tick >= replay.lastTick) { accumulator = 0; break; }
        while (replay.commands.length && replay.commands[0].tick === game.tick) {
          applyCommand(game, replay.commands.shift()!.command);
        }
        stepGame(game);
        const expected = replay.checksums.get(game.tick);
        if (expected !== undefined && !replay.failed) {
          if (checksumState(game) === expected) {
            replay.verified++;
          } else {
            replay.failed = true;
            hud.showMessage(`Replay desync at tick ${game.tick}`);
          }
        }
        if (game.tick === replay.lastTick && !replay.failed) {
          hud.showMessage(`Replay verified: ${replay.verified} checksums match`);
        }
      } else {
        stepGame(game);
        aiClock += TICK_SECONDS;
        if (aiClock >= 0.5) {
          for (const command of exampleAiCommands(observe(game, 2))) applyCommand(game, command);
          aiClock = 0;
        }
      }
      accumulator -= TICK_SECONDS;
    }
  }

  selectedIds = selectedIds.filter(id => game.entities.some(e => e.id === id && !e.dead));
  syncScene(gameTimeSeconds(game));
  fog.update(game);

  camera.position.set(cameraCenter.x, cameraCenter.y, 10);
  camera.zoom = zoom;
  camera.updateProjectionMatrix();

  hudClock += elapsed;
  if (hudClock > 0.15) {
    hudClock = 0;
    hud.updateResources(game, 1);
    hud.setCommands(currentCommands());
    hud.setSelection(selectionInfo());
    hud.minimap.draw(game, isoToWorld(cameraCenter.x, cameraCenter.y), {
      w: innerWidth / zoom / TILE_W * 1.2,
      h: innerHeight / zoom / TILE_H * 0.9,
    });
    if (game.winner && !ended) {
      ended = true;
      hud.showEnd(game.winner === 1);
    }
    if (!game.winner) ended = false;
  }

  renderer.render(scene, camera);
});

// ---------------------------------------------------------------------------
// Hot module replacement for the presentation layer.
//
// Rendering, animation, and HUD code is rebuilt from the live GameState so a
// visual fix lands in the match being played instead of restarting it. Edits to
// `src/sim`, `src/protocol`, `./view/iso`, or this file are not accepted here
// and fall through to Vite's default full reload: those either own or reshape
// authoritative state, and hot-patching them risks a silent divergence from
// what a deterministic replay of the same seed would produce.
function disposeMesh(mesh: THREE.Mesh): void {
  mesh.geometry.dispose();
  const material = mesh.material;
  if (Array.isArray(material)) material.forEach(entry => entry.dispose());
  else material.dispose();
}

/** Recreate every view-owned object from the current simulation state. */
function rebuildPresentation(): void {
  scene.remove(ground);
  disposeMesh(ground);
  ground = view.createGround(game, assets);
  scene.add(ground);

  scene.remove(fog.mesh);
  disposeMesh(fog.mesh);
  fog = view.createFog(game);
  scene.add(fog.mesh);
  fog.update(game);

  for (const entityView of views.values()) scene.remove(entityView.group);
  views.clear();
  disposeGhost();

  const menuWasOpen = hud.menuOpen;
  hud.destroy();
  hud = createHud();
  if (menuWasOpen) hud.toggleMenu(true);
  hud.updateResources(game, 1);
  hud.setCommands(currentCommands());
  hud.setSelection(selectionInfo());
  if (game.winner) hud.showEnd(game.winner === 1);

  syncScene(gameTimeSeconds(game));
}

if (import.meta.hot) {
  import.meta.hot.accept(
    ['./view/world', './view/sprites', './view/hud', './view/assets'],
    async ([world, sprites, hudModule, assetsModule]) => {
      if (assetsModule) {
        [assets, uiAssets, audioAssets] = await Promise.all([
          assetsModule.loadContentAssets(),
          assetsModule.loadUiAssets(),
          assetsModule.loadAudioAssets(),
        ]);
      }
      if (world) {
        view.createGround = world.createGround;
        view.createFog = world.createFog;
        view.createFootprint = world.createFootprint;
      }
      if (sprites) {
        view.createEntityView = sprites.createEntityView;
        view.updateEntityView = sprites.updateEntityView;
        view.createProjectileView = sprites.createProjectileView;
        view.updateProjectileView = sprites.updateProjectileView;
        view.createFlagView = sprites.createFlagView;
        view.updateFlagView = sprites.updateFlagView;
        view.updateOcclusion = sprites.updateOcclusion;
        view.entityKey = sprites.entityKey;
      }
      if (hudModule) view.Hud = hudModule.Hud;
      rebuildPresentation();
      const swapped = [
        assetsModule && 'assets', world && 'world', sprites && 'sprites', hudModule && 'hud',
      ].filter(Boolean).join(', ');
      console.info(`[hmr] rebuilt presentation (${swapped}) at tick ${game.tick}`);
    },
  );
}
