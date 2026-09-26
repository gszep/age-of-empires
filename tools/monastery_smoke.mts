import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import { SNAPSHOT_VERSION } from '../src/dev-session.ts';
import { rulesFromManifest } from '../src/sim/data.ts';
import { activateAutomaticTechnologies, createGame } from '../src/sim/game.ts';
import { addRelic } from '../src/sim/relics.ts';
import { updateVisibility } from '../src/sim/visibility.ts';
import type { Entity } from '../src/sim/types.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = `${root}.local/monastery-fixture`;
const base = process.env.RELIC_BASE_ASSETS ?? `${root}public/imported`;
const useFixture = process.env.RELIC_FIXTURE === '1';
const manifest = JSON.parse(readFileSync(useFixture ? `${fixture}/manifest.json` : `${base}/aoe2/manifest.json`, 'utf8'));
const rules = rulesFromManifest(manifest), state = createGame(130, rules);
state.terrain.fill(0); state.elevation.fill(0);
state.entities = state.entities.filter(e => e.kind === 'town-center');
const monk: Entity = { id: state.nextId++, kind: 'monk', owner: 1, position: { x: 50, y: 50 },
  hp: 30, maxHp: 30, radius: .2, activity: 'idle', order: { kind: 'idle' } };
const home: Entity = { id: state.nextId++, kind: 'monastery', owner: 1, position: { x: 57, y: 50 },
  hp: 2100, maxHp: 2100, radius: 1.5, activity: 'idle', order: { kind: 'idle' } };
state.entities.push(monk, home);
const castle: Entity = { id: state.nextId++, kind: 'castle', owner: 1, position: { x: 50, y: 65 },
  hp: 4800, maxHp: 4800, radius: 2, activity: 'idle', order: { kind: 'idle' } };
const engine: Entity = { id: state.nextId++, kind: 'trebuchet', owner: 1, position: { x: 70, y: 50 },
  hp: 150, maxHp: 150, radius: .5, activity: 'idle', order: { kind: 'idle' } };
const targets: Entity[] = [0, .6].map(offset => ({ id: state.nextId++, kind: 'villager', owner: 2,
  position: { x: 80, y: 50 + offset }, hp: 40, maxHp: 40, radius: .2,
  activity: 'idle', order: { kind: 'idle' } }));
state.entities.push(castle, engine, ...targets);
state.players[1].age = 3; state.players[1].food = state.players[1].gold = state.players[1].wood = 2000;
activateAutomaticTechnologies(state);
const relic = addRelic(state, { x: 52, y: 50 }); updateVisibility(state);
const { rules: omitted, ...saved } = state;
const metadata = gzipSync(JSON.stringify(manifest));
const server = await createServer({ root, configFile: `${root}vite.config.ts`, logLevel: 'error',
  server: { host: '127.0.0.1', port: 5287, strictPort: true }, plugins: [{
    name: 'private-monastery-fixture', enforce: 'pre',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0];
        if (url === '/imported/aoe2/manifest.json') {
          res.setHeader('Content-Type', 'application/json'); res.setHeader('Content-Encoding', 'gzip');
          res.end(metadata); return;
        }
        const path = url.includes('/monastery-fixture/') ? `${fixture}/${url.split('/monastery-fixture/')[1]}`
          : url.startsWith('/imported/') ? `${base}/${url.slice(10)}` : undefined;
        if (!path || !existsSync(path)) { next(); return; }
        if (path.endsWith('.png')) res.setHeader('Content-Type', 'image/png');
        if (path.endsWith('.json')) res.setHeader('Content-Type', 'application/json');
        res.end(readFileSync(path));
      });
    },
    transform(code, id) {
      if (!id.endsWith('/src/main.ts')) return;
      const anchor = 'renderer.setAnimationLoop(now => {'; assert(code.includes(anchor));
      return code.replace(anchor, `Object.assign(globalThis, { __monasteryStep: (n: number) => { for (let i=0;i<n;i++) stepGame(game); } });\n${anchor}\npaused = true;`);
    },
  }] });
