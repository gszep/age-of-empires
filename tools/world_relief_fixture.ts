/** Render createGround itself; no HUD, fog or entities can tint the measured hill. */
import * as THREE from 'three/webgpu';
import { createGame } from '../src/sim/game';
import { checksumState } from '../src/sim/checksum';
import { createGround, ELEVATION_PIXELS } from '../src/view/world';
import { worldToIso } from '../src/view/iso';
import type { ContentAssets } from '../src/view/assets';

async function measure() {
  const renderer = new THREE.WebGPURenderer();
  const width = 1024, height = 768;
  renderer.setSize(width, height);
  renderer.toneMapping = THREE.NoToneMapping;
  document.body.appendChild(renderer.domElement);
  await renderer.init();
  const target = new THREE.RenderTarget(width, height);
  target.texture.colorSpace = THREE.LinearSRGBColorSpace;
  renderer.setRenderTarget(target);
  const camera = new THREE.OrthographicCamera(-768, 768, 576, -576, -100, 100);
  camera.position.set(0, worldToIso(8, 8).y, 10);
  const state = createGame(160);
  state.width = state.height = 16;
  state.entities = [];
  state.terrain = new Array(256).fill(0);
  state.elevation = state.terrain.map((_, i) => Math.max(0,
    6 - Math.max(Math.abs(i % 16 + 0.5 - 8), Math.abs(Math.floor(i / 16) + 0.5 - 8))));
  const initial = checksumState(state);
  const manifest = await fetch('/imported/aoe2/manifest.json').then(r => {
    if (!r.ok) throw new Error('Owned terrain is required for the imported half of this probe');
    return r.json();
  });
  const slot = manifest.terrain.ground;
  const texture = await new THREE.TextureLoader().loadAsync(`/imported/aoe2/${slot.image}`);
  // Same terrain sampling as loadContentAssets, loading only the measured sheet.
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 16;
  const assets = { terrain: { ground: slot }, entities: {}, textures: new Map([[slot.image, texture]]),
    playerRamps: new Map() } as unknown as ContentAssets;
  const faces = [
    ['upperRight', 4, 8], ['lowerRight', 8, 12], ['lowerLeft', 12, 8], ['upperLeft', 8, 4],
  ] as const;
  // All four vertices are at level 2 on the symmetric hill. Sample a 5x5
  // linear-light crop, normalized by an unshaded draw of the identical geometry
  // and UVs, so variation in the original grass texture cancels out.
  function luminance(pixels: Uint8Array, x: number, y: number) {
    const iso = worldToIso(x, y);
    const p = new THREE.Vector3(iso.x, iso.y + 2 * ELEVATION_PIXELS, 0).project(camera);
    const px = Math.round((p.x + 1) * width / 2), py = Math.round((p.y + 1) * height / 2);
    let sum = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const i = ((py + dy) * width + px + dx) * 4;
      sum += 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];
    }
    return sum / 25;
  }
  const results: Record<string, unknown> = {};
  for (const [name, content] of [['fallback', undefined], ['imported', assets]] as const) {
    const scene = new THREE.Scene();
    const ground = createGround(state, content);
    scene.add(ground);
    const mesh = ground.getObjectByName('terrain-ground') as THREE.Mesh;
    const positions = Array.from(mesh.geometry.getAttribute('position').array);
    const uvs = Array.from(mesh.geometry.getAttribute('uv').array);
    const colors = mesh.geometry.getAttribute('color') as THREE.BufferAttribute;
    const shadedColors = colors.array.slice();
    renderer.render(scene, camera);
    const shaded = await renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height) as Uint8Array;
    colors.array.fill(1); colors.needsUpdate = true;
    renderer.render(scene, camera);
    const flat = await renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height) as Uint8Array;
    colors.array.set(shadedColors); colors.needsUpdate = true;
    results[name] = {
      faces: Object.fromEntries(faces.map(([face, x, y]) => {
        const lit = luminance(shaded, x, y), plain = luminance(flat, x, y);
        if (plain < 1) throw new Error(`${name} ${face}: empty terrain sample`);
        return [face, { shaded: lit, unshaded: plain, factor: lit / plain }];
      })),
      unchangedGeometry: positions.every((v, i) => v === mesh.geometry.getAttribute('position').array[i])
        && uvs.every((v, i) => v === mesh.geometry.getAttribute('uv').array[i]),
    };
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  }
  texture.dispose(); target.dispose(); renderer.dispose();
  return { colorSpace: 'linear-srgb', crop: '5x5 at 2/3 native projection scale', results,
    unchangedState: checksumState(state) === initial };
}
measure().then(result => { (window as any).__worldRelief = result; }, error => {
  (window as any).__worldRelief = { error: error.stack };
});
