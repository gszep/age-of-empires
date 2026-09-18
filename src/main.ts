import * as THREE from 'three/webgpu';
import './view/style.css';
import { exampleAiCommands } from './sim/ai';
import { observe } from './sim/observe';
import { TRAINING_QUEUE_LIMIT, applyCommand, buildingFootprint, createGame, gameTimeSeconds, isCarcass, isRepairable, placementLegal, queuedCount, shortfall, stepGame, upgradedAway, notYetUpgradedInto } from './sim/game';
import { AGE_NAMES, FALLBACK_RULES, TICK_SECONDS, isAnimal, isBuilding, isUnit, rulesFromManifest, type AttackValue, type ContentManifest, type Cost, type GameRules, type TechKey, type UnitRules } from './sim/data';
import { MAPS } from './sim/mapgen';
import { isTileVisible } from './sim/visibility';
import { checksumState } from './sim/checksum';
import type { MatchRecord } from './protocol/types';
import type { BuildingKind, Entity, GameState, PlayerId, Point, UnitKind } from './sim/types';
import { buildMenu, type BuildPage } from './view/build-menu';
import { sameKindOnScreen } from './view/selection';
import { clearSession, loadSession, saveSession } from './dev-session';
import { loadAudioAssets, loadContentAssets, loadUiAssets } from './view/assets';
import { worldToIso, isoToWorld, snapPlacement, wallLine, TILE_W, TILE_H } from './view/iso';
import { buildingRulesFor, unitRulesFor } from './sim/rules';
import { gridKey, placeCommands } from './view/command-grid';
import type { ResourceStatus, ScoreRow } from './view/hud';
import { costLabel, displayName as nameFrom, plainHelp } from './view/names';
import { artKey, chooseAnimation, createEntityView, gatherTargetResource, playerColorHex, createFlagView, createProjectileView, updateEntityView, updateFlagView, updateProjectileView, updateOcclusion, entityKey, gateBoxKey, type EntityView } from './view/sprites';
import { createGround, createFog, createFootprint, createSelectionOutline, updateSelectionOutline, elevatedWorldToIso, elevationAt, ELEVATION_PIXELS } from './view/world';
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
  createFlagView, updateFlagView, updateOcclusion, entityKey, gateBoxKey, Hud,
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
/** The reference's own words for a refused order, from its strings file (issue #70). */
let messages: Record<string, string> = {};
try {
  const response = await fetch('/imported/aoe2/manifest.json');
  if (response.ok) {
    const manifest = await response.json() as ContentManifest & { strings?: Record<string, string> };
    rules = rulesFromManifest(manifest);
    messages = manifest.strings ?? {};
  }
} catch { /* open fallback rules */ }

// Which map type the page deals: ?map=black-forest, ?map=senlac,
// ?map=windsor, ?map=painted-proof, or nothing for arabia. An unknown name falls back
// rather than killing the page, and asking for a map explicitly means a
// fresh board of it -- not whatever match a dev-session snapshot resumes.
const pageParams = new URLSearchParams(location.search);
const mapParam = pageParams.get('map');
const mapType = mapParam !== null && mapParam in MAPS ? mapParam : 'arabia';
if (mapParam !== null && mapType !== mapParam) {
  console.warn(`[map] unknown map type '${mapParam}', dealing arabia`);
}
// And which board of it: ?seed=3 deals that seed, on load and again on New
// Match, so a board somebody is looking at can be named. Like ?map=, asking
// for one means a fresh board rather than a resumed session.
const seedParam = Number(pageParams.get('seed'));
const seedFixed = Number.isInteger(seedParam) && seedParam > 0 ? seedParam : undefined;

const restored = mapParam === null && seedFixed === undefined ? loadSession(rules) : undefined;
let game = restored ?? createGame(seedFixed ?? 42, rules, undefined, mapType);
if (restored) console.info(`[dev] resumed match at tick ${restored.tick}; menu restart starts a new one`);
let selectedIds: number[] = [];
let buildMode: BuildingKind | undefined;
/** The villager's Repair button is down: the next click names what to mend. */
let repairMode = false;
let paused = false;
/**
 * Debug: draw the whole board as if seen. Strictly a view-side override --
 * the simulation's visibility, the observation and every checksum are
 * untouched, so a revealed match replays identically to a fogged one.
 */
let revealMap = false;
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
/**
 * Indices into the reference's action-icon sheet (`IconAction###`), which its
 * own `buttons.json` numbers -- the town bell is 49, the gather-point flag 45
 * -- and which laying the imported `ui/textures/ingame/actions/` sheet out
 * with its numbers confirms: the red cross, the open palm, the economic and
 * military hammers, the packed wagon and the set-up engine, and the
 * farm-reseed ring lit and unlit.
 */
