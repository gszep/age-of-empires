/** #152: walk -> idle -> expiry -> walk in a real renderer. Advance only the
 * cache's clock, never the simulation's; verify pixels and GPU texture count. */
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
const rules = rulesFromManifest(manifest);
const state = createGame(11, rules);
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
  name: 'sprite-residency-probe', enforce: 'pre', transform(code, id) {
    if (id.endsWith('/src/main.ts')) {
      const anchor = 'renderer.render(scene, camera);';
      assert(code.includes(anchor));
      return code.replace(anchor, 'Object.assign(globalThis, { __spriteAssets: assets, __spriteViews: views, __spriteRenderer: renderer }); ' + anchor);
    }
    if (id.endsWith('/src/view/sprite-residency.ts')) {
      const anchor = '() => performance.now()';
      assert(code.includes(anchor));
      return code.replace(anchor, '() => performance.now() + (globalThis.__spriteClockOffset ?? 0)');
    }
  },
}], server: { host: '127.0.0.1', port: 5233, strictPort: true }, logLevel: 'error' });
await server.listen();
const libs = `${homedir()}/.cache/puppeteer/extra-libs/usr/lib/x86_64-linux-gnu`;
const browser = await puppeteer.launch({ headless: true, env: existsSync(libs) ? { ...process.env, LD_LIBRARY_PATH: libs } : process.env,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebGPU'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.evaluateOnNewDocument(snapshot => sessionStorage.setItem('open-empires-lab:dev-session', JSON.stringify(snapshot)),
    { version: SNAPSHOT_VERSION, rulesOrigin: rules.origin, state: saved });
  await page.goto('http://127.0.0.1:5233/?solo=1', { waitUntil: 'networkidle0', timeout: 120_000 });
  await page.waitForFunction(() => !!(window as any).__spriteAssets, { timeout: 120_000 });
  const query = (q: object): Promise<any> => page.evaluate(q => (window as any).__empiresDebug(q), q);
  assert((await query({ type: 'snapshot' })).entities.length === saved.entities.length, 'staged snapshot resumed');
  await query({ type: 'look', entity: villager.id });
  const move = async () => {
    const current = (await query({ type: 'snapshot' })).entities.find((e: any) => e.id === villager.id);
    await query({ type: 'command', command: { kind: 'order', player: 1, entityIds: [villager.id],
      target: { x: current.position.x + 10, y: current.position.y } } });
    await page.waitForFunction(id => {
      const v = (window as any).__spriteViews.get(`e${id}`);
      return v?.animationState?.endsWith('/walk') && v.body.mesh.visible && v.color.mesh.visible;
    }, { timeout: 30_000, polling: 100 }, villager.id);
  };
  const sample = () => page.evaluate(() => ({
    ...(window as any).__spriteAssets.spriteResidency.stats,
    gpuTextures: (window as any).__spriteRenderer.info.memory.textures,
  }));
  const rounds = [];
  for (let round = 0; round < 3; round++) {
    await move();
    await query({ type: 'command', command: { kind: 'stop', player: 1, entityIds: [villager.id] } });
    await page.waitForFunction(id => {
      const v = (window as any).__spriteViews.get(`e${id}`);
      return v?.animationState?.endsWith('/idle') && v.body.mesh.visible;
    }, { timeout: 30_000, polling: 100 }, villager.id);
    await page.keyboard.press('F3');
    const before = await sample();
    const sim = await query({ type: 'sim' });
    const pixels = await query({ type: 'pixels', rect: [350, 180, 650, 400] });
    await page.evaluate(() => { (window as any).__spriteClockOffset = ((window as any).__spriteClockOffset ?? 0) + 121_000; });
    await page.waitForFunction(count => (window as any).__spriteAssets.spriteResidency.stats.evictions > count,
      { timeout: 10_000, polling: 100 }, before.evictions);
    const after = await sample();
    assert(after.bytes < before.bytes, 'unused decoded pages released');
    assert(after.gpuTextures < before.gpuTextures, 'unused GPU textures disposed');
    assert.equal((await query({ type: 'sim' })).synchronizationHash, sim.synchronizationHash);
    const afterPixels = await query({ type: 'pixels', rect: [350, 180, 650, 400] });
    assert.deepEqual(afterPixels, pixels, 'paused rendered pixels survive eviction unchanged');
    rounds.push({ before, after });
    await page.keyboard.press('F3');
  }
  await move(); // final evicted animation really reloads and draws
  assert.deepEqual(errors, []);
  console.log(`SPRITE RESIDENCY SMOKE GREEN: ${JSON.stringify(rounds)}`);
} finally { await browser.close(); await server.close(); }
