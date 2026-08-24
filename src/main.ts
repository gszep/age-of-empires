import * as THREE from 'three/webgpu';
import './view/style.css';
import { exampleAiCommands } from './sim/ai';
import { observe } from './sim/observe';
import { applyCommand, createGame, gameTimeSeconds, placementLegal, stepGame } from './sim/game';
import { FALLBACK_RULES, TICK_SECONDS, rulesFromManifest, type ContentManifest, type GameRules } from './sim/data';
import { isTileVisible } from './sim/visibility';
import { checksumState } from './sim/checksum';
import type { MatchRecord } from './protocol/types';
import type { BuildingKind, Entity, GameState, Point } from './sim/types';
import { clearSession, loadSession, saveSession } from './dev-session';
import { loadContentAssets, loadUiAssets } from './view/assets';
import { worldToIso, isoToWorld, TILE_W, TILE_H } from './view/iso';
import { createEntityView, updateEntityView, entityKey, type EntityView } from './view/sprites';
import { createGround, createFog } from './view/world';
import { Hud, type CommandButton, type SelectionInfo } from './view/hud';

/**
 * Mutable presentation bindings so Vite can hot-swap rendering, animation, and
 * HUD code into a running match (see the `import.meta.hot` block at the end of
 * this file). `src/sim` is deliberately excluded: patching tick logic into an
 * already-ticked GameState can silently diverge live state from what a
 * deterministic replay would produce, so simulation edits force a full reload.
 */
const view = { createGround, createFog, createEntityView, updateEntityView, entityKey, Hud };

const app = document.querySelector<HTMLDivElement>('#app')!;

const renderer = new THREE.WebGPURenderer({ antialias: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.domElement.classList.add('battlefield');
app.appendChild(renderer.domElement);
await renderer.init();

let [assets, uiAssets] = await Promise.all([loadContentAssets(), loadUiAssets()]);
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

// Building placement ghost.
const ghost = new THREE.Mesh(
  new THREE.PlaneGeometry(1, 1),
  new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.4, depthTest: false, depthWrite: false }),
);
ghost.visible = false;
ghost.renderOrder = 6000;
scene.add(ghost);
let pointerWorld: Point = { x: 16, y: 9 };

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
  });
}

let hud = createHud();

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
  if (id === 'build-house' || id === 'build-barracks') {
    buildMode = id === 'build-house' ? 'house' : 'barracks';
    return;
  }
  if (id === 'stop') {
    if (selection.length) applyCommand(game, { kind: 'stop', player: 1, entityIds: selection.map(e => e.id) });
    return;
  }
  if (id === 'train-villager' || id === 'train-militia') {
    const building = selection.find(e => e.kind === (id === 'train-villager' ? 'town-center' : 'barracks'));
    if (!building) return;
    const result = applyCommand(game, {
      kind: 'train', player: 1, buildingId: building.id,
      unit: id === 'train-villager' ? 'villager' : 'militia',
    });
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
      const result = builder
        ? applyCommand(game, { kind: 'build', player: 1, builderIds: ownSelected().filter(e => e.kind === 'villager').map(e => e.id), building: buildMode, target: point })
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
      !e.dead && e.owner === 1 && (e.kind === 'villager' || e.kind === 'militia') &&
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
  const units = selection.filter(e => e.kind === 'villager' || e.kind === 'militia');
  if (units.length) {
    const result = applyCommand(game, {
      kind: 'order', player: 1, entityIds: units.map(e => e.id),
      target: point, targetId: target && target.id !== units[0].id ? target.id : undefined,
    });
    if (!result.ok) hud.showMessage(result.reason);
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
    buttons.push({
      id: 'build-house', label: 'Build House (25 wood)', hotkey: 'q', enabled: player.wood >= rules.buildings.house.cost.wood,
      icon: hud.iconFor('Buildings', 34),
    });
    buttons.push({
      id: 'build-barracks', label: 'Build Barracks (175 wood)', hotkey: 'w', enabled: player.wood >= rules.buildings.barracks.cost.wood,
      icon: hud.iconFor('Buildings', 2),
    });
  }
  if (selection.some(e => e.kind === 'villager' || e.kind === 'militia')) {
    buttons.push({ id: 'stop', label: 'Stop', hotkey: 's', enabled: true });
  }
  const tc = selection.find(e => e.kind === 'town-center' && e.buildProgress === undefined);
  if (tc) {
    buttons.push({
      id: 'train-villager', label: 'Train Villager (50 food)', hotkey: 'q',
      enabled: !tc.training && player.food >= rules.units.villager.cost.food && player.population < player.populationCap,
      icon: hud.iconFor('Units', 15),
    });
  }
  const barracks = selection.find(e => e.kind === 'barracks' && e.buildProgress === undefined);
  if (barracks) {
    buttons.push({
      id: 'train-militia', label: 'Train Militia (50 food, 20 gold)', hotkey: 'q',
      enabled: !barracks.training && player.food >= rules.units.militia.cost.food && player.gold >= rules.units.militia.cost.gold && player.population < player.populationCap,
      icon: hud.iconFor('Units', 8),
    });
  }
  return buttons;
}

function selectionInfo(): SelectionInfo | undefined {
  const selection = ownSelected().length ? ownSelected() : game.entities.filter(e => selectedIds.includes(e.id) && !e.dead);
  const entity = selection[0];
  if (!entity) return undefined;
  const names: Record<string, string> = {
    villager: 'Villager', militia: 'Militia', 'town-center': 'Town Center',
    barracks: 'Barracks', house: 'House', resource: 'Resource',
  };
  const name = entity.kind === 'resource'
    ? entity.resourceKind === 'food' ? 'Forage Bush' : entity.resourceKind === 'gold' ? 'Gold Mine' : 'Tree'
    : names[entity.kind];
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
  const category = entity.kind === 'villager' || entity.kind === 'militia' ? 'Units' : 'Buildings';
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
  for (const [key, entityView] of views) {
    if (!wanted.has(key)) {
      scene.remove(entityView.group);
      views.delete(key);
    }
  }

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

  // Placement ghost.
  if (buildMode) {
    const half = rules.buildings[buildMode].radius;
    const legal = placementLegal(game, buildMode, pointerWorld).ok;
    const iso = worldToIso(pointerWorld.x, pointerWorld.y);
    ghost.visible = true;
    ghost.position.set(iso.x, iso.y, 0);
    ghost.scale.set(half * 2 * TILE_W, half * 2 * TILE_H, 1);
    (ghost.material as THREE.MeshBasicMaterial).color.set(legal ? 0x7fff9e : 0xff5f5f);
  } else {
    ghost.visible = false;
  }
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
        [assets, uiAssets] = await Promise.all([
          assetsModule.loadContentAssets(),
          assetsModule.loadUiAssets(),
        ]);
      }
      if (world) {
        view.createGround = world.createGround;
        view.createFog = world.createFog;
      }
      if (sprites) {
        view.createEntityView = sprites.createEntityView;
        view.updateEntityView = sprites.updateEntityView;
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
