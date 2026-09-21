/** #143: Shift-click beyond housing, wait at 100%, cancel and resume with a house. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import { createGame, placementLegal } from '../src/sim/game.ts';
import { FALLBACK_RULES, rulesFromManifest } from '../src/sim/data.ts';
import { SNAPSHOT_VERSION } from '../src/dev-session.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const path = `${root}public/imported/aoe2/manifest.json`;
const manifest = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined;
const rules = manifest ? rulesFromManifest(manifest) : FALLBACK_RULES;
const state = createGame(143, rules);
state.entities = state.entities.filter(e => e.owner !== 0);
state.terrain = state.terrain.map(() => 0);
state.players[1].food = 1000;
const home = state.entities.find(e => e.kind === 'town-center' && e.owner === 1)!;
const worker = state.entities.find(e => e.kind === 'villager' && e.owner === 1)!;
const houseAt = { x: home.position.x + 6, y: home.position.y + 4 };
assert(placementLegal(state, 'house', houseAt).ok, 'fixture has room for housing');
const opening = state.players[1].population;
const cost = rules.units.villager.cost.food;
const { rules: ignored, ...saved } = state;
const server = await createServer({ root, configFile: `${root}vite.config.ts`,
  server: { host: '127.0.0.1', port: 5218, strictPort: true }, logLevel: 'error' });
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
  await page.goto('http://127.0.0.1:5218/?solo=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).__empiresDebug === 'function', { timeout: 120_000, polling: 100 });
  const query = (q: object): Promise<any> => page.evaluate(q => (window as any).__empiresDebug(q), q);
  const click = async (selector: string) => {
    const point = await page.$eval(selector, e => {
      const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await page.mouse.click(point.x, point.y);
  };
  await page.keyboard.press('F3');
  assert.equal((await query({ type: 'snapshot' })).players[1].food, 1000, 'fixture resumed');
  await query({ type: 'look', entity: home.id });
  await query({ type: 'select', ids: [home.id] });
  await page.waitForSelector('.command-button[data-command="train-villager"]');
  await page.keyboard.down('Shift');
  await click('.command-button[data-command="train-villager"]');
  await page.keyboard.up('Shift');
  const queued = await query({ type: 'snapshot' });
  assert.equal(queued.entities.find((e: any) => e.id === home.id).trainingQueue.length, 4);
  assert.equal(queued.players[1].food, 1000 - 5 * cost);
  assert.equal(queued.players[1].population, opening);
  for (let i = 0; i < 6; i++) await page.keyboard.press('+');
  await page.keyboard.press('F3');
  await page.waitForFunction(async id => {
    const state = await (window as any).__empiresDebug({ type: 'snapshot' });
    return state.entities.find((e: any) => e.id === id)?.training?.remainingTicks === 0;
  }, { timeout: 120_000, polling: 100 }, home.id);
  await page.keyboard.press('F3');
  const blocked = await query({ type: 'snapshot' });
  assert.equal(blocked.players[1].population, blocked.players[1].populationCap);
  assert.equal(blocked.entities.find((e: any) => e.id === home.id).trainingQueue.length, 3);
  await page.waitForFunction(() => document.querySelector('.training-status')?.textContent?.includes('You need to build more houses.'));
  assert.equal(await page.$eval('.production-progress', e => (e as HTMLElement).style.width), '100%');
  assert(await page.$eval('.command-button[data-command="train-villager"]', e => !(e as HTMLButtonElement).disabled));
  // A real queue-portrait click refunds a waiting entry while the completed
  // active villager remains held at 100%.
  await click('.training-portrait[data-index="1"]');
  const cancelled = await query({ type: 'snapshot' });
  assert.equal(cancelled.players[1].food, 1000 - 4 * cost);
  assert.equal(cancelled.entities.find((e: any) => e.id === home.id).training.remainingTicks, 0);
  const built = await query({ type: 'command', command: { kind: 'build', player: 1,
    builderIds: [worker.id], building: 'house', target: houseAt } });
  assert(built.ok, 'public build command accepted');
  await page.keyboard.press('F3');
  await page.waitForFunction(async id => {
    const state = await (window as any).__empiresDebug({ type: 'snapshot' });
    return !state.entities.find((e: any) => e.id === id)?.training;
  }, { timeout: 120_000, polling: 100 }, home.id);
  const result = await query({ type: 'snapshot' });
  assert.equal(result.players[1].population, opening + 4);
  assert.equal(result.players[1].food, 1000 - 4 * cost);
  assert(result.players[1].population <= result.players[1].populationCap);
  assert.deepEqual(errors, []);
  console.log(`POPULATION QUEUE GREEN (${rules.origin}): Shift queues five beyond housing; 100% wait/message; portrait refund; house releases paid queue`);
} finally { await browser.close(); await server.close(); }
