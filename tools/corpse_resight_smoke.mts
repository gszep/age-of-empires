/** #120: an old corpse must not die again when a scout re-enters sight. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import { applyCommand, createGame, stepGame } from '../src/sim/game.ts';
import { rulesFromManifest } from '../src/sim/data.ts';
import { SNAPSHOT_VERSION } from '../src/dev-session.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const rules = rulesFromManifest(JSON.parse(readFileSync(`${root}public/imported/aoe2/manifest.json`, 'utf8')));
const state = createGame(120, rules);
const home = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
const scout = state.entities.find(e => e.owner === 1 && e.kind === 'scout-cavalry')!;
const corpse = state.entities.find(e => e.owner === 2 && e.kind === 'villager')!;
state.entities = state.entities.filter(e => e.kind === 'town-center' || e.id === scout.id || e.id === corpse.id);
state.terrain.fill(0);
corpse.position = { x: home.position.x + 14, y: home.position.y };
scout.position = { x: corpse.position.x + 1, y: corpse.position.y };
assert(applyCommand(state, { kind: 'delete', player: 2, entityIds: [corpse.id] }).ok);
for (let i = 0; i < 200; i++) stepGame(state);
const { rules: ignored, ...saved } = state;
const server = await createServer({ root, configFile: `${root}vite.config.ts`,
  server: { host: '127.0.0.1', port: 5227, strictPort: true }, logLevel: 'error' });
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
  await page.goto('http://127.0.0.1:5227/?solo=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).__empiresDebug === 'function', { timeout: 120_000, polling: 100 });
  const query = (q: object): Promise<any> => page.evaluate(q => (window as any).__empiresDebug(q), q);
  await page.keyboard.press('F3');
  assert((await query({ type: 'snapshot' })).tick >= 200, 'old-corpse fixture resumed');
  await query({ type: 'look', entity: corpse.id });
  const before = (await query({ type: 'entities', id: corpse.id, dead: true })).entities[0];
  assert(before.rendered && before.animation.endsWith('/decay'), `initial saved corpse: ${before.animation}`);
  await query({ type: 'command', command: { kind: 'order', player: 1, entityIds: [scout.id], target: home.position } });
  for (let i = 0; i < 6; i++) await page.keyboard.press('+');
  await page.keyboard.press('F3');
  await page.waitForFunction(async id => {
    const e = (await (window as any).__empiresDebug({ type: 'entities', id, dead: true })).entities[0];
    return e && !e.rendered;
  }, { timeout: 30_000, polling: 100 }, corpse.id);
  await query({ type: 'command', command: { kind: 'order', player: 1, entityIds: [scout.id],
    target: { x: corpse.position.x + 1, y: corpse.position.y } } });
  await page.waitForFunction(async id => {
    const e = (await (window as any).__empiresDebug({ type: 'entities', id, dead: true })).entities[0];
    return e?.rendered;
  }, { timeout: 30_000, polling: 50 }, corpse.id);
  await page.keyboard.press('F3');
  const after = (await query({ type: 'entities', id: corpse.id, dead: true })).entities[0];
  assert(after.animation.endsWith('/decay'), `resighted corpse: ${after.animation}`);
  assert.deepEqual(errors, []);
  console.log(`CORPSE RESIGHT SMOKE GREEN: saved corpse ${before.animation}; hidden view removed; resighted ${after.animation}`);
} finally { await browser.close(); await server.close(); }
