import * as THREE from 'three/webgpu';
import { skinFamilies, type SkinFamily } from './skins';

export type Frame = { x: number; y: number; w: number; h: number; cx: number; cy: number };
export type Atlas = { image: string; size: [number, number]; framesInFile: number; frames: Frame[] };
export type AnimationInfo = { frames: number; directions: number; frameSeconds: number; mirroringMode: number };

export interface ImportedEntity {
  category: string;
  iconId?: number;
  /**
   * The reference's own strings for it (issue #48): `name` is the DAT's
   * `language_dll_name` verbatim -- "Man-at-Arms", "Lumberjack", and for the
   * base villager "Villager (Male)", the editor's qualifier included --
   * `create` the button text ("Create Villager") and `help` the tooltip
   * with the reference's markup (`<b>`, `<cost>`, a literal `\n`).
   */
  text?: { name?: string; create?: string; help?: string };
  /** A skin: drawn in place of `skinOf` at `chance` percent (on the base's
   * skin only), one of the family `skin`. See `skins.ts`. */
  skinOf?: string;
  skin?: string;
  chance?: number;
  /** What a selection draws on the ground: the DAT's obstruction shape —
   * round under a unit, the outline box (half-extents in tiles, can exceed
   * the collision box) under a building or resource. `dead` is the corpse
   * unit's own shape, which is what a selected carcass is marked with. */
  selection?: {
    shape: 'round' | 'square';
    outline: [number, number];
    dead?: { shape: 'round' | 'square'; outline: [number, number] };
  };
  /** Projectiles only: arc height as a fraction of the shot's distance. */
  projectile?: { arc: number };
  animations: Record<string, AnimationInfo>;
  atlases: Record<string, Atlas>;
  annexes?: { unitId: number; misplacement: [number, number]; animations: Record<string, AnimationInfo>; atlases: Record<string, Atlas> }[];
  /**
   * A building's fires (issue #73): per standing animation (the age's own
   * picture has its own), the DAT's `damage_graphics` thresholds ascending,
   * each the particle effects it lights and where, in sprite pixels from the
   * hotspot, y down.
   */
  damageStages?: Record<string, DamageStage[]>;
}

export interface DamageStage {
  /** The fraction of hit points lost, in percent, past which this stage shows. */
  percent: number;
  flames: { effect: string; offset: [number, number] }[];
}

/**
 * One of the reference's particle effects, as the flipbook it is: frames cut
 * from its atlas at its own scale and pivot, cycling over a length drawn
 * between `cycleSeconds`, fading in and out over its own seconds.
 */
export interface ParticleEffect {
  atlas: Atlas;
  loop: boolean;
  cycleSeconds: [number, number];
  fadeInSeconds: number;
  fadeOutSeconds: number;
}

/** One player's block of the game palette, found at the DAT's own colour base. */
export interface PlayerColor {
  name: string;
  colorBase: number;
  minimapColor: [number, number, number];
  /** What an obscured unit's contour is drawn in; a DAT field, not a choice. */
  outlineColor: [number, number, number];
  /** The eight shades AoE2 draws this player's colour with, darkest first. */
  ramp: [number, number, number][];
}

export interface PlayerColors {
  palette: string;
  /** The grey each shade stands for, from the grey player's identity block. */
  shadeLevels: number[];
  players: Record<string, PlayerColor>;
}

/** One DAT terrain slot: a tiling texture spanning `dimensions` tiles. */
export interface ImportedTerrain {
  /** The DAT slot this is, so the ground can be bucketed by what the map says. */
  terrainId: number;
  /** Which of two meeting terrains is painted over the other, and which
   * family of blend masks the edge is drawn with. Both the DAT's own. */
  blendPriority: number;
  blendType: number;
  name: string;
  texture: string;
  image: string;
  dimensions: [number, number];
  minimapColor: [number, number, number];
}

/**
 * The owned terrain blend masks, decoded from `blendomatic_x1.dat`.
 *
 * One atlas per blending mode, 31 masks laid left to right, each the
 * reference's own 97x49 diamond. `edges` says which columns face which world
 * neighbour — four interchangeable variants apiece, so a long boundary does
 * not repeat one silhouette.
 */