const ACTION_ICON = {
  cancel: 0, ungarrison: 2, stop: 3, pack: 12, unpack: 13, buildEconomic: 30, buildMilitary: 31, repair: 33,
  reseedOn: 70, reseedOff: 71,
} as const;

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
  // A record from before civilisations were written down replays as whatever
  // the content is for, which is what it was played as.
  game = createGame(record.seed, rules, record.civilizations, record.map ?? 'arabia');
  cameraCenter = homeCamera(game);
  selectedIds = [];
  buildMode = undefined;
  repairMode = false;
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
/**
 * Where a match opens: on the player's own town center, as the reference
 * does, and where the `H` key returns to. Tile (8, 9) was the top corner of
 * the board, which on a full-size map is fog and the map's edge with nothing
 * of the player's in sight (issue #62). A restored dev session opens there
 * too; the camera is a view preference and the snapshot holds game state.
 */
function homeCamera(state: GameState): Point {
  const tc = state.entities.find(e => e.owner === 1 && e.kind === 'town-center' && !e.dead);
  return elevatedWorldToIso(state, tc?.position.x ?? state.width / 2, tc?.position.y ?? state.height / 2);
}
let cameraCenter = homeCamera(game);
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
  const key = entity.kind === 'palisade-gate' ? view.gateBoxKey(entity) : view.entityKey(entity);
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
function playUnitSound(unit: Entity, cue: 'select' | 'train'): void {
  // Her own voice: the skin that draws a villager speaks for her too.
  playSound(`${artKey(assets, unit, unit.kind, game.matchSeed ?? 0)}-${cue}`);
}

/** One voice for a selection or an order, from the first owned unit in it. */
function acknowledge(): void {
  const unit = ownSelected().find(e => isUnit(e.kind));
  if (unit) playUnitSound(unit, 'select');
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
/**
 * Say why an order was refused. The simulation's reasons are its own words;
 * where the reference has a line for the same refusal -- "Not enough wood.",
 * "You need to build more houses." -- that line is shown instead (issue #70).
 */
function reject(reason: string): void {
  const short = /^not enough (food|wood|stone|gold)$/.exec(reason)?.[1];
  const said = short
    ? messages[`notEnough${short[0].toUpperCase()}${short.slice(1)}`]
    : reason === 'population cap reached' ? messages.needMoreHouses : undefined;
  hud.showMessage(said ?? reason);
  playSound('error');
}

function createHud(): Hud {
  const created = new view.Hud(app, uiAssets, {
    onCommand: (id, shift) => runUiCommand(id, shift),
    onMinimapNavigate: canvasPoint => {
      const world = hud.minimap.fromCanvas(game, canvasPoint.x, canvasPoint.y);
      cameraCenter = elevatedWorldToIso(game, world.x, world.y);
    },
    onFlare: canvasPoint => {
      const world = hud.minimap.fromCanvas(game, canvasPoint.x, canvasPoint.y);
      hud.minimap.flare(world.x, world.y);
      playSound('flare');
    },
    onSelectIdleVillager: () => selectIdleVillager(),
    onSelectMember: id => {
      if (game.entities.some(e => e.id === id && !e.dead)) selectedIds = [id];
      hud.setSelection(selectionInfo());
    },
    onMenu: action => {
      if (action === 'pause') paused = !paused;
      if (action === 'resume') paused = false;
      if (action === 'restart') restart();
    },
    onReplayFile: record => startReplay(record),
    onSound: alias => playSound(alias),
  });
  created.playerColors = assets?.playerColors;
  return created;
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
    lookAt: point => { cameraCenter = elevatedWorldToIso(game, point.x, point.y); },
    renderer,
    scene,
    camera,
    views,
  });
}

function restart(): void {
  replay = undefined;
  clearSession();
  game = createGame(seedFixed ?? ((Date.now() >>> 0) || 1), rules, undefined, mapType);
  cameraCenter = homeCamera(game);
  selectedIds = [];
  buildMode = undefined;
  repairMode = false;
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
  cameraCenter = elevatedWorldToIso(game, next.position.x, next.position.y);
}

/** How many a Shift-click on a train button asks for, as the reference does. */
const BATCH_TRAIN_COUNT = 5;

