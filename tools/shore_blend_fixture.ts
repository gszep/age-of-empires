/** #148: authored square masks through production geometry and the real GPU. */
import * as THREE from 'three/webgpu';
import { loadContentAssets, maskU } from '../src/view/assets';
import { createGround } from '../src/view/world';
import { worldToIso, isoToWorld } from '../src/view/iso';
import { createGame } from '../src/sim/game';
import { checksumState } from '../src/sim/checksum';

async function run() {
  const assets = await loadContentAssets();
  if (!assets?.blends?.native) throw new Error('run the full owned import first');
  const native = assets.blends.native;
  const sheet = native.modes[1]!;
  const canvas = document.createElement('canvas');
  canvas.width = sheet.image.width; canvas.height = sheet.image.height;
  const context = canvas.getContext('2d')!;
  context.drawImage(sheet.image, 0, 0);
  const source = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const sampleSource = (column: number, u: number, v: number) => {
    const x = maskU(native, column, u) * canvas.width - 0.5;
    const y = v * canvas.height - 0.5;
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const at = (px: number, py: number) => source[(Math.max(0, Math.min(canvas.height - 1, py)) * canvas.width
      + Math.max(0, Math.min(canvas.width - 1, px))) * 4] / 255;
    return (1 - fy) * ((1 - fx) * at(ix, iy) + fx * at(ix + 1, iy))
      + fy * ((1 - fx) * at(ix, iy + 1) + fx * at(ix + 1, iy + 1));
  };
  // Remove water animation/foam and use diagnostic colours to isolate alpha.
  // The atlas, asset loader, geometry, UVs and blend material are production ones.
  assets.water = undefined; assets.foam = undefined;
  const beach = Object.values(assets.terrain).find(t => t.terrainId === 2)!;
  const water = Object.values(assets.terrain).find(t => t.terrainId === 1)!;
  if (!(water.blendPriority > beach.blendPriority)) throw new Error('fixture priority assumption changed');
  const solid = (r: number, g: number, b: number) => {
    const texture = new THREE.DataTexture(new Uint8Array([r, g, b, 255]), 1, 1);
    texture.needsUpdate = true; return texture;
  };
  assets.textures.set(beach.image, solid(255, 0, 0));
  assets.textures.set(water.image, solid(0, 255, 255));
  const renderer = new THREE.WebGPURenderer();
  const size = 512;
  renderer.setSize(size, size); renderer.toneMapping = THREE.NoToneMapping;
  document.body.appendChild(renderer.domElement);
  await renderer.init();
  const target = new THREE.RenderTarget(size, size);
  target.texture.colorSpace = THREE.LinearSRGBColorSpace;
  renderer.setRenderTarget(target);
  const camera = new THREE.OrthographicCamera(-128, 128, 128, -128, -100, 100);
  const state = createGame(148);
  state.width = 8; state.height = 6; state.entities = [];
  state.elevation = new Array(48).fill(0);
  const offsets = [[-1, -1], [-1, 0], [-1, 1], [0, 1], [1, 1], [1, 0], [1, -1], [0, -1]];
  const configurations = [8, 8, 8, 8, 2, 2, 2, 2, 32, 32, 32, 32, 128, 128, 128, 128,
    4, 16, 1, 64, 34, 136, 160, 130, 40, 10, 42, 168, 162, 138, 170];
  let maxError = 0, samples = 0, changedFromClassic = 0;
  for (const [column, bits] of configurations.entries()) {
    const cx = column < 16 ? 2 + column % 4 : 2, cy = 2;
    state.terrain = new Array(48).fill(2);
    offsets.forEach(([dx, dy], bit) => { if (bits & 1 << bit) state.terrain[(cy + dy) * state.width + cx + dx] = 1; });
    const initial = checksumState(state);
    const centre = worldToIso(cx + 0.5, cy + 0.5);
    camera.position.set(centre.x, centre.y, 10);
    const draw = async (useNative: boolean) => {
      assets.blends!.native = useNative ? native : undefined;
      const scene = new THREE.Scene(), ground = createGround(state, assets);
      scene.add(ground); renderer.render(scene, camera);
      const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, size, size) as Uint8Array;
      ground.traverse(object => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose();
        }
      });
      return pixels;
    };
    const pixels = await draw(true), classic = await draw(false);
    for (const u of [0.1, 0.3, 0.5, 0.7, 0.9]) for (const v of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const iso = worldToIso(cx + u, cy + v);
      const px = Math.floor((iso.x - centre.x) * 2 + size / 2);
      const py = Math.floor((iso.y - centre.y) * 2 + size / 2);
      const actual = isoToWorld((px + 0.5 - size / 2) / 2 + centre.x, (py + 0.5 - size / 2) / 2 + centre.y);
      const expected = sampleSource(column, actual.x - cx, actual.y - cy);
      const i = (py * size + px) * 4;
      const alpha = pixels[i + 1] / (pixels[i] + pixels[i + 1]);
      if (!Number.isFinite(alpha)) throw new Error('empty shore sample');
      maxError = Math.max(maxError, Math.abs(alpha - expected));
      if (Math.abs(pixels[i + 1] - classic[i + 1]) > 5) changedFromClassic++;
      samples++;
    }
    if (checksumState(state) !== initial) throw new Error('view mutated authoritative state');
  }
  target.dispose(); renderer.dispose();
  return { colorSpace: 'linear-srgb', configurations: configurations.length, samples, maxError, changedFromClassic };
}
run().then(result => { (window as any).__shoreBlendResult = result; }, error => {
  (window as any).__shoreBlendResult = { error: error.stack };
});
