/** #82/#156: a real group right-click produces one farmer. ENEMY_FARM=1
 * verifies capture on work, preserved crop/HP, own income and reload. */
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
const manifest = `${root}public/imported/aoe2/manifest.json`;
const fallback = process.env.OPEN_FALLBACK === '1';
const enemyFarm = process.env.ENEMY_FARM === '1';
const rules = !fallback && existsSync(manifest) ? rulesFromManifest(JSON.parse(readFileSync(manifest, 'utf8'))) : FALLBACK_RULES;
const state = createGame(82, rules);
// Keep the built-in opponent from spending its initial food on training while
// we measure which player's stockpile receives the captured crop.
Object.assign(state.players[2], { food: 0, wood: 0, gold: 0, stone: 0 });
state.entities = state.entities.filter(e => e.kind === 'town-center' || e.kind === 'villager');
state.terrain.fill(0); state.elevation.fill(0);
const home = state.entities.find(e => e.kind === 'town-center' && e.owner === 1)!;
const workers = state.entities.filter(e => e.kind === 'villager' && e.owner === 1);
const farm: Entity = { id: state.nextId++, kind: 'farm', owner: enemyFarm ? 2 : 1,
  position: { x: home.position.x + 12.5, y: home.position.y + 0.5 },
  hp: rules.buildings.farm.hp - 37, maxHp: rules.buildings.farm.hp, radius: rules.buildings.farm.radius,
  amount: 100, resourceKind: 'food', activity: 'idle', order: { kind: 'idle' } };
state.entities.push(farm);
workers.forEach((worker, i) => { worker.position = { x: farm.position.x - 3 - i * 0.5, y: farm.position.y }; });
updateVisibility(state);
const { rules: ignored, ...saved } = state;
const server = await createServer({ root, configFile: `${root}vite.config.ts`, plugins: [{
  name: 'paused-farm-fixture', enforce: 'pre', transform(code, id) {
    if (!id.endsWith('/src/main.ts')) return;
    assert(code.includes('let paused = false;'));
    return code.replace('let paused = false;', 'let paused = true;');
  },
}],
  server: { host: '127.0.0.1', port: 5213, strictPort: true }, logLevel: 'error' });
await server.listen();
const libs = `${homedir()}/.cache/puppeteer/extra-libs/usr/lib/x86_64-linux-gnu`;
const browser = await puppeteer.launch({ headless: true, env: existsSync(libs) ? { ...process.env, LD_LIBRARY_PATH: libs } : process.env,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebGPU'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  if (fallback) {
    await page.setRequestInterception(true);
    page.on('request', r => { void (r.url().includes('/imported/') ? r.respond({ status: 404, body: '' }) : r.continue()); });
  }
  const handle = await page.evaluateOnNewDocument(snapshot => sessionStorage.setItem('open-empires-lab:dev-session', JSON.stringify(snapshot)),
    { version: SNAPSHOT_VERSION, rulesOrigin: rules.origin, state: saved });
  await page.goto('http://127.0.0.1:5213/?solo=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).__empiresDebug === 'function', { timeout: 120_000, polling: 100 });
  const query = (q: object): Promise<any> => page.evaluate(q => (window as any).__empiresDebug(q), q);
  await page.removeScriptToEvaluateOnNewDocument(handle.identifier);
  assert.equal((await query({ type: 'sim' })).tick, state.tick);
  assert((await query({ type: 'snapshot' })).entities.some((e: any) => e.id === farm.id && e.kind === 'farm'), 'fixture resumed');
  await query({ type: 'look', entity: farm.id });
  await query({ type: 'select', ids: workers.map(e => e.id) });
  const drawn = (await query({ type: 'entities', id: farm.id })).entities[0];
  const before = await query({ type: 'sim' });
  await page.mouse.move(drawn.screen.x, drawn.screen.y);
  await page.waitForFunction(fallback => {
    const css = getComputedStyle(document.querySelector('canvas.battlefield')!).cursor;
    return fallback ? css === 'default' : css.includes('/gather32x32.cur');
  }, { timeout: 10_000 }, fallback);
  assert.equal((await query({ type: 'sim' })).synchronizationHash, before.synchronizationHash, 'hover is read-only');
  await page.mouse.click(drawn.screen.x, drawn.screen.y, { button: 'right' });
  const assigned = (await query({ type: 'snapshot' })).entities.filter((e: any) => e.order.kind === 'gather' && e.order.targetId === farm.id);
  assert.equal(assigned.length, 1);
  const ordered = await query({ type: 'snapshot' });
  assert.equal(ordered.entities.find((e: any) => e.id === farm.id).owner, farm.owner, 'right-click does not capture remotely');
  assert(workers.every(w => ordered.entities.find((e: any) => e.id === w.id).order.kind !== 'attack'));
  for (let i = 0; i < 6; i++) await page.keyboard.press('+');
  await page.keyboard.press('F3');
  await page.waitForFunction(async id => {
    const state = await (window as any).__empiresDebug({ type: 'snapshot' });
    return state.entities.find((e: any) => e.id === id)?.amount < 100;
  }, { timeout: 30_000, polling: 100 }, farm.id);
  const working = await query({ type: 'snapshot' });
  assert.equal(working.entities.filter((e: any) => e.order.kind === 'gather' && e.order.targetId === farm.id).length, 1);
  const farmer = (await query({ type: 'entities', id: assigned[0].id })).entities[0];
  assert(farmer.rendered, 'farmer is rendered while the farm yields food');
  if (enemyFarm) {
    await page.waitForFunction(async initial => {
      const s = await (window as any).__empiresDebug({ type: 'snapshot' });
      return s.players[1].food > initial;
    }, { timeout: 30_000, polling: 100 }, state.players[1].food);
    await page.keyboard.press('F3');
    const banked = await query({ type: 'snapshot' });
    const claimed = banked.entities.find((e: any) => e.id === farm.id);
    assert.equal(claimed.owner, 1); assert.equal(claimed.hp, farm.hp); assert.equal(claimed.maxHp, farm.maxHp);
    assert.equal(banked.players[2].food, state.players[2].food);
    const hash = (await query({ type: 'sim' })).synchronizationHash;
    await page.reload({ waitUntil: 'networkidle0', timeout: 120_000 });
    await page.waitForFunction(() => typeof (window as any).__empiresDebug === 'function', { timeout: 60_000 });
    assert.equal((await query({ type: 'sim' })).synchronizationHash, hash, 'capture and farmer survive reload');
    console.log(`FARM CAPTURE GREEN (${fallback ? 'fallback' : 'owned'}): gather cursor, one farmer, preserved HP/crop, food banked for new owner, reload`);
  }
  assert.deepEqual(errors, []);
  console.log('FARM OCCUPANCY SMOKE GREEN: group right-click assigns one farmer; only that worker gathers food');
} finally { await browser.close(); await server.close(); }
