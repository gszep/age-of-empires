/** #293: real research buttons, FIFO portraits, indexed refunds and completion.
 * AOE2_PUBLIC_DIR may point at an existing owned public tree, read-only. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import { createGame } from '../src/sim/game.ts';
import { FALLBACK_RULES, rulesFromManifest } from '../src/sim/data.ts';
import { researchCostFor } from '../src/sim/technologies.ts';
import { SNAPSHOT_VERSION } from '../src/dev-session.ts';
import { DEFAULT_PREFERENCES, PREFERENCES_KEY } from '../src/view/preferences.ts';
import { updateVisibility } from '../src/sim/visibility.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const publicDir = process.env.AOE2_PUBLIC_DIR ?? `${root}public`;
const manifestPath = `${publicDir}/imported/aoe2/manifest.json`;
const rules = existsSync(manifestPath) ? rulesFromManifest(JSON.parse(readFileSync(manifestPath, 'utf8'))) : FALLBACK_RULES;
const second = rules.origin === 'imported' ? 'town-watch' : 'feudal-age';
const age = rules.origin === 'imported' ? 1 : 0;
const output = `${root}.local/research293/${rules.origin}`;
mkdirSync(output, { recursive: true });
const state = createGame(293, rules);
state.entities = state.entities.filter(e => e.kind === 'town-center' || e.kind === 'villager');
Object.assign(state.players[1], { age, food: 2000, wood: 2000, gold: 2000, stone: 2000 });
if (age) state.players[1].researched.push('feudal-age');
const tc = state.entities.find(e => e.kind === 'town-center' && e.owner === 1)!;
updateVisibility(state);
const { rules: ignored, ...saved } = state;
const server = await createServer({ root, configFile: `${root}vite.config.ts`, publicDir, plugins: [{
  name: 'research-queue-fixture', enforce: 'pre', transform(code, id) {
    if (!id.endsWith('/src/main.ts')) return;
    assert(code.includes('let paused = false;'));
    return code.replace('let paused = false;', 'let paused = true;');
  },
}], server: { host: '127.0.0.1', port: 5293, strictPort: true }, logLevel: 'error' });
await server.listen();
const libs = `${homedir()}/.cache/puppeteer/extra-libs/usr/lib/x86_64-linux-gnu`;
let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
try {
  browser = await puppeteer.launch({ headless: true,
    env: existsSync(libs) ? { ...process.env, LD_LIBRARY_PATH: libs } : process.env,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebGPU'] });
  const page = await browser.newPage(), errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.setViewport({ width: 1280, height: 800 });
  await page.evaluateOnNewDocument('globalThis.__name = f => f');
  await page.evaluateOnNewDocument(({ snapshot, preferences, key }) => {
    sessionStorage.setItem('open-empires-lab:dev-session', JSON.stringify(snapshot));
    localStorage.setItem(key, JSON.stringify(preferences));
  }, { snapshot: { version: SNAPSHOT_VERSION, rulesOrigin: rules.origin, state: saved },
    preferences: { ...DEFAULT_PREFERENCES, speed: 5, music: 0, sound: 0 }, key: PREFERENCES_KEY });
  await page.goto('http://127.0.0.1:5293/?solo=1', { waitUntil: 'networkidle0', timeout: 120_000 });
  const query = (q: object): Promise<any> => page.evaluate(q => (window as any).__empiresDebug(q), q);
  const snapshot = async () => page.evaluate(async id => {
    const s = await (window as any).__empiresDebug({ type: 'snapshot' });
    const p = s.players[1];
    return { tick: s.tick, age: p.age, researched: p.researched, tc: s.entities.find((e: any) => e.id === id),
      purse: { food: p.food, wood: p.wood, gold: p.gold, stone: p.stone } };
  }, tc.id);
  assert.equal((await snapshot()).age, age, 'fixture age resumed');
  assert.equal((await snapshot()).purse.food, 2000, 'fixture resumed, not ordinary opening');
  await query({ type: 'look', entity: tc.id }); await query({ type: 'select', ids: [tc.id] });
  const receipt: Record<string, unknown> = { origin: rules.origin, seed: 293, port: 5293 };
  const initial = await snapshot();
  const clickResearch = async (tech: string) => {
    const selector = `[data-command="research-${tech}"]:not(:disabled)`;
    await page.locator(selector).click();
  };
  const active = '#training-active .production-portrait[data-kind="research"][data-index="0"]';
  const waiting = '#training-queue .research-portrait[data-index="1"]';
  await clickResearch('loom');
  const afterLoom = await snapshot();
  await clickResearch(second);
  await page.waitForSelector(waiting, { visible: true });
  const both = await snapshot();
  assert.equal(both.tc.researching.tech, 'loom'); assert.deepEqual(both.tc.researchQueue, [second]);
  for (const key of ['food', 'wood', 'gold', 'stone'] as const) {
    assert.equal(both.purse[key], initial.purse[key] - researchCostFor(state, 1, 'loom')[key] - researchCostFor(state, 1, second)[key]);
  }
  assert.equal(await page.$('[data-command="research-loom"]'), null, 'active duplicate excluded');
  assert.equal(await page.$(`[data-command="research-${second}"]`), null, 'waiting duplicate excluded');
  receipt.portraits = await page.$$eval(`${active}, ${waiting}`, buttons => buttons.map(b => ({
    title: b.getAttribute('title'), index: (b as HTMLElement).dataset.index, image: getComputedStyle(b).backgroundImage,
  })));
  if (rules.origin === 'imported') for (const b of receipt.portraits as { image: string }[]) assert.match(b.image, /url\(/);
  await page.screenshot({ path: `${output}/queued.png` });
  await page.locator(waiting).click();
  assert.deepEqual((await snapshot()).purse, afterLoom.purse, 'waiting cancellation refunds exactly');
  assert.equal((await snapshot()).tc.researching.tech, 'loom');
  await clickResearch(second);
  await page.locator(active).click();
  const promoted = await snapshot();
  assert.equal(promoted.tc.researching.tech, second); assert.equal(promoted.tc.researchQueue, undefined);
  for (const key of ['food', 'wood', 'gold', 'stone'] as const) assert.equal(promoted.purse[key], initial.purse[key] - researchCostFor(state, 1, second)[key]);
  await page.waitForFunction(({ selector, name }) => document.querySelector(selector)?.getAttribute('title')?.startsWith(name), {}, { selector: active, name: rules.technologies[second].name });
  await page.screenshot({ path: `${output}/active-cancelled.png` });
  await page.locator(active).click();
  assert.deepEqual((await snapshot()).purse, initial.purse, 'both cancel paths fully refund');
  await clickResearch('loom'); await clickResearch(second);
  await page.keyboard.press('F3');
  const waitForResearch = (tech: string) => page.waitForFunction(async tech => {
    const s = await (window as any).__empiresDebug({ type: 'snapshot' });
    return s.players[1].researched.includes(tech);
  }, { timeout: 60_000, polling: 50 }, tech);
  await waitForResearch('loom'); await page.keyboard.press('F3');
  const firstCompleted = await snapshot();
  assert(!firstCompleted.researched.includes(second), 'second cannot complete concurrently');
  assert.equal(firstCompleted.tc.researching.tech, second);
  assert(firstCompleted.tc.researching.remainingTicks > 0);
  await page.screenshot({ path: `${output}/first-completed.png` });
  await page.keyboard.press('F3'); await waitForResearch(second); await page.keyboard.press('F3');
  const finished = await snapshot();
  assert.equal(finished.tc.researching, undefined); assert.equal(finished.tc.researchQueue, undefined);
  assert.deepEqual(finished.purse, both.purse, 'completion does not charge again');
  await page.screenshot({ path: `${output}/completed.png` });
  assert.deepEqual(errors, []);
  Object.assign(receipt, { initial, both, promoted, firstCompleted, finished, errors, outcome: 'PASS' });
  writeFileSync(`${output}/receipt.json`, JSON.stringify(receipt, null, 2));
  console.log(`PASS: research queue buttons, portraits, refunds and FIFO completion (${rules.origin}); ${output}`);
} finally { await browser?.close(); await server.close(); }
