/** Photograph a dock with two fishing ships and the fish, on Islands. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer';
import { rulesFromManifest, type ContentManifest } from '../../src/sim/data';
import { applyCommand, createGame, placementLegal, stepGame } from '../../src/sim/game';
import { SNAPSHOT_VERSION } from '../../src/dev-session';

const ROOT = join(import.meta.dirname, '../..');
const OUT = process.env.OUT ?? join(ROOT, '.local/probes');
const PORT = 5308;
const BASE = `http://127.0.0.1:${PORT}`;
const rules = rulesFromManifest(JSON.parse(readFileSync(join(ROOT, 'public/imported/aoe2/manifest.json'), 'utf8')) as ContentManifest);
const state = createGame(2, rules, undefined, 'islands');
const home = state.entities.find(e => e.kind === 'town-center' && e.owner === 1)!;
let spot: { x: number; y: number } | undefined, best = Infinity;
for (let y = 2.5; y < state.height - 2; y++) for (let x = 2.5; x < state.width - 2; x++) {
  const d = Math.hypot(x - home.position.x, y - home.position.y);
  if (d < best && placementLegal(state, 'dock', { x, y }).ok) { spot = { x, y }; best = d; }
}
state.players[1].wood = 2000;
const villager = state.entities.find(e => e.kind === 'villager' && e.owner === 1)!;
console.log(applyCommand(state, { kind: 'build', player: 1, builderIds: [villager.id], building: 'dock', target: spot! }));
const dock = state.entities.find(e => e.kind === 'dock')!;
dock.buildProgress = undefined; dock.hp = dock.maxHp;
villager.order = { kind: 'idle' }; villager.activity = 'idle';
for (const _ of [1, 2]) applyCommand(state, { kind: 'train', player: 1, buildingId: dock.id, unit: 'fishing-ship' });
for (let i = 0; i < 1700; i++) stepGame(state);
const ships = state.entities.filter(e => e.kind === 'fishing-ship');
console.log('ships', ships.length, ships.map(s => s.position));
// Send the first ship to the nearest fish and let it get there.
// A fish on the near side of the dock (greater x + y), so the y-sort shows the boat.
const fish = state.entities.filter(e => (e.node === 'fish' || e.node === 'shore-fish') && e.position.x + e.position.y > dock.position.x + dock.position.y + 2)
  .sort((a, b) => Math.hypot(a.position.x - dock.position.x, a.position.y - dock.position.y) - Math.hypot(b.position.x - dock.position.x, b.position.y - dock.position.y));
console.log(applyCommand(state, { kind: 'order', player: 1, entityIds: [ships[0].id], target: fish[0].position, targetId: fish[0].id }));
for (let i = 0; i < 400; i++) stepGame(state);
console.log('ship 0', ships[0].activity, ships[0].position, 'fish', fish[0].node, fish[0].position);
const { rules: _drop, ...rest } = state;
const snapshot = JSON.stringify({ version: SNAPSHOT_VERSION, rulesOrigin: rules.origin, state: rest });

const extraLibs = join(homedir(), '.cache/puppeteer/extra-libs/usr/lib/x86_64-linux-gnu');
const launchEnv = existsSync(extraLibs) ? { ...process.env, LD_LIBRARY_PATH: [extraLibs, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') } : process.env;
const { createServer } = await import('vite');
const server = await createServer({ root: ROOT, configFile: join(ROOT, 'vite.config.ts'), server: { host: '127.0.0.1', port: PORT, strictPort: true } });
await server.listen();
const browser = await puppeteer.launch({ headless: true, env: launchEnv, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebGPU'] });
const query = async (payload: unknown) => { const r = await fetch(`${BASE}/__debug`, { method: 'POST', body: JSON.stringify(payload) }); const b = await r.json(); if (!r.ok) throw new Error(JSON.stringify(b)); return b as any; };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  page.on('pageerror', error => console.log('page error:', error.message));
  page.on('console', msg => { if (msg.type() === 'error') console.log('console error:', msg.text().slice(0, 200)); });
  await page.evaluateOnNewDocument((raw: string) => sessionStorage.setItem('open-empires-lab:dev-session', raw), snapshot);
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle2', timeout: 120_000 });
  await page.waitForFunction(() => document.querySelector('canvas.battlefield') !== null, { timeout: 120_000 });
  await sleep(5000);
  const docks = (await query({ type: 'entities', kind: 'dock' })).entities;
  if (!docks.length) throw new Error('the page declined the snapshot');
  await page.keyboard.press('F4');
  await query({ type: 'look', entity: dock.id });
  await sleep(2500);
  for (const kind of ['dock', 'fishing-ship']) {
    for (const row of (await query({ type: 'entities', kind })).entities) console.log(kind, 'animation', row.animation, 'frame', row.frame, 'activity', row.activity, 'at', row.position);
  }
  const shipRow = (await query({ type: 'entities', kind: 'fishing-ship' })).entities[0];
  console.log('ship row', JSON.stringify(shipRow));
  if (shipRow.screen) console.log('pixels under ship', JSON.stringify(await query({ type: 'pixels', entity: shipRow.id })).slice(0, 300));
  const fishRows = (await query({ type: 'entities', id: fish[0].id })).entities;
  console.log('fish row', JSON.stringify(fishRows[0]));
  await page.screenshot({ path: join(OUT, 'harbour.png') });
  await query({ type: 'select', ids: [ships[0].id] });
  await sleep(800);
  const buttons = await page.evaluate(() => [...document.querySelectorAll('.command-button')].map(b => (b as HTMLElement).title));
  console.log('ship buttons', buttons);
  await query({ type: 'select', ids: [dock.id] });
  await sleep(800);
  console.log('dock buttons', await page.evaluate(() => [...document.querySelectorAll('.command-button')].map(b => (b as HTMLElement).title)));
  const name = await page.evaluate(() => document.querySelector('#selection-panel, .selection-panel')?.textContent?.slice(0, 120));
  console.log('selection', name);
  await page.screenshot({ path: join(OUT, 'harbour-dock.png') });
} finally { await browser.close(); await server.close(); }
