import * as THREE from 'three/webgpu';
import './view/style.css';
import { exampleAiCommands } from './sim/ai';
import { garrisonCount } from './sim/garrison';
import { observe } from './sim/observe';
import { TRAINING_QUEUE_LIMIT, applyCommand as applyLocalCommand, buildingFootprint, civHas, createGame, gameTimeSeconds, isCarcass, isRepairable, placementLegal, planContextCommand, queuedCount, shortfall, stepGame, trainableUnitsAt, rulesForPlayer } from './sim/game';
import { connectSharedMatch } from './shared/client';
import { AGE_NAMES, FALLBACK_RULES, TICK_SECONDS, isAnimal, isBuilding, isUnit, rulesFromManifest, type AttackValue, type ContentManifest, type Cost, type GameRules, type TechKey, type UnitRules } from './sim/data';
import { MAPS } from './sim/mapgen';
import { isTileVisible } from './sim/visibility';
import { checksumState } from './sim/checksum';
import type { MatchRecord } from './protocol/types';
import type { BuildingKind, Entity, GameState, PlayerId, Point, ResourceKind, UnitKind } from './sim/types';
import { isGateKind, isWallKind } from './sim/buildings';
import { buildMenu, type BuildPage } from './view/build-menu';
import { contextTargets, pickTarget, sameKindOnScreen } from './view/selection';
import { clearSession, loadSession, loadSessionSetup, saveSession } from './dev-session';
import { loadMapPreference, saveMapPreference, mapChoices, validMatchSetup, validRecordedMode, MAX_MAP_SEED, type MatchSetup } from './match-setup';
import { matchOver, TREASON_GOLD } from './sim/regicide';
import { loadAudioAssets, loadContentAssets, loadUiAssets } from './view/assets';
import { worldToIso, isoToWorld, snapPlacement, wallLine, TILE_W, TILE_H } from './view/iso';
import { buildingLimitReached, buildingRulesFor, buildingRulesForEntity, populationLimitFor, trainingAt, unitRulesFor, unitRulesForEntity } from './sim/rules';
import { researchCostFor, researchSecondsFor, technologyRequirementsMet } from './sim/technologies';
import { COMMODITIES, hasMarket, marketQuote, maximumTribute, tributeFee, type Commodity } from './sim/market';
import type { DiplomacyModel } from './view/diplomacy';
import { civilizationRules } from './sim/civilizations';
import { profileArtKey } from './view/sprites';
import { gridKey, placeCommands } from './view/command-grid';
import type { ConfirmationResult, ProductionItem, ResourceStatus, ScoreRow } from './view/hud';
import { costLabel, displayName as nameFrom, plainHelp } from './view/names';
import { contextCursor, cursorCss } from './view/cursors';
import { artKey, chooseAnimation, createEntityView, refreshEntityTextures, dimFogSnapshot, gatherTargetResource, playerColorHex, createFlagView, createProjectileView, updateEntityView, updateFlagView, updateProjectileView, updateOcclusion, entityKey, gateBoxKey, type EntityView } from './view/sprites';
import { createGround, createFog, createFootprint, createSelectionOutline, updateSelectionOutline, elevatedWorldToIso, elevationAt, ELEVATION_PIXELS } from './view/world';
import { createScatter, fillScatter } from './view/scatter';
import { createCueWatcher, pollCues } from './view/cues';
import { ConstructionCues } from './view/construction-cues';
import { AudioPlayer } from './view/audio';
import { MusicPlayer } from './view/music';
import { loadPreferences, normalizePreferences, savePreferences, type Preferences } from './view/preferences';
import { commandHotkey, hotkeyLabel, matchesHotkey } from './view/hotkeys';
import { WorldSounds, type SoundPose } from './view/world-sounds';
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
  createEntityView, updateEntityView, refreshEntityTextures, dimFogSnapshot, createProjectileView, updateProjectileView,
  createFlagView, updateFlagView, updateOcclusion, entityKey, gateBoxKey, Hud,
};

const app = document.querySelector<HTMLDivElement>('#app')!;
const loading = document.createElement('div');
loading.id = 'game-message';
loading.className = 'show';
loading.textContent = 'Loading artwork…';
app.appendChild(loading);

const renderer = new THREE.WebGPURenderer({ antialias: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.domElement.classList.add('battlefield');
app.appendChild(renderer.domElement);
await renderer.init();

let [assets, uiAssets, audioAssets] = await Promise.all([
  loadContentAssets(), loadUiAssets(), loadAudioAssets(),
]);
let preferences = loadPreferences();
const requestedPalette = new URLSearchParams(location.search).get('uiPalette');
if (requestedPalette) preferences = normalizePreferences({ ...preferences, palette: requestedPalette });
if (!uiAssets?.hotkeyProfiles?.[preferences.hotkeys]) preferences.hotkeys = 'definitive';
if (preferences.palette !== 'default' && !uiAssets?.colorPalettes?.[preferences.palette]) preferences.palette = 'default';
const selectedHotkeys = () => uiAssets?.hotkeyProfiles?.[preferences.hotkeys];
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
const mapPreference = loadMapPreference();
const mapParam = pageParams.get('map');
const mapType = mapParam === null ? (mapPreference?.map ?? 'arabia') : Object.hasOwn(MAPS, mapParam) ? mapParam : 'arabia';
if (mapParam !== null && mapType !== mapParam) {
  console.warn(`[map] unknown map type '${mapParam}', dealing arabia`);
}
// And which board of it: ?seed=3 deals that seed, on load and again on New
// Match, so a board somebody is looking at can be named. Like ?map=, asking
// for one means a fresh board rather than a resumed session.
const seedParam = Number(pageParams.get('seed'));
const seedFixed = Number.isInteger(seedParam) && seedParam > 0 && seedParam <= MAX_MAP_SEED ? seedParam : undefined;
const initialSetup: MatchSetup = { map: mapType, seed: seedFixed ?? (mapParam === null ? mapPreference?.seed : undefined) ?? 42 };
if (mapPreference?.populationLimit !== undefined) initialSetup.populationLimit = mapPreference.populationLimit;
if (mapPreference?.wonderVictory) initialSetup.wonderVictory = true;
if (pageParams.get('mode') === 'regicide' || (!pageParams.has('mode') && mapPreference?.mode === 'regicide')) initialSetup.mode = 'regicide';
if (mapPreference?.civilizations && [1, 2].every(player => civilizationRules(rules, mapPreference.civilizations![player as 1 | 2]))) {
  initialSetup.civilizations = mapPreference.civilizations;
}

const restored = mapParam === null && seedFixed === undefined && !pageParams.has('mode') ? loadSession(rules) : undefined;
const savedSetup = loadSessionSetup(rules);
const hostResume = loadSession(rules);
loading.textContent = 'Connecting to shared match…';
const shared = await connectSharedMatch(
  () => hostResume ?? createGame(initialSetup.seed, rules, initialSetup.civilizations, initialSetup.map, initialSetup.mode, initialSetup.populationLimit, initialSetup.wonderVictory),
  notice => { loading.textContent = notice; },
  hostResume ? savedSetup : initialSetup,
);
loading.remove();
const localPlayer: PlayerId = shared?.player ?? 1;
if (shared) rules = shared.state.rules;
let game = shared?.state ?? restored ?? createGame(initialSetup.seed, rules, initialSetup.civilizations, initialSetup.map, initialSetup.mode, initialSetup.populationLimit, initialSetup.wonderVictory);
const playerRules = (owner: Entity['owner'] = localPlayer): GameRules => rulesForPlayer(game, owner);
const importedEntity = (key: string, owner: number = localPlayer) => {
  const civ = owner === 1 || owner === 2 ? game.players[owner].civilization : undefined;
  return assets?.entities[`civilizations/${civ}/${key}`] ?? assets?.entities[key];
};
if (assets) assets.civilizationForOwner = owner => owner === 1 || owner === 2 ? game.players[owner].civilization : undefined;
let activeSetup: MatchSetup = shared?.setup ?? (restored ? savedSetup : undefined) ?? initialSetup;
let setupKnown = shared ? shared.setup !== undefined : !restored || savedSetup !== undefined;
const renderPosition = (entity: Entity): Point => shared?.renderPosition(entity) ?? entity.position;
const renderEntity = (entity: Entity): Entity => {
  const position = renderPosition(entity);
  return position === entity.position ? entity : { ...entity, position };
};
let presentationRebuilds = 0;
let cursorStamp = '';
const applyCommand: typeof applyLocalCommand = (state, command) => {
  const result = shared ? shared.command(command) : applyLocalCommand(state, command);
  cursorStamp = ''; // commands may change hover meaning even while paused
  return result;
};
if (restored) console.info(`[dev] resumed match at tick ${restored.tick}; menu restart starts a new one`);
let selectedIds: number[] = [];
let buildMode: BuildingKind | undefined;
/** The villager's Repair button is down: the next click names what to mend. */
let repairMode = false;
let groundAttackers: number[] = [];
let unloadShips: number[] = [];
let gatherPointBuildings: number[] = [];
let gatherPointSelection = '';
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
 * Match labels13101/13126/13102/13103 are Slow/Casual/Normal/Fast.
 * Native185872's clock explicitly displays1.0/1.5/1.7/2.0 respectively.
 * The previously used20033..20036 names belong to REPLAY_SPEED_* bindings,
 * not the match menu. Stored indices keep their pace; new sessions use Normal.
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
  attackGround: 60,
  cancel: 0, ungarrison: 2, stop: 3, pack: 12, unpack: 13, buildEconomic: 30, buildMilitary: 31, repair: 33,
  reseedOn: 70, reseedOff: 71,
} as const;

const GAME_SPEEDS: { label: string; multiplier: number }[] = [
  { label: messages.gameSpeedSlow ?? 'Slow', multiplier: 1 },
  { label: messages.gameSpeedCasual ?? 'Casual', multiplier: 1.5 },
  { label: messages.gameSpeedNormal ?? 'Normal', multiplier: 1.7 },
  { label: messages.gameSpeedFast ?? 'Fast', multiplier: 2 },
  // Past the original's own settings: fast-forward, for watching a match out
  // or for an automated pass. Not a claim about AoE2.
  { label: 'Fast-forward 5x', multiplier: 5 },
  { label: 'Fast-forward 10x', multiplier: 10 },
];
let speedIndex = preferences.speed;
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
  if (shared) { hud.showPopup('Open a standalone game to watch a replay'); return; }
  const record = raw as MatchRecord;
  if (!record || !validRecordedMode(record.version, record.mode) || !Array.isArray(record.commands) || !Array.isArray(record.checksums)
    || (record.version === 1 && (record.populationLimit !== undefined || record.wonderVictory !== undefined))
    || !validMatchSetup({ map: record.map ?? 'arabia', seed: record.seed, mode: record.mode, populationLimit: record.populationLimit, wonderVictory: record.wonderVictory })) {
    hud.showPopup('Not a valid replay file');
    return;
  }
  if (record.rulesOrigin !== rules.origin) {
    hud.showPopup(`Replay was recorded with ${record.rulesOrigin} rules; local rules are ${rules.origin}`);
    return;
  }
  // A replay drives its own command stream; snapshotting it would resume a
  // spectated match as if it were played.
  clearSession();
  // A record from before civilisations were written down replays as whatever
  // the content is for, which is what it was played as.
  game = createGame(record.seed, rules, record.civilizations, record.map ?? 'arabia', record.mode, record.populationLimit, record.wonderVictory);
  if (record.version < 3) delete game.researchQueueVersion;
  activeSetup = { map: record.map ?? 'arabia', seed: record.seed, mode: record.mode, civilizations: record.civilizations,
    ...(record.populationLimit !== undefined ? { populationLimit: record.populationLimit } : {}),
    ...(record.wonderVictory ? { wonderVictory: true } : {}) };
  setupKnown = true;
  cameraCenter = homeCamera(game);
  selectedIds = [];
  buildMode = undefined;
  repairMode = false;
  groundAttackers = [];
  unloadShips = [];
  paused = false;
  hud.hideEnd();
  for (const entityView of views.values()) retireEntityView(entityView);
  views.clear();
  replay = {
    record,
    commands: [...record.commands],
    checksums: new Map(record.checksums.map(entry => [entry.tick, entry.hash])),
    lastTick: record.checksums.at(-1)?.tick ?? 0,
    verified: 0,
    failed: false,
  };
  resetMatchView();
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
  const tc = state.entities.find(e => e.owner === localPlayer && e.kind === 'town-center' && !e.dead);
  return elevatedWorldToIso(state, tc?.position.x ?? state.width / 2, tc?.position.y ?? state.height / 2);
}
let cameraCenter = homeCamera(game);
// The reference's default zoom draws the 2x assets at 0.80 (docs/status.md,
// "The reference's default zoom"), so a match opens at the same tile.
let zoom = 0.8;

