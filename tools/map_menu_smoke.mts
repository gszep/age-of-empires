/** Issue #144: real menu controls on a private host, including its solo override. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import puppeteer, { type Page } from 'puppeteer';
import { createServer } from 'vite';
import { sharedMatchPlugin } from '../src/shared/server.ts';
import { createGame } from '../src/sim/game.ts';
import { FALLBACK_RULES, rulesFromManifest } from '../src/sim/data.ts';
import { MAPS } from '../src/sim/mapgen.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const checkpoint = `${root}.local/map-menu-smoke-${process.pid}.json`;
const server = await createServer({ root, configFile: `${root}vite.config.ts`, plugins: [sharedMatchPlugin(root, checkpoint)],
  server: { host: '127.0.0.1', port: 5209, strictPort: true }, logLevel: 'error' });
await server.listen();
const base = 'http://127.0.0.1:5209';
const libs = `${homedir()}/.cache/puppeteer/extra-libs/usr/lib/x86_64-linux-gnu`;
const browser = await puppeteer.launch({ headless: true, env: existsSync(libs) ? { ...process.env, LD_LIBRARY_PATH: libs } : process.env,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebGPU'] });
const manifest = `${root}public/imported/aoe2/manifest.json`;
const rules = existsSync(manifest) ? rulesFromManifest(JSON.parse(readFileSync(manifest, 'utf8'))) : FALLBACK_RULES;
const query = (page: Page, value: object): Promise<any> => page.evaluate(q => (globalThis as any).__empiresDebug(q), value);
const ready = (page: Page) => page.waitForFunction(() => typeof (globalThis as any).__empiresDebug === 'function', { timeout: 120_000, polling: 100 });
const until = (page: Page, expression: string) => page.waitForFunction(async text => {
  if (typeof (globalThis as any).__empiresDebug !== 'function') return false;
  const state = await (globalThis as any).__empiresDebug({ type: 'sim' });
  return new Function('s', `return ${text}`)(state);
}, { timeout: 30_000, polling: 100 }, expression);
const errors: string[] = [];
async function open(path: string): Promise<Page> {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  page.on('pageerror', error => { errors.push(String(error)); console.error(error); });
  await page.goto(base + path, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await ready(page);
  return page;
}
async function fillSeed(page: Page, seed: string): Promise<void> {
  await page.click('#map-seed');
  await page.keyboard.down('Control');
  await page.keyboard.press('a');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  if (seed) await page.keyboard.type(seed);
  assert.equal(await page.$eval('#map-seed', e => (e as HTMLInputElement).value), seed);
}
async function choose(page: Page, map: string, seed: number): Promise<void> {
  await page.bringToFront();
  const opened = await page.$eval('#menu-dialog', e => !e.classList.contains('hidden'));
  if (!opened) await page.keyboard.press('F10');
  await page.select('#map-choice', map);
  await fillSeed(page, String(seed));
  await page.click('#map-setup button[type="submit"]');
  await until(page, `s.connection.setup.map === '${map}' && s.connection.setup.seed === ${seed}`);
  await page.waitForSelector('#menu-dialog.hidden');
}
try {
  const solo = await open('/?solo=1&map=arabia&seed=23');
  assert.equal((await query(solo, { type: 'sim' })).connection.connected, false);
  await solo.keyboard.press('F3'); await until(solo, 's.connection.paused');
  const worker = (await query(solo, { type: 'entities', owner: 1 })).entities.find((e: any) => e.kind === 'villager');
  await solo.mouse.click(worker.screen.x, worker.screen.y);
  await solo.keyboard.press('F10');
  assert.deepEqual(await solo.$$eval('#map-choice option', options => options.map(o => (o as HTMLOptionElement).value)), Object.keys(MAPS));
  const before = await query(solo, { type: 'sim' });
  await solo.select('#map-choice', 'islands');
  await fillSeed(solo, '2');
  await solo.keyboard.press('ArrowUp');
  assert.equal(await solo.$eval('#map-seed', e => (e as HTMLInputElement).value), '3');
  await solo.keyboard.press('Delete');
  assert.equal((await query(solo, { type: 'sim' })).synchronizationHash, before.synchronizationHash, 'editing cannot issue game hotkeys');
  await fillSeed(solo, '0');
  await solo.click('#map-setup button[type="submit"]');
  assert.equal((await query(solo, { type: 'sim' })).synchronizationHash, before.synchronizationHash, 'invalid seed cannot replace the match');
  await choose(solo, 'islands', 2);
  const islands = await query(solo, { type: 'snapshot' });
  assert.deepEqual(islands.terrain, createGame(2, rules, undefined, 'islands').terrain);
  assert.equal(new URL(solo.url()).searchParams.get('solo'), '1');
  assert.equal(new URL(solo.url()).searchParams.has('map'), false);
  await until(solo, 's.tick >= 20');
  const tick = (await query(solo, { type: 'sim' })).tick;
  await solo.reload({ waitUntil: 'domcontentloaded' }); await ready(solo);
  const resumed = await query(solo, { type: 'sim' });
  assert.deepEqual(resumed.connection.setup, { map: 'islands', seed: 2 });
  assert(resumed.tick >= tick, 'reload resumes rather than re-dealing the chosen board');
  console.log('Solo: six maps, safe text input, seed validation, Islands seed 2 and reload persistence');

  await choose(solo, 'windsor', 7);
  assert.equal((await query(solo, { type: 'snapshot' })).width, 392);
  await solo.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const ground = await query(solo, { type: 'pixels', rect: [440, 320, 100, 100], match: '#18140c', tolerance: 2 });
  assert(ground.matched < ground.pixels / 2, 'terrain exists around the new home on the larger map');
  await choose(solo, 'black-forest', 9);
  assert.equal((await query(solo, { type: 'snapshot' })).width, 120);
  await solo.keyboard.press('F10');
  await solo.click('#random-map-seed');
  assert.equal(await solo.$eval('#map-seed', e => (e as HTMLInputElement).value), '');
  await solo.click('#map-setup button[type="submit"]');
  await until(solo, "s.connection.setup.seed !== 9");
  const random = (await query(solo, { type: 'sim' })).connection.setup;
  assert.equal(random.map, 'black-forest'); assert(Number.isInteger(random.seed) && random.seed > 0);
  console.log('Solo: large/small map transitions rebuild terrain; Random creates a new seed');
  await solo.close();

  const host = await open('/');
  await host.keyboard.press('F3'); await until(host, 's.connection.paused');
  const guest = await open('/?player=2');
  await guest.keyboard.press('F10');
  assert(await guest.$eval('#map-choice', e => (e as HTMLSelectElement).disabled));
  assert(await guest.$eval('#map-setup button[type="submit"]', e => (e as HTMLButtonElement).disabled));
  await choose(host, 'islands', 2);
  await until(guest, "s.connection.setup.map === 'islands' && s.connection.setup.seed === 2");
  await host.keyboard.press('F3'); await until(host, 's.connection.paused'); await until(guest, 's.connection.paused');
  assert.equal((await query(host, { type: 'sim' })).synchronizationHash, (await query(guest, { type: 'sim' })).synchronizationHash);
  assert.deepEqual(JSON.parse(readFileSync(checkpoint, 'utf8')).setup, { map: 'islands', seed: 2 });
  console.log('Shared: host menu changes both clients; guest is read-only; setup is checkpointed');
  assert.deepEqual(errors, []);
  console.log('MAP MENU SMOKE GREEN');
} finally {
  await browser.close(); await server.close(); rmSync(checkpoint, { force: true });
}
