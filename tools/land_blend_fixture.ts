/** #116: source alpha through production terrain/farm geometry and materials.
 * Diagnostic terrain categories isolate all eight family routes. */
import * as THREE from 'three/webgpu';
import { loadContentAssets, maskU } from '../src/view/assets';
import { createGround, createTerrainPatch } from '../src/view/world';
import { worldToIso, isoToWorld } from '../src/view/iso';
import { createGame } from '../src/sim/game';
import { checksumState } from '../src/sim/checksum';

async function run() {
  const assets = await loadContentAssets();
  if (!assets?.blends?.native) throw new Error('full owned import required');
  const native = assets.blends.native;
  for (let mode = 0; mode < 8; mode++) if (!native.modes[mode]) throw new Error(`missing family ${mode}`);
  const originalTextures = new Map(assets.textures);
  const ground = Object.values(assets.terrain).find(t => t.terrainId === 0)!;
  const beach = Object.values(assets.terrain).find(t => t.terrainId === 2)!;
  const originals = [{ ...ground }, { ...beach }];
  assets.water = undefined; assets.foam = undefined;
  const solid = (r: number, g: number, b: number) => {
    const t = new THREE.DataTexture(new Uint8Array([r,g,b,255]), 1, 1); t.needsUpdate = true; return t;
  };
  assets.textures.set(ground.image, solid(255,0,0));
  assets.textures.set(beach.image, solid(0,255,255));
  ground.overlayMask = beach.overlayMask = undefined;
  if (!(beach.blendPriority > ground.blendPriority)) throw new Error('priority fixture changed');

  function sampler(t: THREE.Texture, repeat = false) {
    const canvas = document.createElement('canvas');
    canvas.width = t.image.width; canvas.height = t.image.height;
    const ctx = canvas.getContext('2d')!; ctx.drawImage(t.image, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    return (u: number, v: number) => {
      const x = u * canvas.width - .5, y = v * canvas.height - .5;
      const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
      const at = (px: number, py: number) => {
        const bound = (n: number, size: number) => repeat ? (n % size + size) % size : Math.max(0, Math.min(size - 1, n));
        return data[(bound(py, canvas.height) * canvas.width + bound(px, canvas.width)) * 4] / 255;
      };
      return (1-fy)*((1-fx)*at(ix,iy)+fx*at(ix+1,iy)) + fy*((1-fx)*at(ix,iy+1)+fx*at(ix+1,iy+1));
    };
  }
  const shape = Array.from({ length: 8 }, (_, mode) => {
    const sample = sampler(native.modes[mode]!);
    return (column: number, u: number, v: number) => sample(maskU(native, column, u), v);
  });
  const renderer = new THREE.WebGPURenderer();
  renderer.setSize(512,512); renderer.toneMapping = THREE.NoToneMapping;
  document.body.style.margin = '0'; document.body.appendChild(renderer.domElement);
  await renderer.init();
  const target = new THREE.RenderTarget(512,512); target.texture.colorSpace = THREE.LinearSRGBColorSpace;
  const camera = new THREE.OrthographicCamera(-128,128,128,-128,-100,100);
  const state = createGame(116);
  state.width = 8; state.height = 6; state.entities = [];
  state.elevation = new Array(48).fill(0);
  const dispose = (scene: THREE.Object3D) => scene.traverse(o => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
    }
  });
  const draw = async (x: number, y: number, patch?: string) => {
    const centre = worldToIso(x+.5,y+.5); camera.position.set(centre.x,centre.y,10);
    const scene = new THREE.Scene(); scene.add(createGround(state, assets));
    if (patch) {
      const mesh = createTerrainPatch(assets, patch, 1.5, { x: 2, y: 2 }, state)!;
      const p = worldToIso(2,2); mesh.position.set(p.x,p.y,0); mesh.renderOrder = 200; scene.add(mesh);
    }
    renderer.setRenderTarget(target); renderer.render(scene,camera);
    const pixels = await renderer.readRenderTargetPixelsAsync(target,0,0,512,512) as Uint8Array;
    dispose(scene);
    return { pixels, centre };
  };
  function measurements(image: Awaited<ReturnType<typeof draw>>, x: number, y: number) {
    const out = [];
    for (const u of [.1,.3,.5,.7,.9]) for (const v of [.1,.3,.5,.7,.9]) {
      const iso = worldToIso(x+u,y+v);
      const px = Math.floor((iso.x-image.centre.x)*2+256), py = Math.floor((iso.y-image.centre.y)*2+256);
      const actual = isoToWorld((px+.5-256)/2+image.centre.x,(py+.5-256)/2+image.centre.y);
      const i = (py*512+px)*4;
      out.push({ x: actual.x, y: actual.y, u: actual.x-x, v: actual.y-y,
        red: image.pixels[i]/255, green: image.pixels[i+1]/255 });
    }
    return out;
  }
  const offsets = [[-1,-1],[-1,0],[-1,1],[0,1],[1,1],[1,0],[1,-1],[0,-1]];
  const configurations = [8,8,8,8,2,2,2,2,32,32,32,32,128,128,128,128,4,16,1,64,34,136,160,130,40,10,42,168,162,138,170];
  const pairs = [[3,3],[2,3],[0,0],[0,1],[0,7],[0,6],[0,5],[3,4]];
  let samples = 0, maxError = 0, changedFromClassic = 0;
  for (const [mode, pair] of pairs.entries()) {
    [ground.blendType, beach.blendType] = pair;
    for (const [column, bits] of configurations.entries()) {
      const x = column < 16 ? 2+column%4 : 2, y = 2;
      state.terrain = new Array(48).fill(0);
      offsets.forEach(([dx,dy], bit) => { if (bits & 1<<bit) state.terrain[(y+dy)*8+x+dx] = 2; });
      const hash = checksumState(state);
      assets.blends.native = native;
      const values = measurements(await draw(x,y),x,y);
      // Partial old imports fall back only for the family that is missing.
      assets.blends.native = { ...native, modes: { ...native.modes, [mode]: undefined } };
      const fallback = measurements(await draw(x,y),x,y);
      values.forEach((p,i) => {
        const alpha = p.green/(p.red+p.green), old = fallback[i].green/(fallback[i].red+fallback[i].green);
        if (!Number.isFinite(alpha)) throw new Error('empty terrain sample');
        maxError = Math.max(maxError,Math.abs(alpha-shape[mode](column,p.u,p.v)));
        if (Math.abs(alpha-old) > .02) changedFromClassic++;
        samples++;
      });
      if (checksumState(state) !== hash) throw new Error('terrain render mutated state');
    }
  }
  assets.blends.native = native;
  Object.assign(ground,originals[0]); Object.assign(beach,originals[1]);
  // Shader gating at the repeating terrain UV, including the existing reverse pass.
  state.terrain = new Array(48).fill(0); state.terrain[3*8+2] = 2;
  const hash = checksumState(state);
  let gatedError = 0;
  let gatedWorst: unknown;
  for (const [x,y,column,invert,slot] of [[2,2,0,false,beach],[2,3,30,true,ground]] as const) {
    const mask = sampler(assets.textures.get(slot.overlayMask!)!,true);
    for (const p of measurements(await draw(x,y),x,y)) {
      const alpha = shape[2](column,p.u,p.v)*mask(p.x/slot.dimensions[0],1-p.y/slot.dimensions[1]);
      const observed = p.green/(p.red+p.green), expected = invert ? 1-alpha : alpha;
      const error = Math.abs(observed-expected);
      if (error > gatedError) { gatedError = error; gatedWorst = { slot:slot.name, ...p, observed, expected,
        shape:shape[2](column,p.u,p.v), overlay:mask(p.x/slot.dimensions[0],1-p.y/slot.dimensions[1]),
        anisotropy:assets.textures.get(slot.overlayMask!)!.anisotropy }; }
    }
  }
  if (checksumState(state) !== hash) throw new Error('crossing render mutated state');

  ground.overlayMask = beach.overlayMask = undefined;
  state.terrain.fill(0);
  let farmSamples = 0, farmError = 0, cornerAlpha = 0;
  const cells = [[-1,1,8],[3,1,4],[1,-1,0],[1,3,12],[-1,-1,17],[3,-1,16],[-1,3,19],[3,3,18],[1,1,31]];
  for (const slot of ['farm','farm-construction']) {
    assets.textures.set(assets.terrain[slot].image,solid(0,255,255));
    const hash = checksumState(state);
    for (const [dx,dy,baseColumn] of cells) {
      const x = 2+dx, y = 2+dy;
      const column = baseColumn < 16 ? baseColumn+((x+y*3)&3) : baseColumn;
      for (const p of measurements(await draw(x,y,slot),x,y)) {
        farmError = Math.max(farmError,Math.abs(p.green-shape[3](column,p.u,p.v)));
        if (column >= 16 && column < 20) cornerAlpha += p.green;
        farmSamples++;
      }
    }
    if (checksumState(state) !== hash) throw new Error('farm render mutated state');
  }

  // Supplement measurements with a real-texture crossing/farm overview.
  assets.textures = originalTextures; Object.assign(ground,originals[0]); Object.assign(beach,originals[1]);
  state.width = 16; state.height = 12; state.elevation = new Array(192).fill(0);
  state.terrain = Array.from({ length: 192 }, (_,i) => Math.floor(i/16) >= 9 ? 24 : i%16 >= 8 ? 2 : 0);
  const scene = new THREE.Scene(); scene.add(createGround(state,assets));
  for (const [slot,x,y] of [['farm',6,3],['farm-construction',3,7]] as const) {
    const patch = createTerrainPatch(assets,slot,1.5,{ x,y },state)!;
    const p = worldToIso(x,y); patch.position.set(p.x,p.y,0); patch.renderOrder=200; scene.add(patch);
  }
  const centre = worldToIso(8,6);
  camera.left=-800; camera.right=800; camera.top=600; camera.bottom=-600; camera.updateProjectionMatrix();
  camera.position.set(centre.x,centre.y,10); renderer.setSize(1024,768); renderer.setRenderTarget(null);
  renderer.render(scene,camera);
  // Keep the overview alive for the runner's screenshot; process teardown releases it.
  return { colourSpace:'linear-srgb', families:8, configurations:8*31, samples, maxError,
    changedFromClassic, gatedError, gatedWorst, farmSamples, farmError, cornerAlpha };
}
run().then(result => { (window as any).__landBlendResult=result; }, error => {
  (window as any).__landBlendResult={ error:error.stack };
});