let ground = view.createGround(game, assets);
scene.add(ground);
// The aesthetic scatter: picture only, placed by the view from the board.
let scatter = createScatter(game, assets);
scene.add(scatter);
let fog = view.createFog(game, localPlayer);
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
  const key = isGateKind(entity.kind) ? view.gateBoxKey(entity) : view.entityKey(entity);
  const entry = importedEntity(key, entity.owner)?.selection;
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
 * `docs/ledger.md`. Timed on the game clock like every other view animation.
 */
const ORDER_FLASH_PERIOD_SECONDS = 0.2;
const ORDER_FLASH_TOTAL_SECONDS = 1.2;
let orderFlash: { entityId: number; startedAt: number } | undefined;

/** Somebody else's: not this player's, and not gaia's trees and animals. */
const isHostile = (entity: Entity): boolean => entity.owner !== 0 && entity.owner !== localPlayer;

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

const audioPlayer = new AudioPlayer(() => audioAssets, () => game.matchSeed ?? 0);
const musicPlayer = new MusicPlayer(() => audioAssets);
audioPlayer.setVolume(preferences.sound / 100);
musicPlayer.setVolume(preferences.music / 100);
const unlockAudio = (): void => { audioPlayer.unlock(); musicPlayer.unlock(); };
addEventListener('pointerdown', unlockAudio, { capture: true });
addEventListener('keydown', unlockAudio, { capture: true });
addEventListener('pagehide', () => { audioPlayer.stop(); musicPlayer.reset(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { audioPlayer.stop(); musicPlayer.update(false); }
});
function playSound(alias: string): void {
  audioPlayer.play(alias);
}

/** Selection and order voices have separate DAT event IDs. */
function playUnitSound(unit: Entity, cue: 'select' | 'train' | 'move' | 'attack' | 'construction'): void {
  // Her own voice: the skin that draws a villager speaks for her too.
  const variant = cue === 'train' ? unit.kind : chooseAnimation(game, unit).key;
  const alias = `${artKey(assets, unit, variant, game.matchSeed ?? 0)}-${cue}`;
  const base = `${artKey(assets, unit, unit.kind, game.matchSeed ?? 0)}-${cue}`;
  audioPlayer.play(audioAssets?.audio[alias] ? alias : base, cue === 'construction' ? 'ui' : 'voice');
}

/** One voice for a selection or an order, from the first owned unit in it. */
function acknowledge(cue: 'select' | 'move' | 'attack' = 'select'): void {
  const selected = ownSelected();
  const unit = selected.find(e => isUnit(e.kind)) ?? (cue === 'select' ? selected[0] : undefined);
  if (unit) playUnitSound(unit, cue);
}

/** A stand-in entity so the preview reuses the normal building rendering. */
function ghostEntity(kind: BuildingKind, at: Point): Entity {
  const rules = playerRules();
  return {
    id: 0, kind, owner: localPlayer, position: at,
    hp: 1, maxHp: 1, radius: rules.buildings[kind].radius,
    activity: 'idle', order: { kind: 'idle' },
    ...(rules.buildings[kind].footprint
      ? { footprint: buildingFootprint(game, kind, orientationOf(kind, at), localPlayer) }
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
    retireEntityView(ghostView);
    ghostView = undefined;
  }
  ghostKind = undefined;
  ghostShape = undefined;
}

/** A rejected command, reported and sounded the way the game does. */
/**
 * Say why an order was refused. The simulation's reasons are its own words;
 * where the reference has a line for the same refusal -- "Not enough wood."
 * -- that line is shown instead (issue #70).
 */
function reject(reason: string): void {
  const short = /^not enough (food|wood|stone|gold)$/.exec(reason)?.[1];
  const said = short
    ? messages[`notEnough${short[0].toUpperCase()}${short.slice(1)}`]
    : undefined;
  hud.showMessage(said ?? reason);
  playSound('error');
}

function createHud(): Hud {
  const created = new view.Hud(app, uiAssets, {
    onOptions: () => hud.options.show({ preferences: { ...preferences, speed: speedIndex },
      speeds: GAME_SPEEDS.map(speed => speed.label), profiles: Object.keys(uiAssets?.hotkeyProfiles ?? { definitive: {} }),
      palettes: ['default', ...Object.keys(uiAssets?.colorPalettes ?? {})] }),
    onPreferences: applyPreferences,
    onCommand: (id, shift) => runUiCommand(id, shift),
    onTribute: amounts => {
      if (replay || matchOver(game)) return { ok: false, reason: 'read-only' };
      return applyCommand(game, { kind: 'tribute-batch', player: localPlayer,
        recipient: localPlayer === 1 ? 2 : 1, amounts });
    },
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
    onWonderFocus: id => {
      const e = game.entities.find(e => e.id === id && e.kind === 'wonder' && !e.dead);
      if (e) cameraCenter = elevatedWorldToIso(game, e.position.x, e.position.y);
    },
    onSelectMember: id => {
      if (game.entities.some(e => e.id === id && !e.dead)) selectedIds = [id];
      hud.setSelection(selectionInfo());
    },
    onCancelTraining: (buildingId, index) => {
      if (replay) return;
      applyCommand(game, { kind: 'cancel-train', player: localPlayer, buildingId, index });
      hud.setSelection(selectionInfo());
    },
    onCancelResearch: (buildingId, index) => {
      if (replay) return;
      const result = applyCommand(game, { kind: 'cancel-research', player: localPlayer, buildingId, index });
      if (!result.ok) reject(result.reason);
      hud.setSelection(selectionInfo());
    },
    onMenu: action => {
      if (action === 'pause') setPaused(!paused);
      if (action === 'resume') setPaused(false);
      if (action === 'restart') {
        if (setupKnown) restart();
        else { hud.hideEnd(); hud.toggleMenu(true); }
      }
    },
    onReplayFile: record => startReplay(record),
    onSound: alias => playSound(alias),
    onStartMatch: setup => {
      if (!restart(setup)) return false;
      // The menu now owns setup. Keep solo/player flags, and let ordinary
      // reloads resume the saved match instead of re-dealing an old URL map.
      const url = new URL(location.href);
      url.searchParams.delete('map'); url.searchParams.delete('seed'); url.searchParams.delete('mode');
      history.replaceState(null, '', url);
      return true;
    },
  }, messages);
  created.playerColors = assets?.playerColors;
  created.setPalette(preferences.palette);
  created.minimap.player = localPlayer;
  configureMapMenu(created);
  return created;
}

function configureMapMenu(target: Hud): void {
  target.configureMapMenu(mapChoices(messages), { ...activeSetup, mode: game.mode ?? 'random-map',
    populationLimit: game.populationLimit ?? rules.populationLimit, wonderVictory: game.wonderVictory }, !shared || localPlayer === 1, messages, setupKnown);
  const profiles = [rules, ...Object.values(rules.civilizations ?? {}).filter(profile => profile.civilization.enabled !== false)];
  target.configureCivilizations(profiles.map(profile => ({ id: profile.civilization.key,
    label: profile.civilization.displayName ?? profile.civilization.name })),
    { 1: game.players[1].civilization, 2: game.players[2].civilization }, !shared || localPlayer === 1,
    messages.civilization ?? 'Civilization', playerRules().civilization.internalName, playerRules().civilization.hudStyle);
}

let hud = createHud();

function setPreferredSpeed(speed: number): void {
  preferences = { ...preferences, speed };
  savePreferences(preferences);
  if (shared) shared.send({ type: 'settings', speed });
  else speedIndex = speed;
}

function applyPreferences(value: Preferences): void {
  const next = normalizePreferences(value);
  if (next.speed !== speedIndex) setPreferredSpeed(next.speed);
  preferences = next;
  savePreferences(preferences);
  audioPlayer.setVolume(preferences.sound / 100);
  musicPlayer.setVolume(preferences.music / 100);
  musicPlayer.update(preferences.music > 0 && !paused && !matchOver(game) && !document.hidden);
  hud.setPalette(preferences.palette);
  hud.setCommands(currentCommands());
  hud.setSelection(selectionInfo());
  hud.updateScore(scoreRows());
}

function setPaused(value: boolean): void {
  if (shared) shared.send({ type: 'settings', paused: value });
  else paused = value;
}

if (shared) {
  paused = shared.settings.paused;
  speedIndex = shared.settings.speed;
  shared.onSettings = settings => { paused = settings.paused; speedIndex = settings.speed; };
  shared.onNotice = notice => hud.showMessage(notice);
  shared.onSnapshot = (state, changedMap) => {
    game = state;
    rules = state.rules;
    if (shared.setup) {
      const different = !setupKnown || activeSetup.map !== shared.setup.map || activeSetup.seed !== shared.setup.seed
        || (activeSetup.mode ?? 'random-map') !== (shared.setup.mode ?? 'random-map');
      activeSetup = shared.setup;
      setupKnown = true;
      saveMapPreference(activeSetup);
      if (different && !changedMap) configureMapMenu(hud);
    }
    if (changedMap) {
      resetMatchView();
    }
    // Same-map recovery replaces authoritative data only. syncScene reconciles
    // entity ids on the next frame; terrain, HUD, camera and textures survive.
  };
  hud.showMessage(`Shared match — player ${localPlayer}${paused ? ' — paused (F3 to resume)' : ''}`);
}

// Text-based debug protocol for the dev server's /__debug endpoint. Loaded
// dynamically so none of it reaches a production bundle.
async function installDevelopmentDebug(): Promise<void> {
  const { installDebug } = await import('./dev-debug');
  installDebug({
    game: () => game,
    connection: () => ({ player: localPlayer, connected: shared?.connected ?? false, paused,
      speed: speedIndex, pendingTicks: shared?.pendingTicks ?? 0, synchronization: shared?.stats, presentationRebuilds,
      setup: setupKnown ? activeSetup : undefined }),
    renderPosition,
    resync: () => shared?.requestResync(),
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

function restart(setup: MatchSetup | undefined = setupKnown ? activeSetup : undefined): boolean {
  if (!validMatchSetup(setup)) return false;
  if (setup.civilizations && ![1, 2].every(player => civilizationRules(rules, setup.civilizations![player as 1 | 2]))) return false;
  if (shared) {
    if (localPlayer !== 1) { hud.showMessage('Ysgramor starts a new match'); return false; }
    return shared.send({ type: 'restart', seed: setup.seed, map: setup.map, civilizations: setup.civilizations, mode: setup.mode, populationLimit: setup.populationLimit, wonderVictory: setup.wonderVictory });
  }
  const sides = setup.civilizations ?? { 1: game.players[1].civilization, 2: game.players[2].civilization };
  const next = createGame(setup.seed, rules, sides, setup.map, setup.mode, setup.populationLimit, setup.wonderVictory);
  replay = undefined;
  clearSession();
  activeSetup = setup;
  setupKnown = true;
  game = next;
  saveMapPreference(setup);
  saveSession(game, setup);
  paused = false;
  resetMatchView();
  return true;
}

function resetMatchView(): void {
  hud.toggleMenu(false);
  cameraCenter = homeCamera(game);
  selectedIds = [];
  buildMode = undefined;
  repairMode = false;
  groundAttackers = [];
  unloadShips = [];
  wallStart = undefined;
  orderFlash = undefined;
  aiClock = 0;
  accumulator = 0;
  ended = false;
  shownAge = game.players[localPlayer].age;
  knownOwnUnits = new Set();
  cueWatcher = createCueWatcher();
  constructionCues = new ConstructionCues();
  worldSounds = new WorldSounds();
  audioPlayer.reset();
  musicPlayer.reset();
  gatherPointBuildings = [];
  rebuildPresentation();
}

const ownSelected = (): Entity[] =>
  game.entities.filter(e => selectedIds.includes(e.id) && e.owner === localPlayer && !e.dead);

function selectIdleVillager(): void {
  const idle = game.entities.filter(e => e.owner === localPlayer && e.kind === 'villager' && !e.dead && e.order.kind === 'idle');
  if (!idle.length) { hud.showMessage('No idle villagers'); return; }
  const current = idle.findIndex(e => selectedIds.includes(e.id));
  const next = idle[(current + 1) % idle.length];
  selectedIds = [next.id];
  cameraCenter = elevatedWorldToIso(game, next.position.x, next.position.y);
}

/** How many a Shift-click on a train button asks for, as the reference does. */
const BATCH_TRAIN_COUNT = 5;

function diplomacyModel(): DiplomacyModel {
  return { player: localPlayer, readOnly: !!replay || matchOver(game),
    hasMarket: hasMarket(game, localPlayer), fee: tributeFee(game, localPlayer, 100),
    maximum: Object.fromEntries((['wood', 'food', 'gold', 'stone'] as const).map(r => [r, maximumTribute(game, localPlayer, r)])) as DiplomacyModel['maximum'],
    players: ([1, 2] as const).map(id => ({ id, name: `Player ${id}`,
      civilization: playerRules(id).civilization.displayName ?? playerRules(id).civilization.name,
      color: hud.uiColor(playerColorName(id), 'Icons', playerColorHex(assets, id) ?? (id === 1 ? '#3b64ff' : '#ff3b3b'))! })) };
}
function runUiCommand(id: string, shift = false): void {
  if (id === 'market-tribute' || id === 'diplomacy') {
    hud.diplomacy.show(diplomacyModel());
    return;
  }
  if (replay) return;
  if (id === 'treason') {
    const castle = ownSelected().find(e => e.kind === 'castle' && e.buildProgress === undefined);
    if (castle) { const result = applyCommand(game, { kind: 'treason', player: localPlayer, castleId: castle.id }); if (!result.ok) reject(result.reason); }
    return;
  }
  if (id.startsWith('exchange-')) {
    const [, side, resource] = id.split('-');
    const market = ownSelected().find(e => e.kind === 'market' && e.buildProgress === undefined);
    if (market) {
      const result = applyCommand(game, { kind: 'exchange', player: localPlayer, marketId: market.id,
        side: side as 'buy' | 'sell', resource: resource as Commodity, amount: shift ? 500 : 100 });
      if (!result.ok) reject(result.reason);
    }
    return;
  }
  const rules = playerRules();
  if (replay) return;
  const selection = ownSelected();
  if (id === 'set-gather-point') {
    gatherPointBuildings = selection.filter(e => isBuilding(e.kind) && e.buildProgress === undefined
      && trainableAt(e.kind as BuildingKind).length > 0).map(e => e.id);
    gatherPointSelection = selectedIds.join(',');
    return;
  }
  if (id.startsWith('build-')) {
    const kind = id.slice('build-'.length) as BuildingKind;
    // The reference lets the press through and says what is short rather
    // than greying the button (issue #70); nothing is placed until it is paid.
    const short = shortfall(game, localPlayer, buildingRulesFor(game, localPlayer, kind).cost);
    if (short) { reject(`not enough ${short}`); return; }
    if (kind === buildMode && rules.buildings[kind].footprint) {
      gateOrientation = gateOrientation === 'x' ? 'y' : 'x';
    }
    buildMode = kind;
    return;
  }
  if (id === 'stop') {
    if (selection.length) applyCommand(game, { kind: 'stop', player: localPlayer, entityIds: selection.map(e => e.id) });
    return;
  }
  if (id.startsWith('train-')) {
    const unit = id.slice('train-'.length) as UnitKind;
    const building = selection.find(e => isBuilding(e.kind) && e.buildProgress === undefined
      && trainableUnitsAt(game, localPlayer, e.kind as BuildingKind).includes(unit));
    if (!building) return;
    // Shift asks for five, or as many of the five as the queue and the price
    // allow (issue #76): each goes through the same command a
    // single click sends, and the first refusal ends the batch. The refusal
    // is only news when nothing at all was queued.
    const wanted = shift ? BATCH_TRAIN_COUNT : 1;
    for (let queued = 0; queued < wanted; queued++) {
      const result = applyCommand(game, { kind: 'train', player: localPlayer, buildingId: building.id, unit });
      if (!result.ok) {
        if (queued === 0) reject(result.reason);
        return;
      }
    }
    return;
  }
  if (id === 'ungarrison') {
    unloadShips = selection.filter(e => isUnit(e.kind) && rules.units[e.kind].transportCapacity && e.garrison?.length).map(e => e.id);
    if (unloadShips.length) {
      hud.showMessage(messages.unloadWhere ?? 'Click where you want the transport to unload.');
      return;
    }
    for (const building of selection.filter(e => e.garrison?.length || e.relics?.length)) {
      const result = applyCommand(game, { kind: 'ungarrison', player: localPlayer, buildingId: building.id });
      if (!result.ok) reject(result.reason);
    }
    return;
  }
  if (id === 'town-bell') {
    const centers = selection.filter(e => e.kind === 'town-center' && e.buildProgress === undefined);
    const enabled = centers.some(e => !e.townBell);
    let accepted = false;
    for (const tc of centers) {
      const result = applyCommand(game, { kind: 'town-bell', player: localPlayer, buildingId: tc.id, enabled });
      if (!result.ok) reject(result.reason);
      else accepted = true;
    }
    if (accepted) playSound(enabled ? 'townbell_start' : 'townbell_stop');
    return;
  }
  if (id === 'cancel-train') {
    const producer = ownSelected().find(e => isBuilding(e.kind) && (e.training || e.trainingQueue?.length));
    if (!producer) return;
    applyCommand(game, { kind: 'cancel-train', player: localPlayer, buildingId: producer.id });
    return;
  }
  if (id === 'pack' || id === 'unpack') {
    const engines = ownSelected().filter(e => isUnit(e.kind)
      && rules.units[e.kind as UnitKind].unpacked !== undefined);
    if (!engines.length) return;
    applyCommand(game, {
      kind: 'pack', player: localPlayer, entityIds: engines.map(e => e.id), unpacked: id === 'unpack',
    });
    return;
  }
  if (id === 'attack-ground') {
    groundAttackers = selection.filter(e => isUnit(e.kind) && !!((unitRulesForEntity(game, e).abilityFlags ?? 0) & 8)).map(e => e.id);
    return;
  }
  if (id === 'reseed') {
    const mill = selection.find(e => e.kind === 'mill' && e.buildProgress === undefined);
    if (!mill) return;
    applyCommand(game, {
      kind: 'reseed', player: localPlayer, buildingId: mill.id,
      enabled: !(game.players[localPlayer].autoReseedFarms === true),
    });
    return;
  }
  if (id.startsWith('research-')) {
    const tech = id.slice('research-'.length);
    const at = rules.technologies[tech as TechKey]?.researchedAt;
    const building = selection.find(e => e.kind === at && e.buildProgress === undefined);
    if (!building) return;
    const result = applyCommand(game, { kind: 'research', player: localPlayer, buildingId: building.id, tech });
    if (!result.ok) reject(result.reason);
    return;
  }
  if (id === 'page-economic') { buildPage = 'economic'; return; }
  if (id === 'page-military') { buildPage = 'military'; return; }
  if (id === 'page-back') { buildPage = undefined; return; }
  if (id === 'cancel') { buildMode = undefined; repairMode = false; unloadShips = []; gatherPointBuildings = []; groundAttackers = []; }
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

function pickEntity(point: Point, intent: 'selection' | 'context' = 'context'): Entity | undefined {
  return pickTarget(contextTargets(game, localPlayer, revealMap), point, intent,
    entity => renderPosition(entity as Entity)) as Entity | undefined;
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
const isWall = isWallKind;
let wallStart: Point | undefined;

/**
 * Which way the pending gate lies. AoE2 turns a gate to the wall it is going
 * into, so the run under the cursor decides it; picking the gate again while it
 * is already pending turns it by hand, for a gate with no wall to follow yet.
 */
let gateOrientation: 'x' | 'y' = 'x';

function orientationOf(kind: BuildingKind, at: Point): 'x' | 'y' {
  if (!playerRules().buildings[kind].footprint) return 'x';
  const joins = (dx: number, dy: number) => game.entities.some(e => !e.dead && e.owner === localPlayer
    && isWallKind(e.kind)
    && Math.abs(e.position.x - (at.x + dx)) < 0.6 && Math.abs(e.position.y - (at.y + dy)) < 0.6);
  const reach = Math.max(...Object.values(playerRules().buildings[kind].footprint!)) + 0.5;
  if (joins(-reach, 0) || joins(reach, 0)) return 'x';
  if (joins(0, -reach) || joins(0, reach)) return 'y';
  return gateOrientation;
}

function placeBuilding(kind: BuildingKind, targets: Point[]): void {
  const builders = ownSelected().filter(e => e.kind === (playerRules().buildings[kind].builderKind ?? 'villager')).map(e => e.id);
  if (!builders.length) { reject('Select a villager first'); return; }
  let failure: string | undefined;
  let accepted = false;
  for (const target of targets) {
    const result = applyCommand(game, {
      kind: 'build', player: localPlayer, builderIds: builders, building: kind, target,
      orientation: orientationOf(kind, target),
    });
    if (!result.ok) failure ??= result.reason;
    else accepted = true;
  }
  if (failure) reject(failure);
  if (accepted) acknowledge('attack');
}

renderer.domElement.addEventListener('pointerdown', event => {
  const point = screenToWorld(event.clientX, event.clientY);
  if (groundAttackers.length && !replay) {
    if (event.button === 0) {
      const result = applyCommand(game, { kind: 'attack-ground', player: localPlayer,
        entityIds: groundAttackers.filter(id => ownSelected().some(e => e.id === id)), target: point });
      if (!result.ok) reject(result.reason); else acknowledge('attack');
    }
    groundAttackers = []; return;
  }
  if (gatherPointBuildings.length && !replay) {
    const ids = gatherPointBuildings;
    gatherPointBuildings = [];
    if (event.button === 0) {
      const target = pickEntity(point);
      let accepted = false;
      for (const buildingId of ids) {
        if (!ownSelected().some(e => e.id === buildingId)) continue;
        const result = applyCommand(game, { kind: 'rally', player: localPlayer, buildingId,
          target: point, ...(target ? { targetId: target.id } : {}) });
        if (!result.ok) reject(result.reason);
        else accepted = true;
      }
      if (accepted) playSound('gatherpoint_set');
    }
    return;
  }
  if (event.button === 0) {
    if (unloadShips.length && !replay) {
      for (const id of unloadShips) {
        const result = applyCommand(game, { kind: 'ungarrison', player: localPlayer, buildingId: id, target: point });
        if (!result.ok) reject(result.reason);
      }
      unloadShips = [];
      return;
    }
    if (buildMode && isWall(buildMode) && !replay) {
      // A wall is dragged: the first press only anchors the line.
      wallStart = snapPlacement(point, playerRules().buildings[buildMode].radius);
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
let pointerOnCanvas = false;
let cursorPoint = { x: 0, y: 0 };
let cursorGame: GameState | undefined;
renderer.domElement.addEventListener('pointerenter', () => { pointerOnCanvas = true; cursorStamp = ''; });
renderer.domElement.addEventListener('pointerleave', () => { pointerOnCanvas = false; cursorStamp = ''; });
addEventListener('pointermove', event => {
  cursorPoint = { x: event.clientX, y: event.clientY };
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
    placeBuilding(buildMode, wallLine(wallStart, end, playerRules().buildings[buildMode].radius));
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
    const units = game.entities.filter(e => {
      if (e.dead || e.owner !== localPlayer || !isUnit(e.kind)) return false;
      const at = renderPosition(e);
      return at.x >= minX && at.x <= maxX && at.y >= minY && at.y <= maxY;
    });
    if (units.length) selectedIds = units.map(e => e.id);
  } else {
    const target = pickEntity(screenToWorld(event.clientX, event.clientY), 'selection');
    // The same thing clicked twice quickly takes every one of its kind that
    // can be seen, which is AoE2's rule and issue #6's request.
    const now = performance.now();
    const again = target && lastClick && lastClick.id === target.id
      && now - lastClick.at <= DOUBLE_CLICK_MS;
    lastClick = target ? { id: target.id, at: now } : undefined;
    if (target && again && !event.shiftKey) {
      selectedIds = sameKindOnScreen(game.entities.map(renderEntity), target, localPlayer, isOnScreen).map(e => e.id);
    } else if (target && target.owner === localPlayer) {
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
  const command = planContextCommand(game, localPlayer, selection, point, target, queue);
  if (!command) return;
  const result = applyCommand(game, command);
  if (!result.ok) { reject(result.reason); return; }
  if (command.kind === 'rally') {
    hud.showMessage('Rally point set');
    playSound('gatherpoint_set');
    return;
  }
  const hostile = target !== undefined && isHostile(target);
  if (selection.some(e => isUnit(e.kind))) acknowledge(
    hostile || (target && (target.kind === 'resource' || target.kind === 'farm'
      || target.buildProgress !== undefined || selection.some(e => isRepairable(game, e, target))))
      ? 'attack' : 'move');
  else hud.showMessage(hostile ? 'Target set' : 'Target cleared');
  if (hostile) orderFlash = { entityId: target!.id, startedAt: gameTimeSeconds(game) };
}

function updateContextCursor(): void {
  if (groundAttackers.some(id => !ownSelected().some(e => e.id === id))) groundAttackers = [];
  if (gatherPointSelection !== selectedIds.join(',')
    || gatherPointBuildings.some(id => !ownSelected().some(e => e.id === id && e.buildProgress === undefined))) gatherPointBuildings = [];
  const stamp = `${pointerOnCanvas}/${game.tick}/${selectedIds.join(',')}/${buildMode}/${repairMode}/${groundAttackers.join(',')}/${unloadShips.length}/${gatherPointBuildings.join(',')}/${!!replay}/${cursorPoint.x}/${cursorPoint.y}/${cameraCenter.x}/${cameraCenter.y}/${zoom}`;
  if (game === cursorGame && stamp === cursorStamp) return;
  cursorGame = game; cursorStamp = stamp;
  const point = screenToWorld(cursorPoint.x, cursorPoint.y);
  const selection = pointerOnCanvas ? ownSelected() : [];
  const target = pointerOnCanvas && selection.length ? pickEntity(point) : undefined;
  const name = pointerOnCanvas && groundAttackers.length ? 'attack' : pointerOnCanvas ? contextCursor(game, localPlayer, selection, point, target,
    { build: !!buildMode, repair: repairMode, unload: !!unloadShips.length,
      rally: !!gatherPointBuildings.length, replay: !!replay }) : 'default';
  const css = cursorCss(uiAssets, name);
  if (renderer.domElement.style.cursor !== css) renderer.domElement.style.cursor = css;
}

/**
 * Units this player has that were not there a frame ago. Owned units are
 * always visible, so a new id is one that finished training.
 */
let cueWatcher = createCueWatcher();
let constructionCues = new ConstructionCues();
let worldSounds = new WorldSounds();
let knownOwnUnits = new Set<number>();
let lastAnnouncedNextId = game.nextId;
function announceTrained(): void {
  const current = new Set<number>();
  for (const entity of game.entities) {
    if (entity.dead || entity.owner !== localPlayer || !isUnit(entity.kind)) continue;
    current.add(entity.id);
    if (knownOwnUnits.size && !knownOwnUnits.has(entity.id)) playUnitSound(entity, 'train');
    if (entity.id >= lastAnnouncedNextId) {
      hud.showMessage((messages.unitCreated ?? '--%s Created--').replace('%s', () => displayName(entity.kind)));
    }
  }
  knownOwnUnits = current;
  lastAnnouncedNextId = game.nextId;
}

// Keyboard: camera, hotkeys, menu.
const heldKeys = new Set<string>();
addEventListener('keydown', event => {
  if (hud.modalOpen) return;
  const key = event.key;
  if (event.target instanceof HTMLElement && event.target.closest('input, select, textarea, [contenteditable="true"]')) {
    if (key === 'Escape' || key === 'F10') {
      hud.toggleMenu(false); event.target.blur(); event.preventDefault();
    }
    return;
  }
  if (key.startsWith('Arrow')) { heldKeys.add(key); event.preventDefault(); return; }
  if (key === 'Escape') {
    if (groundAttackers.length) { groundAttackers = []; event.preventDefault(); return; }
    if (gatherPointBuildings.length) { gatherPointBuildings = []; event.preventDefault(); return; }
    if (unloadShips.length) { unloadShips = []; event.preventDefault(); return; }
    if (buildMode) { buildMode = undefined; wallStart = undefined; }
    else if (repairMode) repairMode = false;
    else if (hud.menuOpen) hud.toggleMenu(false);
    else hud.toggleMenu(true);
    return;
  }
  if (key === 'F3') { setPaused(!paused); event.preventDefault(); return; }
  if (key === 'F4') {
    revealMap = !revealMap;
    hud.showMessage(`Reveal map (debug): ${revealMap ? 'on' : 'off'}`);
    event.preventDefault();
    return;
  }
  // Every AoE2 F-key and Alt+R are bound, so the testing cheat takes Ctrl+Alt+R.
  if (event.ctrlKey && event.altKey && event.code === 'KeyR') {
    event.preventDefault();
    if (shared) { hud.showMessage('Resource cheat (debug): not available in shared play'); return; }
    const result = applyCommand(game, { kind: 'cheat-resources', player: localPlayer });
    hud.showMessage(result.ok ? 'Resource cheat (debug): +1000 food, wood, gold and stone' : `Resource cheat refused: ${result.reason}`);
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
      setPreferredSpeed(next);
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
      selectedIds.includes(e.id) && e.owner === localPlayer && !e.dead);
    // What is asked about is the DAT's own list, not "buildings": its
    // `hero_mode` bit 32 is set on the town center, watch tower, monastery,
    // castle and wonder and on nothing else, so a house or a barracks goes on
    // the keypress as a soldier does (issue #47).
    const asked = mine.filter(e =>
      isBuilding(e.kind) ? buildingRulesForEntity(game, e).confirmDelete
        : isUnit(e.kind) && unitRulesForEntity(game, e).confirmDelete);
    const match = game;
    const player = localPlayer;
    const remove = (result: ConfirmationResult): void => {
      if (result === 'aborted' || game !== match || localPlayer !== player) return;
      const doomed = result === 'yes' ? mine : mine.filter(e => !asked.includes(e));
      if (doomed.length) {
        applyCommand(game, { kind: 'delete', player, entityIds: doomed.map(e => e.id) });
        selectedIds = selectedIds.filter(id => !doomed.some(e => e.id === id));
      }
    };
    if (asked.length) {
      heldKeys.clear();
      const question = asked.length === 1
        ? messages.confirmDelete ?? 'Are you sure you want to delete this unit?'
        : messages.confirmDeleteMany ?? 'Are you sure you want to delete these units?';
      void hud.confirmDelete(question,
        messages.yes, messages.no).then(remove);
    } else remove('yes');
    event.preventDefault();
    return;
  }
  if (matchesHotkey(event, selectedHotkeys()?.names.NEXT_IDLE_VILLAGER ?? { key: '.' })) { selectIdleVillager(); return; }
  // Ctrl+<key> walks the buildings of a kind one at a time; Ctrl+Shift+<key>
  // takes the lot. Both the letters and the modifiers come from the
  // reference's own `hotkeys.json` through the UI import, so "Ctrl+Shift+B is
  // your barracks" is true of the reference rather than of whoever typed it.
  {
    const bindings = selectedHotkeys() ?? uiAssets?.hotkeys;
    const kind = Object.entries(event.shiftKey ? bindings?.selectAll ?? {} : bindings?.goto ?? {})
      .find(([, binding]) => matchesHotkey(event, binding))?.[0];
    if (kind) {
      const mine = game.entities.filter(e =>
        e.owner === localPlayer && e.kind === kind && !e.dead && e.buildProgress === undefined);
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
  if (!selectedHotkeys() && (key === 'h' || key === 'H')) {
    const tc = game.entities.find(e => e.owner === localPlayer && e.kind === 'town-center' && !e.dead);
    if (tc) {
      selectedIds = [tc.id];
      cameraCenter = elevatedWorldToIso(game, tc.position.x, tc.position.y);
    }
    return;
  }
  const commands = currentCommands();
  const match = commands.find(c => c.enabled && matchesHotkey(event, c.binding ?? (c.hotkey ? { key: c.hotkey } : undefined), c.id.startsWith('train-')));
  if (match) { event.preventDefault(); runUiCommand(match.id, event.shiftKey); }
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
  const rules = playerRules();
  const selection = ownSelected();
  const player = game.players[localPlayer];
  const buttons: CommandButton[] = [];
  const selectedMarket = selection.find(e => e.kind === 'market' && e.buildProgress === undefined);
  if (gatherPointBuildings.length || groundAttackers.length) {
    return [{ id: 'cancel', label: messages.cancel ?? 'Cancel', hotkey: 'escape', enabled: true,
      active: true, icon: hud.actionIcon(ACTION_ICON.cancel), slot: GRID_SLOT.cancel }];
  }
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
      for (const kind of buildMenu(rules, player.age, buildPage, player.researched)) {
        const building = buildingRulesFor(game, localPlayer, kind);
        if (!civHas(game, localPlayer, 'buildings', building.availabilityId ?? building.datId)) continue;
        if (buildingLimitReached(game, localPlayer, kind)) continue;
        buttons.push({
          id: `build-${kind}`,
          label: `${createLabel(kind, 'Build')} (${costLabel(building.cost)})`,
          help: helpFor(kind, building.cost),
          slot: building.buildButton,
          enabled: true,
          icon: hud.iconFor('Buildings', importedEntity(kind)?.iconId, localPlayer),
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
  if (selection.some(e => isUnit(e.kind) && !!((unitRulesForEntity(game, e).abilityFlags ?? 0) & 8))) {
    buttons.push({ id: 'attack-ground', label: messages.attackGround ?? 'Attack Ground',
      help: messages.attackGroundHelp ? plainHelp(messages.attackGroundHelp) : undefined,
      icon: hud.actionIcon(ACTION_ICON.attackGround), slot: 5, enabled: true });
  }
  if (selection.some(e => e.kind === 'fishing-ship') && player.age >= (rules.buildings['fish-trap'].age ?? 0)) {
    const trap = buildingRulesFor(game, localPlayer, 'fish-trap');
    buttons.push({ id: 'build-fish-trap', label: `${createLabel('fish-trap', 'Build')} (${costLabel(trap.cost)})`,
      help: helpFor('fish-trap', trap.cost), slot: trap.buildButton, enabled: true,
      icon: hud.iconFor('Buildings', importedEntity('fish-trap')?.iconId, localPlayer) });
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
  // Units" (`buttons.json`: action78, zero-based sequence9, icon2).
  if (selection.some(e => e.garrison?.length || e.relics?.length)) {
    const buildingGarrison = selection.some(e => isBuilding(e.kind) && (e.garrison?.length || e.relics?.length));
    const native = uiAssets?.commandButtons?.['78'];
    buttons.push({
      id: 'ungarrison', label: selection.some(e => e.kind === 'monk' && e.relics?.length) ? 'Drop Relic'
        : selection.some(e => e.kind === 'transport-ship') ? messages.unload ?? 'Unload'
          : buildingGarrison ? native?.name ?? 'Ungarrison All Units' : 'Ungarrison all units',
      icon: hud.actionIcon(buildingGarrison ? native?.iconId ?? ACTION_ICON.ungarrison : ACTION_ICON.ungarrison),
      slot: selection.some(e => e.kind === 'transport-ship' || e.kind === 'monk') ? 1
        : selection.some(e => e.kind === 'battering-ram' || e.kind === 'capped-ram') ? 5
        : buildingGarrison ? native?.slot ?? 10 : GRID_SLOT.ungarrison, enabled: true,
    });
  }
  const bellCenters = selection.filter(e => e.kind === 'town-center' && e.buildProgress === undefined);
  if (bellCenters.length) {
    const ringing = bellCenters.every(e => e.townBell);
    const native = uiAssets?.commandButtons?.[ringing ? '165' : '163'];
    buttons.push({ id: 'town-bell', slot: native?.slot ?? 15, enabled: true,
      label: ringing ? messages.backToWork ?? 'Back to work' : messages.townBell ?? 'Ring town bell',
      help: ringing ? messages.backToWorkHelp : messages.townBellHelp,
      icon: hud.actionIcon(native?.iconId ?? (ringing ? 61 : 49)) });
  }
  // Every completed production building offers the units the rules train there.
  const producer = selection.find(e => isBuilding(e.kind) && e.buildProgress === undefined
    && trainableAt(e.kind as BuildingKind).length > 0);
  if (producer) {
    const gather = uiAssets?.commandButtons?.['51'];
    buttons.push({ id: 'set-gather-point', label: messages.setGatherPoint ?? gather?.name ?? 'Set Gather Point',
      help: messages.setGatherPointHelp ? plainHelp(messages.setGatherPointHelp) : undefined,
      slot: gather?.slot ?? 5, icon: hud.actionIcon(gather?.iconId ?? 45), enabled: true });
    for (const kind of trainableAt(producer.kind as BuildingKind)) {
      const unitRules = unitRulesFor(game, localPlayer, kind);
      buttons.push({
        id: `train-${kind}`,
        label: `${createLabel(kind, 'Train')} (${costLabel(unitRules.cost)})`,
        help: helpFor(kind, unitRules.cost),
        slot: trainingAt(unitRules, producer.kind)?.button,
        // Not "is it already training" -- that is what the queue is for
        // (issue #7). Nor the price or the housing: the reference lets the
        // press through and says what is short (issue #70).
        enabled: queuedCount(producer) < TRAINING_QUEUE_LIMIT,
        icon: hud.iconFor('Units', importedEntity(kind)?.iconId, localPlayer),
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
  if (selectedMarket) {
    for (const [i, resource] of COMMODITIES.entries()) for (const side of ['sell', 'buy'] as const) {
      const gold = marketQuote(game, localPlayer, resource, side).gold;
      const name = `${side}${resource[0].toUpperCase()}${resource.slice(1)}`;
      buttons.push({ id: `exchange-${side}-${resource}`, slot: (side === 'sell' ? 7 : 12) + i,
        enabled: true, label: `${messages[name] ?? `${side} ${resource}`} (100: ${gold} gold)`,
        help: messages[`${name}Help`] ? plainHelp(messages[`${name}Help`].replace('%d', String(gold))) : undefined });
    }
    buttons.push({ id: 'market-tribute', slot: 5, enabled: true,
      label: (messages.payTribute ?? 'Pay Tribute (cost %d%%)').replace('%d', String(tributeFee(game, localPlayer, 100))).replace('%%', '%') });
  }
  // Technologies the selected building researches, in the DAT's own order.
  if (game.mode === 'regicide' && selection.some(e => e.kind === 'castle' && e.buildProgress === undefined)) {
    const source = Object.values(rules.technologies).find(t => t.techId === 408);
    buttons.push({ id: 'treason', slot: source?.button ?? 14, enabled: true,
      label: plainHelp(messages.treason ?? `Research Treason (${TREASON_GOLD} gold)`),
      help: messages.treasonHelp ? plainHelp(messages.treasonHelp) : 'Temporarily reveal enemy Kings on the minimap.',
      icon: hud.iconFor('Techs', source?.iconId, localPlayer) });
  }
  const player1 = game.players[localPlayer];
  for (const [key, tech] of Object.entries(rules.technologies) as [TechKey, typeof rules.technologies[TechKey]][]) {
    if (game.mode === 'regicide' && tech.effects.some(e => e.resource === 'spies')) continue;
    if (!civHas(game, localPlayer, 'technologies', tech.techId)) continue;
    const building = selection.find(e => e.kind === tech.researchedAt && e.buildProgress === undefined);
    if (!building) continue;
    if (player1.researched.includes(key)) continue;
    if (game.entities.some(e => !e.dead && e.owner === localPlayer
      && (e.researching?.tech === key || e.researchQueue?.includes(key)))) continue;
    if (rules.civilizationBonuses?.nodes[tech.techId]?.disabled) continue;
    if (tech.requiredTechCount === undefined && player1.age < tech.requiresAge) continue;
    // AoE2 does not show a technology whose predecessor is still outstanding:
    // Iron Casting appears once Forging is done, not beside it.
    if (!technologyRequirementsMet(game, localPlayer, tech)) continue;
    const researchCost = researchCostFor(game, localPlayer, key);
    buttons.push({
      id: `research-${key}`,
      label: `Research ${tech.name} (${costLabel(researchCost)})`,
      help: tech.help ? plainHelp(tech.help, researchCost) : undefined,
      slot: tech.button,
      enabled: (!building.researching || !!game.researchQueueVersion) && !shortfall(game, localPlayer, researchCost),
      icon: hud.iconFor('Techs', tech.iconId, localPlayer),
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
      label: `Auto-reseed farms: ${on ? 'on' : 'off'} (${costLabel(buildingRulesFor(game, localPlayer, 'farm').cost)} each)`,
      icon: hud.actionIcon(on ? ACTION_ICON.reseedOn : ACTION_ICON.reseedOff),
      enabled: true,
    });
  }
  // Keep native/DAT cells while resolving the active profile's binding.
  // Only unmapped Definitive extension commands fall back to grid letters;
  // an explicitly unbound native entry never borrows another profile's key.
  return placeCommands(buttons).flatMap((button, index) => {
    if (!button) return [];
    const actions: Record<string, number> = { 'page-economic': 116, 'page-military': 115, repair: 31,
      stop: 5, pack: 110, unpack: 111, 'attack-ground': 23, 'set-gather-point': 51, 'town-bell': 163,
      ungarrison: selection.some(e => e.kind === 'monk') ? 159
        : selection.some(e => e.kind === 'transport-ship') ? 7
          : selection.some(e => e.kind === 'battering-ram' || e.kind === 'capped-ram') ? 172 : 78 };
    const profile = selectedHotkeys();
    const training = producer && button.id.startsWith('train-')
      ? trainingAt(unitRulesFor(game, localPlayer, button.id.slice(6) as UnitKind), producer.kind) : undefined;
    const hotkeyCommand = training?.index ? `${button.id}@${training.index}` : button.id;
    let binding = commandHotkey(profile, game.players[localPlayer].civilization, hotkeyCommand,
      button.hotkey ?? (preferences.hotkeys === 'definitive' ? gridKey(index + 1) : undefined), actions[button.id]);
    const named = button.id.startsWith('exchange-') ? `MARKET_${button.id.slice(9).replaceAll('-', '_').toUpperCase()}`
      : button.id === 'treason' ? 'CASTLE_TREASON' : undefined;
    if (profile && named && Object.hasOwn(profile.names, named)) binding = profile.names[named] ?? undefined;
    return [{ ...button, slot: index + 1, binding, hotkey: binding ? hotkeyLabel(binding) : undefined }];
  });
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

const trainableAt = (building: BuildingKind): UnitKind[] => {
  return trainableUnitsAt(game, localPlayer, building);
};

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
  const rules = playerRules();
  const workers = { wood: 0, food: 0, gold: 0, stone: 0 };
  let idle = 0;
  let villagers = 0;
  for (const entity of game.entities) {
    if (entity.owner !== localPlayer || entity.dead || entity.kind !== 'villager') continue;
    villagers += 1;
    const resource = entity.carrying?.kind ?? gatherTargetResource(game, entity);
    if (resource) workers[resource] += 1;
    else if (entity.order.kind === 'idle') idle += 1;
  }
  const age = game.players[localPlayer].age;
  const imported = assets?.ages[age];
  // `eras.json` names the shield `ShieldDarkAge`; the material table spells
  // the button's normal state `ButtonsShieldDark-AgeNormal`.
  const shield = (imported?.shield ?? `Shield${['Dark', 'Feudal', 'Castle', 'Imperial'][age] ?? 'Dark'}Age`)
    .replace(/^Shield(.*)Age$/, 'ButtonsShield$1-AgeNormal');
  let ageProgress = 0;
  for (const entity of game.entities) {
    if (entity.owner !== localPlayer || !entity.researching) continue;
    const tech = rules.technologies[entity.researching.tech as TechKey];
    if (tech?.grantsAge === undefined) continue;
    const total = tech.researchSeconds / TICK_SECONDS;
    ageProgress = total > 0 ? 1 - entity.researching.remainingTicks / total : 0;
  }
  return { workers, villagers, idle, ageName: imported?.name ?? AGE_NAMES[age], ageShield: shield, ageProgress };
}

/**
 * The stat row beside the portrait, as the reference shows it: attack (the
 * positive class-4 amount, else class-3 -- the DAT's own `displayed_attack`), armour
 * as melee/pierce (classes 4 and 3), range when there is one, and what a
 * villager is carrying. Read through research, so Forging shows as +1.
 */
function selectionStats(entity: Entity): SelectionInfo['stats'] {
  if (entity.kind === 'resource' || isCarcass(entity)) return undefined;
  const icons = 'textures/ingame/staticons/';
  const stats: NonNullable<SelectionInfo['stats']> = [];
  // Scorpions retain a zero melee attack for rams' negative melee armour;
  // their displayed attack and icon are nevertheless the pierce attack.
  const attacksOf = (attacks: AttackValue[]) => attacks.find(a => a.class === 4 && a.amount > 0) ?? attacks.find(a => a.class === 3);
  const armourOf = (armors: AttackValue[], cls: number) => armors.find(a => a.class === cls)?.amount ?? 0;
  if (isUnit(entity.kind)) {
    const unit = unitRulesForEntity(game, entity);
    const attacks = entity.unpacked && unit.unpacked ? unit.unpacked.attacks : unit.attacks;
    const attack = attacksOf(attacks);
    if (attack && attack.amount > 0) stats.push({ icon: `${icons}${attack.class === 3 ? 'pierceAttack' : 'damage'}.png`, value: String(attack.amount), title: 'Attack' });
    stats.push({ icon: `${icons}armor.png`, value: `${armourOf(unit.armors, 4)}/${armourOf(unit.armors, 3)}`, title: 'Armor (melee/pierce)' });
    const range = entity.unpacked && unit.unpacked ? unit.unpacked.range : unit.range;
    if (range) stats.push({ icon: `${icons}range.png`, value: String(range), title: 'Range' });
    if (entity.carrying) stats.push({ icon: `${icons}${entity.carrying.kind}.png`, value: String(entity.carrying.amount), title: 'Carrying' });
  } else if (isBuilding(entity.kind)) {
    const building = buildingRulesForEntity(game, entity);
    if (building.attack) {
      const attack = attacksOf(building.attack.attacks);
      if (attack?.amount) stats.push({ icon: `${icons}pierceAttack.png`, value: String(attack.amount), title: 'Attack' });
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
  return ([1, 2] as const).map(player => {
    const rules = playerRules(player);
    const names = rules.civilization.computerNames ?? [];
    const computer = names.length ? names[(game.matchSeed ?? 0) % names.length] : 'Computer';
    return {
    number: player,
    name: shared ? (player === 1 ? 'Ysgramor' : 'Artemis') : player === 1 ? 'Player 1' : computer,
    color: hud.uiColor(playerColorName(player), 'Icons', playerColorHex(assets, player) ?? (player === 1 ? '#3b64ff' : '#ff3b3b'))!,
    textColor: hud.textColor(playerColorName(player), playerColorHex(assets, player) ?? '#ffffff'),
    // The civilisation's small icon is the material `<Name>Icon`, by the
    // reference's own name for it (`BritonsIcon`).
    civIcon: assets && (rules.civilization.internalName ?? rules.civilization.displayName)
      ? `${rules.civilization.internalName ?? rules.civilization.displayName}Icon` : undefined,
    age: game.players[player].age,
    };
  });
}

function productionItems(): ProductionItem[] {
  const items: ProductionItem[] = [];
  const self = game.players[localPlayer];
  for (const entity of game.entities) {
    if (entity.owner !== localPlayer || entity.dead) continue;
    if (entity.researching) {
      const tech = playerRules(localPlayer).technologies[entity.researching.tech as TechKey];
      if (tech) items.push({ producer: entity.id, name: tech.name,
        icon: hud.iconFor('Techs', tech.iconId, localPlayer),
        fraction: Math.floor(100 * (1 - entity.researching.remainingTicks * TICK_SECONDS
          / Math.max(TICK_SECONDS, researchSecondsFor(game, localPlayer, entity.researching.tech)))) / 100,
        blocked: false });
    }
    if (!entity.training) continue;
    for (const [index, kind] of [entity.training.kind, ...(entity.trainingQueue ?? [])].entries()) {
      const unit = unitRulesFor(game, localPlayer, kind);
      items.push({ producer: entity.id, name: displayName(kind), icon: hud.iconFor('Units', importedEntity(kind)?.iconId, localPlayer),
        fraction: index ? 0 : Math.floor(100 * (1 - entity.training.remainingTicks * TICK_SECONDS
          / (trainingAt(unit, entity.kind)?.seconds ?? unit.trainSeconds))) / 100,
        blocked: index === 0 && entity.training.remainingTicks <= 0 && self.population + unit.popCost > self.populationCap,
        pending: index > 0, count: 1 });
    }
  }
  return items;
}

function displayName(key: string): string {
  return nameFrom(key, importedEntity(key)?.text?.name);
}

/**
 * What the panel calls this entity right now. The reference names a villager
 * by its task -- "Lumberjack", "Forager", "Hunter" -- and the art already
 * picks that variant, so the name follows the same choice.
 */
function nameOf(entity: Entity): string {
  const variant = chooseAnimation(game, entity).key;
  const text = importedEntity(variant, entity.owner)?.text?.name ?? importedEntity(entityKey(entity), entity.owner)?.text?.name;
  return nameFrom(entityKey(entity), text);
}

/** The reference's button text ("Create Villager", "Build Mill"), or ours. */
function createLabel(key: string, verb: 'Build' | 'Train'): string {
  return importedEntity(key)?.text?.create ?? `${verb} ${displayName(key)}`;
}

/** The reference's tooltip for a build or train button, as plain text. */
function helpFor(key: string, cost: Cost): string | undefined {
  const help = importedEntity(key)?.text?.help;
  return help ? plainHelp(help, cost) : undefined;
}

function selectionInfo(): SelectionInfo | undefined {
  const selection = ownSelected().length
    ? ownSelected()
    : [...contextTargets(game, localPlayer, revealMap)].map(candidate => candidate.entity as Entity)
      .filter(e => selectedIds.includes(e.id) && (!e.dead || isCarcass(e)));
  const entity = selection[0];
  if (!entity) return undefined;
  const rules = playerRules(entity.owner);
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
        importedEntity(view.entityKey(member), member.owner)?.iconId, member.owner),
      hp: member.hp,
      maxHp: member.maxHp,
      hpColor: preferences.palette !== 'default' && (member.owner === 1 || member.owner === 2)
        ? hud.uiColor(playerColorName(member.owner), 'HealthBar') : undefined,
    }))
    : undefined;
  if (entity.kind === 'town-center' && entity.owner === localPlayer) details.push(AGE_NAMES[game.players[localPlayer].age]);
  if (entity.amount !== undefined) details.push(`${Math.floor(entity.amount)} ${entity.resourceKind}`);
  if (entity.owner === localPlayer && entity.garrison?.length) {
    const carrier = isUnit(entity.kind) ? unitRulesForEntity(game, entity) : undefined;
    const capacity = carrier
      ? carrier.transportCapacity ?? carrier.infantryCapacity
      : buildingRulesForEntity(game, entity)?.garrison?.capacity;
    details.push(`${garrisonCount(entity)}${capacity ? `/${capacity}` : ''} garrisoned`);
  }
  if (entity.carrying) details.push(`Carrying ${entity.carrying.amount} ${entity.carrying.kind}`);
  if (entity.owner === localPlayer && entity.relics?.length) details.push(`Relics: ${entity.relics.length}`);
  if (entity.owner === localPlayer && entity.kind === 'monk') details.push(`Faith: ${Math.floor(entity.faith ?? 100)}%`);
  if (entity.owner === localPlayer && isUnit(entity.kind)) {
    const unit = unitRulesForEntity(game, entity);
    const charge = unit.alternateAttack ?? (unit.fireCharge?.type === 6 ? unit.fireCharge : undefined);
    if (charge && charge.maximum > 0) details.push(`Charge: ${Math.floor(100 * (entity.charge ?? charge.maximum) / charge.maximum)}%`);
  }
  let progress: SelectionInfo['progress'];
  if (entity.buildProgress !== undefined) {
    progress = { label: 'Building', fraction: entity.buildProgress };
  } else if (entity.researching) {
    const tech = rules.technologies[entity.researching.tech as TechKey];
    const total = Math.max(1, researchSecondsFor(game, entity.owner as PlayerId, entity.researching.tech) / TICK_SECONDS);
    const fraction = Math.max(0, Math.min(1, 1 - entity.researching.remainingTicks / total));
    progress = {
      label: `${messages.researching ?? 'Researching'} ${Math.floor(fraction * 100)}%`,
      name: tech.name,
      fraction,
    };
  } else if (entity.training) {
    const unit = unitRulesFor(game, entity.owner, entity.training.kind);
    const total = (trainingAt(unit, entity.kind)?.seconds ?? unit.trainSeconds) / TICK_SECONDS;
    const fraction = Math.max(0, Math.min(1, 1 - entity.training.remainingTicks / total));
    progress = {
      label: entity.training.remainingTicks <= 0
        ? game.players[localPlayer].population >= populationLimitFor(game, localPlayer)
          ? messages.productionHoused ?? 'Population limit reached.'
          : messages.needMoreHouses ?? 'You need to build more houses.'
        : `${messages.creating ?? 'Creating'} ${Math.floor(fraction * 100)}%`,
      name: displayName(entity.training.kind),
      fraction,
    };
  }
  const iconIndex = importedEntity(view.entityKey(entity), entity.owner)?.iconId;
  const category = isUnit(entity.kind) ? 'Units' : 'Buildings';
  return {
    members,
    trainingQueue: entity.owner === localPlayer && (entity.training || entity.researching) && selection.length === 1 ? {
      buildingId: entity.id,
      cancelLabel: messages.stopCreating ?? 'Click to stop creating this unit.',
      entries: (entity.training ? [entity.training.kind, ...(entity.trainingQueue ?? [])] : []).map(kind => ({
        kind,
        name: displayName(kind),
        icon: hud.iconFor('Units', importedEntity(kind, entity.owner)?.iconId, entity.owner),
      })),
      ...(entity.researching ? { research: [entity.researching.tech, ...(entity.researchQueue ?? [])].map(key => {
        const tech = rules.technologies[key as TechKey];
        return {
          name: tech.name,
          icon: hud.iconFor('Techs', tech.iconId, entity.owner),
          cancelLabel: messages.stopResearching ?? 'Click to stop researching this item.',
        };
      }) } : {}),
    } : undefined,
    name,
    hpColor: preferences.palette !== 'default' && (entity.owner === 1 || entity.owner === 2)
      ? hud.uiColor(playerColorName(entity.owner), 'HealthBar') : undefined,
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
  if (revealMap || entity.owner === localPlayer) return true;
  return isTileVisible(game, localPlayer, entity.position.x, entity.position.y);
}

function syncScene(time: number): void {
  musicPlayer.update(preferences.music > 0 && !paused && !matchOver(game) && !document.hidden);
  const wanted = new Set<string>();
  const soundPoses = new Map<number, SoundPose>();
  for (const entity of game.entities) {
    if (!entityVisible(entity)) continue;
    if (!revealMap && entity.owner === 0 && !isTileVisible(game, localPlayer, entity.position.x, entity.position.y)) {
      // Gaia in unseen tiles is handled through memory below.
      continue;
    }
    const key = `e${entity.id}`;
    wanted.add(key);
    let entityView = views.get(key);
    // A herdable changes hands, and its player colour is bound into the view's
    // material when the view is built: a captured sheep needs a new one.
    if (entityView && entityView.owner !== entity.owner) {
      retireEntityView(entityView);
      entityView = undefined;
    }
    if (!entityView) {
      entityView = view.createEntityView(assets, entity);
      views.set(key, entityView);
      scene.add(entityView.group);
    }
    view.updateEntityView(entityView, assets, game, renderEntity(entity), time);
    if (entityView.soundPose && isOnScreen(renderPosition(entity))
      && isTileVisible(game, localPlayer, entity.position.x, entity.position.y)) {
      soundPoses.set(entity.id, entityView.soundPose);
    }
  }
  for (const cue of worldSounds.poll(soundPoses)) {
    const prefix = soundPoses.get(cue.id)!.key.match(/^civilizations\/[^/]+\//)?.[0] ?? '';
    audioPlayer.play(`${prefix}events/${cue.event}`, 'world', 0.6);
  }
  const center = isoToWorld(cameraCenter.x, cameraCenter.y);
  const terrainId = game.terrain[Math.floor(center.y) * game.width + Math.floor(center.x)];
  const ambientEvent = Object.values(assets?.terrain ?? {}).find(slot => slot.terrainId === terrainId)?.soundEvent;
  audioPlayer.ambient(!paused && !document.hidden && ambientEvent
    && isTileVisible(game, localPlayer, center.x, center.y) ? `terrain/${ambientEvent}` : undefined,
  performance.now() / 1000);
  // Remembered entities render as whole, dimmed static snapshots. Ground fog
  // sits beneath bodies, so it cannot cut through their crowns and roofs.
  // A revealed board draws the real entities, so the snapshots stand down.
  for (const remembered of revealMap ? [] : Object.values(game.visibility[localPlayer].memory)) {
    if (isTileVisible(game, localPlayer, remembered.x, remembered.y)) continue;
    const key = `m${remembered.id}`;
    wanted.add(key);
    let entityView = views.get(key);
    if (!entityView) {
      const fake: Entity = {
        id: remembered.id, kind: remembered.kind, owner: remembered.owner,
        position: { x: remembered.x, y: remembered.y },
        hp: remembered.hp, maxHp: remembered.maxHp, radius: 0.5,
        activity: 'idle', order: { kind: 'idle' },
        resourceKind: remembered.resource, node: remembered.node, amount: remembered.amount,
      };
      entityView = view.createEntityView(assets, fake);
      view.updateEntityView(entityView, assets, game, fake, 0, !!remembered.hasGarrison);
      view.dimFogSnapshot(entityView);
      views.set(key, entityView);
      scene.add(entityView.group);
    }
    view.refreshEntityTextures(entityView, assets);
  }
  // Gather-point flags: AoE2 shows one where a selected building sends what it
  // trains, and only while that building is selected.
  for (const entity of game.entities) {
    if (entity.dead || !entity.rally || entity.owner !== localPlayer) continue;
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
    if (!revealMap && !isTileVisible(game, localPlayer, projectile.position.x, projectile.position.y)) continue;
    const key = `p${projectile.id}`;
    const position = shared?.renderProjectile(projectile) ?? projectile.position;
    wanted.add(key);
    const target = game.entities.find(e => e.id === projectile.targetId);
    const targetPosition = target ? renderPosition(target) : undefined;
    const heading = targetPosition
      ? Math.atan2(targetPosition.y - position.y, targetPosition.x - position.x)
      : 0;
    // Progress along the shot, measured against the launch point so a moving
    // target still gives a sane 0..1 sweep.
    const flown = Math.hypot(
      position.x - projectile.origin.x,
      position.y - projectile.origin.y,
    );
    const left = targetPosition
      ? Math.hypot(targetPosition.x - position.x, targetPosition.y - position.y)
      : 0;
    const span = flown + left;
    const progress = projectile.impact ? 1 - projectile.impact.remainingTicks / projectile.impact.totalTicks
      : span > 1e-6 ? flown / span : 0;
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
      ? (playerRules(shooter.owner).units as Partial<Record<string, UnitRules>>)[shooter.kind]
      : undefined;
    const art = projectile.art ?? shooterRules?.unpacked?.projectileArt ?? shooterRules?.projectileArt ?? 'arrow';
    view.updateProjectileView(
      entityView, assets, position, heading, progress, span, projectile.launchHeight,
      profileArtKey(assets, projectile.owner, art), time, elevationAt(game, position.x, position.y) * ELEVATION_PIXELS,
      projectile.impact?.effect,
    );
  }

  for (const [key, entityView] of views) {
    if (!wanted.has(key)) {
      retireEntityView(entityView);
      views.delete(key);
    }
  }

  announceTrained();
  for (const id of constructionCues.poll(game, localPlayer)) {
    const building = game.entities.find(entity => entity.id === id);
    if (building) playUnitSound(building, 'construction');
  }
  // Alerts and feedback, read out of what the view can already see. The
  // simulation never raises them: it does not know about sound.
  const researchedBefore = cueWatcher.researched;
  const cuesStarted = cueWatcher.started;
  for (const cue of view.pollCues(cueWatcher, game, localPlayer, gameTimeSeconds(game))) {
    playSound(cue);
    if (cue === 'under_attack') hud.showMessage('Your units are under attack!');
    if (cue === 'under_attack_town') hud.showMessage('Your town is under attack!');
    if (cue === 'farm_depleted') hud.showMessage('Farm depleted.');
  }
  if (cuesStarted) {
    for (const key of game.players[localPlayer].researched.slice(researchedBefore)) {
      const tech = playerRules(localPlayer).technologies[key as TechKey];
      if (!tech) continue;
      const name = tech.name;
      hud.showMessage((messages.researchComplete ?? '--%s Research Complete--').replace('%s', name));
    }
  }

  // Contours for units something else is drawing in front of, once every
  // piece this frame has been placed.
  view.updateOcclusion(views, game);
  fillScatter(scatter, assets, game, localPlayer, revealMap);

  // Selection markers from reusable pools: rings under units, footprint
  // outlines on the ground under buildings and resources (`selectionMarker`).
  let ringsUsed = 0;
  let outlinesUsed = 0;
  const drawMarker = (entity: Entity): void => {
    const marker = selectionMarker(entity);
    const position = renderPosition(entity);
    const iso = elevatedWorldToIso(game, position.x, position.y);
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
    const shape = buildingFootprint(game, buildMode, orientationOf(buildMode, placementTarget()), localPlayer);
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
    const legal = !buildingLimitReached(game, localPlayer, buildMode)
      && placementLegal(game, buildMode, target, orientationOf(buildMode, target), localPlayer).ok;
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
  updateContextCursor();
}

/**
 * The tiles a wall drag would fill, each tinted by whether it could stand
 * there. A single ghost would say nothing about the length of the line.
 */
const wallGhosts: THREE.Mesh[] = [];
function updateWallPreview(): void {
  const rules = playerRules();
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
    const legal = placementLegal(game, buildMode!, tile, 'x', localPlayer).ok;
    (mesh.material as THREE.MeshBasicMaterial).color.set(legal ? 0x7fff9e : 0xff5f5f);
  }
}

/** Where the pending building would actually land, snapped to the tile grid. */
function placementTarget(): Point {
  if (!buildMode) return pointerWorld;
  const rough = snapPlacement(pointerWorld, playerRules().buildings[buildMode].radius);
  return snapPlacement(pointerWorld, buildingFootprint(game, buildMode, orientationOf(buildMode, rough), localPlayer));
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
const snapshot = (): void => { if (!replay && !shared) saveSession(game, setupKnown ? activeSetup : undefined); };
addEventListener('pagehide', snapshot);
addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') snapshot(); });

let previous = performance.now();
let accumulator = 0;
let hudClock = 0;
let ended = false;
let shownAge = game.players[localPlayer].age;

renderer.setAnimationLoop(now => {
  shared?.beginRender(performance.now());
  const elapsed = Math.min(0.1, (now - previous) / 1000);
  previous = now;
  panCamera(elapsed);

  if (game.players[localPlayer].age !== shownAge) {
    shownAge = game.players[localPlayer].age;
    hud.showMessage(`Advancing to the ${AGE_NAMES[shownAge]}`);
  }

  if (!shared && !paused && !matchOver(game)) {
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
    hud.updateResources(game, localPlayer, resourceStatus());
    if (hud.diplomacy.open) hud.diplomacy.update(diplomacyModel());
    hud.updateProduction(productionItems());
    hud.updateScore(scoreRows());
    hud.wonders.update(game, localPlayer, { 1: scoreRows()[0].name, 2: scoreRows()[1].name });
    hud.setCommands(currentCommands());
    hud.setSelection(selectionInfo());
    hud.minimap.draw(game, isoToWorld(cameraCenter.x, cameraCenter.y), {
      w: innerWidth / zoom / TILE_W * 1.2,
      h: innerHeight / zoom / TILE_H * 0.9,
    }, assets, revealMap);
    if (game.draw && !ended) {
      ended = true;
      hud.diplomacy.close();
      hud.showPopup(`${(messages.gameOver ?? 'Game over.').split('.')[0]}.\n${game.wonderDraw ? 'Draw: both Wonder countdowns expired together.' : 'Draw: both Kings were lost in the same tick.'}`);
    }
    if (game.winner && !ended) {
      ended = true;
      hud.diplomacy.close();
      const defeated = scoreRows().find(row => row.number !== game.winner)!;
      hud.showDefeat(defeated);
      hud.showEnd(game.winner === localPlayer);
    }
    if (!matchOver(game)) ended = false;
  }

  assets?.spriteResidency?.sweep();
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
// Defer the debug import until all per-match view state has been initialized.
if (import.meta.hot) void installDevelopmentDebug();

function disposeObject(object: THREE.Object3D): void {
  object.traverse(child => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.dispose();
    const material = child.material;
    if (Array.isArray(material)) material.forEach(entry => entry.dispose());
    else material.dispose();
  });
}

/** Geometry/materials belong to this view; atlas and palette textures belong
 * to ContentAssets and must survive for the next view using them (#164). */
function retireEntityView(entityView: EntityView): void {
  scene.remove(entityView.group);
  disposeObject(entityView.group);
}

/** Recreate every view-owned object from the current simulation state. */
function rebuildPresentation(): void {
  presentationRebuilds++;
  scene.remove(ground);
  disposeObject(ground);
  ground = view.createGround(game, assets);
  scene.add(ground);
  scene.remove(scatter);
  disposeObject(scatter);
  scatter = createScatter(game, assets);
  scene.add(scatter);

  scene.remove(fog.mesh);
  disposeObject(fog.mesh);
  fog.dispose();
  fog = view.createFog(game, localPlayer);
  scene.add(fog.mesh);
  fog.update(game);

  for (const entityView of views.values()) retireEntityView(entityView);
  views.clear();
  disposeGhost();

  const menuWasOpen = hud.menuOpen;
  const endWasOpen = hud.endOpen;
  hud.destroy();
  hud = createHud();
  if (menuWasOpen) hud.toggleMenu(true);
  hud.updateResources(game, localPlayer, resourceStatus());
  hud.updateProduction(productionItems());
  hud.updateScore(scoreRows());
  hud.setCommands(currentCommands());
  hud.setSelection(selectionInfo());
  if (game.winner && endWasOpen) hud.showEnd(game.winner === localPlayer);

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
        if (assets) assets.civilizationForOwner = owner => owner === 1 || owner === 2 ? game.players[owner].civilization : undefined;
      }
      if (world) {
        view.createGround = world.createGround;
        view.createFog = world.createFog;
        view.createFootprint = world.createFootprint;
      }
      if (sprites) {
        view.createEntityView = sprites.createEntityView;
        view.updateEntityView = sprites.updateEntityView;
        view.refreshEntityTextures = sprites.refreshEntityTextures;
        view.dimFogSnapshot = sprites.dimFogSnapshot;
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
