/** #97: dock buttons, shared upgrade art, transport shore unloading, trap
 * construction and visible fire projectiles, all through the real page. */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import { createGame } from '../src/sim/game.ts';
import { rulesFromManifest } from '../src/sim/data.ts';
import { SNAPSHOT_VERSION } from '../src/dev-session.ts';
import type { Entity, UnitKind, BuildingKind, Point } from '../src/sim/types.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(readFileSync(`${root}public/imported/aoe2/manifest.json`, 'utf8'));
const rules = rulesFromManifest(manifest);
function fixture() {
  const state = createGame(97, rules);
  state.entities = state.entities.filter(e => e.owner !== 0);
  state.terrain = state.terrain.map(() => 0); state.elevation = state.elevation.map(() => 0);
  for (let y = 8; y < 40; y++) for (let x = 8; x < 112; x++) state.terrain[y * state.width + x] = 1;
  const add = (kind: UnitKind | BuildingKind, owner: 1 | 2, position: Point) => {
    const r = kind in rules.units ? rules.units[kind as UnitKind] : rules.buildings[kind as BuildingKind];
    const e: Entity = { id: state.nextId++, kind, owner, position, hp: r.hp, maxHp: r.hp, radius: r.radius,
      activity: 'idle', order: { kind: 'idle' } };
    state.entities.push(e); return e;
  };
  for (let i = 0; i < 5; i++) add('house', 1, { x: 20 + i * 3, y: 70 });
  const dock = add('dock', 1, { x: 15.5, y: 8.5 });
  Object.assign(state.players[1], { food: 10000, wood: 10000, gold: 10000, age: 2, populationCap: 30 });
  Object.assign(state.players[2], { food: 0, wood: 0, gold: 0 });
  return { state, add, dock };
}
const server = await createServer({ root, configFile: `${root}vite.config.ts`,
  server: { host: '127.0.0.1', port: 5221, strictPort: true }, logLevel: 'error' });
