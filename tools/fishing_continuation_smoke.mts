/** #87: a real fishing order survives depletion, banking and return to sea. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import { addNode, createGame, holdOf } from '../src/sim/game.ts';
import { FALLBACK_RULES, rulesFromManifest } from '../src/sim/data.ts';
import { SNAPSHOT_VERSION } from '../src/dev-session.ts';
import type { Entity } from '../src/sim/types.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = `${root}public/imported/aoe2/manifest.json`;
const rules = existsSync(manifest) ? rulesFromManifest(JSON.parse(readFileSync(manifest, 'utf8'))) : FALLBACK_RULES;
const state = createGame(87, rules);
state.entities = state.entities.filter(e => e.owner !== 0);
state.terrain = state.terrain.map(() => 0);
for (let y = 15; y < 30; y++) for (let x = 20; x < 65; x++) state.terrain[y * state.width + x] = 1;
const dock: Entity = { id: state.nextId++, kind: 'dock', owner: 1,
  position: { x: 20.5, y: 22.5 }, hp: rules.buildings.dock.hp, maxHp: rules.buildings.dock.hp,
  radius: rules.buildings.dock.radius, activity: 'idle', order: { kind: 'idle' } };
const ship: Entity = { id: state.nextId++, kind: 'fishing-ship', owner: 1,
  position: { x: 40.5, y: 20.5 }, hp: rules.units['fishing-ship'].hp, maxHp: rules.units['fishing-ship'].hp,
  radius: rules.units['fishing-ship'].radius, activity: 'idle', order: { kind: 'idle' } };
state.entities.push(dock, ship);
const first = addNode(state, 'fish', { x: 43.5, y: 22.5 });
const next = addNode(state, 'fish', { x: 46.5, y: 22.5 });
first.amount = holdOf(state, ship);
next.amount = 2;
const before = state.players[1].food;
const total = first.amount + next.amount;
const { rules: ignored, ...saved } = state;
const server = await createServer({ root, configFile: `${root}vite.config.ts`,
  server: { host: '127.0.0.1', port: 5216, strictPort: true }, logLevel: 'error' });
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
  await page.goto('http://127.0.0.1:5216/?solo=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).__empiresDebug === 'function', { timeout: 120_000, polling: 100 });
  const query = (q: object): Promise<any> => page.evaluate(q => (window as any).__empiresDebug(q), q);
  await page.keyboard.press('F3');
  assert((await query({ type: 'snapshot' })).entities.some((e: any) => e.id === ship.id && e.kind === 'fishing-ship'), 'fixture resumed');
  await query({ type: 'look', entity: first.id });
  await query({ type: 'select', ids: [ship.id] });
  const drawn = (await query({ type: 'entities', id: first.id })).entities[0];
  await page.mouse.click(drawn.screen.x, drawn.screen.y, { button: 'right' });
  assert.deepEqual((await query({ type: 'snapshot' })).entities.find((e: any) => e.id === ship.id).order,
    { kind: 'gather', targetId: first.id });
  for (let i = 0; i < 6; i++) await page.keyboard.press('+');
  await page.keyboard.press('F3');
  await page.waitForFunction(async food => {
    const state = await (window as any).__empiresDebug({ type: 'snapshot' });
    return state.players[1].food >= food;
  }, { timeout: 120_000, polling: 100 }, before + first.amount);
  const banked = await query({ type: 'snapshot' });
  assert(!banked.entities.some((e: any) => e.id === first.id), 'first fish disappeared during banking');
  assert.equal(banked.visibility[1].visible[Math.floor(next.position.y) * state.width + Math.floor(next.position.x)], 0,
    'remaining fish is out of sight at the dock');
  await page.waitForFunction(async food => {
    const state = await (window as any).__empiresDebug({ type: 'snapshot' });
    return state.players[1].food >= food;
  }, { timeout: 120_000, polling: 100 }, before + total);
  const result = await query({ type: 'snapshot' });
  assert.equal(result.players[1].food - before, total);
  assert.equal(result.entities.find((e: any) => e.id === next.id)?.amount ?? 0, 0);
  await query({ type: 'look', entity: ship.id });
  assert((await query({ type: 'entities', id: ship.id })).entities[0].rendered, 'ship is rendered');
  assert.deepEqual(errors, []);
  console.log(`FISHING CONTINUATION GREEN (${rules.origin}): right-click → deplete → bank → return through fog → fish again; ${total} food banked`);
} finally { await browser.close(); await server.close(); }
