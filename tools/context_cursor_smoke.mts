/** #51: native owned cursor requests/hotspots and matching real right-click orders. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import { SNAPSHOT_VERSION } from '../src/dev-session.ts';
import { FALLBACK_RULES, isBuilding, rulesFromManifest } from '../src/sim/data.ts';
import { addNode, createGame } from '../src/sim/game.ts';
import type { BuildingKind, Entity, EntityKind, UnitKind } from '../src/sim/types.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const fallback = process.env.OPEN_FALLBACK === '1';
const rules = fallback ? FALLBACK_RULES : rulesFromManifest(JSON.parse(readFileSync(`${root}public/imported/aoe2/manifest.json`, 'utf8')));
const state = createGame(51, rules);
state.entities = state.entities.filter(e => e.kind === 'town-center');
state.terrain.fill(0); state.elevation.fill(0);
let next = 0;
const spot = () => ({ x: 20.5 + (next++ % 5) * 12, y: 20.5 + Math.floor((next - 1) / 5) * 12 });
const add = (kind: EntityKind, owner: Entity['owner'], extra: Partial<Entity> = {}) => {
  const rule = isBuilding(kind) ? rules.buildings[kind as BuildingKind] : rules.units[kind as UnitKind];
  const entity: Entity = { id: state.nextId++, kind, owner, position: spot(), hp: rule.hp, maxHp: rule.hp,
    radius: rule.radius, activity: 'idle', order: { kind: 'idle' }, ...extra };
  state.entities.push(entity); return entity;
};
const worker = add('villager', 1), monk = add('monk', 1), soldier = add('militia', 1);
const tree = addNode(state, 'tree', spot()), gold = addNode(state, 'gold', spot());
const stone = addNode(state, 'stone', spot()), food = addNode(state, 'berries', spot());
const fish = addNode(state, 'shore-fish', spot());
const deer = add('deer', 0, { amount: 100, resourceKind: 'food' });
const sheep = add('sheep', 1, { amount: 100, resourceKind: 'food' });
const site = add('house', 1, { hp: 1, buildProgress: 0.5 });
const damaged = add('house', 1, { hp: 1 });
const wounded = add('villager', 1, { hp: 1 });
const enemy = add('militia', 2);
const tc = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
const mill = add('mill', 1);
for (const player of [1, 2] as const) {
  state.visibility[player].visible.fill(1); state.visibility[player].explored.fill(1);
  state.visibility[player].memory = {};
}
const hidden = addNode(state, 'gold', { x: 110.5, y: 110.5 });
state.visibility[1].visible[110 * state.width + 110] = 0;
state.visibility[1].explored[110 * state.width + 110] = 0;
const remembered = addNode(state, 'gold', { x: 110.5, y: 100.5 });
const rememberedAmount = remembered.amount!;
remembered.amount = 1;
state.visibility[1].visible[100 * state.width + 110] = 0;
state.visibility[1].visible[100 * state.width + 105] = 0;
state.visibility[1].memory[remembered.id] = { id: remembered.id, kind: 'resource', owner: 0,
  x: 105.5, y: 100.5, hp: 0, maxHp: 0, node: 'gold', resource: 'gold', amount: rememberedAmount, lastSeenAt: 0 };
const { rules: ignored, ...saved } = state;
const server = await createServer({ root, configFile: `${root}vite.config.ts`, plugins: [{
  name: 'context-cursor-probe', enforce: 'pre', transform(code, id) {
    if (!id.endsWith('/src/main.ts')) return;
    const anchor = 'renderer.setAnimationLoop(now => {';
    assert(code.includes(anchor));
    return code.replace(anchor, anchor + '\npaused = true;');
  },
}], server: { host: '127.0.0.1', port: 5265, strictPort: true }, logLevel: 'error' });
await server.listen();
const libs = `${homedir()}/.cache/puppeteer/extra-libs/usr/lib/x86_64-linux-gnu`;
const browser = await puppeteer.launch({ headless: true,
  env: existsSync(libs) ? { ...process.env, LD_LIBRARY_PATH: libs } : process.env,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebGPU'] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 800 });
  const errors: string[] = []; page.on('pageerror', error => errors.push(String(error)));
  const fetched = new Set<string>();
  page.on('response', response => { if (response.url().endsWith('.cur') && response.ok()) fetched.add(new URL(response.url()).pathname.split('/').at(-1)!); });
  if (fallback) {
    await page.setRequestInterception(true);
    page.on('request', request => { void (request.url().includes('/imported/') ? request.respond({ status: 404, body: '' }) : request.continue()); });
  }
  await page.evaluateOnNewDocument(snapshot => sessionStorage.setItem('open-empires-lab:dev-session', JSON.stringify(snapshot)),
    { version: SNAPSHOT_VERSION, rulesOrigin: rules.origin, state: saved });
  await page.goto('http://127.0.0.1:5265/?solo=1', { waitUntil: 'networkidle0', timeout: 120_000 });
  await page.waitForFunction(() => typeof (window as any).__empiresDebug === 'function', { timeout: 60_000 });
  const query = (q: object): Promise<any> => page.evaluate(q => (window as any).__empiresDebug(q), q);
  assert.equal((await query({ type: 'sim' })).tick, state.tick);
  const cases = [
    [worker, tree, 'chop', 'gather'], [worker, gold, 'mine_gold', 'gather'],
    [worker, stone, 'mine_stone', 'gather'], [worker, food, 'gather', 'gather'],
    [worker, fish, 'fish', 'gather'], [worker, deer, 'hunt', 'attack'],
    [worker, sheep, 'gather_meat', 'gather'], [worker, site, 'build', 'build'],
    [worker, damaged, 'repair', 'repair'], [monk, wounded, 'heal', 'heal'],
    [monk, enemy, 'convert', 'convert'], [soldier, enemy, 'attack', 'attack'],
    [worker, tc, 'garrison', 'garrison'], [tc, mill, 'default', 'rally'],
    [worker, hidden, 'default', 'move'],
  ] as const;
  for (const [actor, target, cursor, order] of cases) {
    await query({ type: 'select', ids: [actor.id] });
    await query({ type: 'look', entity: target.id });
    if (target !== hidden) await page.waitForFunction(async id => {
      const reply = await (window as any).__empiresDebug({ type: 'entities', id });
      return reply.entities[0]?.rendered;
    }, { timeout: 30_000 }, target.id);
    const drawn = (await query({ type: 'entities', id: target.id })).entities[0];
    const before = (await query({ type: 'sim' })).synchronizationHash;
    await page.mouse.move(drawn.screen.x, drawn.screen.y);
    await page.waitForFunction(({ cursor, fallback }) => {
      const css = getComputedStyle(document.querySelector('canvas.battlefield')!).cursor;
      return fallback ? css === 'default' : css.includes(`/${cursor}32x32.cur`);
    }, { timeout: 10_000 }, { cursor, fallback });
    const css = await page.$eval('canvas.battlefield', e => getComputedStyle(e).cursor);
    if (!fallback && cursor === 'convert') assert(css.includes('15 15'));
    if (!fallback && cursor === 'flag') assert(css.includes('9 43'));
    assert.equal((await query({ type: 'sim' })).synchronizationHash, before, 'hover is read-only');
    await page.mouse.click(drawn.screen.x, drawn.screen.y, { button: 'right' });
    const snapshot = await query({ type: 'snapshot' });
    const updated = snapshot.entities.find((e: any) => e.id === actor.id);
    if (order === 'rally') assert.equal(updated.rally.targetId, target.id);
    else {
      assert.equal(updated.order.kind, order, `${cursor} cursor matches actual ${actor.kind} order`);
      if (order !== 'move') assert.equal(updated.order.targetId, target.id);
      else assert.equal(updated.order.targetId, undefined, 'hidden target is not exposed by the cursor or command');
    }
  }
  // #239: an actual TC selection stays ordinary until Set Gather Point is
  // explicitly pressed. The button uses native sequence4 => grid cell5/T.
  await query({ type: 'look', entity: tc.id });
  let tcDrawn = (await query({ type: 'entities', id: tc.id })).entities[0];
  await page.mouse.click(tcDrawn.screen.x, tcDrawn.screen.y);
  assert.deepEqual((await query({ type: 'sim' })).selected, [tc.id]);
  const expectCursor = async (name: string) => page.waitForFunction(({ name, fallback }) => {
    const css = getComputedStyle(document.querySelector('canvas.battlefield')!).cursor;
    return fallback ? css === 'default' : css.includes(`/${name}32x32.cur`);
  }, { timeout: 10000 }, { name, fallback });
  const clickGather = async () => {
    await page.waitForSelector('[data-command="set-gather-point"]');
    const button = await page.$eval('[data-command="set-gather-point"]', e => {
      const r = e.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2,
        cell: [...e.parentElement!.children].indexOf(e) + 1, title: (e as HTMLElement).title };
    });
    assert.equal(button.cell, 5); assert(button.title.includes('(T)'));
    await page.mouse.click(button.x, button.y);
  };
  await expectCursor('default');
  await clickGather();
  await page.mouse.move(tcDrawn.screen.x + 120, tcDrawn.screen.y);
  await expectCursor('flag');
  const beforeCancel = (await query({ type: 'sim' })).synchronizationHash;
  await page.keyboard.press('Escape'); await expectCursor('default');
  assert.equal((await query({ type: 'sim' })).synchronizationHash, beforeCancel);
  await clickGather();
  await query({ type: 'look', entity: mill.id });
  const millDrawn = (await query({ type: 'entities', id: mill.id })).entities[0];
  await page.mouse.move(millDrawn.screen.x, millDrawn.screen.y); await expectCursor('flag');
  await page.mouse.click(millDrawn.screen.x, millDrawn.screen.y);
  assert.equal((await query({ type: 'snapshot' })).entities.find((e: any) => e.id === tc.id).rally.targetId, mill.id);
  await expectCursor('default');
  assert.deepEqual((await query({ type: 'sim' })).selected, [tc.id], 'placement does not select the target');
  await page.keyboard.press('t'); await expectCursor('flag');
  const beforeRightCancel = (await query({ type: 'sim' })).synchronizationHash;
  await page.mouse.click(millDrawn.screen.x, millDrawn.screen.y, { button: 'right' });
  await expectCursor('default');
  assert.equal((await query({ type: 'sim' })).synchronizationHash, beforeRightCancel);
  await page.keyboard.press('t'); await expectCursor('flag');
  await query({ type: 'select', ids: [worker.id] });
  await page.mouse.move(millDrawn.screen.x + 150, millDrawn.screen.y + 20);
  await expectCursor('default');
  console.log('GATHER POINT GREEN: TC click stays ordinary; native button/T arms left-click placement; Escape/right-click/selection cancel');
  // A last-seen resource is selected at its remembered location and reports
  // remembered stock, not hidden live position/depletion data.
  await query({ type: 'select', ids: [worker.id] });
  await query({ type: 'look', rect: [105.5, 100.5, 0, 0] });
  await page.mouse.move(640, 400);
  await page.waitForFunction(fallback => {
    const css = getComputedStyle(document.querySelector('canvas.battlefield')!).cursor;
    return fallback ? css === 'default' : css.includes('/mine_gold32x32.cur');
  }, {}, fallback);
  await page.mouse.click(640, 400);
  await page.waitForFunction(amount => document.body.textContent?.includes(`${amount} gold`), {}, rememberedAmount);
  assert.deepEqual((await query({ type: 'sim' })).selected, [remembered.id]);
  await page.waitForNetworkIdle({ idleTime: 500, timeout: 30_000 });
  if (!fallback) for (const cursor of new Set(cases.map(c => c[2]))) assert(fetched.has(`${cursor}32x32.cur`), `browser fetched native ${cursor} asset`);
  assert.deepEqual(errors, []);
  console.log(`CONTEXT CURSOR SMOKE GREEN (${fallback ? 'fallback' : 'owned'}): ${cases.length} actual hover/right-click outcomes, ${fallback ? 'CSS fallback' : 'native hotspots'} and read-only/fog checks`);
} finally { await browser.close(); await server.close(); }
