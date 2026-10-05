/** #296: a farm built through the public command shows each owned construction stage. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import { createGame } from '../src/sim/game.ts';
import { rulesFromManifest } from '../src/sim/data.ts';
import { SNAPSHOT_VERSION } from '../src/dev-session.ts';
import { updateVisibility } from '../src/sim/visibility.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(readFileSync(`${root}public/imported/aoe2/manifest.json`, 'utf8'));
for (const slot of ['farm-construction', 'farm-construction-2', 'farm-construction-3']) {
  assert(manifest.terrain[slot], `owned import publishes ${slot}; run npm run import:aoe2`);
}
const rules = rulesFromManifest(manifest), state = createGame(296, rules);
state.entities = state.entities.filter(e => e.kind === 'town-center' || e.kind === 'villager');
state.terrain.fill(0); state.elevation.fill(0);
const home = state.entities.find(e => e.kind === 'town-center' && e.owner === 1)!;
const builder = state.entities.find(e => e.kind === 'villager' && e.owner === 1)!;
const site = { x: home.position.x + 6.5, y: home.position.y + .5 };
builder.position = { x: site.x - 2, y: site.y };
updateVisibility(state);
const { rules: ignored, ...saved } = state;
const server = await createServer({ root, configFile: `${root}vite.config.ts`, plugins: [{
  name: 'farm-construction-fixture', enforce: 'pre', transform(code, id) {
    if (!id.endsWith('/src/main.ts')) return;
    assert(code.includes('renderer.render(scene, camera);') && code.includes('let paused = false;'));
    return code.replace('let paused = false;', 'let paused = true;').replace('renderer.render(scene, camera);',
      'Object.assign(globalThis, { __farm: { views } }); renderer.render(scene, camera);');
  },
}], server: { host: '127.0.0.1', port: 5270, strictPort: true }, logLevel: 'error' });
await server.listen();
const libs = `${homedir()}/.cache/puppeteer/extra-libs/usr/lib/x86_64-linux-gnu`;
const browser = await puppeteer.launch({ headless: true,
  env: existsSync(libs) ? { ...process.env, LD_LIBRARY_PATH: libs } : process.env,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebGPU'] });
try {
  const page = await browser.newPage(), errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.setViewport({ width: 1280, height: 800 });
  // tsx keeps function names through an `__name` helper the page lacks.
  await page.evaluateOnNewDocument('globalThis.__name = f => f');
  await page.evaluateOnNewDocument(snapshot => sessionStorage.setItem('open-empires-lab:dev-session', JSON.stringify(snapshot)),
    { version: SNAPSHOT_VERSION, rulesOrigin: rules.origin, state: saved });
  await page.goto('http://127.0.0.1:5270/?solo=1', { waitUntil: 'networkidle0', timeout: 120_000 });
  const query = (q: object): Promise<any> => page.evaluate(q => (window as any).__empiresDebug(q), q);
  assert((await query({ type: 'snapshot' })).entities.some((e: any) => e.id === builder.id), 'fixture resumed');
  await query({ type: 'look', rect: [site.x, site.y, 0, 0] });
  await query({ type: 'command', command: { kind: 'build', player: 1, builderIds: [builder.id], building: 'farm', target: site } });
  await page.keyboard.press('F3');
  const farmId = await page.waitForFunction(async () => {
    const snapshot = await (window as any).__empiresDebug({ type: 'snapshot' });
    return snapshot.entities.find((e: any) => e.kind === 'farm')?.id;
  }, { timeout: 30_000, polling: 50 }).then(handle => handle.jsonValue() as Promise<number>);
  // Record each distinct slot and texture the farm's patch draws, every frame,
  // until the farm is complete.
  const stages = await page.evaluate(id => new Promise<{ slot: string; image: string }[]>((done, fail) => {
    const seen: { slot: string; image: string }[] = [];
    const started = performance.now();
    const sample = () => {
      const view = (globalThis as any).__farm?.views.get(`e${id}`);
      const material = view?.patch?.material;
      const source = (Array.isArray(material) ? material[0] : material)?.map?.uuid ?? '';
      if (view?.patchSlot && view.patch?.visible && seen.at(-1)?.slot !== view.patchSlot) seen.push({ slot: view.patchSlot, image: source });
      if (view?.patchSlot === 'farm') return done(seen);
      if (performance.now() - started > 120_000) return fail(new Error(`farm unfinished: ${JSON.stringify(seen)}`));
      requestAnimationFrame(sample);
    };
    sample();
  }), farmId);
  console.log(JSON.stringify(stages));
  assert.deepEqual(stages.map(s => s.slot), ['farm-construction', 'farm-construction-2', 'farm-construction-3', 'farm']);
  assert.equal(new Set(stages.map(s => s.image)).size, 4, 'each stage draws its own owned texture');
  assert.deepEqual(errors, []);
  console.log('FARM CONSTRUCTION GREEN: public build shows Farm Cnst1, Cnst2, Cnst3, then Farm1');
} finally { await browser.close(); await server.close(); }
