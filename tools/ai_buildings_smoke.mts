/** #86: a resource-constrained AI saves, builds and displays its blacksmith. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import { addNode, applyCommand, createGame, stepGame } from '../src/sim/game.ts';
import { FALLBACK_RULES, rulesFromManifest } from '../src/sim/data.ts';
import { SNAPSHOT_VERSION } from '../src/dev-session.ts';
import type { BuildingKind, Entity } from '../src/sim/types.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = `${root}public/imported/aoe2/manifest.json`;
const rules = existsSync(manifest) ? rulesFromManifest(JSON.parse(readFileSync(manifest, 'utf8'))) : FALLBACK_RULES;
const state = createGame(86, rules);
state.entities = state.entities.filter(e => e.kind === 'town-center' || (e.owner === 2 && e.kind === 'villager'));
state.terrain.fill(0);
const home = state.entities.find(e => e.owner === 2 && e.kind === 'town-center')!;
const add = (kind: BuildingKind, x: number, y: number) => {
  const r = rules.buildings[kind];
  const e: Entity = { id: state.nextId++, kind, owner: 2, position: { x: home.position.x + x, y: home.position.y + y },
    hp: r.hp, maxHp: r.hp, radius: r.radius, activity: 'idle', order: { kind: 'idle' } };
  if (kind === 'farm') { e.resourceKind = 'food'; e.amount = 175; }
  state.entities.push(e); return e;
};
add('barracks', 12, 12); add('archery-range', 12, 18);
const camp = add('lumber-camp', 16, 12);
add('mill', 20, 12); add('mining-camp', 24, 12);
add('house', -12, 12); add('house', -16, 12); add('farm', -6, -6);
const tree = addNode(state, 'tree', { x: camp.position.x + 3, y: camp.position.y });
const woodWorker = state.entities.filter(e => e.owner === 2 && e.kind === 'villager')[1];
woodWorker.position = { x: tree.position.x - 0.8, y: tree.position.y };
applyCommand(state, { kind: 'order', player: 2, entityIds: [woodWorker.id], target: tree.position, targetId: tree.id });
Object.assign(state.players[2], { age: 1, researched: ['feudal-age', 'loom'], wood: 125, food: 0, gold: 100, populationCap: 15 });
stepGame(state);
const { rules: ignored, ...saved } = state;
const server = await createServer({ root, configFile: `${root}vite.config.ts`,
  server: { host: '127.0.0.1', port: 5226, strictPort: true }, logLevel: 'error' });
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
  await page.goto('http://127.0.0.1:5226/?solo=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).__empiresDebug === 'function', { timeout: 120_000, polling: 100 });
  const query = (q: object): Promise<any> => page.evaluate(q => (window as any).__empiresDebug(q), q);
  const initial = await query({ type: 'snapshot' });
  assert(initial.entities.some((e: any) => e.id === camp.id && e.kind === 'lumber-camp'), 'fixture resumed');
  assert(!initial.entities.some((e: any) => e.kind === 'blacksmith'), 'AI must build it');
  await page.keyboard.press('F4');
  for (let i = 0; i < 6; i++) await page.keyboard.press('+');
  await page.waitForFunction(async () => (await (window as any).__empiresDebug({ type: 'snapshot' })).entities
    .some((e: any) => e.owner === 2 && e.kind === 'blacksmith' && e.buildProgress === undefined),
    { timeout: 120_000, polling: 200 });
  await page.keyboard.press('F3');
  const finished = await query({ type: 'snapshot' });
  const smith = finished.entities.find((e: any) => e.owner === 2 && e.kind === 'blacksmith');
  await query({ type: 'look', entity: smith.id });
  const drawn = (await query({ type: 'entities', id: smith.id })).entities[0];
  assert(drawn.rendered, 'completed AI blacksmith is rendered');
  await page.mouse.click(drawn.screen.x, drawn.screen.y);
  assert((await query({ type: 'sim' })).selected.includes(smith.id));
  assert.deepEqual(errors, []);
  console.log(`AI BUILDINGS SMOKE GREEN: 125 starting wood, blacksmith finished by tick ${finished.tick}, rendered and selected`);
} finally { await browser.close(); await server.close(); }