await server.listen();
const libs = `${homedir()}/.cache/puppeteer/extra-libs/usr/lib/x86_64-linux-gnu`;
const browser = await puppeteer.launch({ headless: true,
  env: existsSync(libs) ? { ...process.env, LD_LIBRARY_PATH: libs } : process.env,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebGPU'] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 800 });
  const errors: string[] = []; page.on('pageerror', e => errors.push(String(e)));
  await page.evaluateOnNewDocument(snapshot => sessionStorage.setItem('open-empires-lab:dev-session', JSON.stringify(snapshot)),
    { version: SNAPSHOT_VERSION, rulesOrigin: rules.origin, state: saved });
  await page.goto('http://127.0.0.1:5287/?solo=1', { waitUntil: 'networkidle0', timeout: 120_000 });
  await page.waitForFunction(() => typeof (window as any).__empiresDebug === 'function');
  const query = (q: object): Promise<any> => page.evaluate(q => (window as any).__empiresDebug(q), q);
  const step = (n: number) => page.evaluate(n => (window as any).__monasteryStep(n), n);
  assert.equal((await query({ type: 'sim' })).tick, 0);
  await query({ type: 'look', entity: relic.id });
  await page.waitForFunction(async id => (await (window as any).__empiresDebug({ type: 'entities', id })).entities[0]?.bodyVisible, {}, relic.id);
  const drawn = (await query({ type: 'entities', id: relic.id })).entities[0];
  await page.mouse.click(drawn.screen.x, drawn.screen.y);
  assert.deepEqual((await query({ type: 'sim' })).selected, [relic.id]);
  await query({ type: 'select', ids: [monk.id] });
  await page.mouse.click(drawn.screen.x, drawn.screen.y, { button: 'right' }); await step(60);
  await query({ type: 'look', entity: monk.id });
  await page.waitForFunction(async id => {
    const e = (await (window as any).__empiresDebug({ type: 'entities', id })).entities[0];
    return e?.bodyVisible && e.animation?.includes('monk-relic');
  }, {}, monk.id);
  const carrier = (await query({ type: 'entities', id: monk.id })).entities[0];
  const pixels = await query({ type: 'pixels', rect: [carrier.screen.x - 30, carrier.screen.y - 65, 60, 70], match: '#2020b0', tolerance: 48 });
  assert.equal(pixels.colorSpace, 'srgb'); assert(pixels.matched > 5);
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLButtonElement>('.command-button')].some(b => /Drop Relic/.test(b.title)));
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('.command-button')].find(b => /Drop Relic/.test(b.title))!.click());
  let snapshot = await query({ type: 'snapshot' });
  assert(snapshot.entities.some((e: any) => e.id === relic.id));
  assert(!snapshot.entities.find((e: any) => e.id === monk.id).relics);
  await query({ type: 'command', command: { kind: 'order', player: 1, entityIds: [monk.id], targetId: relic.id, target: snapshot.entities.find((e: any) => e.id === relic.id).position } });
  await step(1200); snapshot = await query({ type: 'snapshot' });
  assert.equal(snapshot.entities.find((e: any) => e.id === home.id).relics[0].id, relic.id);
  assert(snapshot.players[1].gold > 2000);
  await query({ type: 'select', ids: [home.id] });
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLButtonElement>('.command-button')].some(b => /Devotion/.test(b.title) && !b.disabled));
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('.command-button')].find(b => /Devotion/.test(b.title))!.click());
  await step(801); assert((await query({ type: 'snapshot' })).players[1].researched.includes('devotion'));
  await query({ type: 'select', ids: [castle.id] });
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLButtonElement>('.command-button')].some(b => /Warwolf/.test(b.title) && !b.disabled));
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('.command-button')].find(b => /Warwolf/.test(b.title))!.click());
  await page.waitForFunction(async id => (await (window as any).__empiresDebug({ type: 'snapshot' })).entities.find((e: any) => e.id === id)?.researching?.tech === 'warwolf', {}, castle.id);
  await step(801);
  assert((await query({ type: 'snapshot' })).players[1].researched.includes('warwolf'));
  await query({ type: 'command', command: { kind: 'pack', player: 1, entityIds: [engine.id], unpacked: true } });
  await step(300);
  await query({ type: 'command', command: { kind: 'order', player: 1, entityIds: [engine.id], targetId: targets[0].id, target: targets[0].position } });
  await step(150);
  snapshot = await query({ type: 'snapshot' });
  console.log('Warwolf impact state', JSON.stringify({ engine: snapshot.entities.find((e: any) => e.id === engine.id),
    targets: snapshot.entities.filter((e: any) => targets.some(t => t.id === e.id)), projectiles: snapshot.projectiles }));
  assert(snapshot.entities.find((e: any) => e.id === targets[1].id)?.hp < targets[1].hp, 'Warwolf must damage the neighbouring villager');
  console.log('Warwolf GREEN: actual castle research button, public unpack/attack, bystander damage');
  assert.deepEqual(errors, []);
  console.log(`MONASTERY SMOKE GREEN: relic/carry art (${pixels.matched} blue sRGB pixels), real Drop Relic, deposit/income, real Devotion`);
} finally { await browser.close(); await server.close(); }