await server.listen();
const libs = `${homedir()}/.cache/puppeteer/extra-libs/usr/lib/x86_64-linux-gnu`;
const browser = await puppeteer.launch({ headless: true, env: existsSync(libs) ? { ...process.env, LD_LIBRARY_PATH: libs } : process.env,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebGPU'] });
try {
  for (const scenario of ['dock', 'transport', 'trap', 'fire'] as const) {
    const { state, add, dock } = fixture();
    const galley = add('galley', 1, { x: 25.5, y: 20.5 });
    const transport = add('transport-ship', 1, { x: 25.5, y: 8.5 });
    const fisher = add('fishing-ship', 1, { x: 50.5, y: 20.5 });
    const marker = add('transport-ship', 1, { x: 55.5, y: 20.5 });
    const fire = add('fire-galley', 1, { x: 60.5, y: 28.5 });
    const enemy = add('transport-ship', 2, { x: 65.5, y: 28.5 });
    enemy.hp = enemy.maxHp = 1000; // long-lived combat target for the rendering measurement
    const workers = state.entities.filter(e => e.kind === 'villager' && e.owner === 1);
    workers[0].position = { x: 25.5, y: 7.5 };
    workers[0].carrying = { kind: 'wood', amount: 7 };
    workers[1].position = { x: 40.5, y: 6.5 };
    const { rules: ignored, ...saved } = state;
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.setViewport({ width: 1280, height: 800 });
    await page.evaluateOnNewDocument(snapshot => sessionStorage.setItem('open-empires-lab:dev-session', JSON.stringify(snapshot)),
      { version: SNAPSHOT_VERSION, rulesOrigin: rules.origin, state: saved });
    await page.goto('http://127.0.0.1:5221/?solo=1', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof (window as any).__empiresDebug === 'function', { timeout: 120_000, polling: 100 });
    const query = (q: object): Promise<any> => page.evaluate(q => (window as any).__empiresDebug(q), q);
    const snapshot = () => query({ type: 'snapshot' });
    const drawn = async (id: number) => (await query({ type: 'entities', id })).entities[0];
    const click = async (selector: string) => {
      await page.waitForSelector(selector);
      const point = await page.$eval(selector, e => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
      await page.mouse.click(point.x, point.y);
    };
    const look = (id: number) => query({ type: 'look', entity: id });
    const select = (id: number) => query({ type: 'select', ids: [id] });
    const rightClick = async (id: number) => { const e = await drawn(id); await page.mouse.click(e.screen.x, e.screen.y, { button: 'right' }); };
    const wait = async (predicate: string, timeout = 120_000) => page.waitForFunction(async predicate => {
      const s = await (window as any).__empiresDebug({ type: 'snapshot' });
      return new Function('s', `return (${predicate})`)(s);
    }, { timeout, polling: 100 }, predicate);
    await page.keyboard.press('F3');
    assert((await snapshot()).entities.some((e: any) => e.id === transport.id && e.kind === 'transport-ship'), 'fixture resumed');

    if (scenario === 'dock') {
      await look(dock.id); await select(dock.id);
      for (const kind of ['galley', 'hulk', 'fire-galley', 'demolition-raft', 'transport-ship', 'trade-cog', 'fishing-ship']) {
        await page.waitForSelector(`[data-command="train-${kind}"]`);
      }
      assert.equal(await page.$('[data-command="train-war-galley"]'), null);
      await click('[data-command="train-galley"]');
      await click('[data-command="research-warships"]');
      for (let i = 0; i < 6; i++) await page.keyboard.press('+');
      await page.keyboard.press('F3');
      await wait('s.players[1].researched.includes("warships")');
      const upgraded = await snapshot();
      assert.equal(upgraded.entities.filter((e: any) => e.owner === 1 && e.kind === 'war-galley').length, 2);
      await look(galley.id);
      await page.waitForFunction(async id => {
        const d = await (window as any).__empiresDebug({ type: 'entities', id });
        return d.entities[0]?.bodyVisible && d.entities[0]?.layersVisible >= 2;
      }, { timeout: 30_000, polling: 100 }, galley.id);
      assert((await drawn(galley.id)).colorTint, 'upgraded sails carry player colour');
    } else if (scenario === 'transport') {
      await look(transport.id); await select(workers[0].id); await rightClick(transport.id);
      assert.equal((await snapshot()).entities.find((e: any) => e.id === workers[0].id).order.kind, 'garrison');
      await page.keyboard.press('F3');
      await wait(`s.entities.find(e=>e.id===${transport.id}).garrison?.length===1`);
      await page.keyboard.press('F3');
      await select(transport.id); await look(workers[1].id);
      await click('[data-command="ungarrison"]');
      const landing = await drawn(workers[1].id);
      await page.mouse.click(landing.screen.x, landing.screen.y);
      assert.equal((await snapshot()).entities.find((e: any) => e.id === transport.id).order.kind, 'unload');
      for (let i = 0; i < 4; i++) await page.keyboard.press('+');
      await page.keyboard.press('F3');
      await wait(`!s.entities.find(e=>e.id===${transport.id}).garrison?.length && s.entities.some(e=>e.id===${workers[0].id})`);
      const unloaded = await snapshot();
      const passenger = unloaded.entities.find((e: any) => e.id === workers[0].id);
      assert.equal(passenger.carrying.amount, 7);
      assert.equal(unloaded.terrain[Math.floor(passenger.position.y) * unloaded.width + Math.floor(passenger.position.x)], 0);
      assert.equal(unloaded.players[1].wood, 10000);
    } else if (scenario === 'trap') {
      await look(marker.id); await select(fisher.id);
      await click('[data-command="build-fish-trap"]');
      const at = await drawn(marker.id);
      await page.mouse.click(at.screen.x, at.screen.y);
      assert((await snapshot()).entities.some((e: any) => e.kind === 'fish-trap'), 'real build click placed the trap');
      for (let i = 0; i < 6; i++) await page.keyboard.press('+');
      await page.keyboard.press('F3');
      await wait('s.players[1].food > 10000');
      const worked = await snapshot();
      const trap = worked.entities.find((e: any) => e.kind === 'fish-trap');
      assert(trap.amount < 700 && trap.buildProgress === undefined);
      assert.equal(worked.players[1].wood, 9900);
      await look(trap.id);
      await page.waitForFunction(async id => {
        const d = await (window as any).__empiresDebug({ type: 'entities', id });
        return d.entities[0]?.layersVisible === 2;
      }, { timeout: 30_000, polling: 100 }, trap.id);
    } else {
      await look(fire.id); await select(fire.id); await rightClick(enemy.id);
      assert.deepEqual((await snapshot()).entities.find((e: any) => e.id === fire.id).order, { kind: 'attack', targetId: enemy.id });
      await page.keyboard.press('F3');
      await wait(`s.entities.find(e=>e.id===${enemy.id}).hp < 1000`);
      await page.waitForFunction(async id => {
        const s = await (window as any).__empiresDebug({ type: 'sim' });
        return s.projectileViews.some((p: any) => p.shooterId === id && p.art === 'naval-fire' && p.rendered);
      }, { timeout: 30_000, polling: 50 }, fire.id);
    }
    assert.deepEqual(errors, []);
    console.log(`NAVAL ${scenario.toUpperCase()} GREEN: real controls, imported content and observed outcome`);
    await page.close();
  }
} finally { await browser.close(); await server.close(); }
