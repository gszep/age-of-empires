/** #294: an Imperial Japanese town center draws player colour only where its own art has a mask. */
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
assert(manifest.civilizations?.japanese, 'owned import publishes the Japanese profile');
const rules = rulesFromManifest(manifest), state = createGame(294, rules, { 1: 'japanese', 2: 'britons' });
state.entities = state.entities.filter(e => e.kind === 'town-center');
state.terrain.fill(0); state.elevation.fill(0);
state.players[1].age = 3;
const tc = state.entities.find(e => e.owner === 1)!;
updateVisibility(state);
const { rules: ignored, ...saved } = state;
const server = await createServer({ root, configFile: `${root}vite.config.ts`, plugins: [{
  name: 'tc-annex-fixture', enforce: 'pre', transform(code, id) {
    if (!id.endsWith('/src/main.ts')) return;
    assert(code.includes('renderer.render(scene, camera);') && code.includes('let paused = false;'));
    return code.replace('let paused = false;', 'let paused = true;').replace('renderer.render(scene, camera);',
      'Object.assign(globalThis, { __tc: { views } }); renderer.render(scene, camera);');
  },
}], server: { host: '127.0.0.1', port: 5272, strictPort: true }, logLevel: 'error' });
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
  await page.goto('http://127.0.0.1:5272/?solo=1', { waitUntil: 'networkidle0', timeout: 120_000 });
  const query = (q: object): Promise<any> => page.evaluate(q => (window as any).__empiresDebug(q), q);
  assert((await query({ type: 'snapshot' })).entities.some((e: any) => e.id === tc.id), 'fixture resumed');
  await query({ type: 'look', entity: tc.id });
  await page.waitForNetworkIdle({ idleTime: 500, timeout: 30_000 });
  const pieces = await page.evaluate(id => {
    const view = (globalThis as any).__tc.views.get(`e${id}`);
    return view.annexes.map((piece: any, index: number) => ({
      art: piece.textureImage, color: view.annexColors[index].mesh.visible ? view.annexColors[index].textureImage : null,
    }));
  }, tc.id);
  console.log(JSON.stringify(pieces));
  const art = (stem: string) => pieces.find((p: any) => p.art?.includes(stem));
  assert(art('annex0-idle-imperial')?.color?.includes('annex0-idle-imperial-playercolor'), 'main piece keeps its own mask');
  assert(art('annex2-idle-imperial'), 'front piece draws Imperial art');
  assert.equal(art('annex2-idle-imperial').color, null, 'front piece borrows no other age’s mask');
  for (const piece of pieces) {
    if (piece.color) assert(piece.color.startsWith(piece.art.replace(/\.png$/, '').replace(/-p\d+$/, '')), `${piece.art} colour ${piece.color}`);
  }
  if (process.env.SCREENSHOT) await page.screenshot({ path: process.env.SCREENSHOT });
  assert.deepEqual(errors, []);
  console.log('TC ANNEX COLOUR GREEN: every visible annex colour mask matches its own art');
} finally { await browser.close(); await server.close(); }
