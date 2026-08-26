import * as THREE from 'three/webgpu';

export type Frame = { x: number; y: number; w: number; h: number; cx: number; cy: number };
export type Atlas = { image: string; size: [number, number]; framesInFile: number; frames: Frame[] };
export type AnimationInfo = { frames: number; directions: number; frameSeconds: number; mirroringMode: number };

export interface ImportedEntity {
  category: string;
  iconId?: number;
  /** Projectiles only: arc height as a fraction of the shot's distance. */
  projectile?: { arc: number };
  animations: Record<string, AnimationInfo>;
  atlases: Record<string, Atlas>;
  annexes?: { unitId: number; misplacement: [number, number]; animations: Record<string, AnimationInfo>; atlases: Record<string, Atlas> }[];
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
  name: string;
  texture: string;
  image: string;
  dimensions: [number, number];
  minimapColor: [number, number, number];
}

export interface ContentAssets {
  entities: Record<string, ImportedEntity>;
  terrain: Record<string, ImportedTerrain>;
  textures: Map<string, THREE.Texture>;
  playerColors?: PlayerColors;
  /** One 256-texel ramp per player, indexed by a sprite's own grey. */
  playerRamps: Map<number, THREE.DataTexture>;
}

interface UiMaterial { type: string; blend?: string | null; texture?: string; color?: { r: number; g: number; b: number; a: number } }
interface UiLayoutWidget {
  Name?: string;
  Type?: string;
  ViewPort?: { xorigin: number; yorigin: number; width: number; height: number; alignment?: string };
  StateMaterials?: Record<string, { Material?: string }>;
  ChildWidgets?: UiLayoutWidget[];
}
export interface UiAssets {
  base: string;
  layouts: Record<string, { viewPort: { width: number; height: number; xorigin: number; yorigin: number; alignment?: string }; widgets: UiLayoutWidget[] }>;
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
    terrain?: Record<string, ImportedTerrain>;
    playerColors?: PlayerColors;
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
  await Promise.all(jobs);
  const playerColors = manifest.playerColors;
  const playerRamps = new Map<number, THREE.DataTexture>();
  for (const [player, color] of Object.entries(playerColors?.players ?? {})) {
    playerRamps.set(Number(player), rampTexture(color, playerColors!.shadeLevels));
  }
  return { entities: manifest.entities, terrain, textures, playerColors, playerRamps };
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