export interface BlendMasks {
  tile: [number, number];
  modes: THREE.Texture[];
  edges: Record<string, number[]>;
  masksPerMode: number;
  /** Pixels of gutter either side of every column, so a seam sample stays
   * inside its own mask. */
  gutter: number;
  /** The column past the owned masks: the whole diamond, opaque. Ours. */
  solid: number;
}

/**
 * The atlas u of a point `t` (0..1) across mask `column`: the column's
 * pitch is the tile plus its gutters, and `t` spans the tile only.
 */
export function maskU(blends: BlendMasks, column: number, t: number): number {
  const pitch = blends.tile[0] + 2 * blends.gutter;
  return (column * pitch + blends.gutter + t * blends.tile[0]) / (pitch * blends.masksPerMode);
}

/**
 * One water preset as `water_def.json` states it and the importer carries
 * it: the reference draws water through a shader rather than a tile, and
 * these are that shader's inputs. Texture paths are relative to the content
 * base and are loaded into `ContentAssets.textures` like the terrain.
 */
export interface WaterPreset {
  name: string;
  normal: string;
  normalVelocity: [number, number];
  normalDirection: [[number, number], [number, number]];
  normalAzimuth: number;
  normalScale: number;
  sky: string;
  seaFloor: string;
  sunDirection: [number, number, number];
  sunColor: [number, number, number];
  skyColor: [number, number, number];
  waterColor: [number, number, number];
  seaFloorIntensity: number;
  skyIntensity: number;
  skyRotation: number;
  skyScale: number;
  specularIntensity: number;
  specularPower: number;
  mapScale: number;
  seaFloorScale: number;
  waveAnimationSpeed: number;
  waveRepeatLength: number;
  waveAmplitude: number;
  types: Record<string, { reflectivity: number; opacity: number }>;
}

/** One age as `eras.json` states it: its name and the shield it wears. */
export interface ImportedAge { name?: string; shield: string }

export interface ContentAssets {
  entities: Record<string, ImportedEntity>;
  /** The base era's ages in order, Dark to Imperial. */
  ages: ImportedAge[];
  /** Skin families by the base key they stand in for. */
  skins: Map<string, SkinFamily[]>;
  terrain: Record<string, ImportedTerrain>;
  /** Water presets by `water_def.json` index; absent without owned content. */
  water?: Record<string, WaterPreset>;
  textures: Map<string, THREE.Texture>;
  playerColors?: PlayerColors;
  /** One 256-texel ramp per player, indexed by a sprite's own grey. */
  playerRamps: Map<number, THREE.DataTexture>;
  blends?: BlendMasks;
  /** The reference's particle effects the content names, by name. */
  particles?: Record<string, ParticleEffect>;
}

interface UiMaterial {
  type: string;
  blend?: string | null;
  texture?: string;
  /** For a player-coloured icon: the owner's weight per pixel, white where all of it. */
  playerColorMask?: string;
  color?: { r: number; g: number; b: number; a: number };
}
export interface UiLayoutWidget {
  Name?: string;
  Type?: string;
  ViewPort?: { xorigin: number; yorigin: number; width: number; height: number; alignment?: string };
  /** An `Anchor` widget carries a bare origin here instead of a ViewPort. */
  Anchor?: { xorigin: number; yorigin: number };
  StateMaterials?: Record<string, { Material?: string }>;
  ChildWidgets?: UiLayoutWidget[];
}
export interface UiLayout {
  viewPort: { width: number; height: number; xorigin: number; yorigin: number; alignment?: string };
  widgets: UiLayoutWidget[];
}
/** A key the reference binds, as `hotkeys.json` gives it. */
export interface ImportedHotkey { key: string; control?: boolean; shift?: boolean; alt?: boolean }

export interface UiAssets {
  base: string;
  /** The reference's faces, copied as they ship: file name -> path under `base`. */
  fonts?: Record<string, string>;
  /** `UIColors.json`: per player colour name, the tints its text and bars use. */
  colors?: { PresetColors?: Record<string, number[]>; ColorTables?: Record<string, Record<string, number[]>> };
  /** Keys taken from the reference's own `hotkeys.json`, per action. */
  hotkeys?: { goto?: Record<string, ImportedHotkey>; selectAll?: Record<string, ImportedHotkey> };
  layouts: Record<string, UiLayout>;
  materials: Record<string, UiMaterial>;
  icons: Record<string, Record<string, string>>;
}

