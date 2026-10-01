/** #178: captured ram HUD/ejection retains the enemy passenger's ownership. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import puppeteer from 'puppeteer';
import { applyCommand, createGame, rulesForPlayer, stepGame, unitRulesFor } from '../src/sim/game.ts';
import { FALLBACK_RULES, rulesFromManifest } from '../src/sim/data.ts';
import { updateVisibility } from '../src/sim/visibility.ts';
import { SNAPSHOT_VERSION } from '../src/dev-session.ts';
import type { Entity, PlayerId, UnitKind } from '../src/sim/types.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const fallback = process.env.OPEN_FALLBACK === '1';
const rules = fallback ? FALLBACK_RULES : rulesFromManifest(JSON.parse(readFileSync(`${root}public/imported/aoe2/manifest.json`, 'utf8')));
const state = createGame(178, rules, rules.civilizations?.teutons
  ? { 1: 'teutons', 2: rules.civilization.key } : undefined);
state.entities = state.entities.filter(e => e.kind === 'town-center');
state.terrain.fill(0); state.elevation.fill(0);
Object.assign(state.players[2], { food: 0, wood: 0, gold: 0, stone: 0 });
if (rulesForPlayer(state, 1).technologies.redemption) state.players[1].researched.push('redemption');
const make = (kind: UnitKind, owner: PlayerId, x: number): Entity => {
  const r = unitRulesFor(state, owner, kind);
  const e: Entity = { id: state.nextId++, kind, owner, position: { x, y: 50.5 }, hp: r.hp, maxHp: r.hp,
    radius: r.radius, activity: 'idle', order: { kind: 'idle' } };
  state.entities.push(e); return e;
};
const ram = make('battering-ram', 2, 60.5), passenger = make('militia', 2, 61.3);
const order = (unit: Entity, target: Entity) => {
  updateVisibility(state);
  assert.deepEqual(applyCommand(state, { kind: 'order', player: unit.owner as PlayerId,
    entityIds: [unit.id], target: target.position, targetId: target.id }), { ok: true });
};
order(passenger, ram);
for (let i = 0; i < 100 && !ram.garrison?.length; i++) stepGame(state);
assert.equal(ram.garrison?.[0].id, passenger.id);
const monk = make('monk', 1, 58.5);
order(monk, ram);
assert.equal(monk.order.kind, 'convert');
for (let i = 0; i < 600 && ram.owner !== 1; i++) stepGame(state);
assert.equal(ram.owner, 1);
assert.equal(passenger.owner, 2);
assert.equal(passenger.convertedRules, undefined);
const { rules: ignored, ...saved } = state;
const server = await createServer({ root, configFile: `${root}vite.config.ts`, plugins: [{
  name: 'paused-conversion-cargo-fixture', enforce: 'pre', transform(code, id) {
    if (!id.endsWith('/src/main.ts')) return;
    assert(code.includes('let paused = false;'));
    return code.replace('let paused = false;', 'let paused = true;');
  },
}], server: { host: '127.0.0.1', port: 5278, strictPort: true }, logLevel: 'error' });
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
  await page.goto('http://127.0.0.1:5278/?solo=1', { waitUntil: 'networkidle0', timeout: 120_000 });
  await page.removeScriptToEvaluateOnNewDocument(handle.identifier);
  const query = (q: object): Promise<any> => page.evaluate(q => (window as any).__empiresDebug(q), q);
  assert.equal((await query({ type: 'sim' })).tick, state.tick);
  await query({ type: 'look', entity: ram.id });
  await query({ type: 'select', ids: [ram.id] });
  await page.waitForFunction(() => document.querySelector('.object-detail')?.textContent?.includes('1/'));
  const hash = (await query({ type: 'sim' })).synchronizationHash;
  await page.reload({ waitUntil: 'networkidle0', timeout: 120_000 });
  assert.equal((await query({ type: 'sim' })).synchronizationHash, hash);
  const before = await query({ type: 'snapshot' });
  assert.equal(before.entities.find((e: any) => e.id === ram.id).garrison[0].owner, 2);
  await query({ type: 'select', ids: [ram.id] });
  await page.waitForSelector('[data-command="ungarrison"]:not([disabled])');
  await page.click('[data-command="ungarrison"]');
  const after = await query({ type: 'snapshot' });
  assert.equal(after.entities.find((e: any) => e.id === passenger.id)?.owner, 2);
  assert.equal(after.entities.find((e: any) => e.id === ram.id).garrison, undefined);
  await query({ type: 'select', ids: [passenger.id] });
  await page.waitForFunction(() => !document.querySelector('[data-command="ungarrison"]'));
  assert.deepEqual(errors, []);
  console.log(`CONVERSION CARGO GREEN (${fallback ? 'fallback' : 'owned'}): public boarding/conversion, captured HUD, reload, real ejection click and enemy passenger ownership`);
} finally { await browser.close(); await server.close(); }
