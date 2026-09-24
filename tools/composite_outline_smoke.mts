/** #173/#238: contour pixels/lifetime/overlays. CONTOUR_FAR=1 moves to a far
 * surveyed-map position; CONTOUR_KIND=villager exercises an ordinary contour. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import puppeteer, { type HTTPRequest } from 'puppeteer';
import { createServer } from 'vite';
import { createGame } from '../src/sim/game.ts';
import { rulesFromManifest } from '../src/sim/data.ts';
import { SNAPSHOT_VERSION } from '../src/dev-session.ts';
import { skinFamilies, skinnedKey } from '../src/view/skins.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(readFileSync(`${root}public/imported/aoe2/manifest.json`, 'utf8'));
const far = process.env.CONTOUR_FAR === '1';
const single = process.env.CONTOUR_KIND === 'villager';
const state = createGame(173, rulesFromManifest(manifest), undefined, far ? 'windsor' : 'arabia');
const home = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
const worker = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
if (far) {
  assert(state.width > 260 && state.height > 260, 'far fixture requires a large board');
  home.position = { x: 260, y: 260 };
}
state.entities = state.entities.filter(e => e.kind === 'town-center');
state.terrain.fill(1); state.elevation.fill(0);
for (const tc of state.entities) for (let y = tc.position.y - 2; y < tc.position.y + 2; y++) {
  for (let x = tc.position.x - 2; x < tc.position.x + 2; x++) state.terrain[y * state.width + x] = 0;
}
const ship = single ? worker : { id: state.nextId++, kind: 'galley' as const, owner: 1 as const,
  position: { x: home.position.x - 2.5, y: home.position.y - 2.5 },
  hp: state.rules.units.galley.hp, maxHp: state.rules.units.galley.hp, radius: state.rules.units.galley.radius,
  activity: 'idle' as const, order: { kind: 'idle' as const } };
if (single) ship.position = { x: home.position.x - 0.5, y: home.position.y - 0.5 };
state.entities.push(ship);
const key = skinnedKey(skinFamilies(manifest.entities), ship, ship.kind, ship.kind, state.matchSeed);
const maskName = single ? 'idle-outline' : `${manifest.entities[key].animationLayers.idle[1].animation}-outline`;
const image = manifest.entities[key].atlases[maskName].image;
const { rules: ignored, ...saved } = state;
const server = await createServer({ root, configFile: `${root}vite.config.ts`, plugins: [{
  name: 'composite-contour-probe', enforce: 'pre', transform(code, id) {
    if (id.endsWith('/src/main.ts')) {
      const anchor = 'renderer.setAnimationLoop(now => {';
      assert(code.includes(anchor));
      // Isolate the native sprites from wall-clock water/foam during A/B
      // readbacks; retain the actual owned TC occluder and ship layer geometry.
      return code.replace(anchor, anchor + `
        paused = true; ground.visible = false; scatter.visible = false; fog.mesh.visible = false;
        Object.assign(globalThis, { __shipContext: { assets, views, scene, footprint: view.createFootprint,
          part: id => { const v = views.get('e' + id); return ${single ? 'v?.outline' : 'v?.layerOutlines?.[0]'}; },
        } });`);
    }
    if (id.endsWith('/src/view/sprite-residency.ts')) return code.replace('() => performance.now()',
      '() => performance.now() + (globalThis.__shipClockOffset ?? 0)');
  },
}], server: { host: '127.0.0.1', port: 5264, strictPort: true }, logLevel: 'error' });
await server.listen();
const libs = `${homedir()}/.cache/puppeteer/extra-libs/usr/lib/x86_64-linux-gnu`;
const browser = await puppeteer.launch({ headless: true,
  env: existsSync(libs) ? { ...process.env, LD_LIBRARY_PATH: libs } : process.env,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebGPU'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.setCacheEnabled(false);
  await page.evaluateOnNewDocument('globalThis.__name = fn => fn;');
  await page.evaluateOnNewDocument(snapshot => sessionStorage.setItem('open-empires-lab:dev-session', JSON.stringify(snapshot)),
    { version: SNAPSHOT_VERSION, rulesOrigin: state.rules.origin, state: saved });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  let hold = true;
  const held: HTTPRequest[] = [];
  await page.setRequestInterception(true);
  page.on('request', request => {
    if (hold && new URL(request.url()).pathname === `/imported/aoe2/${image}`) held.push(request);
    else void request.continue();
  });
  const initialRequest = page.waitForRequest(request => new URL(request.url()).pathname === `/imported/aoe2/${image}`, { timeout: 60_000 });
  await page.goto('http://127.0.0.1:5264/?solo=1', { waitUntil: 'domcontentloaded', timeout: 120_000 });
  const query = (q: object): Promise<any> => page.evaluate(q => (window as any).__empiresDebug(q), q);
  const contour = () => page.evaluate(id => {
    const p = (window as any).__shipContext?.part(id);
    return p && { visible: p.mesh.visible, pending: p.pendingTexture, image: p.textureImage,
      color: p.mesh.material.color.getHex(), order: p.mesh.renderOrder };
  }, ship.id);
  await page.waitForFunction(id => !!(window as any).__shipContext?.part(id)?.pendingTexture,
    { timeout: 60_000 }, ship.id);
  await page.waitForFunction(() => typeof (window as any).__empiresDebug === 'function', { timeout: 60_000 });
  assert.equal((await contour()).visible, false, 'late mask stays hidden');
  assert.equal((await contour()).image, image);
  await initialRequest;
  const before = await query({ type: 'sim' });
  assert.equal(before.tick, state.tick, 'fixture resumed and paused');
  hold = false;
  assert(held.length > 0, 'the owned layer page really was delayed');
  await Promise.all(held.splice(0).map(request => request.continue()));
  await page.waitForFunction(id => (window as any).__shipContext.part(id).mesh.visible,
    { timeout: 30_000 }, ship.id);
  await page.waitForNetworkIdle({ idleTime: 500, timeout: 30_000 });
  assert.equal((await contour()).color, manifest.playerColors.players['1'].outlineColor.reduce((n: number, c: number) => n * 256 + c, 0));
  const orders = await page.evaluate(({ shipId, homeId, far, kind }) => {
    const context = (window as any).__shipContext, views = context.views;
    const unit = views.get(`e${shipId}`), home = views.get(`e${homeId}`);
    return { far, kind, shipBody: unit.body.mesh.renderOrder, contour: context.part(shipId).mesh.renderOrder,
      occluder: Math.max(...[home.body, ...home.annexes].map(p => p.mesh.renderOrder)) };
  }, { shipId: ship.id, homeId: home.id, far, kind: ship.kind });
  console.log('contour fixture orders', orders);
  const capture = async () => query({ type: 'pixels', png: true, rect: [0, 60, 1280, 530] });
  const withOutline = await capture();
  await page.evaluate(id => { (window as any).__shipContext.part(id).mesh.material.visible = false; }, ship.id);
  const withoutOutline = await capture();
  assert.equal((await query({ type: 'pixels', rect: [0, 60, 1, 1] })).colorSpace, 'srgb');
  const changed = await page.evaluate(async ({ withPng, withoutPng }) => {
    const read = async (png: string) => {
      const image = new Image(); image.src = 'data:image/png;base64,' + png; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0);
      return ctx.getImageData(0, 0, image.width, image.height).data;
    };
    const a = await read(withPng), b = await read(withoutPng);
    let count = 0, blue = 0;
    const opaque: number[] = [];
    for (let i = 0; i < a.length; i += 4) {
      if (Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i+1] - b[i+1]), Math.abs(a[i+2] - b[i+2])) < 8) continue;
      count++;
      if (a[i+2] > b[i+2] && a[i] <= b[i] && a[i+1] <= b[i+1]) blue++;
      if (a[i] < 10 && a[i+1] < 10 && a[i+2] > 245) opaque.push(i);
    }
    return { count, blue, opaque };
  }, { withPng: withOutline.png, withoutPng: withoutOutline.png });
  console.log('owned contour sRGB pixel delta', { count: changed.count, blue: changed.blue, opaque: changed.opaque.length });
  assert(orders.contour > orders.shipBody && orders.contour > orders.occluder,
    'contour pass must sort above its body and the real occluder at every map depth');
  assert(changed.count > 10 && changed.blue / changed.count > 0.9, 'owned mask draws the player outline over the occluder');
  assert(changed.opaque.length > 5, 'owned mask has enough opaque samples to test overlay order');
  await page.evaluate(id => {
    const context = (window as any).__shipContext;
    context.part(id).mesh.material.visible = true;
    const marker = context.footprint(10);
    marker.position.copy(context.part(id).mesh.position);
    marker.material.color.set(0x00ff00); // diagnostic colour on the real placement mesh
    context.scene.add(marker);
    (window as any).__contourOverlay = marker;
  }, ship.id);
  const overlay = await capture();
  const coveredSamples = await page.evaluate(async ({ png, indices }) => {
    const image = new Image(); image.src = 'data:image/png;base64,' + png; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0);
    const data = ctx.getImageData(0, 0, image.width, image.height).data;
    return indices.filter(i => data[i+1] > 80 && data[i+2] < 245).length;
  }, { png: overlay.png, indices: changed.opaque });
  assert.equal(coveredSamples, changed.opaque.length, 'placement overlay draws above every opaque contour sample');
  await page.evaluate(() => {
    const marker = (window as any).__contourOverlay;
    (window as any).__shipContext.scene.remove(marker); marker.geometry.dispose(); marker.material.dispose();
  });
  const frames = () => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await query({ type: 'look', rect: [home.position.x + 2, home.position.y, 0, 0] });
  await frames();
  assert.notEqual((await capture()).png, withOutline.png, 'camera actually moves');
  await query({ type: 'look', rect: [home.position.x, home.position.y, 0, 0] });
  await frames();
  assert.equal((await capture()).png, withOutline.png, 'camera round trip retains the same owned contour pixels');
  await page.evaluate(({ name, key }) => {
    const context = (window as any).__shipContext;
    (window as any).__retiredShipMask = context.assets.entities[key].atlases[name];
    delete context.assets.entities[key].atlases[name];
    (window as any).__shipClockOffset = 121_000;
  }, { name: maskName, key });
  await page.waitForFunction(image => !(window as any).__shipContext.assets.textures.has(image), { timeout: 10_000 }, image);
  assert.equal((await contour()).visible, false);
  assert.equal((await contour()).image, undefined);
  await capture(); // no disposed texture may be re-enabled by occlusion
  // A browser can reuse an already decoded image without another network
  // event. Hold the actual asset-loader boundary for the reload case.
  await page.evaluate(({ name, image, key }) => {
    const assets = (window as any).__shipContext.assets;
    const load = assets.loadTexture;
    (window as any).__shipOriginalLoad = load;
    assets.loadTexture = (key: string) => { if (key !== image) load(key); };
    assets.entities[key].atlases[name] = (window as any).__retiredShipMask;
  }, { name: maskName, image, key });
  await page.waitForFunction(id => !!(window as any).__shipContext.part(id).pendingTexture,
    { timeout: 30_000 }, ship.id);
  assert.equal((await contour()).visible, false);
  await page.evaluate(image => {
    const assets = (window as any).__shipContext.assets;
    assets.loadTexture = (window as any).__shipOriginalLoad;
    assets.loadTexture(image);
  }, image);
  await page.waitForFunction(id => (window as any).__shipContext.part(id).mesh.visible,
    { timeout: 30_000 }, ship.id);
  await page.evaluate(({ name, key }) => {
    for (const frame of (window as any).__shipContext.assets.entities[key].atlases[name].frames) frame.w = 0;
  }, { name: maskName, key });
  await page.waitForFunction(id => !(window as any).__shipContext.part(id).textureImage, {}, ship.id);
  assert.equal((await contour()).visible, false);
  await capture();
  assert.deepEqual(errors, []);
  assert.equal((await query({ type: 'sim' })).synchronizationHash, before.synchronizationHash);
  console.log(`CONTOUR SMOKE GREEN (${ship.kind}, ${far ? 'far' : 'near'}): owned pixels/colour/depth, placement overlay, camera round trip, delayed load, expiry/reload, empty frame, unchanged simulation`);
} finally { await browser.close(); await server.close(); }
