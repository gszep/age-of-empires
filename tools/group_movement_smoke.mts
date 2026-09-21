/** #83: a real group right-click must settle in two dimensions, not a line. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import { createGame } from '../src/sim/game.ts';
import { FALLBACK_RULES, rulesFromManifest } from '../src/sim/data.ts';
import { SNAPSHOT_VERSION } from '../src/dev-session.ts';
import type { Entity } from '../src/sim/types.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = `${root}public/imported/aoe2/manifest.json`;
const rules = existsSync(manifest) ? rulesFromManifest(JSON.parse(readFileSync(manifest, 'utf8'))) : FALLBACK_RULES;
const state = createGame(83, rules);
state.entities = state.entities.filter(e => e.kind === 'town-center');
state.terrain.fill(0);
const home = state.entities.find(e => e.owner === 1)!;
const group: Entity[] = Array.from({ length: 25 }, (_, i) => ({
  id: state.nextId++, kind: 'militia', owner: 1,
  position: { x: home.position.x + 5 + i % 5, y: home.position.y + Math.floor(i / 5) },
  hp: rules.units.militia.hp, maxHp: rules.units.militia.hp, radius: rules.units.militia.radius,
  activity: 'idle', order: { kind: 'idle' },
}));
state.entities.push(...group);
const ids = group.map(e => e.id);
const { rules: ignored, ...saved } = state;
const server = await createServer({ root, configFile: `${root}vite.config.ts`,
  server: { host: '127.0.0.1', port: 5223, strictPort: true }, logLevel: 'error' });
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
  await page.goto('http://127.0.0.1:5223/?solo=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).__empiresDebug === 'function', { timeout: 120_000, polling: 100 });
  const query = (q: object): Promise<any> => page.evaluate(q => (window as any).__empiresDebug(q), q);
  await page.keyboard.press('F3');
  assert.equal((await query({ type: 'snapshot' })).entities.filter((e: any) => ids.includes(e.id)).length, 25, 'fixture resumed');
  await query({ type: 'look', entity: group[12].id });
  await query({ type: 'select', ids });
  // A bare-ground click away from the staged group, in the central viewport.
  await page.mouse.click(850, 320, { button: 'right' });
  const ordered = (await query({ type: 'snapshot' })).entities.filter((e: any) => ids.includes(e.id));
  assert(ordered.every((e: any) => e.order.kind === 'move'), 'right-click orders every selected unit');
  const target = ordered[0].order.target;
  for (let i = 0; i < 6; i++) await page.keyboard.press('+');
  await page.keyboard.press('F3');
  await page.waitForFunction(async ids => {
    const s = await (window as any).__empiresDebug({ type: 'snapshot' });
    return s.entities.filter((e: any) => ids.includes(e.id)).every((e: any) => e.order.kind === 'idle');
  }, { timeout: 60_000, polling: 100 }, ids);
  const arrivalTick = (await query({ type: 'sim' })).tick;
  await page.waitForFunction(async tick => (await (window as any).__empiresDebug({ type: 'sim' })).tick >= tick + 200,
    { timeout: 30_000, polling: 100 }, arrivalTick);
  await page.keyboard.press('F3');
  const arrived = (await query({ type: 'snapshot' })).entities.filter((e: any) => ids.includes(e.id));
  const xs = arrived.map((e: any) => e.position.x);
  const ys = arrived.map((e: any) => e.position.y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  const radius = Math.max(...arrived.map((e: any) => Math.hypot(e.position.x - target.x, e.position.y - target.y)));
  assert(Math.min(width, height) > rules.units.militia.radius * 2, `two-dimensional: ${width} × ${height}`);
  assert(radius < Math.sqrt(ids.length) * rules.units.militia.radius * 2, `compact: radius ${radius}`);
  const drawn = (await query({ type: 'entities', owner: 1 })).entities.filter((e: any) => ids.includes(e.id));
  assert.equal(drawn.filter((e: any) => e.rendered).length, 25, 'all arrivals rendered');
  assert.deepEqual(errors, []);
  console.log(`GROUP MOVEMENT SMOKE GREEN: 25-unit right-click, ${width.toFixed(3)} × ${height.toFixed(3)} tiles, radius ${radius.toFixed(3)}`);
} finally { await browser.close(); await server.close(); }
