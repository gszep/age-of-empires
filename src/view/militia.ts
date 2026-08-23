import * as THREE from 'three/webgpu';
import type { Entity, Point } from '../sim/types';

type Frame = { x: number; y: number; w: number; h: number; cx: number; cy: number };
type Atlas = { image: string; size: [number, number]; frames: Frame[] };
type Manifest = {
  unit: { animations: Record<string, { frames: number; directions: number; frameSeconds: number }> };
  atlases: Record<string, Atlas>;
};

export type MilitiaAssets = { manifest: Manifest; textures: Record<string, THREE.Texture> };

export async function loadMilitiaAssets(): Promise<MilitiaAssets | undefined> {
  try {
    const base = '/imported/aoe2/militia/';
    const manifest = await fetch(`${base}manifest.json`).then(response => {
      if (!response.ok) throw new Error(String(response.status));
      return response.json() as Promise<Manifest>;
    });
    const textures: Record<string, THREE.Texture> = {};
    await Promise.all(Object.entries(manifest.atlases).map(async ([state, atlas]) => {
      const texture = await new THREE.TextureLoader().loadAsync(base + atlas.image);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.LinearFilter;
      textures[state] = texture;
    }));
    return { manifest, textures };
  } catch {
    return undefined;
  }
}

export function createMilitiaMesh(assets: MilitiaAssets, owner: 1 | 2): THREE.Mesh {
  const material = new THREE.MeshBasicMaterial({
    map: assets.textures.idle,
    color: owner === 1 ? 0xb8d6ff : 0xffc2b8,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  mesh.userData.militia = true;
  return mesh;
}

export function updateMilitiaMesh(
  assets: MilitiaAssets,
  mesh: THREE.Mesh,
  entity: Entity,
  target: Point | undefined,
  time: number,
): void {
  const state = entity.activity === 'attacking' ? 'attack' : entity.activity === 'moving' ? 'walk' : 'idle';
  if (mesh.userData.animationState !== state) {
    mesh.userData.animationState = state;
    mesh.userData.animationStartedAt = time;
  }
  const animation = assets.manifest.unit.animations[state];
  const atlas = assets.manifest.atlases[state];
  const material = mesh.material as THREE.MeshBasicMaterial;
  if (material.map !== assets.textures[state]) {
    material.map = assets.textures[state];
    material.needsUpdate = true;
  }

  const angle = target
    ? Math.atan2(target.y - entity.position.y, target.x - entity.position.x)
    : 0;
  const direction = ((Math.round(angle / (Math.PI * 2) * animation.directions) % animation.directions) + animation.directions) % animation.directions;
  const elapsed = time - (mesh.userData.animationStartedAt as number);
  const frameInDirection = Math.floor(elapsed / animation.frameSeconds) % animation.frames;
  const frame = atlas.frames[direction * animation.frames + frameInDirection];
  const [atlasWidth, atlasHeight] = atlas.size;
  const left = frame.x / atlasWidth;
  const right = (frame.x + frame.w) / atlasWidth;
  const bottom = 1 - (frame.y + frame.h) / atlasHeight;
  const top = 1 - frame.y / atlasHeight;
  const uv = mesh.geometry.getAttribute('uv') as THREE.BufferAttribute;
  uv.setXY(0, left, top);
  uv.setXY(1, right, top);
  uv.setXY(2, left, bottom);
  uv.setXY(3, right, bottom);
  uv.needsUpdate = true;

  const scale = 0.025;
  mesh.scale.set(frame.w * scale, frame.h * scale, 1);
  mesh.userData.spriteOffset = {
    x: (frame.w / 2 - frame.cx) * scale,
    y: (frame.cy - frame.h / 2) * scale,
  };
}