export interface AudioAssets {
  base: string;
  audio: Record<string, { event: string; files: { file: string; mediaId: number; seconds: number }[] }>;
}

const CONTENT_BASE = '/imported/aoe2/';
const UI_BASE = '/imported/aoe2/ui/';
const AUDIO_BASE = '/imported/aoe2/audio/';

async function fetchJson<T>(url: string): Promise<T | undefined> {
  try {
    const response = await fetch(url);
    if (!response.ok) return undefined;
    return await response.json() as T;
  } catch {
    return undefined;
  }
}

export const RAMP_LEVELS = 256;

/**
 * A player's ramp resolved for every grey a sprite can carry.
 *
 * The player-colour art is painted in greys, and the palette holds only eight
 * shades per player. `shadeLevels` says which grey each of those eight shades
 * stands for - it is the grey player's own block, which is why that block is an
 * identity ramp - so inverting it turns a sprite's grey into a position in this
 * player's block. Positions between two shades interpolate, which keeps a
 * smooth gradient without inventing a colour outside the player's own eight.
 */
export function rampLut(ramp: [number, number, number][], shadeLevels: number[]): Uint8Array {
  const data = new Uint8Array(RAMP_LEVELS * 4);
  const last = ramp.length - 1;
  for (let grey = 0; grey < RAMP_LEVELS; grey++) {
    let index = 0;
    while (index < last - 1 && shadeLevels[index + 1] < grey) index++;
    const span = shadeLevels[index + 1] - shadeLevels[index];
    const fraction = Math.max(0, Math.min(1, span > 0 ? (grey - shadeLevels[index]) / span : 0));
    for (let channel = 0; channel < 3; channel++) {
      data[grey * 4 + channel] = Math.round(
        ramp[index][channel] + (ramp[index + 1][channel] - ramp[index][channel]) * fraction,
      );
    }
    data[grey * 4 + 3] = 255;
  }
  return data;
}

