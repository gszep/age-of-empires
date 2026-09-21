/** #85: AI sheep consumption and visible unattended carcass food loss. */
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
const rules = existsSync(manifest) ? rulesFromManifest(JSON.parse(readFileSync(manifest, 'utf8'))) : FALLBACK_RULES;
const state = createGame(85, rules);
state.entities = state.entities.filter(e => e.kind === 'town-center' || (e.owner === 2 && e.kind === 'villager'));
state.terrain.fill(0);
const homes = [1, 2].map(owner => state.entities.find(e => e.kind === 'town-center' && e.owner === owner)!);
const sheep = (owner: 1 | 2, index: number): Entity => ({ id: state.nextId++, kind: 'sheep', owner,
  position: { x: homes[owner - 1].position.x + 5, y: homes[owner - 1].position.y + index * 2 },
  hp: rules.units.sheep.hp, maxHp: rules.units.sheep.hp, radius: rules.units.sheep.radius,
  resourceKind: 'food', amount: 100, activity: 'idle', order: { kind: 'idle' } });
const carcass = sheep(1, 0);
const flock = Array.from({ length: 3 }, (_, i) => sheep(2, i));
state.entities.push(carcass, ...flock);
state.entities.filter(e => e.owner === 2 && e.kind === 'villager').forEach((e, i) => {
  e.position = { x: flock[i].position.x + 0.5, y: flock[i].position.y };
});
state.players[2].food = 0; state.players[2].wood = 0;
assert(applyCommand(state, { kind: 'delete', player: 1, entityIds: [carcass.id] }).ok);
const { rules: ignored, ...saved } = state;
const server = await createServer({ root, configFile: `${root}vite.config.ts`,
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
  await page.evaluateOnNewDocument(snapshot => sessionStorage.setItem('open-empires-lab:dev-session', JSON.stringify(snapshot)),
    { version: SNAPSHOT_VERSION, rulesOrigin: rules.origin, state: saved });
  await page.goto('http://127.0.0.1:5225/?solo=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).__empiresDebug === 'function', { timeout: 120_000, polling: 100 });
  const query = (q: object): Promise<any> => page.evaluate(q => (window as any).__empiresDebug(q), q);
  await page.keyboard.press('F3');
  const start = await query({ type: 'snapshot' });
  assert(start.entities.some((e: any) => e.id === carcass.id && e.dead), 'fixture resumed');
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
  const hud = await page.$eval('.object-detail', element => element.textContent ?? '');
  assert(hud.includes(String(after.amount)), `HUD shows remaining food ${after.amount}: ${hud}`);
  const killed = end.entities.filter((e: any) => flock.some(f => f.id === e.id) && e.dead);
  assert.equal(killed.length, 1, 'AI consumes one sheep, not the flock');
  assert(killed[0].amount > 0);
  assert.deepEqual(errors, []);
  console.log(`HERD FOOD SMOKE GREEN: one AI sheep killed; unattended carcass lost ${lost} food; HUD displays ${after.amount}`);
} finally { await browser.close(); await server.close(); }
