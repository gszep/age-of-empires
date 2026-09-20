/** Two real browsers, a private host and local-asset gateway; no shared debug broadcast. */
import { createServer } from 'vite';
import puppeteer, { type Page } from 'puppeteer';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { sharedMatchPlugin } from '../src/shared/server.ts';
import assert from 'node:assert/strict';
import { createGame, stepGame } from '../src/sim/game.ts';
import { rulesFromManifest, FALLBACK_RULES } from '../src/sim/data.ts';
import { SNAPSHOT_VERSION } from '../src/dev-session.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const checkpoint = `${root}.local/shared-smoke-${process.pid}.json`;
console.log('Starting private shared host');
const startServer = () => createServer({ root, configFile: `${root}vite.config.ts`, plugins: [sharedMatchPlugin(root, checkpoint)], server: { port: 5201, strictPort: true }, logLevel: 'error' });
let server = await startServer();
await server.listen();
console.log('Private shared host listening');
const manifestPath = `${root}public/imported/aoe2/manifest.json`;
const rules = existsSync(manifestPath) ? rulesFromManifest(JSON.parse(readFileSync(manifestPath, 'utf8'))) : FALLBACK_RULES;
const resumed = createGame(7, rules, undefined, 'islands');
for (let i = 0; i < 150; i++) stepGame(resumed);
const gateway = spawn(process.execPath, [`${root}tools/shared-join.mjs`], {
  env: { ...process.env, PORT: '5202', MATCH_HOST: 'http://127.0.0.1:5201', MATCH_ASSETS: `${root}public` }, stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise<void>(resolve => gateway.stdout!.once('data', () => resolve()));
console.log('Private gateway listening');
const libs = `${homedir()}/.cache/puppeteer/extra-libs/usr/lib/x86_64-linux-gnu`;
const browser = await puppeteer.launch({ headless: true, env: existsSync(libs) ? { ...process.env, LD_LIBRARY_PATH: libs } : process.env,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebGPU'] });
const debug = (page: Page, query: object): Promise<any> => page.evaluate(q => (globalThis as any).__empiresDebug(q), query);
const ready = (page: Page) => page.waitForFunction(() => typeof (globalThis as any).__empiresDebug === 'function', { timeout: 120_000, polling: 100 });
const wait = (page: Page, predicate: string) => page.waitForFunction(async p => {
  if (typeof (globalThis as any).__empiresDebug !== 'function') return false;
  const state = await (globalThis as any).__empiresDebug({ type: 'sim' });
  return new Function('s', `return ${p}`)(state);
}, { timeout: 30_000, polling: 100 }, predicate);
const errors: string[] = [];
let localImages = 0;
console.log('Browser launched');
try {
  const a = await browser.newPage();
  const b = await browser.newPage();
  const { rules: _rules, ...savedState } = resumed;
  await a.evaluateOnNewDocument(snapshot => {
    sessionStorage.setItem('open-empires-lab:dev-session', JSON.stringify(snapshot));
  }, { version: SNAPSHOT_VERSION, rulesOrigin: rules.origin, state: savedState });
  for (const page of [a, b]) {
    await page.setViewport({ width: 1280, height: 800 });
    page.on('pageerror', error => { errors.push(String(error)); console.error('PAGE ERROR', error); });
    page.on('console', message => { if (message.type() === 'error' || message.text().includes('[dev]')) console.log('PAGE', message.text()); });
    page.on('response', response => {
      if (!response.url().includes('/imported/')) return;
      if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
      if (page === b && response.url().endsWith('.png') && response.headers()['x-empires-assets'] === 'local') localImages++;
    });
  }
  await a.bringToFront();
  await a.goto('http://127.0.0.1:5201', { waitUntil: 'domcontentloaded' });
  console.log('Host page loaded');
  await ready(a);
  await a.keyboard.press('F3');
  await wait(a, 's.connection.paused');
  await b.bringToFront();
  await b.goto('http://127.0.0.1:5202', { waitUntil: 'domcontentloaded' });
  await ready(b);
  let sa = await debug(a, { type: 'sim' });
  let sb = await debug(b, { type: 'sim' });
  assert.equal(sa.synchronizationHash, sb.synchronizationHash, 'guest joins current state');
  assert(sa.tick >= 150, 'guest joined the evolved match, not an initial board');
  assert.equal((await debug(b, { type: 'snapshot' })).matchSeed, resumed.matchSeed, 'guest kept the adopted Islands seed');
  assert.equal(sb.connection.player, 2);
  console.log(`Both joined at tick ${sa.tick}, checksum ${sa.synchronizationHash}; guest is player 2`);
  const asset = await b.evaluate(async () => {
    const response = await fetch('/imported/aoe2/manifest.json');
    return { status: response.status, source: response.headers.get('x-empires-assets') };
  });
  assert.equal(asset.source, 'local');
  assert.equal(asset.status, 200);
  console.log('Guest artwork served locally');
  // An adopted match may already have an AI villager in training. Cancel that
  // through the public command before measuring the two human clicks (#143).
  const guestTc = (await debug(b, { type: 'entities', owner: 2 })).entities.find((e: any) => e.kind === 'town-center');
  if (guestTc.queued) {
    assert.equal(guestTc.queued, 1, 'fixture has only the AI opening villager queued');
    await debug(b, { type: 'command', command: { kind: 'cancel-train', player: 2, buildingId: guestTc.id } });
    await a.bringToFront();
    await a.keyboard.press('F3');
    await wait(a, `s.players['2'].food === ${sb.players['2'].food + 50}`);
    await a.keyboard.press('F3');
    await wait(a, 's.connection.paused');
    await wait(b, 's.connection.paused');
    sa = await debug(a, { type: 'sim' });
    sb = await debug(b, { type: 'sim' });
  }
  for (const [page, player] of [[a, 1], [b, 2]] as const) {
    await page.bringToFront();
    const entities = await debug(page, { type: 'entities', owner: player });
    const tc = entities.entities.find((e: any) => e.kind === 'town-center');
    assert(tc.screen.x > 0 && tc.screen.x < 1280, `player ${player} camera opens at own town`);
    await page.mouse.click(tc.screen.x, tc.screen.y);
    await page.waitForSelector('.command-button[data-command="train-villager"]:not([disabled])');
    await page.click('.command-button[data-command="train-villager"]');
  }
  const food = [sa.players['1'].food, sa.players['2'].food];
  await a.bringToFront();
  await a.keyboard.press('F3');
  try {
    await wait(a, `s.players['1'].food === ${food[0] - 50} && s.players['2'].food === ${food[1] - 50}`);
  } catch (error) {
    console.error('Train outcome', { before: food, a: await debug(a, { type: 'sim' }), b: await debug(b, { type: 'sim' }) });
    console.error('Guest feedback', await b.$eval('#game-message', element => element.textContent));
    throw error;
  }
  await a.keyboard.press('F3');
  await wait(a, 's.connection.paused');
  await wait(b, 's.connection.paused');
  sa = await debug(a, { type: 'sim' });
  sb = await debug(b, { type: 'sim' });
  assert.equal(sa.synchronizationHash, sb.synchronizationHash, 'both player clicks reproduce exactly');
  console.log(`Both real train clicks accepted; equal state at tick ${sa.tick}`);
  assert.equal(sb.connection.synchronization.resyncs, 0);
  await debug(b, { type: 'resync' });
  await wait(b, `s.connection.synchronization.snapshots > ${sb.connection.synchronization.snapshots}`);
  const recovered = await debug(b, { type: 'sim' });
  assert.deepEqual(recovered.selected, sb.selected, 'same-map recovery preserves selection');
  assert.equal(recovered.connection.presentationRebuilds, sb.connection.presentationRebuilds, 'same-map recovery does not rebuild the scene');
  console.log('Forced same-map recovery preserved selection and scene');
  await b.bringToFront();
  await b.reload({ waitUntil: 'domcontentloaded' });
  await ready(b);
  sb = await debug(b, { type: 'sim' });
  assert.equal(sa.synchronizationHash, sb.synchronizationHash, 'reload rejoins existing match');
  console.log('Guest reload rejoined exact paused state');
  await a.bringToFront();
  for (let speed = 2; speed <= 5; speed++) {
    await a.keyboard.press('+');
    await wait(a, `s.connection.speed === ${speed}`);
  }
  const targetTick = sa.tick + 1500;
  await a.keyboard.press('F3');
  await wait(a, `s.tick >= ${targetTick}`);
  await a.keyboard.press('F3');
  await wait(a, 's.connection.paused');
  await wait(b, 's.connection.paused');
  sa = await debug(a, { type: 'sim' });
  sb = await debug(b, { type: 'sim' });
  assert.equal(sa.synchronizationHash, sb.synchronizationHash);
  assert.equal(sa.connection.synchronization.resyncs, 0);
  assert.equal(sb.connection.synchronization.resyncs, 0);
  assert(sb.connection.synchronization.checks >= 15);
  console.log(`1500+ fast-forward ticks: zero unintended resyncs; ${JSON.stringify(sb.connection.synchronization)}`);
  await b.bringToFront();
  const state = await debug(b, { type: 'snapshot' });
  const tree = state.entities.find((e: any) => e.resourceKind === 'wood' && e.node === 'tree');
  assert(tree, 'fixture contains a tree');
  await b.keyboard.press('F4');
  await debug(b, { type: 'look', entity: tree.id });
  await b.waitForFunction(async id => {
    const result = await (globalThis as any).__empiresDebug({ type: 'entities', id });
    return result.entities[0]?.bodyVisible;
  }, { timeout: 30_000, polling: 100 }, tree.id);
  assert(localImages > 0, 'actual PNG sheets came from the guest disk');
  console.log(`Tree body visible; ${localImages} guest PNG responses served locally`);
  await server.close();
  await wait(b, '!s.connection.connected');
  // Vite itself reloads the page when its dev connection returns.
  const reloaded = b.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30_000 });
  server = await startServer();
  await server.listen();
  await reloaded;
  await ready(b);
  await wait(b, 's.connection.connected');
  sb = await debug(b, { type: 'sim' });
  assert.equal(sa.synchronizationHash, sb.synchronizationHash, 'host restart preserved its disk checkpoint');
  console.log('Host restart restored the checkpoint and guest automatically reconnected');
  assert.deepEqual(errors, []);
  console.log('SHARED SMOKE GREEN');
} finally {
  await browser.close();
  gateway.kill('SIGTERM');
  await server.close();
  rmSync(checkpoint, { force: true });
}
