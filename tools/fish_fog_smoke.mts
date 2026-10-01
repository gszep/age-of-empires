/** #258: actual live → remembered → live resource art through scout movement. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import puppeteer from 'puppeteer';
import { addNode, createGame } from '../src/sim/game.ts';
import { rulesFromManifest } from '../src/sim/data.ts';
import { SNAPSHOT_VERSION } from '../src/dev-session.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(readFileSync(`${root}public/imported/aoe2/manifest.json`, 'utf8'));
const rules = rulesFromManifest(manifest);
const state = createGame(258, rules);
const scout = state.entities.find(e => e.kind === 'scout-cavalry' && e.owner === 1)!;
assert(scout);
state.entities = state.entities.filter(e => e.kind === 'town-center' || e.id === scout.id);
state.terrain.fill(0);
state.elevation.fill(0);
for (let y = 40; y < 60; y++) for (let x = 51; x < 65; x++) state.terrain[y * state.width + x] = 1;
scout.position = { x: 49, y: 50 };
const resources = [
  addNode(state, 'fish', { x: 52, y: 48 }),
  addNode(state, 'shore-fish', { x: 51, y: 52 }),
  addNode(state, 'berries', { x: 48, y: 53 }),
];
const { rules: omitted, ...saved } = state;
const server = await createServer({ root, configFile: `${root}vite.config.ts`, plugins: [{
  name: 'fish-fog-probe', enforce: 'pre', transform(code, id) {
    if (!id.endsWith('/src/dev-debug.ts')) return;
    const anchor = 'const hot = import.meta.hot!;';
    assert(code.includes(anchor));
    return code.replace(anchor, 'Object.assign(globalThis, { __fishContext: context }); ' + anchor);
  },
}], server: { host: '127.0.0.1', port: 5238, strictPort: true }, logLevel: 'error' });
await server.listen();
const libs = `${homedir()}/.cache/puppeteer/extra-libs/usr/lib/x86_64-linux-gnu`;
const browser = await puppeteer.launch({ headless: true,
  env: existsSync(libs) ? { ...process.env, LD_LIBRARY_PATH: libs } : process.env,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebGPU'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const errors: string[] = [];
  page.on('pageerror', error => { errors.push(String(error)); console.error(error); });
  page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
  page.on('requestfailed', request => console.error('Request failed:', request.url(), request.failure()?.errorText));
  await page.evaluateOnNewDocument(snapshot => sessionStorage.setItem('open-empires-lab:dev-session', JSON.stringify(snapshot)),
    { version: SNAPSHOT_VERSION, rulesOrigin: rules.origin, state: saved });
  await page.goto('http://127.0.0.1:5238/?solo=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window as any).__fishContext, { timeout: 120_000, polling: 100 });
  const query = (q: object): Promise<any> => page.evaluate(q => (window as any).__empiresDebug(q), q);
  const resumed = await query({ type: 'snapshot' });
  assert(resources.every(e => resumed.entities.some((r: any) => r.id === e.id && r.node === e.node)), 'fixture resumed');
  await query({ type: 'look', entity: resources[0].id });
  const inspect = async (prefix: string) => {
    const keys = resources.map(e => `${prefix}${e.id}`);
    await page.waitForFunction(keys => keys.every(key => (window as any).__fishContext.views.get(key)?.body.mesh.visible),
      { timeout: 30_000, polling: 100 }, keys);
    const images = await page.evaluate(keys => keys.map(key => {
      const view = (window as any).__fishContext.views.get(key);
      return { image: view.body.textureImage, fallback: view.fallback };
    }), keys);
    for (let i = 0; i < resources.length; i++) {
      const key = resources[i].node!;
      assert(!images[i].fallback, `${prefix}: ${key} uses owned art`);
      assert.equal(images[i].image, manifest.entities[key].atlases.idle.image, `${prefix}: ${key} retains its owned atlas`);
    }
    console.log(prefix === 'm' ? 'Remembered fish/shore-fish/berries use correct owned textures' : 'Visible resources use correct owned textures');
  };
  await inspect('e');
  for (let i = 0; i < 6; i++) await page.keyboard.press('+');
  await query({ type: 'command', command: { kind: 'order', player: 1, entityIds: [scout.id], target: { x: 35, y: 50 } } });
  await inspect('m');
  const fogged = await query({ type: 'snapshot' });
  for (const resource of resources) assert.equal(fogged.visibility[1].memory[resource.id].node, resource.node);
  await query({ type: 'command', command: { kind: 'order', player: 1, entityIds: [scout.id], target: scout.position } });
  await inspect('e');
  assert.deepEqual(errors, []);
  console.log('FISH FOG SMOKE GREEN: owned fish, shore fish and berries survive scout departure and return');
} finally { await browser.close(); await server.close(); }
