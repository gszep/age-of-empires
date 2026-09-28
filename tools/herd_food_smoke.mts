/** #85/#136: AI brings sheep home before slaughter; carcass loss remains
 * visible and manual sheep orders are independent. OPEN_FALLBACK=1 supported. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import { applyCommand, createGame } from '../src/sim/game.ts';
import { FALLBACK_RULES, rulesFromManifest, TICK_SECONDS } from '../src/sim/data.ts';
import { SNAPSHOT_VERSION } from '../src/dev-session.ts';
import type { Entity } from '../src/sim/types.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = `${root}public/imported/aoe2/manifest.json`;
const fallback = process.env.OPEN_FALLBACK === '1';
const rules = !fallback && existsSync(manifest) ? rulesFromManifest(JSON.parse(readFileSync(manifest, 'utf8'))) : FALLBACK_RULES;
const state = createGame(85, rules);
state.entities = state.entities.filter(e => e.kind === 'town-center' || (e.owner === 2 && e.kind === 'villager'));
state.terrain.fill(0); state.elevation.fill(0);
const homes = [1, 2].map(owner => state.entities.find(e => e.kind === 'town-center' && e.owner === owner)!);
const sheep = (owner: 1 | 2, index: number): Entity => ({ id: state.nextId++, kind: 'sheep', owner,
  position: { x: homes[owner - 1].position.x + 5, y: homes[owner - 1].position.y + index * 2 },
  hp: rules.units.sheep.hp, maxHp: rules.units.sheep.hp, radius: rules.units.sheep.radius,
  resourceKind: 'food', amount: 100, activity: 'idle', order: { kind: 'idle' } });
const carcass = sheep(1, 0);
const manual = sheep(1, 1);
const flock = Array.from({ length: 3 }, (_, i) => sheep(2, i));
state.entities.push(carcass, manual, ...flock);
state.entities.filter(e => e.owner === 2 && e.kind === 'villager').forEach((e, i) => {
  e.position = { x: flock[i].position.x + 0.5, y: flock[i].position.y };
});
state.players[2].food = 0; state.players[2].wood = 0;
assert(applyCommand(state, { kind: 'delete', player: 1, entityIds: [carcass.id] }).ok);
const { rules: ignored, ...saved } = state;
const server = await createServer({ root, configFile: `${root}vite.config.ts`, plugins: [{
  name: 'paused-herding-fixture', enforce: 'pre', transform(code, id) {
    if (!id.endsWith('/src/main.ts')) return;
    assert(code.includes('let paused = false;'));
    return code.replace('let paused = false;', 'let paused = true;');
  },
}],
  server: { host: '127.0.0.1', port: 5225, strictPort: true }, logLevel: 'error' });
await server.listen();
const libs = `${homedir()}/.cache/puppeteer/extra-libs/usr/lib/x86_64-linux-gnu`;
const browser = await puppeteer.launch({ headless: true, env: existsSync(libs) ? { ...process.env, LD_LIBRARY_PATH: libs } : process.env,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebGPU'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  if (fallback) {
    await page.setRequestInterception(true);
    page.on('request', r => { void (r.url().includes('/imported/') ? r.respond({ status: 404, body: '' }) : r.continue()); });
  }
  await page.evaluateOnNewDocument(snapshot => sessionStorage.setItem('open-empires-lab:dev-session', JSON.stringify(snapshot)),
    { version: SNAPSHOT_VERSION, rulesOrigin: rules.origin, state: saved });
  await page.goto('http://127.0.0.1:5225/?solo=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).__empiresDebug === 'function', { timeout: 120_000, polling: 100 });
  const query = (q: object): Promise<any> => page.evaluate(q => (window as any).__empiresDebug(q), q);
  const start = await query({ type: 'snapshot' });
  assert.equal(start.tick, state.tick);
  assert(start.entities.some((e: any) => e.id === carcass.id && e.dead), 'fixture resumed');
  const destination = { x: homes[0].position.x + 10, y: homes[0].position.y + 5 };
  assert((await query({ type: 'command', command: { kind: 'order', player: 1, entityIds: [manual.id], target: destination } })).ok);
  await query({ type: 'look', entity: carcass.id });
  const drawn = (await query({ type: 'entities', id: carcass.id, dead: true })).entities[0];
  assert(drawn.rendered, 'carcass drawn');
  await page.mouse.click(drawn.screen.x, drawn.screen.y);
  assert((await query({ type: 'sim' })).selected.includes(carcass.id), 'real click selects edible carcass');
  for (let i = 0; i < 6; i++) await page.keyboard.press('+');
  await page.keyboard.press('F3');
  await page.waitForFunction(async tick => (await (window as any).__empiresDebug({ type: 'sim' })).tick >= tick + 400,
    { timeout: 40_000, polling: 100 }, start.tick);
  await page.keyboard.press('F3');
  const end = await query({ type: 'snapshot' });
  const after = end.entities.find((e: any) => e.id === carcass.id);
  const before = start.entities.find((e: any) => e.id === carcass.id);
  const lost = before.amount - after.amount;
  const expected = (end.tick - start.tick) * TICK_SECONDS * rules.units.sheep.foodDecayPerSecond!;
  assert(Math.abs(lost - expected) < 1, `idle decay ${lost}, clock predicts ${expected}`);
  await page.waitForFunction(amount => document.querySelector('.object-detail')?.textContent?.includes(String(amount)), {}, after.amount);
  const hud = await page.$eval('.object-detail', element => element.textContent ?? '');
  assert(hud.includes(String(after.amount)), `HUD shows remaining food ${after.amount}: ${hud}`);
  const killed = end.entities.filter((e: any) => flock.some(f => f.id === e.id) && e.dead);
  assert.equal(killed.length, 1, 'AI consumes one sheep, not the flock');
  assert(killed[0].amount > 0);
  assert(Math.hypot(killed[0].position.x - homes[1].position.x, killed[0].position.y - homes[1].position.y) <= 2.5,
    'the AI animal reaches the TC before slaughter');
  const controlled = end.entities.find((e: any) => e.id === manual.id);
  assert(Math.hypot(controlled.position.x - destination.x, controlled.position.y - destination.y) < 0.3,
    'human sheep follows its explicit move, not AI herding or automatic following');
  await page.keyboard.press('F4');
  await query({ type: 'look', entity: killed[0].id });
  await page.waitForFunction(async id => (await (window as any).__empiresDebug({ type: 'entities', id, dead: true })).entities[0]?.rendered,
    { timeout: 30_000 }, killed[0].id);
  await page.keyboard.press('F3');
  await page.waitForFunction(async () => (await (window as any).__empiresDebug({ type: 'snapshot' })).players[2].food > 0,
    { timeout: 40_000, polling: 100 });
  await page.keyboard.press('F3');
  assert((await query({ type: 'snapshot' })).players[2].food > 0, 'AI banks food from the returned sheep');
  assert.deepEqual(errors, []);
  console.log(`HERD FOOD SMOKE GREEN (${fallback ? 'fallback' : 'owned'}): sheep reaches TC before slaughter and banks food; manual sheep reaches its target; one AI sheep killed; unattended carcass lost ${lost} food; HUD displays ${after.amount}`);
} finally { await browser.close(); await server.close(); }
