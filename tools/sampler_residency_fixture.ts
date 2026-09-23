import * as THREE from 'three/webgpu';
import { createGame } from '../src/sim/game';
import { createEntityView, updateEntityView } from '../src/view/sprites';
import { SpriteResidency } from '../src/view/sprite-residency';
import { worldToIso } from '../src/view/iso';
// Synthetic images isolate the renderer's binding lifetime from SLD decoding.
const run = async () => {
  const renderer = new THREE.WebGPURenderer();
  renderer.setSize(64, 64); document.body.appendChild(renderer.domElement);
  await renderer.init();
  const state = createGame(1), original = JSON.stringify(state);
  const entity = state.entities.find(e => e.kind === 'villager' && e.owner === 1)!;
  const center = worldToIso(entity.position.x, entity.position.y);
  const camera = new THREE.OrthographicCamera(-16, 16, 16, -16, -100, 100);
  camera.position.set(center.x, center.y, 10);
  const scene = new THREE.Scene();
  const target = new THREE.RenderTarget(64, 64); renderer.setRenderTarget(target);
  const make = (green: boolean) => {
    const bytes = new Uint8Array(64);
    for (let i = 0; i < 64; i += 4) { bytes[i + (green ? 1 : 0)] = 255; bytes[i + 3] = 255; }
    const tex = new THREE.DataTexture(bytes, 4, 4); tex.needsUpdate = true; return tex;
  };
  const textures = new Map(), a = make(false), b = make(true);
  let clock = 0;
  const residency = new SpriteResidency(textures, () => clock);
  residency.add('a', a); residency.add('b', b);
  const atlas = image => ({ image, size: [4, 4], framesInFile: 1, frames: [{ x: 0, y: 0, w: 4, h: 4, cx: 2, cy: 2 }] });
  const animation = { frames: 1, directions: 1, frameSeconds: 0, mirroringMode: 0 };
  const assets = { textures, spriteResidency: residency, entities: { villager: {
    category: 'unit', animations: { idle: animation, walk: animation }, atlases: { idle: atlas('a'), walk: atlas('b') },
  } }, skins: new Map(), playerRamps: new Map(), terrain: {}, ages: [] };
  if (new URLSearchParams(location.search).has('ramp')) {
    assets.playerRamps.set(1, make(true));
    Object.assign(assets.entities.villager.atlases, { 'idle-playercolor': atlas('a'), 'walk-playercolor': atlas('b') });
  }
  const first = createEntityView(assets as any, entity); scene.add(first.group);
  updateEntityView(first, assets as any, state, entity, 0);
  renderer.render(scene, camera); // creates a shared sampler template referring to A
  clock = 121_000;
  const moving = { ...entity, activity: 'moving' as const };
  updateEntityView(first, assets as any, state, moving, 1);
  renderer.render(scene, camera); // current material/binding now refers to B
  residency.sweep(); // disposes A while B remains alive
  renderer.render(scene, camera);
  const before = await renderer.readRenderTargetPixelsAsync(target, 0, 0, 64, 64);
  const second = createEntityView(assets as any, moving); scene.add(second.group);
  updateEntityView(second, assets as any, state, moving, 2);
  renderer.render(scene, camera); // new object must not clone A's cleared sampler
  const after = await renderer.readRenderTargetPixelsAsync(target, 0, 0, 64, 64);
  return { equalPixels: before.every((value, index) => value === after[index]), green: [...after].filter((v, i) => i % 4 === 1 && v === 255).length,
    unchangedState: original === JSON.stringify(state), evictions: residency.stats.evictions, disposedA: a.image === null };
};
run().then(result => { (window as any).__samplerResult = result; }, error => { (window as any).__samplerResult = { error: error.stack }; });
