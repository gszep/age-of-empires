/** Mixed-rule plumbing through the real page; synthetic profile, not Frankish fidelity. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import { SNAPSHOT_VERSION } from '../src/dev-session.ts';
import { rulesFromManifest } from '../src/sim/data.ts';
import { createGame, placementLegal } from '../src/sim/game.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(readFileSync(`${root}public/imported/aoe2/manifest.json`, 'utf8'));
const profile = structuredClone({
  civilization: { ...manifest.civilization, key: 'fixture-other', name: 'Fixture Other' },
  entities: Object.fromEntries(Object.entries(manifest.entities).map(([key, value]: [string, any]) => {
    const { atlases, ...data } = value;
    return [key, data];
  })),
  technologies: { loom: manifest.technologies.loom },
  playerAttributes: manifest.playerAttributes,
  terrainRestrictions: manifest.terrainRestrictions,
});
profile.entities.villager.cost.food = 75;
profile.entities.villager.hitPoints = 80;
profile.entities.villager.train.seconds = 1;
profile.entities.house.cost.wood = 7;
profile.entities.house.collision = [0.5, 0.5];
profile.civilization.unavailable.units.push(profile.entities.militia.id);
manifest.civilizations = { 'fixture-other': profile };
const rules = rulesFromManifest(manifest);
const state = createGame(122, rules, { 1: 'fixture-other', 2: rules.civilization.key });
state.entities = state.entities.filter(e => e.owner !== 0);
state.terrain.fill(0);
state.elevation.fill(0);
state.players[1].food = state.players[1].wood = 5000;
const worker = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
const tc = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
const barracks = { id: state.nextId++, kind: 'barracks' as const, owner: 1 as const,
  position: { x: 35.5, y: 63.5 }, hp: 1200, maxHp: 1200, radius: 1.5,
  activity: 'idle' as const, order: { kind: 'idle' as const } };
state.entities.push(barracks);
const target = { x: 36.5, y: 56.5 };
assert(placementLegal(state, 'house', target, 'x', 1).ok);
const { rules: ignored, ...saved } = state;
const server = await createServer({ root, configFile: `${root}vite.config.ts`, plugins: [{
  name: 'civilization-rule-probe', enforce: 'pre', transform(code, id) {
    if (!id.endsWith('/src/main.ts')) return;
    assert(code.includes('let paused = false;'));
    const anchor = 'renderer.setAnimationLoop(now => {';
    assert(code.includes(anchor));
    return code.replace('let paused = false;', 'let paused = true;').replace(anchor, anchor + `
      Object.assign(globalThis, { __civilizationProbe: {
        screen: (at) => {
          const iso = elevatedWorldToIso(game, at.x, at.y);
          const p = new THREE.Vector3(iso.x, iso.y, 0).project(camera);
          return { x: (p.x + 1) * innerWidth / 2, y: (1 - p.y) * innerHeight / 2 };
        },
        preview: () => ({ kind: buildMode, target: placementTarget(), radius: ghostEntity('house', placementTarget()).radius }),
      } });`);
  },
}], server: { host: '127.0.0.1', port: 5263, strictPort: true }, logLevel: 'error' });
await server.listen();
const libs = `${homedir()}/.cache/puppeteer/extra-libs/usr/lib/x86_64-linux-gnu`;
const browser = await puppeteer.launch({ headless: true,
  env: existsSync(libs) ? { ...process.env, LD_LIBRARY_PATH: libs } : process.env,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebGPU'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.setRequestInterception(true);
  const body = JSON.stringify(manifest);
  page.on('request', request => { void (new URL(request.url()).pathname === '/imported/aoe2/manifest.json'
    ? request.respond({ status: 200, contentType: 'application/json', body }) : request.continue()); });
  await page.evaluateOnNewDocument(snapshot => sessionStorage.setItem('open-empires-lab:dev-session', JSON.stringify(snapshot)),
    { version: SNAPSHOT_VERSION, rulesOrigin: rules.origin, state: saved });
  await page.goto('http://127.0.0.1:5263/?solo=1', { waitUntil: 'networkidle0', timeout: 120_000 });
  await page.waitForFunction(() => !!(window as any).__civilizationProbe, { timeout: 120_000 });
  const query = (q: object): Promise<any> => page.evaluate(q => (window as any).__empiresDebug(q), q);
  const initial = await query({ type: 'snapshot' });
  assert.equal(initial.players[1].civilization, 'fixture-other', 'mixed snapshot resumed');
  assert.equal(initial.players[2].civilization, rules.civilization.key);
  assert.equal(initial.entities.find((e: any) => e.id === worker.id).maxHp, 80);
  await query({ type: 'select', ids: [tc.id] });
  await page.waitForSelector('[data-command="train-villager"]');
  assert.match(await page.$eval('[data-command="train-villager"]', e => e.getAttribute('title') ?? ''), /75/);
  assert.equal(await page.$('[data-command="research-feudal-age"]'), null, 'opponent research does not leak into the command grid');
  await page.locator('[data-command="train-villager"]').click();
  const queued = await query({ type: 'snapshot' });
  assert.equal(queued.players[1].food, 4925);
  assert.equal(queued.players[2].food, initial.players[2].food);
  await page.keyboard.press('F3');
  await page.waitForFunction(async () => {
    const s = await (window as any).__empiresDebug({ type: 'snapshot' });
    return s.entities.filter((e: any) => e.owner === 1 && e.kind === 'villager').length === 4;
  }, { timeout: 30_000 });
  await page.keyboard.press('F3');
  const trained = await query({ type: 'snapshot' });
  assert.equal(trained.entities.filter((e: any) => e.owner === 1 && e.kind === 'villager').at(-1).maxHp, 80);
  await query({ type: 'select', ids: [barracks.id] });
  await page.waitForFunction(() => !document.querySelector('[data-command="train-villager"]'));
  assert.equal(await page.$('[data-command="train-militia"]'), null, 'unavailable unit is not offered');
  const refused = await query({ type: 'command', command: { kind: 'train', player: 1, buildingId: barracks.id, unit: 'militia' } });
  assert.equal(refused.ok, false);
  await query({ type: 'select', ids: [worker.id] });
  await page.locator('[data-command="page-economic"]').click();
  await page.waitForSelector('[data-command="build-house"]');
  assert.match(await page.$eval('[data-command="build-house"]', e => e.getAttribute('title') ?? ''), /7/);
  const before = await query({ type: 'snapshot' });
  await page.locator('[data-command="build-house"]').click();
  const screen = await page.evaluate(at => (window as any).__civilizationProbe.screen(at), target);
  await page.mouse.move(screen.x, screen.y);
  await page.waitForFunction(at => {
    const p = (window as any).__civilizationProbe.preview();
    return p.kind === 'house' && p.radius === 0.5 && p.target.x === at.x && p.target.y === at.y;
  }, {}, target);
  await page.mouse.click(screen.x, screen.y);
  const built = await query({ type: 'snapshot' });
  assert.equal(built.players[1].wood, before.players[1].wood - 7);
  assert.equal(built.entities.find((e: any) => e.owner === 1 && e.kind === 'house').radius, 0.5);
  assert.deepEqual(errors, []);
  console.log('CIVILIZATION RULES SMOKE GREEN: mixed manifest + resumed selection, owner-specific prices/availability/HP, real training and build clicks, correct preview footprint');
} finally { await browser.close(); await server.close(); }
