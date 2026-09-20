/** #127: train and upgrade through real buttons, then right-click an enemy. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import { createGame } from '../src/sim/game.ts';
import { rulesFromManifest } from '../src/sim/data.ts';
import { SNAPSHOT_VERSION } from '../src/dev-session.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const rules = rulesFromManifest(JSON.parse(readFileSync(`${root}public/imported/aoe2/manifest.json`, 'utf8')));
const state = createGame(127, rules);
state.entities = state.entities.filter(e => e.owner !== 0);
state.terrain.fill(0);
state.players[1].age = 3;
state.players[1].food = state.players[1].wood = state.players[1].gold = 10_000;
const home = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
const workshop = { ...home, id: state.nextId++, kind: 'siege-workshop' as const,
  position: { x: home.position.x + 7, y: home.position.y }, hp: rules.buildings['siege-workshop'].hp,
  maxHp: rules.buildings['siege-workshop'].hp, radius: rules.buildings['siege-workshop'].radius };
state.entities.push(workshop);
const target = { ...state.entities.find(e => e.kind === 'villager')!, id: state.nextId++, owner: 2 as const,
  position: { x: workshop.position.x + 16, y: workshop.position.y } };
state.entities.push(target);
const { rules: ignored, ...saved } = state;
const server = await createServer({ root, configFile: `${root}vite.config.ts`,
  server: { host: '127.0.0.1', port: 5211, strictPort: true }, logLevel: 'error' });
await server.listen();
const libs = `${homedir()}/.cache/puppeteer/extra-libs/usr/lib/x86_64-linux-gnu`;
const browser = await puppeteer.launch({ headless: true, env: existsSync(libs) ? { ...process.env, LD_LIBRARY_PATH: libs } : process.env,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebGPU'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.evaluateOnNewDocument(snapshot => sessionStorage.setItem('open-empires-lab:dev-session', JSON.stringify(snapshot)),
    { version: SNAPSHOT_VERSION, rulesOrigin: rules.origin, state: saved });
  await page.goto('http://127.0.0.1:5211/?solo=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).__empiresDebug === 'function', { timeout: 120_000, polling: 100 });
  const query = (q: object): Promise<any> => page.evaluate(q => (window as any).__empiresDebug(q), q);
  const until = (expression: string) => page.waitForFunction(async text => {
    const s = await (window as any).__empiresDebug({ type: 'snapshot' });
    return new Function('s', `return ${text}`)(s);
  }, { timeout: 90_000, polling: 100 }, expression);
  assert.equal((await query({ type: 'snapshot' })).players[1].age, 3, 'fixture resumed');
  await page.keyboard.press('F3');
  await query({ type: 'look', entity: workshop.id });
  const building = (await query({ type: 'entities', id: workshop.id })).entities[0];
  await page.mouse.click(building.screen.x, building.screen.y);
  await page.waitForSelector('[data-command="train-scorpion"]');
  assert.equal(await page.$('[data-command="train-heavy-scorpion"]'), null);
  await page.click('[data-command="train-scorpion"]');
  await until(`s.entities.find(e => e.id === ${workshop.id}).training?.kind === 'scorpion'`);
  await page.waitForSelector('#training-active button');
  for (let i = 0; i < 6; i++) await page.keyboard.press('+');
  await page.keyboard.press('F3');
  await until("s.entities.some(e => e.kind === 'scorpion' && e.owner === 1)");
  await page.keyboard.press('F3');
  const trained = (await query({ type: 'snapshot' })).entities.find((e: any) => e.kind === 'scorpion' && e.owner === 1);
  assert(trained);
  await page.click('[data-command="research-heavy-scorpion"]');
  await until(`s.entities.find(e => e.id === ${workshop.id}).researching?.tech === 'heavy-scorpion'`);
  await page.keyboard.press('F3');
  await until(`s.entities.find(e => e.id === ${trained.id}).kind === 'heavy-scorpion'`);
  await page.keyboard.press('F3');
  await page.waitForSelector('[data-command="train-heavy-scorpion"]');
  assert.equal(await page.$('[data-command="train-scorpion"]'), null);
  await query({ type: 'look', entity: trained.id });
  const heavy = (await query({ type: 'entities', id: trained.id })).entities[0];
  assert(heavy.rendered);
  await page.mouse.click(heavy.screen.x, heavy.screen.y);
  assert((await query({ type: 'sim' })).selected.includes(trained.id));
  await page.waitForSelector('.stat[title="Attack"] .stat-value');
  assert.equal(await page.$eval('.stat[title="Attack"] .stat-value', el => el.textContent), '14');
  await page.keyboard.press('F4');
  await query({ type: 'look', entity: target.id });
  const enemy = (await query({ type: 'entities', id: target.id })).entities[0];
  await page.mouse.click(enemy.screen.x, enemy.screen.y, { button: 'right' });
  await page.keyboard.press('F3');
  await until(`s.entities.find(e => e.id === ${target.id}).hp < ${target.hp}`);
  assert(await page.evaluate(() => performance.getEntriesByType('resource').some(e => e.name.includes('/heavy-scorpion/'))));
  assert.deepEqual(errors, []);
  console.log('SCORPION SMOKE GREEN: training portrait, real train/upgrade buttons, replacement art and right-click combat');
} finally {
  await browser.close();
  await server.close();
}
