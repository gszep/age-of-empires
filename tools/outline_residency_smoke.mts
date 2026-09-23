/** #172: retire a previously drawn contour, expire its page, then render the
 * occluded unit again. The fixture changes art availability, never live sim. */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import puppeteer from 'puppeteer';
import { createGame } from '../src/sim/game.ts';
import { rulesFromManifest } from '../src/sim/data.ts';
import { SNAPSHOT_VERSION } from '../src/dev-session.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(readFileSync(`${root}public/imported/aoe2/manifest.json`, 'utf8'));
const rules = rulesFromManifest(manifest);
const state = createGame(11, rules);
const home = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
const worker = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
state.entities = state.entities.filter(e => e.kind === 'town-center' || e === worker);
worker.position = { x: home.position.x - 0.5, y: home.position.y - 0.5 };
state.elevation.fill(0);
const { rules: ignored, ...saved } = state;
const server = await createServer({ root, configFile: `${root}vite.config.ts`, plugins: [{
  name: 'outline-residency-probe', enforce: 'pre', transform(code, id) {
    if (id.endsWith('/src/main.ts')) {
      const anchor = 'renderer.setAnimationLoop(now => {';
      assert(code.includes(anchor));
      return code.replace(anchor, anchor + '\npaused = true; Object.assign(globalThis, { __outlineAssets: assets, __outlineViews: views });');
    }
    if (id.endsWith('/src/view/sprite-residency.ts')) return code.replace('() => performance.now()',
      '() => performance.now() + (globalThis.__outlineClockOffset ?? 0)');
    if (id.endsWith('/src/view/sprites.ts')) {
      const anchor = 'export function updateOcclusion(views: Map<string, EntityView>, state: ReadonlyGameState): void {';
      assert(code.includes(anchor));
      return code.replace(anchor, anchor + '\nif (globalThis.__outlineSuppress !== false) return;');
    }
  },
}], server: { host: '127.0.0.1', port: 5241, strictPort: true }, logLevel: 'error' });
await server.listen();
const libs = `${homedir()}/.cache/puppeteer/extra-libs/usr/lib/x86_64-linux-gnu`;
const browser = await puppeteer.launch({ headless: true, env: existsSync(libs) ? { ...process.env, LD_LIBRARY_PATH: libs } : process.env,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebGPU'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const errors: string[] = [];
  page.on('pageerror', error => { const detail = error.stack ?? String(error); if (!errors.includes(detail)) errors.push(detail); });
  await page.evaluateOnNewDocument(snapshot => sessionStorage.setItem('open-empires-lab:dev-session', JSON.stringify(snapshot)),
    { version: SNAPSHOT_VERSION, rulesOrigin: rules.origin, state: saved });
  await page.goto('http://127.0.0.1:5241/?solo=1', { waitUntil: 'networkidle0', timeout: 120_000 });
  await page.waitForFunction(id => {
    const piece = (window as any).__outlineViews?.get(`e${id}`)?.outline;
    return piece?.textureImage && !piece.pendingTexture;
  },
    { timeout: 30_000, polling: 100 }, worker.id);
  const query = (q: object): Promise<any> => page.evaluate(q => (window as any).__empiresDebug(q), q);
  assert.equal((await query({ type: 'sim' })).tick, state.tick, 'staged match remains paused');
  const before = (await query({ type: 'sim' })).synchronizationHash;
  const image = await page.evaluate(id => {
    const view = (window as any).__outlineViews.get(`e${id}`);
    const [key, animation] = view.animationState.split('/');
    const entry = (window as any).__outlineAssets.entities[key];
    const image = view.outline.textureImage;
    if (!image) throw new Error('fixture needs a loaded outline');
    delete entry.atlases[`${animation}-outline`];
    (window as any).__outlineClockOffset = 121_000;
    return image;
  }, worker.id);
  await page.waitForFunction(image => !(window as any).__outlineAssets.textures.has(image), { timeout: 10_000 }, image);
  await page.evaluate(() => { (window as any).__outlineSuppress = false; });
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  console.log(JSON.stringify({ errors, contour: await page.evaluate(id => {
    const p = (window as any).__outlineViews.get(`e${id}`).outline;
    return { visible: p.mesh.visible, image: p.textureImage, pending: p.pendingTexture, source: p.mesh.material.map?.source.data === null ? 'disposed' : 'live' };
  }, worker.id) }));
  assert.deepEqual(errors, []);
  assert.equal(await page.evaluate(id => (window as any).__outlineViews.get(`e${id}`).outline.mesh.visible, worker.id), false);
  const pixels = await query({ type: 'pixels', entity: worker.id });
  assert(pixels.pixels > 0, 'renderer still returns pixels after expiry');
  assert.equal((await query({ type: 'sim' })).synchronizationHash, before);
  console.log('OUTLINE RESIDENCY SMOKE GREEN: retired contour stays hidden after expiry; renderer and simulation survive');
} finally { await browser.close(); await server.close(); }
