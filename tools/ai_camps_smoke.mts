/** #147: the page AI skips a redundant mill and completes one at a distinct patch. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import { addNode, createGame, stepGame } from '../src/sim/game.ts';
import { FALLBACK_RULES, rulesFromManifest } from '../src/sim/data.ts';
import { SNAPSHOT_VERSION } from '../src/dev-session.ts';
import type { BuildingKind, Entity } from '../src/sim/types.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const path = `${root}public/imported/aoe2/manifest.json`;
const rules = existsSync(path) ? rulesFromManifest(JSON.parse(readFileSync(path, 'utf8'))) : FALLBACK_RULES;
const state = createGame(147, rules);
state.entities = state.entities.filter(e => e.owner !== 0);
state.terrain = state.terrain.map(() => 0);
const home = state.entities.find(e => e.owner === 2 && e.kind === 'town-center')!;
const building = (kind: BuildingKind, dx: number, dy: number) => {
  const rule = rules.buildings[kind];
  const entity: Entity = { id: state.nextId++, kind, owner: 2,
    position: { x: home.position.x - dx, y: home.position.y + dy },
    hp: rule.hp, maxHp: rule.hp, radius: rule.radius, activity: 'idle', order: { kind: 'idle' } };
  state.entities.push(entity);
  return entity;
};
building('barracks', 0, -8);
building('lumber-camp', 0, -12);
for (let i = 0; i < 3; i++) building('house', i * 3, 14);
const oldMill = building('mill', 20, 0);
const edge = addNode(state, 'berries', { x: home.position.x - 29, y: home.position.y });
const remote = addNode(state, 'berries', { x: home.position.x - 45, y: home.position.y });
// Own scouts keep both patches known to the native player-two strategy.
const scout = state.entities.find(e => e.owner === 2 && e.kind === 'scout-cavalry')!;
for (const resource of [edge, remote]) state.entities.push({ ...scout, id: state.nextId++,
  position: { ...resource.position }, order: { kind: 'move', target: { x: 110, y: 110 } } });
stepGame(state);
state.tick = 48 * 20;
state.players[2].populationCap = 20;
state.players[2].wood = 1000;
state.players[2].food = 0;
const start = state.tick;
const { rules: ignored, ...saved } = state;
const server = await createServer({ root, configFile: `${root}vite.config.ts`,
  server: { host: '127.0.0.1', port: 5220, strictPort: true }, logLevel: 'error' });
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
  await page.goto('http://127.0.0.1:5220/?solo=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).__empiresDebug === 'function', { timeout: 120_000, polling: 100 });
  const query = (q: object): Promise<any> => page.evaluate(q => (window as any).__empiresDebug(q), q);
  assert((await query({ type: 'snapshot' })).entities.some((e: any) => e.id === oldMill.id && e.kind === 'mill'), 'fixture resumed');
  for (let i = 0; i < 6; i++) await page.keyboard.press('+');
  await page.waitForFunction(async start => {
    const state = await (window as any).__empiresDebug({ type: 'snapshot' });
    return state.tick >= start + 90 * 20 && state.entities.some((e: any) => e.owner === 2
      && e.kind === 'mill' && e.position.x < 55 && e.buildProgress === undefined);
  }, { timeout: 120_000, polling: 100 }, start);
  const result = await query({ type: 'snapshot' });
  const mills = result.entities.filter((e: any) => e.owner === 2 && e.kind === 'mill' && !e.dead);
  assert.equal(mills.length, 2);
  const added = mills.find((e: any) => e.id !== oldMill.id)!;
  assert(Math.hypot(added.position.x - remote.position.x, added.position.y - remote.position.y) < 5);
  assert(Math.hypot(added.position.x - oldMill.position.x, added.position.y - oldMill.position.y) > 8);
  assert(result.players[2].wood >= 100, 'duplicate prevention was not just running out of wood');
  await page.keyboard.press('F4');
  await query({ type: 'look', entity: added.id });
  await page.waitForFunction(async id => {
    const reply = await (window as any).__empiresDebug({ type: 'entities', id });
    return reply.entities[0]?.rendered;
  }, { timeout: 30_000, polling: 100 }, added.id);
  assert((await query({ type: 'entities', id: added.id })).entities[0].rendered, 'useful new mill rendered');
  assert.deepEqual(errors, []);
  console.log(`AI CAMPS GREEN (${rules.origin}): no adjacent duplicate across placement cycle; separate berry patch gets a completed mill; wood remains available`);
} finally { await browser.close(); await server.close(); }
