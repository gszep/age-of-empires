/** #82: a real group right-click on a farm must produce one farmer. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import { createGame } from '../src/sim/game.ts';
import { FALLBACK_RULES, rulesFromManifest } from '../src/sim/data.ts';
import { SNAPSHOT_VERSION } from '../src/dev-session.ts';
import type { Entity } from '../src/sim/types.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = `${root}public/imported/aoe2/manifest.json`;
const rules = existsSync(manifest) ? rulesFromManifest(JSON.parse(readFileSync(manifest, 'utf8'))) : FALLBACK_RULES;
const state = createGame(82, rules);
state.entities = state.entities.filter(e => e.owner !== 0);
state.terrain.fill(0);
const home = state.entities.find(e => e.kind === 'town-center' && e.owner === 1)!;
const workers = state.entities.filter(e => e.kind === 'villager' && e.owner === 1);
const farm: Entity = { id: state.nextId++, kind: 'farm', owner: 1,
  position: { x: home.position.x + 7.5, y: home.position.y + 0.5 },
  hp: rules.buildings.farm.hp, maxHp: rules.buildings.farm.hp, radius: rules.buildings.farm.radius,
  amount: 100, resourceKind: 'food', activity: 'idle', order: { kind: 'idle' } };
state.entities.push(farm);
const { rules: ignored, ...saved } = state;
const server = await createServer({ root, configFile: `${root}vite.config.ts`,
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
  await page.evaluateOnNewDocument(snapshot => sessionStorage.setItem('open-empires-lab:dev-session', JSON.stringify(snapshot)),
    { version: SNAPSHOT_VERSION, rulesOrigin: rules.origin, state: saved });
  await page.goto('http://127.0.0.1:5213/?solo=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).__empiresDebug === 'function', { timeout: 120_000, polling: 100 });
  const query = (q: object): Promise<any> => page.evaluate(q => (window as any).__empiresDebug(q), q);
  await page.keyboard.press('F3');
  assert((await query({ type: 'snapshot' })).entities.some((e: any) => e.id === farm.id && e.kind === 'farm'), 'fixture resumed');
  await query({ type: 'look', entity: farm.id });
  await query({ type: 'select', ids: workers.map(e => e.id) });
  const drawn = (await query({ type: 'entities', id: farm.id })).entities[0];
  await page.mouse.click(drawn.screen.x, drawn.screen.y, { button: 'right' });
  const assigned = (await query({ type: 'snapshot' })).entities.filter((e: any) => e.order.kind === 'gather' && e.order.targetId === farm.id);
  assert.equal(assigned.length, 1);
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
  assert.deepEqual(errors, []);
  console.log('FARM OCCUPANCY SMOKE GREEN: group right-click assigns one farmer; only that worker gathers food');
} finally { await browser.close(); await server.close(); }
