/** Actual published-asset clicks for the five remaining Briton research nodes. */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import puppeteer from 'puppeteer';
import { rulesFromManifest, isBuilding } from '../src/sim/data.ts';
import { activateAutomaticTechnologies, createGame } from '../src/sim/game.ts';
import { updateVisibility } from '../src/sim/visibility.ts';
import { SNAPSHOT_VERSION } from '../src/dev-session.ts';
import type { Entity, UnitKind, BuildingKind } from '../src/sim/types.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const rules = rulesFromManifest(JSON.parse(readFileSync(`${root}public/imported/aoe2/manifest.json`, 'utf8')));
const state = createGame(915, rules);
state.entities = state.entities.filter(e => e.kind === 'town-center');
state.terrain = state.terrain.map(() => 0); state.elevation.fill(0);
for (let y = 30; y < 60; y++) for (let x = 30; x < 60; x++) state.terrain[y * state.width + x] = 1;
for (const p of [1, 2] as const) Object.assign(state.players[p], { age: 3, food: 10000, wood: 10000, gold: 10000, stone: 10000 });
const put = (kind: UnitKind | BuildingKind, owner: 1 | 2, x: number, y: number) => {
  const r = isBuilding(kind) ? rules.buildings[kind] : rules.units[kind];
  const e: Entity = { id: state.nextId++, kind, owner, position: { x, y }, hp: r.hp, maxHp: r.hp, radius: r.radius,
    activity: 'idle', order: { kind: 'idle' } }; state.entities.push(e); return e;
};
const market = put('market', 1, 50, 65), castle = put('castle', 1, 57, 65), university = put('university', 1, 25, 25);
const fire = put('fire-ship', 1, 40, 43), victim = put('galley', 2, 55, 43);
victim.hp = victim.maxHp = fire.hp = fire.maxHp = 10000;
const villager = put('villager', 2, 100, 100), spare = put('villager', 2, 104, 100);
activateAutomaticTechnologies(state); updateVisibility(state);
const { rules: ignored, ...saved } = state;
const keyFor = (id: number) => {
  const entry = Object.entries(rules.technologies).find(([, t]) => t.techId === id);
  assert(entry, `missing offered tech ${id}`); return entry[0];
};
const server = await createServer({ root, configFile: `${root}vite.config.ts`, logLevel: 'error',
  server: { host: '127.0.0.1', port: 5291, strictPort: true }, plugins: [{
    name: 'private-final-research-clock', enforce: 'pre', transform(code, id) {
      if (!id.endsWith('/src/main.ts')) return;
      const anchor = 'renderer.setAnimationLoop(now => {'; assert(code.includes(anchor));
      code = code.replace(anchor, `Object.assign(globalThis, { __finalStep: (n: number) => { for(let i=0;i<n;i++) stepGame(game); } });\n${anchor}\npaused = true;`);
      const end = 'for (const [key, entityView] of views) {'; assert(code.includes(end));
      return code.replace(end, `if ((globalThis as any).__hideChargeImpact) for (const p of game.projectiles) {
        if (p.impact) { const v = views.get('p' + p.id); if (v) v.body.mesh.visible = false; }
      }\n${end}`);
    },
  }] });
