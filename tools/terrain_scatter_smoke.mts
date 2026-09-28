/** #55: real owned plant pixels, deterministic reload and authoritative fog.
 * Private paused fixture; simulation state is never edited in the browser. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import puppeteer from 'puppeteer';
import { createGame } from '../src/sim/game.ts';
import { rulesFromManifest } from '../src/sim/data.ts';
import { SNAPSHOT_VERSION } from '../src/dev-session.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(readFileSync(`${root}public/imported/aoe2/manifest.json`, 'utf8'));
const state = createGame(55, rulesFromManifest(manifest));
state.terrain.fill(12); state.elevation.fill(0);
// Keep real town centers as occluders; no resource sprites camouflage plants.
state.entities = state.entities.filter(e => e.kind === 'town-center');
const home = state.entities.find(e => e.owner === 1)!;
const { rules, ...saved } = state;
const server = await createServer({ root, configFile: `${root}vite.config.ts`, plugins: [{
  name: 'terrain-scatter-probe', enforce: 'pre', transform(code, id) {
    if (!id.endsWith('/src/main.ts')) return;
    const anchor = 'renderer.setAnimationLoop(now => {';
    assert(code.includes(anchor));
    return code.replace(anchor, anchor + `
      paused = true;
      Object.assign(globalThis, { __scatterProbe: { scatter, assets } });`);
  },
}], server: { host: '127.0.0.1', port: 5273, strictPort: true }, logLevel: 'error' });
await server.listen();
const libs = `${homedir()}/.cache/puppeteer/extra-libs/usr/lib/x86_64-linux-gnu`;
const browser = await puppeteer.launch({ headless: true,
  env: existsSync(libs) ? { ...process.env, LD_LIBRARY_PATH: libs } : process.env,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebGPU'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.evaluateOnNewDocument('globalThis.__name = fn => fn;');
  await page.evaluateOnNewDocument(snapshot => sessionStorage.setItem('open-empires-lab:dev-session', JSON.stringify(snapshot)),
    { version: SNAPSHOT_VERSION, rulesOrigin: rules.origin, state: saved });
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('response', r => { if (r.url().includes('/imported/') && r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
  const query = (q: object): Promise<any> => page.evaluate(q => (window as any).__empiresDebug(q), q);
  const ready = async () => {
    await page.waitForFunction(() => (window as any).__scatterProbe?.scatter.children.some(c => c.visible && c.userData.terrainId !== undefined), { timeout: 60_000 });
    await page.waitForNetworkIdle({ idleTime: 500, timeout: 60_000 });
  };
  await page.goto('http://127.0.0.1:5273/?solo=1', { waitUntil: 'networkidle0', timeout: 120_000 });
  await ready();
  const before = await query({ type: 'sim' });
  assert.equal(before.tick, state.tick, 'fixture resumed and paused');
  const placements = () => page.evaluate(() => (window as any).__scatterProbe.scatter.children
    .filter(c => c.userData.terrainId !== undefined && !c.userData.shadow).map(c => ({ name: c.name, tile: c.userData.tile,
      position: c.position.toArray(), scale: c.scale.toArray(), visible: c.visible })));
  const first = await placements();
  assert(first.length > 100 && first.some(p => p.visible) && first.some(p => !p.visible));
  for (const p of first.filter(p => p.visible)) {
    assert(state.visibility[1].explored[p.tile], 'unexplored plants are hidden');
    const x = p.tile % state.width + 0.5, y = Math.floor(p.tile / state.width) + 0.5;
    assert(Math.abs(x - home.position.x) >= home.radius || Math.abs(y - home.position.y) >= home.radius,
      'plants stay hidden under the real TC footprint');
  }
  const capture = () => query({ type: 'pixels', png: true, rect: [0, 60, 1280, 530] });
  const withPlants = await capture();
  assert.equal((await query({ type: 'pixels', rect: [0, 60, 1, 1] })).colorSpace, 'srgb');
  await page.evaluate(() => { (window as any).__scatterProbe.scatter.visible = false; });
  const withoutPlants = await capture();
  const pixelDelta = (a: string, b: string) => page.evaluate(async ({ a, b }) => {
    const read = async (png: string) => {
      const image = new Image(); image.src = 'data:image/png;base64,' + png; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0);
      return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    };
    const left = await read(a), right = await read(b);
    let count = 0, darkened = 0;
    for (let i = 0; i < left.length; i += 4) if (Math.max(...[0, 1, 2].map(c => Math.abs(left[i+c] - right[i+c]))) >= 8) {
      count++;
      if ([0, 1, 2].every(c => left[i+c] <= right[i+c])) darkened++;
    }
    return { count, darkened };
  }, { a, b });
  const changed = (await pixelDelta(withPlants.png, withoutPlants.png)).count;
  assert(changed > 50, `owned plants contribute visible sRGB pixels (${changed})`);
  await page.evaluate(() => { (window as any).__scatterProbe.scatter.visible = true; });
  const shadows = await page.evaluate(() => (window as any).__scatterProbe.scatter.children
    .filter(c => c.userData.shadow && c.visible).map(c => ({ order: c.renderOrder, color: c.material.color.toArray(), opacity: c.material.opacity })));
  assert(shadows.length > 0, 'owned soft shadows are actually drawn');
  for (const shadow of shadows) {
    assert(shadow.order < 900, 'shadows are below the ground-fog pass');
    assert.deepEqual(shadow.color, manifest.shadows.color);
    assert.equal(shadow.opacity, manifest.shadows.strength);
  }
  const toggleShadows = (visible: boolean) => page.evaluate(visible => {
    for (const child of (window as any).__scatterProbe.scatter.children) if (child.userData.shadow) child.material.visible = visible;
  }, visible);
  await toggleShadows(false);
  const noShadows = await capture();
  const shadowDelta = await pixelDelta(withPlants.png, noShadows.png);
  assert(shadowDelta.count > 50 && shadowDelta.darkened === shadowDelta.count,
    `owned shadows darken real ground pixels: ${JSON.stringify(shadowDelta)}`);
  await toggleShadows(true);
  assert.equal((await query({ type: 'sim' })).synchronizationHash, before.synchronizationHash);
  await page.reload({ waitUntil: 'networkidle0', timeout: 120_000 });
  await ready();
  assert.deepEqual(await placements(), first, 'reload preserves every placement/variant/visibility');
  assert.equal((await query({ type: 'sim' })).synchronizationHash, before.synchronizationHash);
  assert.deepEqual(errors, []);
  console.log(`TERRAIN SCATTER GREEN: ${first.length} plants, ${first.filter(p => p.visible).length} visible, ${changed} changed sRGB pixels; fog/foundation coverage, deterministic reload and unchanged sim`);
  console.log(`TERRAIN SHADOW GREEN: ${shadows.length} visible owned masks, ${shadowDelta.darkened} darkened sRGB pixels; owned strength/colour, ground-fog order and unchanged sim`);
  await page.screenshot({ path: `${root}.local/scatter55-fixture.png` });
  await page.goto('http://127.0.0.1:5273/?solo=1&map=islands&seed=3', { waitUntil: 'networkidle0', timeout: 120_000 });
  await ready();
  const natural = await placements();
  assert(natural.some(p => p.visible), 'an ordinary Islands opening draws plants without staged terrain');
  assert.notEqual((await query({ type: 'sim' })).synchronizationHash, before.synchronizationHash, 'explicit map URL declines staged snapshot');
  assert.deepEqual(errors, []);
  await page.screenshot({ path: `${root}.local/scatter55-islands.png` });
  await toggleShadows(false);
  await page.screenshot({ path: `${root}.local/scatter250-islands-without-shadows.png` });
  await toggleShadows(true);
  console.log(`NATURAL ISLANDS SCATTER GREEN: ${natural.length} plants, ${natural.filter(p => p.visible).length} visible`);
} finally { await browser.close(); await server.close(); }
