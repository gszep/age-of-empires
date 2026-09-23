/** #176: real build buttons/previews/clicks reject a steep site and accept a ramp. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import { SNAPSHOT_VERSION } from '../src/dev-session.ts';
import { FALLBACK_RULES, rulesFromManifest } from '../src/sim/data.ts';
import { createGame, placementLegal } from '../src/sim/game.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const fallback = process.env.OPEN_FALLBACK === '1';
const rules = fallback ? FALLBACK_RULES
  : rulesFromManifest(JSON.parse(readFileSync(`${root}public/imported/aoe2/manifest.json`, 'utf8')));
const state = createGame(176, rules);
state.entities = state.entities.filter(e => e.owner !== 0);
state.terrain.fill(0);
state.elevation.fill(0);
state.players[1].wood = 5000;
const worker = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
worker.position = { x: 36.5, y: 58.5 };
const steep = { x: 34.5, y: 54.5 }, ramp = { x: 38.5, y: 54.5 };
for (let y = 53; y <= 55; y++) {
  state.elevation[y * state.width + 33] = 2;
  state.elevation[y * state.width + 37] = 1;
}
assert.equal(placementLegal(state, 'barracks', steep).ok, false);
assert.equal(placementLegal(state, 'barracks', ramp).ok, true);
const { rules: ignored, ...saved } = state;
const server = await createServer({ root, configFile: `${root}vite.config.ts`, plugins: [{
  name: 'placement-relief-probe', enforce: 'pre', transform(code, id) {
    if (!id.endsWith('/src/main.ts')) return;
    const anchor = 'renderer.setAnimationLoop(now => {';
    assert(code.includes(anchor));
    // Read-only presentation accessors; public input still performs every build.
    return code.replace(anchor, anchor + `
      paused = true;
      Object.assign(globalThis, { __placementRelief: {
        preview: () => ({ target: placementTarget(), kind: buildMode,
          tint: ghostFootprint?.material.color.getHex() }),
        screen: (at) => {
          const iso = elevatedWorldToIso(game, at.x, at.y);
          const p = new THREE.Vector3(iso.x, iso.y, 0).project(camera);
          return { x: (p.x + 1) * innerWidth / 2, y: (1 - p.y) * innerHeight / 2 };
        },
      } });`);
  },
}], server: { host: '127.0.0.1', port: 5241, strictPort: true }, logLevel: 'error' });
await server.listen();
const libs = `${homedir()}/.cache/puppeteer/extra-libs/usr/lib/x86_64-linux-gnu`;
const browser = await puppeteer.launch({ headless: true,
  env: existsSync(libs) ? { ...process.env, LD_LIBRARY_PATH: libs } : process.env,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebGPU'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  if (fallback) {
    await page.setRequestInterception(true);
    page.on('request', req => { void (req.url().includes('/imported/') ? req.respond({ status: 404, body: '' }) : req.continue()); });
  }
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.evaluateOnNewDocument(snapshot => sessionStorage.setItem('open-empires-lab:dev-session', JSON.stringify(snapshot)),
    { version: SNAPSHOT_VERSION, rulesOrigin: rules.origin, state: saved });
  await page.goto('http://127.0.0.1:5241/?solo=1', { waitUntil: 'networkidle0', timeout: 120_000 });
  await page.waitForFunction(() => !!(window as any).__placementRelief, { timeout: 120_000 });
  const query = (q: object): Promise<any> => page.evaluate(q => (window as any).__empiresDebug(q), q);
  const snapshot = await query({ type: 'snapshot' });
  assert.equal(snapshot.elevation[53 * state.width + 33], 2, 'fixture resumed');
  assert.equal(snapshot.players[1].wood, 5000, 'fixture resources resumed');
  await query({ type: 'select', ids: [worker.id] });
  await page.locator('[data-command="page-military"]').click();
  const before = await query({ type: 'sim' });
  for (const [target, tint, legal] of [[steep, 0xff5f5f, false], [ramp, 0x7fff9e, true]] as const) {
    await page.locator('[data-command="build-barracks"]').click();
    const screen = await page.evaluate(at => (window as any).__placementRelief.screen(at), target);
    await page.mouse.move(screen.x, screen.y);
    await page.waitForFunction(({ target, tint }) => {
      const p = (window as any).__placementRelief.preview();
      return p.kind === 'barracks' && p.tint === tint && p.target.x === target.x && p.target.y === target.y;
    }, { timeout: 30_000 }, { target, tint });
    assert.equal((await query({ type: 'sim' })).synchronizationHash, before.synchronizationHash,
      'hover/preview does not mutate authoritative state');
    await page.mouse.click(screen.x, screen.y);
    const after = await query({ type: 'snapshot' });
    assert.equal(after.entities.filter((e: any) => e.kind === 'barracks').length, legal ? 1 : 0);
    assert.equal(after.players[1].wood, legal ? 5000 - rules.buildings.barracks.cost.wood : 5000);
    if (!legal) {
      assert.equal((await query({ type: 'sim' })).synchronizationHash, before.synchronizationHash);
      assert(await page.evaluate(() => document.body.textContent?.includes('placement is on unsuitable elevation')));
    } else {
      const foundation = after.entities.find((e: any) => e.kind === 'barracks');
      assert.deepEqual(foundation.position, ramp);
      // Command completion can precede the next presentation frame, especially
      // in fallback mode where there is no asset-fetch await to hide the race.
      await page.waitForFunction(async id => {
        const reply = await (window as any).__empiresDebug({ type: 'entities', id });
        return reply.entities[0]?.rendered;
      }, { timeout: 30_000, polling: 100 }, foundation.id);
    }
  }
  assert.deepEqual(errors, []);
  console.log(`ELEVATION PLACEMENT SMOKE GREEN (${fallback ? 'fallback' : 'imported'}): red steep preview/rejected click/no spend; green ramp preview/paid rendered foundation`);
} finally { await browser.close(); await server.close(); }
