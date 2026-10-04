/** #289: real left-click selection over farms, with right-click work preserved. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import { createGame } from '../src/sim/game.ts';
import { FALLBACK_RULES, rulesFromManifest } from '../src/sim/data.ts';
import { SNAPSHOT_VERSION } from '../src/dev-session.ts';
import { updateVisibility } from '../src/sim/visibility.ts';
import type { Entity } from '../src/sim/types.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const fallback = process.env.OPEN_FALLBACK === '1';
const rules = fallback ? FALLBACK_RULES : rulesFromManifest(JSON.parse(readFileSync(`${root}public/imported/aoe2/manifest.json`, 'utf8')));
const state = createGame(289, rules);
state.entities = state.entities.filter(e => e.kind === 'town-center' || e.kind === 'villager');
state.terrain.fill(0); state.elevation.fill(0);
const home = state.entities.find(e => e.kind === 'town-center' && e.owner === 1)!;
const workers = state.entities.filter(e => e.kind === 'villager' && e.owner === 1);
const farm: Entity = { id: state.nextId++, kind: 'farm', owner: 1,
  position: { x: home.position.x + 10.5, y: home.position.y + .5 },
  hp: rules.buildings.farm.hp, maxHp: rules.buildings.farm.hp, radius: rules.buildings.farm.radius,
  amount: 100, resourceKind: 'food', activity: 'idle', order: { kind: 'idle' } };
state.entities.push(farm);
workers.forEach((worker, i) => { worker.position = { x: farm.position.x - i * 4, y: farm.position.y }; });
updateVisibility(state);
const { rules: ignored, ...saved } = state;
const server = await createServer({ root, configFile: `${root}vite.config.ts`, plugins: [{
  name: 'farm-selection-fixture', enforce: 'pre', transform(code, id) {
    if (!id.endsWith('/src/main.ts')) return;
    assert(code.includes('let paused = false;'));
    return code.replace('let paused = false;', 'let paused = true;');
  },
}], server: { host: '127.0.0.1', port: 5268, strictPort: true }, logLevel: 'error' });
await server.listen();
const libs = `${homedir()}/.cache/puppeteer/extra-libs/usr/lib/x86_64-linux-gnu`;
const browser = await puppeteer.launch({ headless: true,
  env: existsSync(libs) ? { ...process.env, LD_LIBRARY_PATH: libs } : process.env,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebGPU'] });
try {
  const page = await browser.newPage(), errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.setViewport({ width: 1280, height: 800 });
  if (fallback) {
    await page.setRequestInterception(true);
    page.on('request', r => { void (r.url().includes('/imported/') ? r.respond({ status: 404, body: '' }) : r.continue()); });
  }
  await page.evaluateOnNewDocument(snapshot => sessionStorage.setItem('open-empires-lab:dev-session', JSON.stringify(snapshot)),
    { version: SNAPSHOT_VERSION, rulesOrigin: rules.origin, state: saved });
  await page.goto('http://127.0.0.1:5268/?solo=1', { waitUntil: 'networkidle0', timeout: 120_000 });
  await page.waitForFunction(() => typeof (window as any).__empiresDebug === 'function', { timeout: 60_000 });
  const query = (q: object): Promise<any> => page.evaluate(q => (window as any).__empiresDebug(q), q);
  assert.equal((await query({ type: 'sim' })).tick, state.tick);
  assert((await query({ type: 'snapshot' })).entities.some((e: any) => e.id === farm.id && e.kind === 'farm'), 'fixture resumed');
  await query({ type: 'look', entity: farm.id });
  const farmer = (await query({ type: 'entities', id: workers[0].id })).entities[0];
  assert(farmer.rendered, 'farmer has a scene view');
  const before = (await query({ type: 'sim' })).synchronizationHash;
  // Aim above the ground anchor, on the villager rather than the field.
  await page.mouse.click(farmer.screen.x, farmer.screen.y - 10);
  const selected = (await query({ type: 'sim' })).selected;
  console.log(`Click on farmer: selected ${JSON.stringify(selected)}, expected ${workers[0].id}; farm ${farm.id}`);
  assert.deepEqual(selected, [workers[0].id], 'left-click selects the villager standing on the farm');
  assert.equal((await query({ type: 'sim' })).synchronizationHash, before, 'selection is read-only');
  // The farm must remain selectable on an exposed part of its footprint.
  // +1.2,+1.2 tiles projects straight down. Derive its screen distance from
  // the second worker's known four-tile separation, preserving camera zoom.
  const other = (await query({ type: 'entities', id: workers[1].id })).entities[0];
  await page.mouse.click(farmer.screen.x, farmer.screen.y + .6 * Math.abs(farmer.screen.y - other.screen.y));
  assert.deepEqual((await query({ type: 'sim' })).selected, [farm.id]);
  await query({ type: 'select', ids: [workers[1].id] });
  await page.keyboard.down('Shift');
  await page.mouse.click(farmer.screen.x, farmer.screen.y - 10);
  await page.keyboard.up('Shift');
  assert.deepEqual((await query({ type: 'sim' })).selected, [workers[1].id, workers[0].id]);
  await query({ type: 'select', ids: [workers[1].id] });
  await page.mouse.move(farmer.screen.x, farmer.screen.y - 10);
  await page.waitForFunction(fallback => {
    const css = getComputedStyle(document.querySelector('canvas.battlefield')!).cursor;
    return fallback ? css === 'default' : css.includes('/gather32x32.cur');
  }, { timeout: 10_000 }, fallback);
  await page.mouse.click(farmer.screen.x, farmer.screen.y - 10, { button: 'right' });
  const ordered = (await query({ type: 'snapshot' })).entities.find((e: any) => e.id === workers[1].id);
  assert.equal(ordered.order.kind, 'gather');
  assert.equal(ordered.order.targetId, farm.id);
  assert.deepEqual(errors, []);
  console.log(`FARM SELECTION GREEN (${fallback ? 'fallback' : 'owned'}): villager click/Shift-click, exposed farm click, gather cursor and right-click`);
} finally { await browser.close(); await server.close(); }
