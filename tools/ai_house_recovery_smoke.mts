/** #146: the page's own AI replaces a lost builder and finishes the paid house. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import { applyCommand, createGame, stepGame } from '../src/sim/game.ts';
import { FALLBACK_RULES, rulesFromManifest } from '../src/sim/data.ts';
import { SNAPSHOT_VERSION } from '../src/dev-session.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifestPath = `${root}public/imported/aoe2/manifest.json`;
const rules = existsSync(manifestPath) ? rulesFromManifest(JSON.parse(readFileSync(manifestPath, 'utf8'))) : FALLBACK_RULES;
const state = createGame(146, rules);
state.entities = state.entities.filter(e => e.owner !== 0);
state.terrain = state.terrain.map(() => 0);
const home = state.entities.find(e => e.owner === 2 && e.kind === 'town-center')!;
const builder = state.entities.find(e => e.owner === 2 && e.kind === 'villager')!;
assert(applyCommand(state, { kind: 'build', player: 2, builderIds: [builder.id], building: 'house',
  target: { x: home.position.x + 6, y: home.position.y + 4 } }).ok);
const house = state.entities.find(e => e.kind === 'house')!;
for (let i = 0; i < 1000 && house.buildProgress! < 0.1; i++) stepGame(state);
assert(house.buildProgress! >= 0.1 && house.buildProgress! < 0.5);
state.players[2].wood = 0;
state.players[2].food = 0;
const { rules: ignored, ...saved } = state;
const server = await createServer({ root, configFile: `${root}vite.config.ts`,
  server: { host: '127.0.0.1', port: 5219, strictPort: true }, logLevel: 'error' });
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
  await page.goto('http://127.0.0.1:5219/?solo=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).__empiresDebug === 'function', { timeout: 120_000, polling: 100 });
  const query = (q: object): Promise<any> => page.evaluate(q => (window as any).__empiresDebug(q), q);
  await page.keyboard.press('F3');
  const initial = await query({ type: 'snapshot' });
  assert(initial.entities.find((e: any) => e.id === house.id)?.buildProgress !== undefined, 'unfinished fixture resumed');
  await page.keyboard.press('F4');
  await query({ type: 'look', entity: house.id });
  assert((await query({ type: 'command', command: { kind: 'delete', player: 2, entityIds: [builder.id] } })).ok);
  for (let i = 0; i < 4; i++) await page.keyboard.press('+');
  await page.keyboard.press('F3');
  await page.waitForFunction(async ({ houseId, lostId }) => {
    const state = await (window as any).__empiresDebug({ type: 'snapshot' });
    return state.entities.some((e: any) => e.id !== lostId && !e.dead && e.owner === 2
      && e.order.kind === 'build' && e.order.targetId === houseId);
  }, { timeout: 30_000, polling: 100 }, { houseId: house.id, lostId: builder.id });
  await page.waitForFunction(async id => {
    const state = await (window as any).__empiresDebug({ type: 'snapshot' });
    return state.entities.find((e: any) => e.id === id)?.buildProgress === undefined;
  }, { timeout: 60_000, polling: 100 }, house.id);
  const result = await query({ type: 'snapshot' });
  assert.equal(result.players[2].wood, 0);
  assert.equal(result.players[2].populationCap, 10);
  assert.equal(result.entities.filter((e: any) => e.owner === 2 && e.kind === 'house').length, 1);
  const drawn = (await query({ type: 'entities', id: house.id })).entities[0];
  assert(drawn.rendered, 'completed house rendered');
  assert.deepEqual(errors, []);
  console.log(`AI HOUSE RECOVERY GREEN (${rules.origin}): builder deleted → AI assigns replacement → same paid house completes with zero wood; cap 10`);
} finally { await browser.close(); await server.close(); }
