/** #251: real boarding clicks and HUD occupancy for loaded rams. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import puppeteer from 'puppeteer';
import { createGame } from '../src/sim/game.ts';
import { FALLBACK_RULES, rulesFromManifest } from '../src/sim/data.ts';
import { updateVisibility } from '../src/sim/visibility.ts';
import { SNAPSHOT_VERSION } from '../src/dev-session.ts';
import type { Entity, UnitKind } from '../src/sim/types.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const fallback = process.env.OPEN_FALLBACK === '1';
const rules = fallback ? FALLBACK_RULES : rulesFromManifest(JSON.parse(readFileSync(`${root}public/imported/aoe2/manifest.json`, 'utf8')));
const state = createGame(251, rules);
state.entities = state.entities.filter(e => e.kind === 'town-center');
state.terrain.fill(0); state.elevation.fill(0);
for (let y = 18; y <= 34; y++) for (let x = 25; x <= 32; x++) state.terrain[y * state.width + x] = 1;
Object.assign(state.players[2], { food: 0, wood: 0, gold: 0, stone: 0 });
const make = (kind: UnitKind, x: number, y: number): Entity => {
  const r = rules.units[kind];
  return { id: state.nextId++, kind, owner: 1, position: { x, y }, hp: r.hp, maxHp: r.hp,
    radius: r.radius, activity: 'idle', order: { kind: 'idle' } };
};
const capacity = rules.units['transport-ship'].transportCapacity!;
const crew = rules.units['battering-ram'].infantryCapacity!;
const fixture = (y: number, used: number) => {
  const ship = make('transport-ship', 25.5, y), ram = make('battering-ram', 24.5, y);
  ship.garrison = Array.from({ length: used }, () => make('militia', 25.5, y));
  ram.garrison = Array.from({ length: crew }, () => make('militia', 24.5, y));
  state.entities.push(ship, ram);
  return { ship, ram };
};
const exact = fixture(20.5, capacity - crew - 1), full = fixture(26.5, capacity - 1);
const captured = fixture(32.5, 0);
captured.ship.convertedRules = { ...rules.units['transport-ship'], transportCapacity: crew + 1 };
captured.ship.garrison = [captured.ram]; state.entities = state.entities.filter(e => e.id !== captured.ram.id);
updateVisibility(state);
const { rules: ignored, ...saved } = state;
const server = await createServer({ root, configFile: `${root}vite.config.ts`, plugins: [{
  name: 'paused-capacity-fixture', enforce: 'pre', transform(code, id) {
    if (!id.endsWith('/src/main.ts')) return;
    assert(code.includes('let paused = false;'));
    return code.replace('let paused = false;', 'let paused = true;');
  },
}], server: { host: '127.0.0.1', port: 5277, strictPort: true }, logLevel: 'error' });
await server.listen();
const libs = `${homedir()}/.cache/puppeteer/extra-libs/usr/lib/x86_64-linux-gnu`;
const browser = await puppeteer.launch({ headless: true,
  env: existsSync(libs) ? { ...process.env, LD_LIBRARY_PATH: libs } : process.env,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebGPU'] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 800 });
  if (fallback) {
    await page.setRequestInterception(true);
    page.on('request', r => { void (r.url().includes('/imported/') ? r.respond({ status: 404, body: '' }) : r.continue()); });
  }
  const handle = await page.evaluateOnNewDocument(snapshot => sessionStorage.setItem('open-empires-lab:dev-session', JSON.stringify(snapshot)),
    { version: SNAPSHOT_VERSION, rulesOrigin: rules.origin, state: saved });
  const errors: string[] = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://127.0.0.1:5277/?solo=1', { waitUntil: 'networkidle0', timeout: 120_000 });
  await page.removeScriptToEvaluateOnNewDocument(handle.identifier);
  const query = (q: object): Promise<any> => page.evaluate(q => (window as any).__empiresDebug(q), q);
  assert.equal((await query({ type: 'sim' })).tick, state.tick);
  const occupancy = async (ship: Entity, used: number, max = capacity) => {
    await query({ type: 'select', ids: [ship.id] });
    await page.waitForFunction(text => document.querySelector('.object-detail')?.textContent?.includes(text), {}, `${used}/${max} garrisoned`);
  };
  await occupancy(captured.ship, crew + 1, crew + 1);
  for (const [setup, cursor] of [[full, 'default'], [exact, 'board']] as const) {
    await query({ type: 'select', ids: [setup.ram.id] });
    await query({ type: 'look', entity: setup.ship.id });
    await page.waitForFunction(async id => (await (window as any).__empiresDebug({ type: 'entities', id })).entities[0]?.rendered,
      { timeout: 30_000 }, setup.ship.id);
    const drawn = (await query({ type: 'entities', id: setup.ship.id })).entities[0];
    await page.mouse.move(drawn.screen.x, drawn.screen.y);
    await page.waitForFunction(({ cursor, fallback }) => {
      const css = getComputedStyle(document.querySelector('canvas.battlefield')!).cursor;
      return fallback ? css === 'default' : css.includes(`/${cursor}32x32.cur`);
    }, { timeout: 10_000 }, { cursor, fallback });
    await page.mouse.click(drawn.screen.x, drawn.screen.y, { button: 'right' });
    const snapshot = await query({ type: 'snapshot' });
    assert.equal(snapshot.entities.find((e: any) => e.id === setup.ram.id).order.kind, cursor === 'board' ? 'garrison' : 'move');
  }
  await page.keyboard.press('F3');
  await page.waitForFunction(async id => !(await (window as any).__empiresDebug({ type: 'snapshot' })).entities.some((e: any) => e.id === id),
    { timeout: 30_000 }, exact.ram.id);
  await page.keyboard.press('F3');
  await occupancy(exact.ship, capacity);
  await occupancy(full.ship, capacity - 1);
  const snapshot = await query({ type: 'snapshot' });
  assert.equal(snapshot.entities.find((e: any) => e.id === full.ram.id).garrison.length, crew);
  assert.equal(snapshot.entities.find((e: any) => e.id === exact.ship.id).garrison.find((e: any) => e.id === exact.ram.id).garrison.length, crew);
  const hash = (await query({ type: 'sim' })).synchronizationHash;
  await page.reload({ waitUntil: 'networkidle0', timeout: 120_000 });
  assert.equal((await query({ type: 'sim' })).synchronizationHash, hash);
  await occupancy(exact.ship, capacity);
  assert.deepEqual(errors, []);
  console.log(`TRANSPORT CAPACITY GREEN (${fallback ? 'fallback' : 'owned'}): real overflow/exact-fit clicks, nested ${capacity}/${capacity} HUD, stored carrier capacity, intact payload and reload`);
} finally { await browser.close(); await server.close(); }