await server.listen();
const libs = `${homedir()}/.cache/puppeteer/extra-libs/usr/lib/x86_64-linux-gnu`;
const browser = await puppeteer.launch({ headless: true, env: existsSync(libs) ? { ...process.env, LD_LIBRARY_PATH: libs } : process.env,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebGPU'] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 800 });
  const errors: string[] = []; page.on('pageerror', e => errors.push(String(e)));
  await page.evaluateOnNewDocument(s => sessionStorage.setItem('open-empires-lab:dev-session', JSON.stringify(s)),
    { version: SNAPSHOT_VERSION, rulesOrigin: rules.origin, state: saved });
  await page.goto('http://127.0.0.1:5291/?solo=1', { waitUntil: 'networkidle0', timeout: 120000 });
  await page.waitForFunction(() => typeof (window as any).__empiresDebug === 'function');
  const query = (q: object): Promise<any> => page.evaluate(q => (window as any).__empiresDebug(q), q);
  const snapshot = () => query({ type: 'snapshot' });
  const step = (n: number) => page.evaluate(n => (window as any).__finalStep(n), n);
  const click = async (id: string) => {
    const selector = `.command-button[data-command="${id}"]`;
    await page.locator(selector).click();
  };
  const select = async (e: Entity) => { await query({ type: 'select', ids: [e.id] }); await query({ type: 'look', entity: e.id }); };
  const research = async (id: number, building: Entity) => {
    const key = keyFor(id); await select(building); await click(`research-${key}`);
    assert.equal((await snapshot()).entities.find((e: any) => e.id === building.id).researching?.tech, key);
    await step(Math.ceil(rules.technologies[key].researchSeconds * 20) + 1);
    assert((await snapshot()).players[1].researched.includes(key));
  };
  assert.equal((await snapshot()).tick, 0);
  await select(market);
  await click('exchange-buy-wood'); let s = await snapshot();
  assert.equal(s.players[1].gold, 9870); assert.equal(s.players[1].wood, 10100);
  await click('exchange-sell-wood'); s = await snapshot(); assert.equal(s.players[1].gold, 9942);
  await research(15, market);
  await page.waitForFunction(() => document.querySelector<HTMLButtonElement>('[data-command="exchange-buy-wood"]')?.title.includes('115 gold'));
  const guildGold = (await snapshot()).players[1].gold;
  await click('exchange-sell-wood'); assert.equal((await snapshot()).players[1].gold - guildGold, 85);
  for (const [tech, fee] of [[undefined, 30], [23, 20], [17, 0]] as const) {
    if (tech) await research(tech, market);
    await click('market-tribute'); const before = await snapshot(); await click('tribute-stone'); s = await snapshot();
    assert.equal(before.players[1].stone - s.players[1].stone, 100 + fee);
    assert.equal(s.players[2].stone - before.players[2].stone, 100); await click('market-back');
  }
  await select(castle); const spies = keyFor(408);
  await page.waitForFunction(key => document.querySelector<HTMLButtonElement>(`[data-command="research-${key}"]`)?.title.includes('400 gold'), {}, spies);
  assert(!(await query({ type: 'entities', id: villager.id })).entities[0].rendered);
  await query({ type: 'command', command: { kind: 'delete', player: 2, entityIds: [spare.id] } });
  await page.waitForFunction(key => document.querySelector<HTMLButtonElement>(`[data-command="research-${key}"]`)?.title.includes('200 gold'), {}, spies);
  const spyGold = (await snapshot()).players[1].gold; await research(408, castle);
  assert.equal(spyGold - (await snapshot()).players[1].gold, 200);
  await query({ type: 'look', entity: villager.id });
  await page.waitForFunction(async id => (await (window as any).__empiresDebug({ type: 'entities', id })).entities[0]?.rendered, {}, villager.id);
  await research(909, university);
  await query({ type: 'command', command: { kind: 'order', player: 2, entityIds: [victim.id], target: { x: 43, y: 43 } } });
  let shot: any;
  for (let i = 0; i < 100 && !shot; i++) { await step(5); shot = (await snapshot()).projectiles.find((p: any) => p.art === 'fire-charge'); }
  assert(shot, 'ready Siphons charge actually launches');
  await query({ type: 'command', command: { kind: 'stop', player: 1, entityIds: [fire.id] } });
  for (let i = 0; i < 100 && !shot.impact; i++) {
    await step(1); shot = (await snapshot()).projectiles.find((p: any) => p.id === shot.id); assert(shot);
  }
  assert.equal(shot.impact.effect, 'impact_grenade'); await step(5);
  await query({ type: 'look', rect: [shot.position.x, shot.position.y, 0, 0] });
  await page.waitForFunction(async id => (await (window as any).__empiresDebug({ type: 'sim' })).projectileViews
    .some((p: any) => p.id === id && p.rendered && p.animation?.includes('/impact/impact_grenade')), {}, shot.id);
  await page.waitForNetworkIdle({ idleTime: 500, timeout: 30000 });
  const rect = [600, 350, 80, 80];
  const on = await query({ type: 'pixels', rect }); assert.equal(on.colorSpace, 'srgb');
  const a = await query({ type: 'pixels', rect, png: true });
  await page.evaluate(() => { (window as any).__hideChargeImpact = true; });
  await page.waitForFunction(async id => !(await (window as any).__empiresDebug({ type: 'sim' })).projectileViews.find((p: any) => p.id === id)?.rendered, {}, shot.id);
  const b = await query({ type: 'pixels', rect, png: true });
  const changed = await page.evaluate(async ({ a, b }) => {
    const [x, y] = await Promise.all([a, b].map(async png => {
      const image = new Image(); image.src = `data:image/png;base64,${png}`; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0); return ctx.getImageData(0, 0, image.width, image.height).data;
    }));
    let count = 0;
    for (let i = 0; i < x.length; i += 4) if (Math.abs(x[i] - y[i]) + Math.abs(x[i + 1] - y[i + 1]) + Math.abs(x[i + 2] - y[i + 2]) > 10) count++;
    return count;
  }, { a: a.png, b: b.png });
  assert(changed > 10, `owned grenade impact changes ${changed} sRGB pixels`);
  assert.deepEqual(errors, []);
  console.log(`BRITON FINAL SMOKE GREEN: all five research buttons, buy/sell/tribute payments, live Spies price/reveal, Siphons flight/impact (${changed} sRGB pixels)`);
} finally { await browser.close(); await server.close(); }
