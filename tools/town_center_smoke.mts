/** #177: press the economic TC button and place/finish a replacement or expansion. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import { activateAutomaticTechnologies, createGame, placementLegal } from '../src/sim/game.ts';
import { buildingRulesFor } from '../src/sim/rules.ts';
import { FALLBACK_RULES, rulesFromManifest } from '../src/sim/data.ts';
import { SNAPSHOT_VERSION } from '../src/dev-session.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const path = `${root}public/imported/aoe2/manifest.json`;
const manifest = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined;
// Exercise freshly extracted construction metadata without publishing a partial
// manifest or regenerating atlases. All art remains from the installed import.
if (manifest && process.env.TC_CONTENT) {
  const fresh = JSON.parse(readFileSync(process.env.TC_CONTENT, 'utf8')).entities['town-center'];
  Object.assign(manifest.entities['town-center'], { build: fresh.build, cost: fresh.cost });
}
const rules = manifest ? rulesFromManifest(manifest) : FALLBACK_RULES;
const override = manifest && process.env.TC_CONTENT ? gzipSync(JSON.stringify(manifest)) : undefined;
const server = await createServer({ root, configFile: `${root}vite.config.ts`, plugins: [{
  name: 'town-center-preview-probe', enforce: 'pre',
  configureServer(server) {
    if (!override) return;
    server.middlewares.use((req, res, next) => {
      if (req.url?.split('?')[0] !== '/imported/aoe2/manifest.json') return next();
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' });
      res.end(override);
    });
  }, transform(code, id) {
    if (!id.endsWith('/src/main.ts')) return;
    const anchor = 'renderer.setAnimationLoop(now => {';
    assert(code.includes(anchor));
    // Read-only presentation accessor: placement still uses real input.
    return code.replace(anchor, anchor + `
      Object.assign(globalThis, { __townCenterScreen: (at) => {
        const iso = elevatedWorldToIso(game, at.x, at.y);
        const p = new THREE.Vector3(iso.x, iso.y, 0).project(camera);
        return { x: (p.x + 1) * innerWidth / 2, y: (1 - p.y) * innerHeight / 2 };
      }, __townCenterPreview: () => ({
        target: placementTarget(), kind: buildMode,
        tint: ghostFootprint?.material.color.getHex(),
      }) });`);
  },
}],
  server: { host: '127.0.0.1', port: 5247, strictPort: true }, logLevel: 'error' });
await server.listen();
const libs = `${homedir()}/.cache/puppeteer/extra-libs/usr/lib/x86_64-linux-gnu`;
const browser = await puppeteer.launch({ headless: true, env: existsSync(libs) ? { ...process.env, LD_LIBRARY_PATH: libs } : process.env,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebGPU'] });
try {
  for (const age of [0, 2]) {
    const state = createGame(177, rules);
    state.entities = state.entities.filter(e => e.owner !== 0);
    state.terrain.fill(0); state.elevation.fill(0);
    state.players[1].age = age;
    activateAutomaticTechnologies(state);
    const paidWood = buildingRulesFor(state, 1, 'town-center').cost.wood;
    state.players[1].wood = state.players[1].stone = 2000;
    const home = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
    const worker = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
    worker.position = { x: 42.5, y: 40.5 };
    assert(placementLegal(state, 'town-center', { x: 40, y: 40 }).ok);
    state.elevation[39 * state.width + 39] = 1;
    const { rules: ignored, ...saved } = state;
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.evaluateOnNewDocument(snapshot => sessionStorage.setItem('open-empires-lab:dev-session', JSON.stringify(snapshot)),
      { version: SNAPSHOT_VERSION, rulesOrigin: rules.origin, state: saved });
    await page.goto('http://127.0.0.1:5247/?solo=1', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof (window as any).__empiresDebug === 'function', { timeout: 120_000, polling: 100 });
    const query = (q: object): Promise<any> => page.evaluate(q => (window as any).__empiresDebug(q), q);
    const hover = async (target: { x: number; y: number }, tint: number) => {
      await query({ type: 'look', rect: [target.x, target.y] });
      // look updates cameraCenter; panCamera applies it on the next frame.
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      const screen = await page.evaluate(at => (window as any).__townCenterScreen(at), target);
      await page.mouse.move(screen.x, screen.y);
      try {
        await page.waitForFunction(({ target, tint }) => {
          const p = (window as any).__townCenterPreview();
          return p.kind === 'town-center' && p.target.x === target.x && p.target.y === target.y && p.tint === tint;
        }, {}, { target, tint });
      } catch (error) {
        console.error({ target, tint, screen, preview: await page.evaluate(() => (window as any).__townCenterPreview()) });
        throw error;
      }
      return screen;
    };
    const click = async (command: string) => {
      const selector = `.command-button[data-command="${command}"]`;
      await page.locator(selector).click();
    };
    await page.keyboard.press('F3');
    assert.equal((await query({ type: 'snapshot' })).players[1].wood, 2000, 'fixture resumed');
    assert.equal((await query({ type: 'snapshot' })).players[1].age, age);
    await query({ type: 'select', ids: [worker.id] });
    await click('page-economic');
    if (age === 0) {
      assert.equal(await page.$('.command-button[data-command="build-town-center"]'), null);
      assert((await query({ type: 'command', command: { kind: 'delete', player: 1, entityIds: [home.id] } })).ok);
    }
    await click('build-town-center');
    // The first real placement click is on the sloped footprint: no payment.
    const slope = await hover({ x: 40, y: 40 }, 0xff5f5f);
    await page.mouse.click(slope.x, slope.y);
    assert.equal((await query({ type: 'snapshot' })).players[1].wood, 2000);
    await click('build-town-center');
    const flat = await hover({ x: 48, y: 40 }, 0x7fff9e);
    await page.mouse.click(flat.x, flat.y);
    const placed = await query({ type: 'snapshot' });
    const site = placed.entities.find((e: any) => e.kind === 'town-center' && e.owner === 1 && e.buildProgress !== undefined);
    assert(site, `age ${age}: button and map click placed a foundation`);
    assert.equal(placed.players[1].wood, 2000 - paidWood);
    assert.equal(placed.players[1].stone, 1900);
    const cap = placed.players[1].populationCap;
    if (age === 0) {
      await page.waitForFunction(() => !document.querySelector('.command-button[data-command="build-town-center"]'));
      const blocked = await query({ type: 'command', command: { kind: 'build', player: 1,
        builderIds: [worker.id], building: 'town-center', target: { x: 56, y: 40 } } });
      assert.equal(blocked.ok, false, 'foundation consumes replacement slot');
    }
    for (let i = 0; i < 6; i++) await page.keyboard.press('+');
    await page.keyboard.press('F3');
    await page.waitForFunction(async id => {
      const state = await (window as any).__empiresDebug({ type: 'snapshot' });
      return state.entities.some((e: any) => e.id === id && e.buildProgress === undefined);
    }, { timeout: 120_000, polling: 100 }, site.id);
    await page.keyboard.press('F3');
    const complete = await query({ type: 'snapshot' });
    assert.equal(complete.players[1].populationCap, cap + 5);
    await query({ type: 'look', entity: site.id });
    await query({ type: 'select', ids: [site.id] });
    await click('train-villager');
    const trained = await query({ type: 'snapshot' });
    assert(trained.entities.find((e: any) => e.id === site.id).training,
      JSON.stringify({ age, player: trained.players[1], site: trained.entities.find((e: any) => e.id === site.id),
        hud: await page.evaluate(() => document.body.innerText) }));
    assert((await query({ type: 'entities', id: site.id })).entities[0].rendered);
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(`TOWN CENTER SMOKE GREEN (${rules.origin}): replacement and expansion buttons, sloped rejection, paid placement, foundation limit, completion, population and training`);
} finally { await browser.close(); await server.close(); }
