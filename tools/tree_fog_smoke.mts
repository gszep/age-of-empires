/** Screenshot-driven acceptance: revealing a tree's tile reveals its whole
 * canopy. Compare opaque leaf pixels with F4 on/off, not a whole-screen mean. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import puppeteer from 'puppeteer';
import { createGame } from '../src/sim/game.ts';
import { rulesFromManifest } from '../src/sim/data.ts';
import { updateVisibility } from '../src/sim/visibility.ts';
import { SNAPSHOT_VERSION } from '../src/dev-session.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(readFileSync(`${root}public/imported/aoe2/manifest.json`, 'utf8'));
const rules = rulesFromManifest(manifest);
const state = createGame(2, rules);
const tree = state.entities.find(e => e.resourceKind === 'wood' && e.id % manifest.entities['tree-oak'].atlases.idle.framesInFile === 0)!;
const scout = state.entities.find(e => e.kind === 'scout-cavalry' && e.owner === 1)!;
tree.position = { x: 50.5, y: 50.5 };
scout.position = { x: 50.5, y: 50.5 + rules.units['scout-cavalry'].lineOfSight - 0.5 };
const unseen = { ...tree, id: state.nextId++, position: { x: 44.5, y: 47.5 } };
state.entities = state.entities.filter(e => e.kind === 'town-center' || e.id === tree.id || e.id === scout.id);
state.entities.push(unseen);
state.terrain.fill(0); state.elevation.fill(0);
state.players[2].food = state.players[2].wood = 0;
state.visibility[1].explored.fill(0); state.visibility[1].memory = {};
updateVisibility(state);
const { rules: ignored, ...saved } = state;
const server = await createServer({ root, configFile: `${root}vite.config.ts`, plugins: [{
  name: 'tree-fog-probe', enforce: 'pre', transform(code, id) {
    if (!id.endsWith('/src/dev-debug.ts')) return;
    const anchor = 'const hot = import.meta.hot!;';
    assert(code.includes(anchor));
    return code.replace(anchor, 'Object.assign(globalThis, { __treeContext: context }); ' + anchor);
  },
}], server: { host: '127.0.0.1', port: 5216, strictPort: true }, logLevel: 'error' });
await server.listen();
const libs = `${homedir()}/.cache/puppeteer/extra-libs/usr/lib/x86_64-linux-gnu`;
const browser = await puppeteer.launch({ headless: true, env: existsSync(libs) ? { ...process.env, LD_LIBRARY_PATH: libs } : process.env,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebGPU'] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 800 });
  // tsx's function-name helper is otherwise absent from serialized callbacks.
  await page.evaluateOnNewDocument('globalThis.__name = fn => fn;');
  const errors: string[] = []; page.on('pageerror', error => errors.push(String(error)));
  await page.evaluateOnNewDocument(snapshot => sessionStorage.setItem('open-empires-lab:dev-session', JSON.stringify(snapshot)),
    { version: SNAPSHOT_VERSION, rulesOrigin: rules.origin, state: saved });
  await page.goto('http://127.0.0.1:5216/?solo=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window as any).__treeContext, { timeout: 120_000, polling: 100 });
  const query = (q: object): Promise<any> => page.evaluate(q => (window as any).__empiresDebug(q), q);
  await page.keyboard.press('F3'); await query({ type: 'look', entity: tree.id });
  await page.waitForFunction(id => (window as any).__treeContext.views.get(`e${id}`)?.body.mesh.visible,
    { timeout: 30_000, polling: 100 }, tree.id);
  assert(!(await page.evaluate(id => (window as any).__treeContext.views.has(`e${id}`) || (window as any).__treeContext.views.has(`m${id}`), unseen.id)), 'an unseen tree is not rendered');
  const samples = await page.evaluate(async ({ id, atlas }) => {
    const context = (window as any).__treeContext;
    const view = context.views.get(`e${id}`), mesh = view.body.mesh;
    const frame = atlas.frames[view.frameIndex];
    const image = new Image(); image.src = '/imported/aoe2/' + atlas.image; await image.decode();
    const source = document.createElement('canvas'); source.width = frame.w; source.height = frame.h;
    const ctx = source.getContext('2d')!;
    ctx.drawImage(image, frame.x, frame.y, frame.w, frame.h, 0, 0, frame.w, frame.h);
    const rgba = ctx.getImageData(0, 0, frame.w, frame.h).data;
    const zoom = context.zoom(), center = context.cameraCenter();
    const width = mesh.scale.x * zoom, height = mesh.scale.y * zoom;
    const left = 640 + (mesh.position.x - mesh.scale.x / 2 - center.x) * zoom;
    const top = 400 - (mesh.position.y + mesh.scale.y / 2 - center.y) * zoom;
    const points: number[][] = [];
    for (let y = Math.ceil(top + 5); y < top + height * 0.65; y += 2) {
      for (let x = Math.ceil(left + 5); x < left + width - 5; x += 2) {
        const sx = Math.floor(0.5 + (x + 0.5 - left) / width * (frame.w - 1));
        const sy = Math.floor(0.5 + (y + 0.5 - top) / height * (frame.h - 1));
        let opaque = true;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          if (sx + dx < 0 || sy + dy < 0 || sx + dx >= frame.w || sy + dy >= frame.h
            || rgba[((sy + dy) * frame.w + sx + dx) * 4 + 3] !== 255) opaque = false;
        }
        if (opaque) points.push([x, y]);
      }
    }
    return points;
  }, { id: tree.id, atlas: manifest.entities['tree-oak'].atlases.idle });
  assert(samples.length >= 20, 'enough fully opaque leaf pixels for a meaningful comparison');
  const pausedHash = (await query({ type: 'sim' })).synchronizationHash;
  const capture = async (points = samples) => {
    const png = await query({ type: 'pixels', png: true, rect: [480, 240, 320, 220] });
    return page.evaluate(async ({ png, samples }) => {
      const image = new Image(); image.src = 'data:image/png;base64,' + png; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0);
      return samples.map(([x, y]) => [...ctx.getImageData(x - 480, y - 240, 1, 1).data].slice(0, 3));
    }, { png: png.png, samples: points });
  };
  const fogged = await capture();
  if (process.env.TREE_FOG_SCREENSHOTS === '1') {
    const image = await query({ type: 'pixels', png: true, rect: [480, 240, 320, 260] });
    writeFileSync(`${root}.local/tree-fog-visible-fixed.png`, Buffer.from(image.png, 'base64'));
  }
  await page.keyboard.press('F4');
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const revealed = await capture();
  const differences = fogged.map((rgb, i) => Math.max(...rgb.map((v, c) => Math.abs(v - revealed[i][c]))));
  const clipped = differences.filter(d => d > 2).length;
  console.log(`visible canopy: ${samples.length} opaque samples, ${clipped} changed by fog, max sRGB difference ${Math.max(...differences)}`);
  assert.equal(clipped, 0, 'revealing the ground behind an already-visible tree must not reveal more of its canopy');

  const shadowSamples = await page.evaluate(async ({ id, bodyAtlas, shadowAtlas }) => {
    const context = (window as any).__treeContext, view = context.views.get(`e${id}`);
    const zoom = context.zoom(), center = context.cameraCenter();
    const source = async (atlas: any, mesh: any) => {
      const f = atlas.frames[view.frameIndex];
      const image = new Image(); image.src = '/imported/aoe2/' + atlas.image; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = f.w; canvas.height = f.h;
      const ctx = canvas.getContext('2d')!; ctx.drawImage(image, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
      return { f, data: ctx.getImageData(0, 0, f.w, f.h).data, w: mesh.scale.x * zoom, h: mesh.scale.y * zoom,
        left: 640 + (mesh.position.x - mesh.scale.x / 2 - center.x) * zoom,
        top: 400 - (mesh.position.y + mesh.scale.y / 2 - center.y) * zoom };
    };
    const body = await source(bodyAtlas, view.body.mesh), shadow = await source(shadowAtlas, view.shadow.mesh);
    const at = (s: typeof body, x: number, y: number) => {
      if (x < s.left || x >= s.left + s.w || y < s.top || y >= s.top + s.h) return 0;
      const sx = (x - s.left) / s.w * (s.f.w - 1), sy = (y - s.top) / s.h * (s.f.h - 1);
      const ix = Math.floor(sx), iy = Math.floor(sy), fx = sx - ix, fy = sy - iy;
      const a = (dx: number, dy: number) => s.data[((iy + dy) * s.f.w + ix + dx) * 4 + 3] / 255;
      return (a(0, 0) * (1 - fx) + a(1, 0) * fx) * (1 - fy) + (a(0, 1) * (1 - fx) + a(1, 1) * fx) * fy;
    };
    const points: number[][] = [], alpha: number[] = [];
    for (let y = 378; y < 420; y += 3) for (let x = 535; x < 635; x += 3) {
      const a = at(shadow, x + 0.5, y + 0.5);
      if (a < 0.15 || a > 0.75) continue;
      let clear = true;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (at(body, x + 0.5 + dx, y + 0.5 + dy) > 0) clear = false;
      if (clear) { points.push([x, y]); alpha.push(a); }
    }
    return { points, alpha, strength: view.shadow.mesh.material.opacity };
  }, { id: tree.id, bodyAtlas: manifest.entities['tree-oak'].atlases.idle, shadowAtlas: manifest.entities['tree-oak'].atlases['idle-shadow'] });
  assert(shadowSamples.points.length >= 20);
  assert.equal(shadowSamples.strength, manifest.shadows.strength);
  const shadowed = await capture(shadowSamples.points);
  if (process.env.TREE_FOG_SCREENSHOTS === '1') {
    const image = await query({ type: 'pixels', png: true, rect: [480, 240, 320, 260] });
    writeFileSync(`${root}.local/tree-shadow-visible-fixed.png`, Buffer.from(image.png, 'base64'));
  }
  await page.evaluate(id => { (window as any).__treeContext.views.get(`e${id}`).shadow.mesh.material.visible = false; }, tree.id);
  const bare = await capture(shadowSamples.points);
  await page.evaluate(id => { (window as any).__treeContext.views.get(`e${id}`).shadow.mesh.material.visible = true; }, tree.id);
  const linear = (v: number) => v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4;
  const shadowError = shadowed.map((rgb, i) => Math.abs((1 - linear(rgb[1]) / linear(bare[i][1])) - shadowSamples.alpha[i] * shadowSamples.strength));
  const meanShadowError = shadowError.reduce((a, b) => a + b, 0) / shadowError.length;
  console.log(`visible shadow: ${shadowError.length} ground samples, mean linear-alpha error ${meanShadowError.toFixed(4)} against owned mask × strength ${shadowSamples.strength}`);
  assert(meanShadowError < 0.04, 'visible shadows use the owned mask strength without extra attenuation');
  assert.equal((await query({ type: 'sim' })).synchronizationHash, pausedHash, 'render comparisons do not change visibility or simulation state');

  await page.keyboard.press('F4');
  for (let i = 0; i < 6; i++) await page.keyboard.press('+');
  await query({ type: 'command', command: { kind: 'order', player: 1, entityIds: [scout.id], target: { x: 30, y: 60 } } });
  await page.keyboard.press('F3');
  await page.waitForFunction(id => (window as any).__treeContext.views.has(`m${id}`), { timeout: 30_000, polling: 100 }, tree.id);
  await page.keyboard.press('F3');
  const remembered = await capture();
  if (process.env.TREE_FOG_SCREENSHOTS === '1') {
    const image = await query({ type: 'pixels', png: true, rect: [480, 240, 320, 260] });
    writeFileSync(`${root}.local/tree-fog-memory-fixed.png`, Buffer.from(image.png, 'base64'));
  }
  const srgb = (v: number) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
  // Compare in encoded bytes: ratios amplify the one-byte quantization of dark leaves.
  const rememberedError = remembered.map((rgb, i) => Math.max(...rgb.map((v, c) => Math.abs(v - srgb(linear(revealed[i][c]) * 0.5)))));
  console.log(`remembered canopy: ${rememberedError.length} opaque samples, max sRGB-byte error ${Math.max(...rememberedError).toFixed(3)} against half linear brightness`);
  assert(Math.max(...rememberedError) < 2, 'the entire remembered canopy keeps its silhouette and half-brightness RGB');
  assert.deepEqual(errors, []);
  console.log('TREE FOG SMOKE GREEN: full visible/remembered canopies, owned visible-shadow strength, no unseen-tree disclosure');
} finally { await browser.close(); await server.close(); }