function runUiCommand(id: string, shift = false): void {
  if (replay) return;
  const selection = ownSelected();
  if (id.startsWith('build-')) {
    const kind = id.slice('build-'.length) as BuildingKind;
    // The reference lets the press through and says what is short rather
    // than greying the button (issue #70); nothing is placed until it is paid.
    const short = shortfall(game, 1, rules.buildings[kind].cost);
    if (short) { reject(`not enough ${short}`); return; }
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
    // Shift asks for five, or as many of the five as the queue, the price and
    // the housing allow (issue #76): each goes through the same command a
    // single click sends, and the first refusal ends the batch. The refusal
    // is only news when nothing at all was queued.
    const wanted = shift ? BATCH_TRAIN_COUNT : 1;
    for (let queued = 0; queued < wanted; queued++) {
      const result = applyCommand(game, { kind: 'train', player: 1, buildingId: building.id, unit });
      if (!result.ok) {
        if (queued === 0) reject(result.reason);
        return;
      }
    }
    return;
  }
  if (id === 'ungarrison') {
    for (const building of selection.filter(e => isBuilding(e.kind) && e.garrison?.length)) {
      const result = applyCommand(game, { kind: 'ungarrison', player: 1, buildingId: building.id });
      if (!result.ok) reject(result.reason);
    }
    return;
  }
  if (id === 'cancel-train') {
    const producer = ownSelected().find(e => isBuilding(e.kind) && (e.training || e.trainingQueue?.length));
    if (!producer) return;
    applyCommand(game, { kind: 'cancel-train', player: 1, buildingId: producer.id });
    return;
  }
  if (id === 'pack' || id === 'unpack') {
    const engines = ownSelected().filter(e => isUnit(e.kind)
      && rules.units[e.kind as UnitKind].unpacked !== undefined);
    if (!engines.length) return;
    applyCommand(game, {
      kind: 'pack', player: 1, entityIds: engines.map(e => e.id), unpacked: id === 'unpack',
    });
    return;
  }
  if (id === 'reseed') {
    const mill = selection.find(e => e.kind === 'mill' && e.buildProgress === undefined);
    if (!mill) return;
    applyCommand(game, {
      kind: 'reseed', player: 1, buildingId: mill.id,
      enabled: !(game.players[1].autoReseedFarms === true),
    });
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
  if (id === 'page-back') { buildPage = undefined; return; }
  if (id === 'cancel') { buildMode = undefined; repairMode = false; }
  if (id === 'repair') { repairMode = true; return; }
}

/** Screen pixel -> world tile point under the current camera. */
/** Whether a world point is inside the visible canvas, for "on screen" rules. */
function isOnScreen(point: Point): boolean {
  const rect = renderer.domElement.getBoundingClientRect();
  const iso = elevatedWorldToIso(game, point.x, point.y);
  const sx = (iso.x - cameraCenter.x) * zoom + rect.width / 2;
  const sy = -(iso.y - cameraCenter.y) * zoom + rect.height / 2;
  return sx >= 0 && sx <= rect.width && sy >= 0 && sy <= rect.height;
}

/**
 * A double-click takes everything of that kind that can be seen, which is
 * AoE2's own rule and the reason it says "on screen" rather than "on the map"
 * (issue #6): it is a selection you could have made with a drag.
 */
function screenToWorld(clientX: number, clientY: number): Point {
  const rect = renderer.domElement.getBoundingClientRect();
  const sx = (clientX - rect.left - rect.width / 2) / zoom + cameraCenter.x;
  const sy = -((clientY - rect.top - rect.height / 2) / zoom) + cameraCenter.y;
  let point = isoToWorld(sx, sy);
  // Invert the raised terrain iteratively: the first pass finds the tile on
  // the flat projection, the second removes that tile's surveyed screen lift.
  for (let pass = 0; pass < 2; pass++) {
    const raise = elevationAt(game, point.x, point.y) * ELEVATION_PIXELS;
    point = isoToWorld(sx, sy - raise);
  }
  return point;
}

function pickEntity(point: Point): Entity | undefined {
  let best: Entity | undefined;
  let bestDistance = Infinity;
  for (const entity of game.entities) {
    // A carcass is still food, and a player is entitled to click it and read
    // how much is left; a corpse with nothing on it stays unclickable, so a
    // battlefield of dead soldiers never gets in the way of the living.
    if (entity.dead && !isCarcass(entity)) continue;
    if (!revealMap && entity.owner !== 1 && entity.owner !== 0 && !isTileVisible(game, 1, entity.position.x, entity.position.y)) continue;
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

/**
 * How long after clicking a thing clicking it again is a double click. Read
 * from the pointer events this app already handles rather than from the
 * browser's own `dblclick`, which a canvas that captures the pointer does not
 * reliably produce.
 */
const DOUBLE_CLICK_MS = 350;
let lastClick: { id: number; at: number } | undefined;
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
    if (repairMode && !replay) {
      repairMode = false;
      const target = pickEntity(point);
      const villagers = ownSelected().filter(e => e.kind === 'villager');
      if (!target || !villagers.some(v => isRepairable(game, v, target))) {
        reject('nothing to repair there');
        return;
      }
      contextOrder(point, event.clientX, event.clientY, event.shiftKey);
      return;
    }
    dragStart = { x: event.clientX, y: event.clientY };
  } else if (event.button === 2) {
    contextOrder(point, event.clientX, event.clientY, event.shiftKey);
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
    // The same thing clicked twice quickly takes every one of its kind that
    // can be seen, which is AoE2's rule and issue #6's request.
    const now = performance.now();
    const again = target && lastClick && lastClick.id === target.id
      && now - lastClick.at <= DOUBLE_CLICK_MS;
    lastClick = target ? { id: target.id, at: now } : undefined;
    if (target && again && !event.shiftKey) {
      selectedIds = sameKindOnScreen(game.entities, target, 1, isOnScreen).map(e => e.id);
    } else if (target && target.owner === 1) {
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

function contextOrder(point: Point, _clientX: number, _clientY: number, queue = false): void {
  if (replay) return; // spectating: inputs must not perturb the command stream
  const selection = ownSelected();
  const target = pickEntity(point);
  const units = selection.filter(e => isUnit(e.kind));
  if (units.length) {
    const targetId = target && target.id !== units[0].id ? target.id : undefined;
    const result = applyCommand(game, {
      kind: 'order', player: 1, entityIds: units.map(e => e.id),
      target: point, targetId,
      // Shift-click falls in behind what they are doing, as the reference does.
      ...(queue ? { queue: true } : {}),
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
    if (knownOwnUnits.size && !knownOwnUnits.has(entity.id)) playUnitSound(entity, 'train');
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
    else if (repairMode) repairMode = false;
    else if (hud.menuOpen) hud.toggleMenu(false);
    else hud.toggleMenu(true);
    return;
  }
  if (key === 'F3') { paused = !paused; event.preventDefault(); return; }
  if (key === 'F4') {
    revealMap = !revealMap;
    hud.showMessage(`Reveal map (debug): ${revealMap ? 'on' : 'off'}`);
    event.preventDefault();
    return;
  }
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
  if (key === 'Delete') {
    // The reference's Delete: destroy what you have selected, of your own.
    // Nothing comes back, so it asks first — and only about what it can
    // actually destroy, since the selection may hold somebody else's.
    const mine = game.entities.filter(e =>
      selectedIds.includes(e.id) && e.owner === 1 && !e.dead);
    // What is asked about is the DAT's own list, not "buildings": its
    // `hero_mode` bit 32 is set on the town center, watch tower, monastery,
    // castle and wonder and on nothing else, so a house or a barracks goes on
    // the keypress as a soldier does (issue #47).
    const asked = mine.filter(e =>
      isBuilding(e.kind) && game.rules.buildings[e.kind as BuildingKind].confirmDelete);
    const doomed = asked.length && !confirm(
      asked.length === 1
        ? `Delete your ${displayName(asked[0].kind)}? This cannot be undone.`
        : `Delete ${asked.length} of your buildings? This cannot be undone.`)
      ? mine.filter(e => !asked.includes(e))
      : mine;
    if (doomed.length) {
      applyCommand(game, { kind: 'delete', player: 1, entityIds: doomed.map(e => e.id) });
      selectedIds = selectedIds.filter(id => !doomed.some(e => e.id === id));
    }
    event.preventDefault();
    return;
  }
  if (key === '.') { selectIdleVillager(); return; }
  // Ctrl+<key> walks the buildings of a kind one at a time; Ctrl+Shift+<key>
  // takes the lot. Both the letters and the modifiers come from the
  // reference's own `hotkeys.json` through the UI import, so "Ctrl+Shift+B is
  // your barracks" is true of the reference rather than of whoever typed it.
  if (event.ctrlKey || event.metaKey) {
    const bindings = uiAssets?.hotkeys;
    const wanted = event.shiftKey ? bindings?.selectAll : bindings?.goto;
    const pressed = key.toUpperCase();
    const kind = Object.entries(wanted ?? {}).find(([, binding]) =>
      binding.key.toUpperCase() === pressed
      && !!binding.control === (event.ctrlKey || event.metaKey)
      && !!binding.shift === event.shiftKey)?.[0];
    if (kind) {
      const mine = game.entities.filter(e =>
        e.owner === 1 && e.kind === kind && !e.dead && e.buildProgress === undefined);
      if (mine.length) {
        if (event.shiftKey) {
          selectedIds = mine.map(e => e.id);
        } else {
          // Cycle: the one after whichever of them is selected now.
          const at = mine.findIndex(e => selectedIds.includes(e.id));
          const next = mine[(at + 1) % mine.length];
          selectedIds = [next.id];
          cameraCenter = elevatedWorldToIso(game, next.position.x, next.position.y);
        }
      } else {
        reject(`no ${displayName(kind)} of yours`);
      }
      event.preventDefault();
      return;
    }
  }
  if (key === 'h' || key === 'H') {
    const tc = game.entities.find(e => e.owner === 1 && e.kind === 'town-center' && !e.dead);
    if (tc) {
      selectedIds = [tc.id];
      cameraCenter = elevatedWorldToIso(game, tc.position.x, tc.position.y);
    }
    return;
  }
  const commands = currentCommands();
  const match = commands.find(c => c.hotkey === key.toLowerCase() && c.enabled);
  if (match) runUiCommand(match.id, event.shiftKey);
});
addEventListener('keyup', event => heldKeys.delete(event.key));
// A keyup that never arrives is a camera that never stops: alt-tabbing or
// clicking away mid-scroll takes the release to another window, and the map
// then pans on its own until the same arrow is pressed again (issue #31).
// Losing focus releases everything held.
addEventListener('blur', () => heldKeys.clear());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') heldKeys.clear();
});
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
    return [{
      id: 'cancel', label: 'Cancel placement', hotkey: 'escape', enabled: true, active: true,
      icon: hud.actionIcon(ACTION_ICON.cancel), slot: GRID_SLOT.cancel,
    }];
  }
  if (repairMode) {
    return [{
      id: 'cancel', label: 'Cancel repair', hotkey: 'escape', enabled: true, active: true,
      icon: hud.actionIcon(ACTION_ICON.cancel), slot: GRID_SLOT.cancel,
    }];
  }
  if (selection.some(e => e.kind === 'villager')) {
    if (!buildPage) {
      // AoE2 gives a villager two build buttons and opens neither until one is
      // clicked, which is what selecting a villager shows (issue #25).
      buttons.push({
        id: 'page-economic', label: 'Build economic buildings', icon: hud.actionIcon(ACTION_ICON.buildEconomic),
        slot: GRID_SLOT.buildEconomic, enabled: true,
      });
      buttons.push({
        id: 'page-military', label: 'Build military buildings', icon: hud.actionIcon(ACTION_ICON.buildMilitary),
        slot: GRID_SLOT.buildMilitary, enabled: true,
      });
      // The reference's third cell (issue #74): the next click names what
      // to mend, as a right-click on it would.
      buttons.push({
        id: 'repair', label: 'Repair', icon: hud.actionIcon(ACTION_ICON.repair),
        slot: GRID_SLOT.repair, enabled: true,
      });
    } else {
      for (const kind of buildMenu(rules, player.age, buildPage)) {
        const building = rules.buildings[kind];
        buttons.push({
          id: `build-${kind}`,
          label: `${createLabel(kind, 'Build')} (${costLabel(building.cost)})`,
          help: helpFor(kind, building.cost),
          slot: building.buildButton,
          enabled: true,
          icon: hud.iconFor('Buildings', assets?.entities[kind]?.iconId, 1),
        });
      }
      buttons.push({
        id: 'page-back', label: 'Back', hotkey: 'escape', enabled: true, icon: hud.actionIcon(ACTION_ICON.cancel),
        slot: GRID_SLOT.cancel,
      });
    }
  }
  if (selection.some(e => isUnit(e.kind))) {
    buttons.push({ id: 'stop', label: 'Stop', slot: GRID_SLOT.stop, enabled: true, icon: hud.actionIcon(ACTION_ICON.stop) });
  }
  // A siege engine that has to be set up before it can shoot.
  const engines = selection.filter(e => isUnit(e.kind)
    && rules.units[e.kind as UnitKind].unpacked !== undefined);
  if (engines.length) {
    const packing = engines.some(e => e.packingTicks !== undefined);
    const anyPacked = engines.some(e => !e.unpacked);
    buttons.push({
      id: anyPacked ? 'unpack' : 'pack',
      label: anyPacked ? 'Unpack (set up to shoot)' : 'Pack (fold up to move)',
      icon: hud.actionIcon(anyPacked ? ACTION_ICON.unpack : ACTION_ICON.pack),
      slot: anyPacked ? GRID_SLOT.unpack : GRID_SLOT.pack,
      hotkey: 'p',
      enabled: !packing,
    });
  }
  // A building with somebody inside offers the reference's "Ungarrison All
  // Units" (`buttons.json`: action 78, cell 9, icon 2) (issue #75).
  if (selection.some(e => isBuilding(e.kind) && e.garrison?.length)) {
    buttons.push({
      id: 'ungarrison', label: 'Ungarrison all units', icon: hud.actionIcon(ACTION_ICON.ungarrison),
      slot: GRID_SLOT.ungarrison, enabled: true,
    });
  }
  // Every completed production building offers the units the rules train there.
  const producer = selection.find(e => isBuilding(e.kind) && e.buildProgress === undefined
    && trainableAt(e.kind as BuildingKind).length > 0);
  if (producer) {
    for (const kind of trainableAt(producer.kind as BuildingKind)) {
      const unitRules = rules.units[kind];
      buttons.push({
        id: `train-${kind}`,
        label: `${createLabel(kind, 'Train')} (${costLabel(unitRules.cost)})`,
        help: helpFor(kind, unitRules.cost),
        slot: unitRules.trainButton,
        // Not "is it already training" -- that is what the queue is for
        // (issue #7). Nor the price or the housing: the reference lets the
        // press through and says what is short (issue #70).
        enabled: queuedCount(producer) < TRAINING_QUEUE_LIMIT,
        icon: hud.iconFor('Units', assets?.entities[kind]?.iconId, 1),
      });
    }
  }
  // Anything queued can be taken back, which is what makes a queue safe to
  // fill: the last one asked for is refunded (issue #7).
  const producing = selection.find(e => isBuilding(e.kind) && (e.training || e.trainingQueue?.length));
  if (producing) {
    const waiting = producing.trainingQueue?.length ?? 0;
    buttons.push({
      id: 'cancel-train',
      label: waiting
        ? `Cancel last of ${waiting + 1} queued (refund)`
        : `Cancel ${displayName(producing.training!.kind)} (refund)`,
      hotkey: 'escape',
      slot: GRID_SLOT.cancel,
      enabled: true,
    });
  }
  // Technologies the selected building researches, in the DAT's own order.
  const player1 = game.players[1];
  for (const [key, tech] of Object.entries(rules.technologies) as [TechKey, typeof rules.technologies[TechKey]][]) {
    const building = selection.find(e => e.kind === tech.researchedAt && e.buildProgress === undefined);
    if (!building) continue;
    if (player1.researched.includes(key)) continue;
    if (player1.age < tech.requiresAge) continue;
    // AoE2 does not show a technology whose predecessor is still outstanding:
    // Iron Casting appears once Forging is done, not beside it.
    if ((tech.requires ?? []).some(other => !player1.researched.includes(other))) continue;
    buttons.push({
      id: `research-${key}`,
      label: `Research ${tech.name} (${costLabel(tech.cost)})`,
      help: tech.help ? plainHelp(tech.help, tech.cost) : undefined,
      slot: tech.button,
      enabled: !building.researching,
      icon: hud.iconFor('Techs', tech.iconId, 1),
    });
  }
  // The mill's one standing option: whether a fallow farm is sown again where
  // it stood. AoE2 puts re-sowing at the mill and this is the same place for
  // it; the DAT gives the farm one build location, the villager, so there is
  // nothing here to import (issue #24).
  const mill = selection.find(e => e.kind === 'mill' && e.buildProgress === undefined);
  if (mill) {
    const on = player1.autoReseedFarms === true;
    buttons.push({
      id: 'reseed',
      label: `Auto-reseed farms: ${on ? 'on' : 'off'} (${costLabel(rules.buildings.farm.cost)} each)`,
      icon: hud.actionIcon(on ? ACTION_ICON.reseedOn : ACTION_ICON.reseedOff),
      enabled: true,
    });
  }
  // Settle every button into its cell and give it that cell's letter, so the
  // key on the button is the key that presses it. A stated cell holds against
  // whatever else is on the panel; the rest take the first free ones.
  return placeCommands(buttons).flatMap((button, index) => button
    ? [{ ...button, slot: index + 1, hotkey: button.hotkey ?? gridKey(index + 1) }]
    : []);
}

/**
 * Cells for the buttons the DAT does not place, from the reference's own grid
 * layout in `hotkeys.json` (the second of its four): the two build pages at
 * Q and W, Stop at G, Unpack at Q and Pack at W. Cancel and Back have no
 * letter of their own there (they are Escape) and take the last cell.
 */
const GRID_SLOT = { buildEconomic: 1, buildMilitary: 2, repair: 3, ungarrison: 9, stop: 10, unpack: 1, pack: 2, cancel: 15 } as const;

/**
 * Which page of the villager's build menu is open, or none: selecting a
 * villager opens neither, and offers the two buttons that choose. The pages
 * themselves are laid out from the DAT's own build slots -- see
 * `src/view/build-menu.ts`.
 */
let buildPage: BuildPage | undefined;

const trainableAt = (building: BuildingKind): UnitKind[] =>
  (Object.keys(rules.units) as UnitKind[]).filter(kind =>
    rules.units[kind].trainedAt === building && (rules.units[kind].age ?? 0) <= game.players[1].age
    && !isAnimal(kind)
    // A unit that has been upgraded past is gone from the panel, not greyed
    // out: the barracks offers the man-at-arms in place of the militia.
    && !upgradedAway(game, 1, kind)
    && !notYetUpgradedInto(game, 1, kind));

/**
 * What the reference calls this entity key: its own string where the manifest
 * carries one (issue #48), the slug spelled out otherwise.
 */
/**
 * What the resource panel shows beside the stockpiles (issue #65): how many
 * villagers work each resource -- what they are gathering or carrying, a
 * hunter and a shepherd counted as food -- how many stand idle, and the age
 * with its shield and how far the next one has come.
 */
function resourceStatus(): ResourceStatus {
  const workers = { wood: 0, food: 0, gold: 0, stone: 0 };
  let idle = 0;
  let villagers = 0;
  for (const entity of game.entities) {
    if (entity.owner !== 1 || entity.dead || entity.kind !== 'villager') continue;
    villagers += 1;
    const resource = entity.carrying?.kind ?? gatherTargetResource(game, entity);
    if (resource) workers[resource] += 1;
    else if (entity.order.kind === 'idle') idle += 1;
  }
  const age = game.players[1].age;
  const imported = assets?.ages[age];
  // `eras.json` names the shield `ShieldDarkAge`; the material table spells
  // the button's normal state `ButtonsShieldDark-AgeNormal`.
  const shield = (imported?.shield ?? `Shield${['Dark', 'Feudal', 'Castle', 'Imperial'][age] ?? 'Dark'}Age`)
    .replace(/^Shield(.*)Age$/, 'ButtonsShield$1-AgeNormal');
  let ageProgress = 0;
  for (const entity of game.entities) {
    if (entity.owner !== 1 || !entity.researching) continue;
    const tech = rules.technologies[entity.researching.tech as TechKey];
    if (tech?.grantsAge === undefined) continue;
    const total = tech.researchSeconds / TICK_SECONDS;
    ageProgress = total > 0 ? 1 - entity.researching.remainingTicks / total : 0;
  }
  return { workers, villagers, idle, ageName: imported?.name ?? AGE_NAMES[age], ageShield: shield, ageProgress };
}

/**
 * The stat row beside the portrait, as the reference shows it: attack (the
 * class-4 amount, else class-3 -- the DAT's own `displayed_attack`), armour
 * as melee/pierce (classes 4 and 3), range when there is one, and what a
 * villager is carrying. Read through research, so Forging shows as +1.
 */
function selectionStats(entity: Entity): SelectionInfo['stats'] {
  if (entity.kind === 'resource' || isCarcass(entity)) return undefined;
  const icons = 'textures/ingame/staticons/';
  const stats: NonNullable<SelectionInfo['stats']> = [];
  const attacksOf = (attacks: AttackValue[]) => attacks.find(a => a.class === 4)?.amount ?? attacks.find(a => a.class === 3)?.amount;
  const armourOf = (armors: AttackValue[], cls: number) => armors.find(a => a.class === cls)?.amount ?? 0;
  if (isUnit(entity.kind)) {
    const unit = unitRulesFor(game, entity.owner, entity.kind as UnitKind);
    const attacks = entity.unpacked && unit.unpacked ? unit.unpacked.attacks : unit.attacks;
    const attack = attacksOf(attacks);
    const pierce = attacks.length && !attacks.some(a => a.class === 4);
    if (attack !== undefined && attack > 0) stats.push({ icon: `${icons}${pierce ? 'pierceAttack' : 'damage'}.png`, value: String(attack), title: 'Attack' });
    stats.push({ icon: `${icons}armor.png`, value: `${armourOf(unit.armors, 4)}/${armourOf(unit.armors, 3)}`, title: 'Armor (melee/pierce)' });
    const range = entity.unpacked && unit.unpacked ? unit.unpacked.range : unit.range;
    if (range) stats.push({ icon: `${icons}range.png`, value: String(range), title: 'Range' });
    if (entity.carrying) stats.push({ icon: `${icons}${entity.carrying.kind}.png`, value: String(entity.carrying.amount), title: 'Carrying' });
  } else if (isBuilding(entity.kind)) {
    const building = buildingRulesFor(game, entity.owner, entity.kind as BuildingKind);
    if (building.attack) {
      const attack = attacksOf(building.attack.attacks);
      if (attack) stats.push({ icon: `${icons}pierceAttack.png`, value: String(attack), title: 'Attack' });
    }
    stats.push({ icon: `${icons}armor.png`, value: `${armourOf(building.armors, 4)}/${armourOf(building.armors, 3)}`, title: 'Armor (melee/pierce)' });
    if (building.attack) stats.push({ icon: `${icons}range.png`, value: String(building.attack.range), title: 'Range' });
  }
  return stats;
}

/**
 * The score panel's rows (issue #67): each player's number and name in the
 * player's colour, the civilisation's icon and the age. The human is
 * "Player 1", having no profile here; the computer takes one of the names
 * the reference gives a computer player of its civilisation
 * (`civilizations.json`'s table, "Henry V" ... "Richard the Lionheart"),
 * dealt by the match seed so it holds for the match. No score yet: the
 * reference's is military + economy + technology + society, which nothing
 * here computes, so the row ends at the name rather than inventing one.
 */
/** The reference's name for a player's colour ("Blue", "Red"), as `UIColors.json` keys it. */
function playerColorName(player: PlayerId): string | undefined {
  const name = assets?.playerColors?.players?.[player]?.name;
  return name ? name[0].toUpperCase() + name.slice(1) : undefined;
}

function scoreRows(): ScoreRow[] {
  const names = rules.civilization.computerNames ?? [];
  const computer = names.length ? names[(game.matchSeed ?? 0) % names.length] : 'Computer';
  return ([1, 2] as const).map(player => ({
    number: player,
    name: player === 1 ? 'Player 1' : computer,
    color: playerColorHex(assets, player) ?? (player === 1 ? '#3b64ff' : '#ff3b3b'),
    textColor: hud.textColor(playerColorName(player), playerColorHex(assets, player) ?? '#ffffff'),
    // The civilisation's small icon is the material `<Name>Icon`, by the
    // reference's own name for it (`BritonsIcon`).
    civIcon: assets && rules.civilization.displayName ? `${rules.civilization.displayName}Icon` : undefined,
    age: game.players[player].age,
  }));
}

function displayName(key: string): string {
  return nameFrom(key, assets?.entities[key]?.text?.name);
}

/**
 * What the panel calls this entity right now. The reference names a villager
 * by its task -- "Lumberjack", "Forager", "Hunter" -- and the art already
 * picks that variant, so the name follows the same choice.
 */
function nameOf(entity: Entity): string {
  const variant = chooseAnimation(game, entity).key;
  const text = assets?.entities[variant]?.text?.name ?? assets?.entities[entityKey(entity)]?.text?.name;
  return nameFrom(entityKey(entity), text);
}

/** The reference's button text ("Create Villager", "Build Mill"), or ours. */
function createLabel(key: string, verb: 'Build' | 'Train'): string {
  return assets?.entities[key]?.text?.create ?? `${verb} ${displayName(key)}`;
}

/** The reference's tooltip for a build or train button, as plain text. */
function helpFor(key: string, cost: Cost): string | undefined {
  const help = assets?.entities[key]?.text?.help;
  return help ? plainHelp(help, cost) : undefined;
}

function selectionInfo(): SelectionInfo | undefined {
  const selection = ownSelected().length
    ? ownSelected()
    : game.entities.filter(e => selectedIds.includes(e.id) && (!e.dead || isCarcass(e)));
  const entity = selection[0];
  if (!entity) return undefined;
  // Without the imported strings, the few names the slug cannot spell.
  const names: Record<string, string> = {
    berries: 'Forage Bush', gold: 'Gold Mine', stone: 'Stone Mine', 'tree-oak': 'Tree', boar: 'Wild Boar',
  };
  const fallbackName = (member: Entity) => names[entityKey(member)] ?? displayName(entityKey(member));
  const name = assets ? nameOf(entity) : fallbackName(entity);
  const details: string[] = [];
  if (selection.length > 1) details.push(`${selection.length} selected`);
  const members = selection.length > 1
    ? selection.map(member => ({
      id: member.id,
      name: assets ? nameOf(member) : fallbackName(member),
      icon: hud.iconFor(isUnit(member.kind) ? 'Units' : 'Buildings',
        assets?.entities[view.entityKey(member)]?.iconId, member.owner),
      hp: member.hp,
      maxHp: member.maxHp,
    }))
    : undefined;
  if (entity.kind === 'town-center' && entity.owner === 1) details.push(AGE_NAMES[game.players[1].age]);
  if (entity.amount !== undefined) details.push(`${Math.floor(entity.amount)} ${entity.resourceKind}`);
  if (entity.garrison?.length) {
    const capacity = rules.buildings[entity.kind as BuildingKind]?.garrison?.capacity;
    details.push(`${entity.garrison.length}${capacity ? `/${capacity}` : ''} garrisoned`);
  }
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
    // What is on the anvil, and how many are waiting behind it (issue #7).
    const waiting = entity.trainingQueue?.length ?? 0;
    progress = {
      label: waiting
        ? `Training ${entity.training.kind} (+${waiting} queued)`
        : `Training ${entity.training.kind}`,
      fraction: 1 - entity.training.remainingTicks / total,
    };
  }
  const iconIndex = assets?.entities[view.entityKey(entity)]?.iconId;
  const category = isUnit(entity.kind) ? 'Units' : 'Buildings';
  return {
    members,
    name,
    stats: selectionStats(entity),
    icon: entity.kind !== 'resource' ? hud.iconFor(category, iconIndex, entity.owner) : undefined,
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
  if (revealMap || entity.owner === 1) return true;
  return isTileVisible(game, 1, entity.position.x, entity.position.y);
}

function syncScene(time: number): void {
  const wanted = new Set<string>();
  for (const entity of game.entities) {
    if (!entityVisible(entity)) continue;
    if (!revealMap && entity.owner === 0 && !isTileVisible(game, 1, entity.position.x, entity.position.y)) {
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
  // A revealed board draws the real entities, so the snapshots stand down.
  for (const remembered of revealMap ? [] : Object.values(game.visibility[1].memory)) {
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
    flagView.body.mesh.position.y += elevationAt(
      game, entity.rally.target.x, entity.rally.target.y,
    ) * ELEVATION_PIXELS;
  }

  // Arrows in flight. They are simulation state, so they render from it
  // directly rather than being faked on the view side.
  for (const projectile of game.projectiles) {
    if (!revealMap && !isTileVisible(game, 1, projectile.position.x, projectile.position.y)) continue;
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
    // The rules name each shooter's shot (the DAT's own projectile unit):
    // the trebuchet throws its rock, the mangonel its stone, everything else
    // an arrow (issue #30 -- the rock's art existed and was never drawn).
    const shooter = game.entities.find(e => e.id === projectile.shooterId);
    const shooterRules = shooter
      ? (game.rules.units as Partial<Record<string, UnitRules>>)[shooter.kind]
      : undefined;
    const art = shooterRules?.unpacked?.projectileArt ?? shooterRules?.projectileArt ?? 'arrow';
    view.updateProjectileView(
      entityView, assets, projectile.position, heading, progress, span, projectile.launchHeight,
      art, time, elevationAt(game, projectile.position.x, projectile.position.y) * ELEVATION_PIXELS,
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
    const iso = elevatedWorldToIso(game, entity.position.x, entity.position.y);
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
    const iso = elevatedWorldToIso(game, target.x, target.y);
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
    const iso = elevatedWorldToIso(game, tile.x, tile.y);
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
  fog.mesh.visible = !revealMap;
  if (!revealMap) fog.update(game);

  camera.position.set(cameraCenter.x, cameraCenter.y, 10);
  camera.zoom = zoom;
  camera.updateProjectionMatrix();

  hudClock += elapsed;
  if (hudClock > 0.15) {
    hudClock = 0;
    hud.updateResources(game, 1, resourceStatus());
    hud.updateScore(scoreRows());
    hud.setCommands(currentCommands());
    hud.setSelection(selectionInfo());
    hud.minimap.draw(game, isoToWorld(cameraCenter.x, cameraCenter.y), {
      w: innerWidth / zoom / TILE_W * 1.2,
      h: innerHeight / zoom / TILE_H * 0.9,
    }, assets, revealMap);
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
function disposeObject(object: THREE.Object3D): void {
  object.traverse(child => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.dispose();
    const material = child.material;
    if (Array.isArray(material)) material.forEach(entry => entry.dispose());
    else material.dispose();
  });
}

/** Recreate every view-owned object from the current simulation state. */
function rebuildPresentation(): void {
  scene.remove(ground);
  disposeObject(ground);
  ground = view.createGround(game, assets);
  scene.add(ground);

  scene.remove(fog.mesh);
  disposeObject(fog.mesh);
  fog.dispose();
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
  hud.updateResources(game, 1, resourceStatus());
  hud.updateScore(scoreRows());
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
