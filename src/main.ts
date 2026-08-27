import * as THREE from 'three/webgpu';
import './view/style.css';
import { exampleAiCommands } from './sim/ai';
import { observe } from './sim/observe';
import { applyCommand, buildingFootprint, createGame, gameTimeSeconds, isCarcass, placementLegal, stepGame } from './sim/game';
import { AGE_NAMES, FALLBACK_RULES, TICK_SECONDS, isAnimal, isBuilding, isUnit, rulesFromManifest, type ContentManifest, type Cost, type GameRules, type TechKey } from './sim/data';
import { isTileVisible } from './sim/visibility';
import { checksumState } from './sim/checksum';
import type { MatchRecord } from './protocol/types';
import type { BuildingKind, Entity, GameState, Point, UnitKind } from './sim/types';
import { clearSession, loadSession, saveSession } from './dev-session';
import { loadAudioAssets, loadContentAssets, loadUiAssets } from './view/assets';
import { worldToIso, isoToWorld, snapPlacement, wallLine, TILE_W, TILE_H } from './view/iso';
import { createEntityView, createFlagView, createProjectileView, updateEntityView, updateFlagView, updateProjectileView, updateOcclusion, entityKey, gateKey, type EntityView } from './view/sprites';
import { createGround, createFog, createFootprint, createSelectionOutline, updateSelectionOutline } from './view/world';
import { createCueWatcher, pollCues } from './view/cues';
import { Hud, type CommandButton, type SelectionInfo } from './view/hud';

/**
 * Mutable presentation bindings so Vite can hot-swap rendering, animation, and
 * HUD code into a running match (see the `import.meta.hot` block at the end of
 * this file). `src/sim` is deliberately excluded: patching tick logic into an
 * already-ticked GameState can silently diverge live state from what a
 * deterministic replay would produce, so simulation edits force a full reload.
 */
