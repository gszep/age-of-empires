/** #144/#141: real map/options controls on a private host and its solo override. */
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
import { POPULATION_LIMITS } from '../src/sim/population.ts';
import { DEFAULT_GAME_SPEED } from '../src/shared/protocol.ts';
import { runMatch } from '../src/headless/runner.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const checkpoint = `${root}.local/map-menu-smoke-${process.pid}.json`;
const server = await createServer({ root, configFile: `${root}vite.config.ts`, plugins: [sharedMatchPlugin(root, checkpoint), {
  name: 'population-replay-observer', enforce: 'pre',
  transform(code, id) {
    if (!id.endsWith('/src/main.ts')) return;
    const anchor = 'renderer.setAnimationLoop(now => {'; assert(code.includes(anchor));
    return code.replace(anchor, `Object.assign(globalThis, {
      __populationReplay: () => ({ verified: replay?.verified, failed: replay?.failed })
    });\n${anchor}`);
  },
}],
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
async function open(path: string, preferredSpeed?: number): Promise<Page> {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  page.on('pageerror', error => { errors.push(String(error)); console.error(error); });
  if (preferredSpeed !== undefined) await page.evaluateOnNewDocument(speed => {
    if (!sessionStorage.getItem('options-shared-fixture')) {
      localStorage.setItem('open-empires-lab:preferences', JSON.stringify({ speed, music: 0, sound: 0 }));
      sessionStorage.setItem('options-shared-fixture', '1');
    }
  }, preferredSpeed);
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
  assert.deepEqual(await solo.$$eval('#population-limit option', options => options.map(o => Number((o as HTMLOptionElement).value))), POPULATION_LIMITS);
  await solo.select('#population-limit', '25');
  await solo.click('#wonder-victory');
  assert.equal((await query(solo, { type: 'sim' })).synchronizationHash, before.synchronizationHash, 'population edits do not change a live match');
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
  assert.equal(islands.populationLimit, 25);
  assert.equal(islands.wonderVictory, true);
  assert.equal((await query(solo, { type: 'sim' })).connection.setup.populationLimit, 25);
  assert.deepEqual(islands.terrain, createGame(2, rules, undefined, 'islands').terrain);
  assert.equal(new URL(solo.url()).searchParams.get('solo'), '1');
  assert.equal(new URL(solo.url()).searchParams.has('map'), false);
  await until(solo, 's.tick >= 20');
  const tick = (await query(solo, { type: 'sim' })).tick;
  await solo.reload({ waitUntil: 'domcontentloaded' }); await ready(solo);
  const resumed = await query(solo, { type: 'sim' });
  assert.equal(resumed.connection.setup.map, 'islands');
  assert.equal(resumed.connection.setup.seed, 2);
  assert.equal(resumed.connection.setup.mode ?? 'random-map', 'random-map');
  assert.equal(resumed.connection.setup.populationLimit, 25);
  assert.equal(resumed.connection.setup.wonderVictory, true);
  assert.equal((await query(solo, { type: 'snapshot' })).populationLimit, 25);
  assert(resumed.tick >= tick, 'reload resumes rather than re-dealing the chosen board');
  console.log('Solo: six maps, safe text input, seed validation, Islands seed 2 and reload persistence');

  await choose(solo, 'windsor', 7);
  assert.equal((await query(solo, { type: 'snapshot' })).populationLimit, 25, 'map changes retain the selected ceiling');
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
  await solo.keyboard.press('F10'); await solo.select('#population-limit', '500');
  await solo.click('#map-setup button[type="submit"]');
  await until(solo, 's.connection.setup.populationLimit === 500');
  await solo.keyboard.press('F10'); await solo.click('[data-menu="restart"]');
  await until(solo, 's.connection.setup.populationLimit === 500');
  assert.equal((await query(solo, { type: 'snapshot' })).populationLimit, 500, 'Restart uses the active ceiling');
  assert.equal(await solo.evaluate(() => JSON.parse(localStorage.getItem('open-empires-lab:map-setup')!).populationLimit), 500);
  console.log('Population menu: source-measured choices, no live mutation, chosen 25/500, reload/restart and preferences');
  console.log('Solo: large/small map transitions rebuild terrain; Random creates a new seed');
  const replay = await runMatch({ version: 2, seed: 253, populationLimit: 25, wonderVictory: true, maxTimeSeconds: 5 },
    { 1: { decide: () => [] }, 2: { decide: () => [] } }, rules);
  await solo.evaluate(record => {
    const input = document.querySelector<HTMLInputElement>('#replay-file')!, transfer = new DataTransfer();
    transfer.items.add(new File([JSON.stringify(record)], 'population25.json', { type: 'application/json' }));
    input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
  }, replay.record);
  await solo.waitForFunction(() => (globalThis as any).__populationReplay().verified === 1, { timeout: 30_000 });
  assert.equal(await solo.evaluate(() => (globalThis as any).__populationReplay().failed), false);
  assert.equal((await query(solo, { type: 'snapshot' })).populationLimit, 25);
  assert.equal((await query(solo, { type: 'snapshot' })).wonderVictory, true);
  console.log('Population replay: actual file input restores 25 and verifies the real-clock headless checksum');
  await solo.close();

  const host = await open('/', 5);
  assert.equal((await query(host, { type: 'sim' })).connection.speed, DEFAULT_GAME_SPEED, 'joining does not send a local speed preference');
  await host.keyboard.press('F3'); await until(host, 's.connection.paused');
  const guest = await open('/?player=2', 0);
  assert.equal((await query(guest, { type: 'sim' })).connection.speed, DEFAULT_GAME_SPEED);
  await guest.keyboard.press('F10');
  assert(await guest.$eval('#map-choice', e => (e as HTMLSelectElement).disabled));
  assert(await guest.$eval('#population-limit', e => (e as HTMLSelectElement).disabled));
  assert(await guest.$eval('#wonder-victory', e => (e as HTMLInputElement).disabled));
  assert(await guest.$eval('#map-setup button[type="submit"]', e => (e as HTMLButtonElement).disabled));
  await guest.click('#menu-dialog [data-options]');
  await guest.waitForSelector('#options-dialog[open]');
  await guest.select('#option-speed', '4'); await guest.click('[data-option-action="ok"]');
  await until(host, 's.connection.speed === 4'); await until(guest, 's.connection.speed === 4');
  await guest.evaluate(() => localStorage.setItem('open-empires-lab:preferences', JSON.stringify({ speed: 0, music: 0, sound: 0 })));
  await guest.reload({ waitUntil: 'domcontentloaded' }); await ready(guest);
  assert.equal((await query(guest, { type: 'sim' })).connection.speed, 4, 'reload preserves authoritative shared speed');
  assert.equal((await query(host, { type: 'sim' })).connection.speed, 4);
  console.log('Shared options: local saved speed never overwrites host on join/reload; explicit Apply uses shared settings');
  await host.bringToFront(); await host.keyboard.press('F10'); await host.select('#population-limit', '50');
  if (!(await host.$eval('#wonder-victory', e => (e as HTMLInputElement).checked))) await host.click('#wonder-victory');
  await choose(host, 'islands', 2);
  await until(guest, "s.connection.setup.map === 'islands' && s.connection.setup.seed === 2");
  await host.keyboard.press('F3'); await until(host, 's.connection.paused'); await until(guest, 's.connection.paused');
  assert.equal((await query(host, { type: 'sim' })).synchronizationHash, (await query(guest, { type: 'sim' })).synchronizationHash);
  assert.equal((await query(host, { type: 'snapshot' })).populationLimit, 50);
  assert.equal((await query(guest, { type: 'snapshot' })).populationLimit, 50);
  assert.equal((await query(guest, { type: 'snapshot' })).wonderVictory, true);
  const savedSetup = JSON.parse(readFileSync(checkpoint, 'utf8')).setup;
  assert.equal(savedSetup.map, 'islands'); assert.equal(savedSetup.seed, 2);
  assert.equal(savedSetup.mode ?? 'random-map', 'random-map');
  assert.equal(savedSetup.populationLimit, 50);
  assert.equal(savedSetup.wonderVictory, true);
  assert.equal(JSON.parse(readFileSync(checkpoint, 'utf8')).state.populationLimit, 50);
  await guest.reload({ waitUntil: 'domcontentloaded' }); await ready(guest);
  assert.equal((await query(guest, { type: 'snapshot' })).populationLimit, 50, 'rejoin preserves the host ceiling');
  assert.equal((await query(guest, { type: 'snapshot' })).wonderVictory, true);
  assert.equal((await query(host, { type: 'sim' })).synchronizationHash, (await query(guest, { type: 'sim' })).synchronizationHash);
  console.log('Shared: host menu changes both clients; guest is read-only; setup is checkpointed');
  assert.deepEqual(errors, []);
  console.log('MAP MENU SMOKE GREEN');
} finally {
  await browser.close(); await server.close(); rmSync(checkpoint, { force: true });
}