function rampTexture(color: PlayerColor, shadeLevels: number[]): THREE.DataTexture {
  const texture = new THREE.DataTexture(rampLut(color.ramp, shadeLevels), RAMP_LEVELS, 1);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

export async function loadContentAssets(): Promise<ContentAssets | undefined> {
  const manifest = await fetchJson<{
    entities: Record<string, ImportedEntity>;
    ages?: ImportedAge[];
    terrain?: Record<string, ImportedTerrain>;
    water?: Record<string, WaterPreset>;
    playerColors?: PlayerColors;
    particles?: Record<string, ParticleEffect>;
  }>(`${CONTENT_BASE}manifest.json`);
  if (!manifest) return undefined;
  const textures = new Map<string, THREE.Texture>();
  const loader = new THREE.TextureLoader();
  const jobs: Promise<void>[] = [];
  const loadAtlases = (atlases: Record<string, Atlas>) => {
    for (const atlas of Object.values(atlases)) {
      jobs.push(loader.loadAsync(CONTENT_BASE + atlas.image).then(texture => {
        texture.colorSpace = THREE.SRGBColorSpace;
        // Sprites are x1 art drawn at 1:1 CSS pixels, so a HiDPI backing store
        // or zoom magnifies them; nearest sampling turned that into visible
        // blocks. Filter linearly (applyFrame insets the UVs by half a texel so
        // neighbouring atlas frames cannot bleed in). Mipmaps stay off: they
        // would blend across frame boundaries within the atlas.
        texture.magFilter = THREE.LinearFilter;
        texture.minFilter = THREE.LinearFilter;
        texture.generateMipmaps = false;
        // A player-colour sheet is not a picture: its RGB is the shade to look
        // up in the player's ramp, so it must arrive as the byte the importer
        // wrote rather than as an sRGB colour to be decoded.
        if (atlas.image.endsWith('-playercolor.png')) texture.colorSpace = THREE.NoColorSpace;
        textures.set(atlas.image, texture);
      }));
    }
  };
  for (const entity of Object.values(manifest.entities)) {
    loadAtlases(entity.atlases);
    for (const annex of entity.annexes ?? []) loadAtlases(annex.atlases);
  }
  for (const effect of Object.values(manifest.particles ?? {})) loadAtlases({ flipbook: effect.atlas });
  const terrain = manifest.terrain ?? {};
  for (const slot of Object.values(terrain)) {
    jobs.push(loader.loadAsync(CONTENT_BASE + slot.image).then(texture => {
      texture.colorSpace = THREE.SRGBColorSpace;
      // Terrain is a continuous tiling surface, not a sprite atlas: repeat it
      // and filter smoothly so tile seams do not show at any zoom.
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.magFilter = THREE.LinearFilter;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.generateMipmaps = true;
      // The dimetric projection squashes a tile to half its height, so the
      // ground minifies about twice as fast vertically as horizontally.
      // Isotropic mipmapping would pick the level for the worst axis and blur
      // away detail the 2048px source actually has; sample along the axis
      // instead. 16 is the WebGPU maximum.
      texture.anisotropy = 16;
      textures.set(slot.image, texture);
    }));
  }
  // The water shader's textures. The normal map and the sea floor tile
  // across the water like terrain; the sky dome is looked up by a reflected
  // direction and is clamped. The normal map is data, not colour.
  const water = manifest.water ?? {};
  const waterImages = new Set<string>();
  for (const preset of Object.values(water)) {
    for (const image of [preset.normal, preset.sky, preset.seaFloor]) waterImages.add(image);
  }
  for (const image of waterImages) {
    jobs.push(loader.loadAsync(CONTENT_BASE + image).then(texture => {
      const sky = image === Object.values(water).find(p => p.sky === image)?.sky;
      const normal = Object.values(water).some(p => p.normal === image);
      texture.colorSpace = normal ? THREE.NoColorSpace : THREE.SRGBColorSpace;
      texture.wrapS = sky ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
      texture.wrapT = texture.wrapS;
      texture.magFilter = THREE.LinearFilter;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.generateMipmaps = true;
      texture.anisotropy = 16;
      textures.set(image, texture);
    }));
  }
  await Promise.all(jobs);
  const playerColors = manifest.playerColors;
  const playerRamps = new Map<number, THREE.DataTexture>();
  for (const [player, color] of Object.entries(playerColors?.players ?? {})) {
    playerRamps.set(Number(player), rampTexture(color, playerColors!.shadeLevels));
  }
  // The blend masks. They are sampled per tile in the mesh's second UV set,
  // so they must not repeat or filter across a column boundary: clamped, and
  // linear only within a mask.
  let blends: BlendMasks | undefined;
  const blendSpec = (manifest as { blends?: { tile: [number, number]; gutter?: number; modes: { image: string; masks: number }[]; edges: Record<string, number[]>; solid: number } }).blends;
  if (blendSpec?.modes?.length) {
    const modes = await Promise.all(blendSpec.modes.map(mode =>
      loader.loadAsync(CONTENT_BASE + mode.image).then(texture => {
        texture.colorSpace = THREE.NoColorSpace;
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.magFilter = THREE.LinearFilter;
        texture.minFilter = THREE.LinearFilter;
        texture.generateMipmaps = false;
        // The mask rides in the mesh's second UV set; the terrain it fades
        // keeps the first.
        texture.channel = 1;
        return texture;
      })));
    blends = {
      tile: blendSpec.tile, modes, edges: blendSpec.edges,
      masksPerMode: blendSpec.modes[0].masks, gutter: blendSpec.gutter ?? 0, solid: blendSpec.solid,
    };
  }
  return {
    entities: manifest.entities, skins: skinFamilies(manifest.entities), ages: manifest.ages ?? [],
    terrain, water: Object.keys(water).length ? water : undefined,
    textures, playerColors, playerRamps, blends, particles: manifest.particles,
  };
}

export async function loadUiAssets(): Promise<UiAssets | undefined> {
  const manifest = await fetchJson<Omit<UiAssets, 'base'>>(`${UI_BASE}manifest.json`);
  if (!manifest) return undefined;
  return { base: UI_BASE, ...manifest };
}

export async function loadAudioAssets(): Promise<AudioAssets | undefined> {
  const manifest = await fetchJson<Omit<AudioAssets, 'base'>>(`${AUDIO_BASE}manifest.json`);
  if (!manifest) return undefined;
  return { base: AUDIO_BASE, ...manifest };
}

/** CSS url for a material's converted texture, or undefined. */
export function materialUrl(ui: UiAssets | undefined, name: string): string | undefined {
  const texture = ui?.materials[name]?.texture;
  return texture ? `${ui!.base}${texture}` : undefined;
}

/** Icon material url by category/index. */
export function iconUrl(ui: UiAssets | undefined, category: string, index: number): string | undefined {
  if (!ui) return undefined;
  const material = ui.icons[category]?.[String(index).padStart(3, '0')];
  return material ? materialUrl(ui, material) : undefined;
}

/**
 * The blend the reference's icon materials declare. The shipped icon is
 * opaque everywhere but the owner's cloth, where its alpha is how much of
 * the icon's own colour stays and the RGB the shading the owner's colour
 * takes (issue #77). The importer splits that into an opaque picture and a
 * weight mask, because a canvas premultiplies and would lose the shading.
 */
export const PLAYER_COLOR_BLEND = 'AlphaPlayerColor';

/** The rec.601 luminance of a pixel, as a grey the ramp can be indexed by. */
export function luminance(red: number, green: number, blue: number): number {
  return Math.round(red * 0.299 + green * 0.587 + blue * 0.114);
}

/**
 * Colour one icon's RGBA bytes for an owner, in place. A pixel takes the
 * owner's shade by its weight in the mask and keeps its own colour for the
 * rest, the shade being the owner's palette ramp read at the pixel's own
 * luminance -- the same ramp a sprite's player-colour layer resolves through,
 * so a unit and its portrait wear the one colour.
 */
export function tintIconPixels(data: Uint8ClampedArray, mask: Uint8ClampedArray, lut: Uint8Array): void {
  for (let at = 0; at < data.length; at += 4) {
    const weight = mask[at] / 255;
    if (weight === 0) continue;
    const grey = luminance(data[at], data[at + 1], data[at + 2]);
    for (let channel = 0; channel < 3; channel++) {
      data[at + channel] = Math.round(data[at + channel] * (1 - weight) + lut[grey * 4 + channel] * weight);
    }
  }
}

/** Icons coloured for an owner, by material and owner; filled as asked for. */
const tintedIcons = new Map<string, string>();
const tintingIcons = new Set<string>();

/**
 * The icon url for `owner`'s copy of a player-coloured icon. Colouring takes
 * a decode, so the first request for a pair answers with the untinted icon
 * and starts the work; the HUD redraws often enough that the coloured one is
 * up within a frame or two. Without imported palettes, or in a page with no
 * canvas, the plain icon stands.
 */
export function ownedIconUrl(
  ui: UiAssets | undefined, colors: PlayerColors | undefined, category: string, index: number, owner: number,
): string | undefined {
  const base = iconUrl(ui, category, index);
  if (!ui || !base || !colors) return base;
  const material = ui.icons[category]?.[String(index).padStart(3, '0')];
  const mask = material ? ui.materials[material]?.playerColorMask : undefined;
  if (!material || !mask || ui.materials[material]?.blend !== PLAYER_COLOR_BLEND) return base;
  const color = colors.players[String(owner)];
  if (!color) return base;
  const key = `${material}:${owner}`;
  const tinted = tintedIcons.get(key);
  if (tinted) return tinted;
  if (!tintingIcons.has(key) && typeof document !== 'undefined') {
    tintingIcons.add(key);
    tintIcon(base, `${ui.base}${mask}`, rampLut(color.ramp, colors.shadeLevels))
      .then(url => tintedIcons.set(key, url))
      .catch(() => tintedIcons.set(key, base));
  }
  return base;
}

async function readPixels(url: string): Promise<ImageData> {
  const image = new Image();
  image.decoding = 'async';
  image.src = url;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('no 2d canvas');
  context.drawImage(image, 0, 0);
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

async function tintIcon(pictureUrl: string, maskUrl: string, lut: Uint8Array): Promise<string> {
  const [picture, mask] = await Promise.all([readPixels(pictureUrl), readPixels(maskUrl)]);
  if (picture.width !== mask.width || picture.height !== mask.height) throw new Error('mask does not fit');
  tintIconPixels(picture.data, mask.data, lut);
  const canvas = document.createElement('canvas');
  canvas.width = picture.width;
  canvas.height = picture.height;
  canvas.getContext('2d')!.putImageData(picture, 0, 0);
  return canvas.toDataURL('image/png');
}