const view = {
  pollCues,
  createGround, createFog, createFootprint, createSelectionOutline, updateSelectionOutline,
  createEntityView, updateEntityView, createProjectileView, updateProjectileView,
  createFlagView, updateFlagView, updateOcclusion, entityKey, gateKey, Hud,
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
/**
 * How many game seconds pass per real second. The simulation's tick length is
 * fixed — determinism depends on it — so speed multiplies how much time the
 * frame loop hands the accumulator, and the game runs the same ticks, sooner.
 * Every DAT duration — a 25-second villager, a 130-second Feudal Age, a
 * villager's 0.31 food a second — is quoted in game seconds, so the multiplier
 * is the whole difference between the reference's pace and a slideshow.
 *
 * The reference ships four: `key-value-strings-utf8.txt` names them Slow,
 * Default, Fast and Extra Fast (20033..20036), and the lobby dropdown lists the
 * first three as Slow/Normal/Fast (13101..13103). The multipliers themselves
 * are engine constants in code we do not read, so the four values below come
 * from the community references recorded in `docs/status.md`; what the owned
 * files do settle is that there are four, and that the *second* is the
 * default — which is why the game no longer starts at 1x, the Slow setting.
 */
const GAME_SPEEDS: { label: string; multiplier: number }[] = [
  { label: 'Slow', multiplier: 1 },
  { label: 'Normal', multiplier: 1.5 },
  { label: 'Fast', multiplier: 1.7 },
  { label: 'Extra Fast', multiplier: 2 },
  // Past the original's own settings: fast-forward, for watching a match out
  // or for an automated pass. Not a claim about AoE2.
  { label: 'Fast-forward 5x', multiplier: 5 },
  { label: 'Fast-forward 10x', multiplier: 10 },
];
/** "Set Speed to Default" is the reference's own name for the second setting. */
const DEFAULT_SPEED = 1;
let speedIndex = DEFAULT_SPEED;
const gameSpeed = (): number => GAME_SPEEDS[speedIndex].multiplier;
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
const outlinePool: THREE.Mesh[] = [];
// The group must keep the default renderOrder: a Group's renderOrder becomes
// the sort's groupOrder, which outranks every child's renderOrder, and the
// entity sprites live in groups at 0. Only with the markers also at group
// order 0 does their meshes' 950 put them above shadows (500+) but under
// bodies (1000+), so a building covers the back of its own ground outline.
const selectionRings = new THREE.Group();
scene.add(selectionRings);
const SELECTION_COLOR = 0xf5f0dc;

/**
 * What a selection draws under an entity, as the DAT's obstruction shape has
 * it: the round outline under a unit, the outline box on the ground under a
 * building or resource. The box is the manifest's own `outline_size` — often a
 * shade larger than the collision box — falling back to the sim footprint for
 * the open-content skin. A gate is two DAT units, one per axis, so the turned
 * one carries the swapped box.
 *
 * A carcass takes the shape of the DAT's own corpse unit rather than the live
 * animal's: `BOARX_D` obstructs nothing where `BOARX` obstructs like a unit, so
 * what was a ring around an animal becomes a flat box over what is left of it.
 */
function selectionMarker(entity: Entity): { shape: 'round' | 'square'; half: { x: number; y: number } } {
  const key = entity.kind === 'palisade-gate' ? view.gateKey(entity) : view.entityKey(entity);
  const entry = assets?.entities[key]?.selection;
  const imported = entity.dead ? entry?.dead ?? entry : entry;
  const shape = imported?.shape ?? (isUnit(entity.kind) ? 'round' : 'square');
  const half = imported && shape === 'square'
    ? { x: imported.outline[0], y: imported.outline[1] }
    : entity.footprint ?? { x: entity.radius, y: entity.radius };
  return { shape, half };
}

/**
 * An enemy told to expect company flashes its own marker: the confirmation of
 * which of them a group was just sent at, which is the one case a player
 * cannot read off the board for themselves. Gaia and your own things do not —
 * a tree, a bush or your own mill blinking on every right-click is noise over
 * the question this exists to answer. That it happens is the reference; the
 * cadence and colour are not in
 * the owned files (the DAT's `unit_selection_color_1/2` exist but hold unused
 * palette index 0, and widgetui names no such widget — the behaviour lives in
 * the closed runtime), so both are approximated and recorded in
 * `docs/status.md`. Timed on the game clock like every other view animation.
 */
const ORDER_FLASH_PERIOD_SECONDS = 0.2;
const ORDER_FLASH_TOTAL_SECONDS = 1.2;
let orderFlash: { entityId: number; startedAt: number } | undefined;

/** Somebody else's: not this player's, and not gaia's trees and animals. */
const isHostile = (entity: Entity): boolean => entity.owner !== 0 && entity.owner !== 1;

/**
 * Placement preview: the building's own art where it will stand, over the tile
 * square it will occupy. Rebuilt whenever the chosen building changes, since
 * footprint size and sprite both depend on it.
 */
let ghostKind: BuildingKind | undefined;
/** The pending footprint, so a gate turning rebuilds the preview mesh. */
let ghostShape: string | undefined;
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

/**
 * A unit's own voice, from the DAT's Wwise ids. AoE2 answers both a selection
 * and an order with the same voice set, and the DAT carries one voice set for
 * the unit, so this plays for both.
 */
function playUnitSound(kind: string, cue: 'select' | 'train'): void {
  playSound(`${kind}-${cue}`);
}

/** One voice for a selection or an order, from the first owned unit in it. */
function acknowledge(): void {
  const unit = ownSelected().find(e => isUnit(e.kind));
  if (unit) playUnitSound(unit.kind, 'select');
}

/** A stand-in entity so the preview reuses the normal building rendering. */
function ghostEntity(kind: BuildingKind, at: Point): Entity {
  return {
    id: 0, kind, owner: 1, position: at,
    hp: 1, maxHp: 1, radius: rules.buildings[kind].radius,
    activity: 'idle', order: { kind: 'idle' },
    ...(rules.buildings[kind].footprint
      ? { footprint: buildingFootprint(game, kind, orientationOf(kind, at)) }
      : {}),
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
  ghostShape = undefined;
}

/** A rejected command, reported and sounded the way the game does. */
function reject(reason: string): void {
  hud.showMessage(reason);
  playSound('error');
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
    flashTarget: () => orderFlash?.entityId,
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
    const kind = id.slice('build-'.length) as BuildingKind;
    if (kind === buildMode && rules.buildings[kind].footprint) {
      gateOrientation = gateOrientation === 'x' ? 'y' : 'x';
    }
    buildMode = kind;
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
    if (!result.ok) reject(result.reason);
    return;
  }
  if (id.startsWith('research-')) {
    const tech = id.slice('research-'.length);
    const at = rules.technologies[tech as TechKey]?.researchedAt;
    const building = selection.find(e => e.kind === at && e.buildProgress === undefined);
    if (!building) return;
    const result = applyCommand(game, { kind: 'research', player: 1, buildingId: building.id, tech });
    if (!result.ok) reject(result.reason);
    return;
  }
  if (id === 'page-economic') { buildPage = 'economic'; return; }
  if (id === 'page-military') { buildPage = 'military'; return; }
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
    // A carcass is still food, and a player is entitled to click it and read
    // how much is left; a corpse with nothing on it stays unclickable, so a
    // battlefield of dead soldiers never gets in the way of the living.
    if (entity.dead && !isCarcass(entity)) continue;
    if (entity.owner !== 1 && entity.owner !== 0 && !isTileVisible(game, 1, entity.position.x, entity.position.y)) continue;
    // Nearest to the click wins, carcass or not. Preferring the living sounds
    // reasonable and is not: villagers eating a carcass stand right on it, so
    // any bias at all puts the corpse back out of reach, which is the bug.
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
/** A building placed one tile at a time along a dragged line, as AoE2 walls are. */
const isWall = (kind: BuildingKind): boolean => kind === 'palisade-wall';
let wallStart: Point | undefined;

/**
 * Which way the pending gate lies. AoE2 turns a gate to the wall it is going
 * into, so the run under the cursor decides it; picking the gate again while it
 * is already pending turns it by hand, for a gate with no wall to follow yet.
 */
let gateOrientation: 'x' | 'y' = 'x';

function orientationOf(kind: BuildingKind, at: Point): 'x' | 'y' {
  if (!rules.buildings[kind].footprint) return 'x';
  const joins = (dx: number, dy: number) => game.entities.some(e => !e.dead && e.owner === 1
    && e.kind === 'palisade-wall'
    && Math.abs(e.position.x - (at.x + dx)) < 0.6 && Math.abs(e.position.y - (at.y + dy)) < 0.6);
  if (joins(-1.5, 0) || joins(1.5, 0)) return 'x';
  if (joins(0, -1.5) || joins(0, 1.5)) return 'y';
  return gateOrientation;
}

function placeBuilding(kind: BuildingKind, targets: Point[]): void {
  const builders = ownSelected().filter(e => e.kind === 'villager').map(e => e.id);
  if (!builders.length) { reject('Select a villager first'); return; }
  let failure: string | undefined;
  for (const target of targets) {
    const result = applyCommand(game, {
      kind: 'build', player: 1, builderIds: builders, building: kind, target,
      orientation: orientationOf(kind, target),
    });
    if (!result.ok) failure ??= result.reason;
  }
  if (failure) reject(failure);
}

renderer.domElement.addEventListener('pointerdown', event => {
  const point = screenToWorld(event.clientX, event.clientY);
  if (event.button === 0) {
    if (buildMode && isWall(buildMode) && !replay) {
      // A wall is dragged: the first press only anchors the line.
      wallStart = snapPlacement(point, rules.buildings[buildMode].radius);
      return;
    }
    if (buildMode && !replay) {
      // Commit exactly where the preview showed it, not the raw cursor point.
      placeBuilding(buildMode, [placementTarget()]);
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
  if (event.button === 0 && wallStart && buildMode) {
    const end = screenToWorld(event.clientX, event.clientY);
    placeBuilding(buildMode, wallLine(wallStart, end, rules.buildings[buildMode].radius));
    wallStart = undefined;
    buildMode = undefined;
    return;
  }
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
  acknowledge();
});

function contextOrder(point: Point, _clientX: number, _clientY: number): void {
  if (replay) return; // spectating: inputs must not perturb the command stream
  const selection = ownSelected();
  const target = pickEntity(point);
  const units = selection.filter(e => isUnit(e.kind));
  if (units.length) {
    const targetId = target && target.id !== units[0].id ? target.id : undefined;
    const result = applyCommand(game, {
      kind: 'order', player: 1, entityIds: units.map(e => e.id),
      target: point, targetId,
    });
    if (!result.ok) reject(result.reason);
    else {
      acknowledge();
      // Only somebody else's: the flash says "this is what you just told them
      // to attack", so firing it on a tree, a bush or your own mill is noise
      // over the one case it exists to answer.
      if (target && isHostile(target)) {
        orderFlash = { entityId: target.id, startedAt: gameTimeSeconds(game) };
      }
    }
    return;
  }
  // Defensive buildings take a target the same way units do — but a castle
  // both shoots and trains, and in AoE2 a right-click on the ground with one
  // selected plants its gather point. So the shot is what a click on somebody
  // hostile means, and everything else is the flag (issue #8).
  const hostile = target !== undefined && isHostile(target);
  const towers = selection.filter(e => rules.buildings[e.kind as BuildingKind]?.attack
    && e.buildProgress === undefined
    && (hostile || trainableAt(e.kind as BuildingKind).length === 0));
  if (towers.length) {
    const result = applyCommand(game, {
      kind: 'order', player: 1, entityIds: towers.map(e => e.id),
      target: point, targetId: hostile ? target!.id : undefined,
    });
    if (!result.ok) reject(result.reason);
    else {
      hud.showMessage(hostile ? 'Target set' : 'Target cleared');
      if (hostile) orderFlash = { entityId: target!.id, startedAt: gameTimeSeconds(game) };
    }
    return;
  }
  // Any building that trains something takes a gather point, which is the
  // rule rather than the two buildings that happened to train units first.
  const building = selection.find(e => isBuilding(e.kind) && e.buildProgress === undefined
    && trainableAt(e.kind as BuildingKind).length > 0);
  if (building) {
    applyCommand(game, { kind: 'rally', player: 1, buildingId: building.id, target: point, targetId: target?.id });
    hud.showMessage('Rally point set');
    playSound('gatherpoint_set');
  }
}

/**
 * Units this player has that were not there a frame ago. Owned units are
 * always visible, so a new id is one that finished training.
 */
const cueWatcher = createCueWatcher();
let knownOwnUnits = new Set<number>();
function announceTrained(): void {
  const current = new Set<number>();
  for (const entity of game.entities) {
    if (entity.dead || entity.owner !== 1 || !isUnit(entity.kind)) continue;
    current.add(entity.id);
    if (knownOwnUnits.size && !knownOwnUnits.has(entity.id)) playUnitSound(entity.kind, 'train');
  }
  knownOwnUnits = current;
}

// Keyboard: camera, hotkeys, menu.
const heldKeys = new Set<string>();
addEventListener('keydown', event => {
  const key = event.key;
  if (key.startsWith('Arrow')) { heldKeys.add(key); event.preventDefault(); return; }
  if (key === 'Escape') {
    if (buildMode) { buildMode = undefined; wallStart = undefined; }
    else if (hud.menuOpen) hud.toggleMenu(false);
    else hud.toggleMenu(true);
    return;
  }
  if (key === 'F3') { paused = !paused; event.preventDefault(); return; }
  // AoE2's own speed keys. `=` and `_` come along because `+` and `-` are the
  // shifted faces of those keys on most layouts, and the numpad sends the
  // signs directly. Ctrl and Cmd are left alone: that is the browser's zoom.
  if (!event.ctrlKey && !event.metaKey && ['+', '=', '-', '_'].includes(key)) {
    const faster = key === '+' || key === '=';
    const next = Math.max(0, Math.min(GAME_SPEEDS.length - 1, speedIndex + (faster ? 1 : -1)));
    const setting = GAME_SPEEDS[next];
    if (next !== speedIndex) {
      speedIndex = next;
      hud.showMessage(`Game speed: ${setting.label}`);
    } else {
      hud.showMessage(faster
        ? `Game speed: ${setting.label} (fastest)`
        : `Game speed: ${setting.label} (slowest)`);
    }
    event.preventDefault();
    return;
  }
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
    // The other page of the build menu, as AoE2 splits it.
    const other = buildPage === 'economic' ? 'military' : 'economic';
    buttons.push({
      id: `page-${other}`,
      label: `${displayName(other)} buildings`,
      hotkey: BUILD_PAGE_HOTKEY,
      enabled: true,
    });
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
  // Technologies the selected building researches, in the DAT's own order.
  const player1 = game.players[1];
  for (const [key, tech] of Object.entries(rules.technologies) as [TechKey, typeof rules.technologies[TechKey]][]) {
    const building = selection.find(e => e.kind === tech.researchedAt && e.buildProgress === undefined);
    if (!building) continue;
    if (player1.researched.includes(key)) continue;
    if (player1.age < tech.requiresAge) continue;
    buttons.push({
      id: `research-${key}`,
      label: `Research ${tech.name} (${costLabel(tech.cost)})`,
      enabled: !building.researching && affordable(tech.cost),
    });
  }
  return buttons;
}

const BUILD_HOTKEYS = ['q', 'w', 'e', 'r', 't', 'a', 'd', 'f', 'g', 'z', 'x', 'c'];
const BUILD_PAGE_HOTKEY = 'v';
const TRAIN_HOTKEYS = ['q', 'w', 'e', 'r', 't'];

/**
 * AoE2 splits the villager's build menu into an economic and a military page,
 * which is what keeps it inside the command panel's fifteen slots — seventeen
 * buildings do not fit. The split is the reference game's own; the DAT's
 * `interface_kind` is a different grouping and does not state it (see
 * `docs/status.md`).
 */
const MILITARY_BUILDINGS = new Set<BuildingKind>([
  'barracks', 'archery-range', 'stable', 'blacksmith', 'monastery', 'siege-workshop',
  'castle', 'outpost', 'watch-tower', 'palisade-wall', 'palisade-gate',
]);
let buildPage: 'economic' | 'military' = 'economic';

const buildableKinds = (): BuildingKind[] =>
  (Object.keys(rules.buildings) as BuildingKind[]).filter(kind =>
    rules.buildings[kind].buildable && (rules.buildings[kind].age ?? 0) <= game.players[1].age
    && MILITARY_BUILDINGS.has(kind) === (buildPage === 'military'));

const trainableAt = (building: BuildingKind): UnitKind[] =>
  (Object.keys(rules.units) as UnitKind[]).filter(kind =>
    rules.units[kind].trainedAt === building && (rules.units[kind].age ?? 0) <= game.players[1].age
    && !isAnimal(kind));

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
  const selection = ownSelected().length
    ? ownSelected()
    : game.entities.filter(e => selectedIds.includes(e.id) && (!e.dead || isCarcass(e)));
  const entity = selection[0];
  if (!entity) return undefined;
  const names: Record<string, string> = { resource: 'Resource', boar: 'Wild Boar' };
  const name = entity.kind === 'resource'
    ? entity.resourceKind === 'food' ? 'Forage Bush' : entity.resourceKind === 'gold' ? 'Gold Mine' : 'Tree'
    : names[entity.kind] ?? displayName(entity.kind);
  const details: string[] = [];
  if (selection.length > 1) details.push(`${selection.length} selected`);
  if (entity.kind === 'town-center' && entity.owner === 1) details.push(AGE_NAMES[game.players[1].age]);
  if (entity.amount !== undefined) details.push(`${Math.floor(entity.amount)} ${entity.resourceKind}`);
  if (entity.carrying) details.push(`Carrying ${entity.carrying.amount} ${entity.carrying.kind}`);
  let progress: SelectionInfo['progress'];
  if (entity.buildProgress !== undefined) {
    progress = { label: 'Building', fraction: entity.buildProgress };
  } else if (entity.researching) {
    const tech = rules.technologies[entity.researching.tech as TechKey];
    const total = tech.researchSeconds / TICK_SECONDS;
    progress = {
      label: `Researching ${tech.name}`,
      fraction: 1 - entity.researching.remainingTicks / total,
    };
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
    // A carcass shows no health: the DAT's corpse unit has none, and what a
    // player wants off it is the food still on it, which `details` carries.
    ...(isCarcass(entity) ? {} : { hp: entity.hp, maxHp: entity.maxHp }),
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
      // The stone is the only shot in flight that carries a blast, so what it
      // does on landing is also what says which art to draw it with.
      projectile.blastRadius ? 'mangonel-stone' : 'arrow',
    );
  }

  for (const [key, entityView] of views) {
    if (!wanted.has(key)) {
      scene.remove(entityView.group);
      views.delete(key);
    }
  }

  announceTrained();
  // Alerts and feedback, read out of what the view can already see. The
  // simulation never raises them: it does not know about sound.
  for (const cue of view.pollCues(cueWatcher, game, 1, gameTimeSeconds(game))) playSound(cue);

  // Contours for units something else is drawing in front of, once every
  // piece this frame has been placed.
  view.updateOcclusion(views, game);

  // Selection markers from reusable pools: rings under units, footprint
  // outlines on the ground under buildings and resources (`selectionMarker`).
  let ringsUsed = 0;
  let outlinesUsed = 0;
  const drawMarker = (entity: Entity): void => {
    const marker = selectionMarker(entity);
    const iso = worldToIso(entity.position.x, entity.position.y);
    if (marker.shape === 'round') {
      if (ringsUsed === ringPool.length) {
        const ring = new THREE.Mesh(
          ringGeometry,
          new THREE.MeshBasicMaterial({ color: SELECTION_COLOR, transparent: true, depthTest: false, depthWrite: false }),
        );
        ring.renderOrder = 950;
        ringPool.push(ring);
        selectionRings.add(ring);
      }
      const ring = ringPool[ringsUsed++];
      ring.visible = true;
      const radius = Math.max(0.4, entity.radius) * TILE_W * 0.75;
      ring.position.set(iso.x, iso.y, 0);
      ring.scale.set(radius / 50, radius / 50 * (TILE_H / TILE_W), 1);
    } else {
      if (outlinesUsed === outlinePool.length) {
        const outline = view.createSelectionOutline(SELECTION_COLOR);
        outline.renderOrder = 950;
        outlinePool.push(outline);
        selectionRings.add(outline);
      }
      const outline = outlinePool[outlinesUsed++];
      outline.visible = true;
      view.updateSelectionOutline(outline, marker.half);
      outline.position.set(iso.x, iso.y, 0);
    }
  };
  for (const id of selectedIds) {
    const entity = game.entities.find(e => e.id === id && (!e.dead || isCarcass(e)));
    if (entity) drawMarker(entity);
  }
  // The last order's clicked target blinks its marker (see `orderFlash`).
  if (orderFlash) {
    const elapsed = time - orderFlash.startedAt;
    const entity = game.entities.find(e => e.id === orderFlash!.entityId && (!e.dead || isCarcass(e)));
    if (elapsed >= ORDER_FLASH_TOTAL_SECONDS || !entity) orderFlash = undefined;
    else if (Math.floor(elapsed / ORDER_FLASH_PERIOD_SECONDS) % 2 === 0) drawMarker(entity);
  }
  for (let index = ringsUsed; index < ringPool.length; index++) ringPool[index].visible = false;
  for (let index = outlinesUsed; index < outlinePool.length; index++) outlinePool[index].visible = false;

  // Placement preview.
  if (buildMode) {
    const shape = buildingFootprint(game, buildMode, orientationOf(buildMode, placementTarget()));
    if (ghostKind !== buildMode || ghostShape !== `${shape.x},${shape.y}`) {
      disposeGhost();
      ghostKind = buildMode;
      ghostShape = `${shape.x},${shape.y}`;
      ghostFootprint = view.createFootprint(shape);
      scene.add(ghostFootprint);
      ghostView = view.createEntityView(assets, ghostEntity(buildMode, pointerWorld));
      ghostView.group.renderOrder = 6000;
      scene.add(ghostView.group);
    }
    const target = placementTarget();
    const legal = placementLegal(game, buildMode, target, orientationOf(buildMode, target)).ok;
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
  updateWallPreview();
}

/**
 * The tiles a wall drag would fill, each tinted by whether it could stand
 * there. A single ghost would say nothing about the length of the line.
 */
const wallGhosts: THREE.Mesh[] = [];
function updateWallPreview(): void {
  const tiles = buildMode && wallStart && isWall(buildMode)
    ? wallLine(wallStart, pointerWorld, rules.buildings[buildMode].radius)
    : [];
  while (wallGhosts.length < tiles.length) {
    const mesh = view.createFootprint(rules.buildings['palisade-wall'].radius);
    mesh.renderOrder = 5900;
    wallGhosts.push(mesh);
    scene.add(mesh);
  }
  for (const [index, mesh] of wallGhosts.entries()) {
    const tile = tiles[index];
    mesh.visible = tile !== undefined;
    if (!tile) continue;
    const iso = worldToIso(tile.x, tile.y);
    mesh.position.set(iso.x, iso.y, 0);
    const legal = placementLegal(game, buildMode!, tile).ok;
    (mesh.material as THREE.MeshBasicMaterial).color.set(legal ? 0x7fff9e : 0xff5f5f);
  }
}

/** Where the pending building would actually land, snapped to the tile grid. */
function placementTarget(): Point {
  if (!buildMode) return pointerWorld;
  const rough = snapPlacement(pointerWorld, rules.buildings[buildMode].radius);
  return snapPlacement(pointerWorld, buildingFootprint(game, buildMode, orientationOf(buildMode, rough)));
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
let shownAge = game.players[1].age;

renderer.setAnimationLoop(now => {
  const elapsed = Math.min(0.1, (now - previous) / 1000);
  previous = now;
  panCamera(elapsed);

  if (game.players[1].age !== shownAge) {
    shownAge = game.players[1].age;
    hud.showMessage(`Advancing to the ${AGE_NAMES[shownAge]}`);
  }

  if (!paused && !game.winner) {
    // `elapsed` is already capped at 0.1s, so a frame runs at most the fastest
    // setting's multiplier over `TICK_SECONDS` ticks: a machine that cannot
    // keep up falls behind real time rather than spiralling.
    accumulator += elapsed * gameSpeed();
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

  // A selection outlives its entity's death only while there is still food on
  // it: the carcass a player clicked stays selected until it is eaten or rots.
  selectedIds = selectedIds.filter(id =>
    game.entities.some(e => e.id === id && (!e.dead || isCarcass(e))));
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
      if (sprites) view.pollCues = (await import('./view/cues')).pollCues;
      if (hudModule) view.Hud = hudModule.Hud;
      rebuildPresentation();
      const swapped = [
        assetsModule && 'assets', world && 'world', sprites && 'sprites', hudModule && 'hud',
      ].filter(Boolean).join(', ');
      console.info(`[hmr] rebuilt presentation (${swapped}) at tick ${game.tick}`);
    },
  );
}
