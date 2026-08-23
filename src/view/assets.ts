import * as THREE from 'three/webgpu';

export type Frame = { x: number; y: number; w: number; h: number; cx: number; cy: number };
export type Atlas = { image: string; size: [number, number]; framesInFile: number; frames: Frame[] };
export type AnimationInfo = { frames: number; directions: number; frameSeconds: number; mirroringMode: number };

export interface ImportedEntity {
  category: string;
  iconId?: number;
  animations: Record<string, AnimationInfo>;
  atlases: Record<string, Atlas>;
  annexes?: { unitId: number; misplacement: [number, number]; animations: Record<string, AnimationInfo>; atlases: Record<string, Atlas> }[];
}

export interface ContentAssets {
  entities: Record<string, ImportedEntity>;
  textures: Map<string, THREE.Texture>;
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

const CONTENT_BASE = '/imported/aoe2/';
const UI_BASE = '/imported/aoe2/ui/';

async function fetchJson<T>(url: string): Promise<T | undefined> {
  try {
    const response = await fetch(url);
    if (!response.ok) return undefined;
    return await response.json() as T;
  } catch {
    return undefined;
  }
}

export async function loadContentAssets(): Promise<ContentAssets | undefined> {
  const manifest = await fetchJson<{ entities: Record<string, ImportedEntity> }>(`${CONTENT_BASE}manifest.json`);
  if (!manifest) return undefined;
  const textures = new Map<string, THREE.Texture>();
  const loader = new THREE.TextureLoader();
  const jobs: Promise<void>[] = [];
  const loadAtlases = (atlases: Record<string, Atlas>) => {
    for (const atlas of Object.values(atlases)) {
      jobs.push(loader.loadAsync(CONTENT_BASE + atlas.image).then(texture => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.LinearFilter;
        textures.set(atlas.image, texture);
      }));
    }
  };
  for (const entity of Object.values(manifest.entities)) {
    loadAtlases(entity.atlases);
    for (const annex of entity.annexes ?? []) loadAtlases(annex.atlases);
  }
  await Promise.all(jobs);
  return { entities: manifest.entities, textures };
}

export async function loadUiAssets(): Promise<UiAssets | undefined> {
  const manifest = await fetchJson<Omit<UiAssets, 'base'>>(`${UI_BASE}manifest.json`);
  if (!manifest) return undefined;
  return { base: UI_BASE, ...manifest };
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
