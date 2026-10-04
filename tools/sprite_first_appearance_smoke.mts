/** #287: an already visible unit must survive a cold animation-page load. */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import puppeteer from 'puppeteer';
import { createGame, stepGame } from '../src/sim/game.ts';
import { rulesFromManifest } from '../src/sim/data.ts';
import { SNAPSHOT_VERSION } from '../src/dev-session.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(readFileSync(`${root}public/imported/aoe2/manifest.json`, 'utf8'));
const rules = rulesFromManifest(manifest), state = createGame(11, rules);
const villager = state.entities.find(e => e.kind === 'villager' && e.owner === 1)!;
const home = state.entities.find(e => e.kind === 'town-center' && e.owner === 1)!;
state.entities = state.entities.filter(e => e.kind === 'town-center' || e.id === villager.id);
state.elevation.fill(0);
villager.position = { x: home.position.x + 5, y: home.position.y + 5 };
for (let y = -2; y <= 2; y++) for (let x = -2; x <= 15; x++) {
  state.terrain[Math.floor(villager.position.y + y) * state.width + Math.floor(villager.position.x + x)] = 0;
}
stepGame(state);
const { rules: ignored, ...saved } = state;
const server = await createServer({ root, configFile: `${root}vite.config.ts`, plugins: [{
  name: 'first-appearance-probe', enforce: 'pre', transform(code, id) {
    if (id.endsWith('/src/main.ts')) {
      const anchor = 'renderer.render(scene, camera);';
      assert(code.includes(anchor));
      return code.replace(anchor, `Object.assign(globalThis, { __spriteAssets: assets, __spriteViews: views });
        globalThis.__sampleSprite?.(); ${anchor}`);
    }
    if (id.endsWith('/src/view/assets.ts')) {
      const anchor = 'loader.loadAsync(CONTENT_BASE + image).then(texture => {';
      assert(code.includes(anchor));
      return code.replace(anchor, '(async () => { await globalThis.__holdSprite?.(image); return loader.loadAsync(CONTENT_BASE + image); })().then(texture => {');
    }
  },
}], server: { host: '127.0.0.1', port: 5267, strictPort: true }, logLevel: 'error' });
await server.listen();
const libs = `${homedir()}/.cache/puppeteer/extra-libs/usr/lib/x86_64-linux-gnu`;
const browser = await puppeteer.launch({ headless: true,
  env: existsSync(libs) ? { ...process.env, LD_LIBRARY_PATH: libs } : process.env,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebGPU'] });
try {
  const page = await browser.newPage(), errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.setViewport({ width: 1280, height: 800 });
  await page.evaluateOnNewDocument(snapshot => sessionStorage.setItem('open-empires-lab:dev-session', JSON.stringify(snapshot)),
    { version: SNAPSHOT_VERSION, rulesOrigin: rules.origin, state: saved });
  await page.goto('http://127.0.0.1:5267/?solo=1', { waitUntil: 'networkidle0', timeout: 120_000 });
  const query = (q: object): Promise<any> => page.evaluate(q => (window as any).__empiresDebug(q), q);
  assert.equal((await query({ type: 'snapshot' })).entities.length, saved.entities.length);
  await query({ type: 'look', entity: villager.id });
  await page.waitForFunction(id => {
    const v = (window as any).__spriteViews?.get(`e${id}`);
    return v?.body.mesh.visible && v.color.mesh.visible;
  }, { timeout: 30_000 }, villager.id);
  await page.evaluate(id => {
    const w = window as any, view = w.__spriteViews.get(`e${id}`);
    const key = view.animationState.slice(0, -'/idle'.length);
    const atlas = w.__spriteAssets.entities[key].atlases.walk;
    w.__walkImages = (atlas.pages ?? [atlas]).map((p: any) => p.image);
    w.__held = []; w.__samples = [];
    w.__holdSprite = (image: string) => new Promise<void>(resolve => w.__held.push({ image, resolve }));
    w.__sampleSprite = () => {
      const v = w.__spriteViews.get(`e${id}`);
      w.__samples.push({ body: v.body.mesh.visible, color: v.color.mesh.visible,
        image: v.body.textureImage, animation: v.animationState });
    };
  }, villager.id);
  await query({ type: 'command', command: { kind: 'order', player: 1, entityIds: [villager.id],
    target: { x: villager.position.x + 10, y: villager.position.y } } });
  await page.waitForFunction(() => (window as any).__held.length > 0 && (window as any).__samples.length >= 12,
    { timeout: 30_000 });
  const cold = await page.evaluate(() => (window as any).__samples);
  console.log(`Cold transition: ${cold.filter((s: any) => !s.body).length}/${cold.length} frames missing the body`);
  await page.evaluate(() => {
    const w = window as any; w.__holdSprite = undefined;
    for (const held of w.__held) held.resolve();
  });
  await page.waitForFunction(id => {
    const w = window as any, v = w.__spriteViews.get(`e${id}`);
    return w.__walkImages.includes(v.body.textureImage) && v.body.mesh.visible && v.color.mesh.visible;
  }, { timeout: 30_000 }, villager.id);
  const pixels = await query({ type: 'pixels', rect: [450, 200, 300, 300] });
  assert(pixels && !pixels.error, 'real renderer still returns pixels after the new page arrives');
  assert(cold.every((s: any) => s.body && s.color), 'visible unit flickered during its first cold animation transition');
  assert.deepEqual(errors, []);
  console.log('SPRITE FIRST APPEARANCE GREEN: cold public move retains the visible pose until owned walk art arrives');
} finally { await browser.close(); await server.close(); }
