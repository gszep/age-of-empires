/** #137: real bell, self-rally production and ram boarding/unload, plus flag pixels. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import { addNode, applyCommand, createGame, stepGame } from '../src/sim/game.ts';
import { rulesFromManifest } from '../src/sim/data.ts';
import { SNAPSHOT_VERSION } from '../src/dev-session.ts';
import type { BuildingKind, Entity, UnitKind } from '../src/sim/types.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const rules = rulesFromManifest(JSON.parse(readFileSync(`${root}public/imported/aoe2/manifest.json`, 'utf8')));
const audioPath = `${root}public/imported/aoe2/audio/manifest.json`;
if (existsSync(audioPath)) {
  const audio = JSON.parse(readFileSync(audioPath, 'utf8')).audio;
  for (const cue of ['townbell_start', 'townbell_stop']) {
    assert(audio[cue]?.files?.some((file: any) => file.seconds > 0), `${cue} resolves to owned audio`);
  }
}
const state = createGame(137, rules);
state.entities = state.entities.filter(e => e.owner !== 0);
state.terrain.fill(0);
const tc = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
const workers = state.entities.filter(e => e.owner === 1 && e.kind === 'villager');
const put = (kind: BuildingKind | UnitKind, dx: number, dy: number): Entity => {
  const rule = (rules.units as any)[kind] ?? (rules.buildings as any)[kind];
  const e: Entity = { id: state.nextId++, kind, owner: 1, position: { x: tc.position.x + dx, y: tc.position.y + dy },
    hp: rule.hp, maxHp: rule.hp, radius: rule.radius, activity: 'idle', order: { kind: 'idle' } };
  state.entities.push(e); return e;
};
const barracks = put('barracks', 8, 8);
const ram = put('battering-ram', 12, -4);
const infantry = put('militia', 9, -3);
for (let i = 0; i < 5; i++) put('house', -10 + 3 * i, 14);
Object.assign(state.players[1], { food: 2000, wood: 2000, gold: 2000, populationCap: 30 });
state.players[2].food = 0; state.players[2].wood = 0;
const berries = addNode(state, 'berries', { x: tc.position.x + 5, y: tc.position.y });
applyCommand(state, { kind: 'order', player: 1, entityIds: workers.map(e => e.id), target: berries.position, targetId: berries.id });
stepGame(state);
const { rules: ignored, ...saved } = state;
const server = await createServer({ root, configFile: `${root}vite.config.ts`,
  server: { host: '127.0.0.1', port: 5237, strictPort: true }, logLevel: 'error' });
await server.listen();
const libs = `${homedir()}/.cache/puppeteer/extra-libs/usr/lib/x86_64-linux-gnu`;
const browser = await puppeteer.launch({ headless: true,
  env: existsSync(libs) ? { ...process.env, LD_LIBRARY_PATH: libs } : process.env,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebGPU'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.evaluateOnNewDocument(snapshot => sessionStorage.setItem('open-empires-lab:dev-session', JSON.stringify(snapshot)),
    { version: SNAPSHOT_VERSION, rulesOrigin: rules.origin, state: saved });
  await page.goto('http://127.0.0.1:5237/?solo=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).__empiresDebug === 'function', { timeout: 120_000, polling: 100 });
  const query = (q: object): Promise<any> => page.evaluate(q => (window as any).__empiresDebug(q), q);
  const clickButton = async (command: string) => {
    const selector = `[data-command="${command}"]`;
    await page.waitForSelector(selector);
    // The HUD rebuilds buttons as its state changes. Resolve coordinates,
    // then issue a real mouse click rather than holding a detachable handle.
    const at = await page.$eval(selector, el => {
      const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await page.mouse.click(at.x, at.y);
  };
  const until = (expression: string) => page.waitForFunction(async expression => {
    const s = await (window as any).__empiresDebug({ type: 'snapshot' });
    return new Function('s', `return ${expression}`)(s);
  }, { timeout: 60_000, polling: 100 }, expression);
  const select = async (id: number) => {
    await query({ type: 'look', entity: id });
    const e = (await query({ type: 'entities', id })).entities[0];
    await page.mouse.click(e.screen.x, e.screen.y);
    assert((await query({ type: 'sim' })).selected.includes(id));
    return e;
  };
  const flags = async (id: number) => {
    await page.waitForFunction(async id => (await (window as any).__empiresDebug({ type: 'entities', id })).entities[0]
      ?.garrisonFlags?.some((f: any) => f.visible), { timeout: 30_000, polling: 100 }, id);
    const e = (await query({ type: 'entities', id })).entities[0];
    const flag = e.garrisonFlags.find((f: any) => f.visible);
    const pixels = await query({ type: 'pixels', rect: flag.rect, match: '#0000ff', tolerance: 100 });
    assert(pixels.matched > 0, `${id}: flag rectangle must contain rendered blue player-colour pixels (${pixels.colorSpace})`);
    return pixels.matched;
  };
  await page.keyboard.press('F3');
  assert((await query({ type: 'snapshot' })).entities.some((e: any) => e.id === ram.id && e.kind === 'battering-ram'), 'fixture resumed');
  await select(tc.id);
  await page.waitForSelector('[data-command="town-bell"]');
  await clickButton('town-bell');
  await until(`s.entities.find(e => e.id === ${tc.id}).townBell === true`);
  for (let i = 0; i < 6; i++) await page.keyboard.press('+');
  await page.keyboard.press('F3');
  await until(`s.entities.find(e => e.id === ${tc.id}).garrison?.length === 3`);
  await page.keyboard.press('F3');
  const tcPixels = await flags(tc.id);
  await clickButton('town-bell');
  const afterBell = await query({ type: 'snapshot' });
  assert(workers.every(w => afterBell.entities.some((e: any) => e.id === w.id && e.order.kind === 'gather' && e.order.targetId === berries.id)));
  if (existsSync(audioPath)) {
    await page.waitForFunction(() => ['townbell_start', 'townbell_stop'].every(cue =>
      performance.getEntriesByType('resource').some(e => e.name.includes(`/audio/${cue}`))));
  }
  await select(barracks.id);
  const producer = (await query({ type: 'entities', id: barracks.id })).entities[0];
  await page.mouse.click(producer.screen.x, producer.screen.y, { button: 'right' });
  await until(`s.entities.find(e => e.id === ${barracks.id}).rally?.targetId === ${barracks.id}`);
  await page.waitForSelector('[data-command="train-militia"]');
  await clickButton('train-militia');
  await page.keyboard.press('F3');
  await until(`s.entities.find(e => e.id === ${barracks.id}).garrison?.length === 1`);
  await page.keyboard.press('F3');
  const productionPixels = await flags(barracks.id);
  await clickButton('ungarrison');
  await until(`!s.entities.find(e => e.id === ${barracks.id}).garrison?.length`);
  await select(ram.id);
  const carrier = (await query({ type: 'entities', id: ram.id })).entities[0];
  await query({ type: 'select', ids: [infantry.id] });
  await page.mouse.click(carrier.screen.x, carrier.screen.y, { button: 'right' });
  await page.keyboard.press('F3');
  await until(`s.entities.find(e => e.id === ${ram.id}).garrison?.length === 1`);
  await page.keyboard.press('F3');
  await select(ram.id);
  const ramPixels = await flags(ram.id);
  await page.waitForFunction(() => document.querySelector('.object-detail')?.textContent?.includes('1/6 garrisoned'));
  await page.waitForSelector('[data-command="ungarrison"]');
  await clickButton('ungarrison');
  await until(`s.entities.some(e => e.id === ${infantry.id}) && !s.entities.find(e => e.id === ${ram.id}).garrison?.length`);
  assert.deepEqual(errors, []);
  console.log(`GARRISON EDGES SMOKE GREEN: bell/work restore, self-rally training/unload, ram boarding/unload; blue flag pixels TC=${tcPixels}, barracks=${productionPixels}, ram=${ramPixels}`);
} finally { await browser.close(); await server.close(); }
