/** #140: actual portrait clicks, mixed queues, refunds and full-queue geometry. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import { createGame } from '../src/sim/game.ts';
import { FALLBACK_RULES, rulesFromManifest } from '../src/sim/data.ts';
import { SNAPSHOT_VERSION } from '../src/dev-session.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = `${root}public/imported/aoe2/manifest.json`;
const fallback = process.env.OPEN_FALLBACK === '1';
const rules = !fallback && existsSync(manifest) ? rulesFromManifest(JSON.parse(readFileSync(manifest, 'utf8'))) : FALLBACK_RULES;
const state = createGame(140, rules);
const tc = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
tc.training = { kind: 'militia', remainingTicks: 5000 };
tc.trainingQueue = ['militia', 'militia', 'militia', 'spearman', 'spearman', 'spearman', 'militia'];
const { rules: ignored, ...saved } = state;
const server = await createServer({ root, configFile: `${root}vite.config.ts`,
  server: { host: '127.0.0.1', port: 5210, strictPort: true }, logLevel: 'error' });
await server.listen();
const libs = `${homedir()}/.cache/puppeteer/extra-libs/usr/lib/x86_64-linux-gnu`;
const browser = await puppeteer.launch({ headless: true, env: existsSync(libs) ? { ...process.env, LD_LIBRARY_PATH: libs } : process.env,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebGPU'] });
try {
  const page = await browser.newPage();
  if (fallback) {
    await page.setRequestInterception(true);
    page.on('request', request => { void (request.url().includes('/imported/') ? request.abort() : request.continue()); });
  }
  await page.setViewport({ width: 2000, height: 1125 });
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.evaluateOnNewDocument(snapshot => sessionStorage.setItem('open-empires-lab:dev-session', JSON.stringify(snapshot)),
    { version: SNAPSHOT_VERSION, rulesOrigin: rules.origin, state: saved });
  await page.goto('http://127.0.0.1:5210/?solo=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).__empiresDebug === 'function', { timeout: 120_000, polling: 100 });
  const query = (q: object): Promise<any> => page.evaluate(q => (window as any).__empiresDebug(q), q);
  await page.keyboard.press('F3');
  assert.equal((await query({ type: 'snapshot' })).entities.find((e: any) => e.id === tc.id).trainingQueue.length, 7, 'one active plus seven waiting units resumed');
  await page.keyboard.press('h');
  await page.waitForSelector('.training-portrait');
  const portraits = await page.$$eval('.training-portrait', buttons => buttons.map(b => {
    const rect = b.getBoundingClientRect();
    return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, art: (b as HTMLElement).style.backgroundImage };
  }));
  assert.equal(portraits.length, 3);
  assert.deepEqual(await page.$$eval('.training-portrait', buttons => buttons.map(b => b.querySelector('.queue-count')?.textContent ?? '1')), ['3', '3', '1']);
  assert(portraits.every(p => p.x >= 0 && p.y >= 0 && p.right <= 2000 && p.bottom <= 1125));
  if (rules.origin === 'imported') assert(portraits.every(p => p.art.includes('url(')));
  if (!fallback) {
    const near = (actual: number, expected: number) => assert(Math.abs(actual - expected) < 2, `${actual} near reference ${expected}`);
    // Coordinates read from the supplied 2000x1125 DE barracks screenshot.
    near(portraits[0].x, 482); near(portraits[0].y, 1029);
    near(portraits[0].right - portraits[0].x, 36);
    near(portraits[1].x, 518); near(portraits[2].x, 555);
    const active = await page.$eval('#training-active button', button => {
      const r = button.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width };
    });
    near(active.x, 482); near(active.y, 978); near(active.width, 36);
    assert.match(await page.$eval('.training-status', el => el.textContent ?? ''), /Creating \d+%Militia/);
  }
  for (let i = 0; i < portraits.length; i++) for (let j = i + 1; j < portraits.length; j++) {
    const a = portraits[i], b = portraits[j];
    assert(a.right <= b.x + 0.1 || b.right <= a.x + 0.1 || a.bottom <= b.y + 0.1 || b.bottom <= a.y + 0.1, 'portraits do not overlap');
  }
  const before = await query({ type: 'snapshot' });
  const producer = (s: any) => s.entities.find((e: any) => e.id === tc.id);
  await page.click('.training-portrait[data-index="1"]');
  await page.waitForFunction(() => document.querySelector('.training-portrait[data-index="1"] .queue-count')?.textContent === '2', { polling: 100 });
  const first = await query({ type: 'snapshot' });
  assert.deepEqual(producer(first).training, producer(before).training, 'first waiting batch never cancels the active unit');
  assert.equal(first.players[1].gold - before.players[1].gold, rules.units.militia.cost.gold);
  await page.click('.training-portrait[data-index="3"]');
  await page.waitForFunction(() => document.querySelector('.training-portrait[data-index="3"] .queue-count')?.textContent === '2', { polling: 100 });
  const middle = await query({ type: 'snapshot' });
  assert.deepEqual(producer(middle).training, producer(before).training);
  assert.deepEqual(producer(middle).trainingQueue, ['militia', 'militia', 'spearman', 'spearman', 'militia']);
  assert.equal(middle.players[1].food - first.players[1].food, rules.units.spearman.cost.food);
  await page.click('#training-active button');
  await page.waitForFunction(() => {
    const first = document.querySelector('.training-portrait[data-index="1"]');
    return first && !first.querySelector('.queue-count');
  }, { polling: 100 });
  const active = await query({ type: 'snapshot' });
  assert.equal(producer(active).training.kind, 'militia');
  assert.equal(producer(active).training.remainingTicks, Math.round(rules.units.militia.trainSeconds * 20));
  assert.equal(active.players[1].gold - middle.players[1].gold, rules.units.militia.cost.gold);
  // Running frame updates must keep the clickable nodes alive between down/up.
  const button = await page.$('.training-portrait[data-index="1"]');
  await page.keyboard.press('F3');
  await page.waitForFunction(tick => (window as any).__empiresDebug({ type: 'sim' }).then((s: any) => s.tick > tick + 5), { polling: 100 }, active.tick);
  assert(await button!.evaluate(el => el.isConnected));
  // The 15-entry limit is one active unit plus 14 alternating waiting entries.
  tc.trainingQueue = Array.from({ length: 14 }, (_, i) => i % 2 ? 'militia' : 'spearman');
  await page.evaluateOnNewDocument(snapshot => sessionStorage.setItem('open-empires-lab:dev-session', JSON.stringify(snapshot)),
    { version: SNAPSHOT_VERSION, rulesOrigin: rules.origin, state: saved });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).__empiresDebug === 'function', { timeout: 120_000, polling: 100 });
  await page.keyboard.press('F3'); await page.keyboard.press('h');
  await page.waitForFunction(() => document.querySelectorAll('.training-portrait').length === 14, { polling: 100 });
  assert(await page.$$eval('.training-portrait', buttons => buttons.every(b => {
    const r = b.getBoundingClientRect(); return r.x >= 0 && r.y >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
  })));
  const running = producer(await query({ type: 'snapshot' })).training;
  for (let left = 13; left >= 0; left--) {
    await page.click('.training-portrait[data-index="1"]');
    await page.waitForFunction(count => document.querySelectorAll('.training-portrait').length === count, { polling: 100 }, left);
  }
  assert.deepEqual(producer(await query({ type: 'snapshot' })).training, running);
  assert(await page.$eval('#training-queue', row => (row as HTMLElement).hidden));
  assert(await page.$eval('#training-active', active => !(active as HTMLElement).hidden));
  assert.deepEqual(errors, []);
  console.log('TRAINING QUEUE SMOKE GREEN: reference 3/3/1 grouping and geometry, middle/active refunds, stable clicks, 15-entry wrapping');
} finally {
  await browser.close();
  await server.close();
}
