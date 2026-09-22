/** #162: render the same fleet with per-animation URLs and shared URLs.
 * Private internal rewrites serve identical bytes at the old URLs, allowing
 * the baseline on fresh imports too. Browser mutations are presentation-only. */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import puppeteer from 'puppeteer';
import { createGame } from '../src/sim/game.ts';
import { rulesFromManifest } from '../src/sim/data.ts';
import { SNAPSHOT_VERSION } from '../src/dev-session.ts';
import type { Entity, UnitKind } from '../src/sim/types.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(readFileSync(`${root}public/imported/aoe2/manifest.json`, 'utf8'));
const legacy = structuredClone(manifest);
const aliases = new Map<string, string>();
for (const [key, entity] of Object.entries(legacy.entities) as [string, any][]) {
  for (const owner of [entity, ...(entity.annexes ?? [])]) for (const [name, atlas] of Object.entries(owner.atlases) as [string, any][]) {
    const first = `${key}/${name}.png`;
    aliases.set(`/imported/aoe2/${first}`, `/imported/aoe2/${atlas.image}`);
    atlas.image = first;
    if (atlas.pages) for (const [index, page] of atlas.pages.entries()) {
      const image = `${key}/${name}${index ? `-p${index}` : ''}.png`;
      aliases.set(`/imported/aoe2/${image}`, `/imported/aoe2/${page.image}`);
      page.image = image;
    }
  }
}
const rules = rulesFromManifest(manifest);
const state = createGame(11, rules);
state.elevation.fill(0);
const home = state.entities.find(e => e.kind === 'town-center' && e.owner === 1)!;
const at = { x: home.position.x, y: home.position.y };
state.entities = state.entities.filter(e => e.kind === 'town-center');
const ships: Entity[] = [];
for (const [index, kind] of (['cannon-galleon', 'fire-ship', 'galley', 'war-galley', 'galleon'] as UnitKind[]).entries()) {
  const r = rules.units[kind];
  assert(r, kind);
  for (const activity of ['idle', 'attacking'] as const) {
    const ship: Entity = { id: state.nextId++, kind, owner: 1,
      position: { x: at.x + index * 2, y: at.y + (activity === 'idle' ? 5 : 9) },
      hp: r.hp, maxHp: r.hp, radius: r.radius, activity, order: { kind: 'idle' } };
    ships.push(ship); state.entities.push(ship);
  }
}
const { rules: ignored, ...saved } = state;
const server = await createServer({ root, configFile: `${root}vite.config.ts`, plugins: [{
  name: 'atlas-sharing-probe', enforce: 'pre', configureServer(s) {
    s.middlewares.use((req, _res, next) => {
      req.url = aliases.get(req.url ?? '') ?? req.url;
      next();
    });
  }, transform(code, id) {
    if (!id.endsWith('/src/main.ts')) return;
    const anchor = 'renderer.setAnimationLoop(now => {';
    assert(code.includes(anchor));
    return code.replace(anchor, anchor + '\npaused = true; Object.assign(globalThis, { __sharingAssets: assets, __sharingViews: views, __sharingRenderer: renderer });');
  },
}], server: { host: '127.0.0.1', port: 5236, strictPort: true }, logLevel: 'error' });
await server.listen();
const libs = `${homedir()}/.cache/puppeteer/extra-libs/usr/lib/x86_64-linux-gnu`;
const results: any[] = [];
try {
  for (const mode of ['legacy', 'shared']) {
    const browser = await puppeteer.launch({ headless: true, env: existsSync(libs) ? { ...process.env, LD_LIBRARY_PATH: libs } : process.env,
      args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebGPU'] });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 800 });
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(String(error)));
      page.on('response', response => { if (response.url().endsWith('.png') && response.status() !== 200 && response.status() !== 304) errors.push(response.url()); });
      await page.setRequestInterception(true);
      page.on('request', req => { void (req.url().endsWith('/aoe2/manifest.json')
        ? req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(mode === 'legacy' ? legacy : manifest) })
        : req.continue()); });
      await page.evaluateOnNewDocument(snapshot => sessionStorage.setItem('open-empires-lab:dev-session', JSON.stringify(snapshot)),
        { version: SNAPSHOT_VERSION, rulesOrigin: rules.origin, state: saved });
      await page.goto('http://127.0.0.1:5236/?solo=1', { waitUntil: 'networkidle0', timeout: 120_000 });
      await page.waitForFunction(ids => ids.every(id => {
        const view = (window as any).__sharingViews?.get(`e${id}`);
        // Some hulls have no colour mask: their owner's colour is on a sail.
        return view?.body.mesh.visible && [view.body, view.color, view.shadow, ...view.annexes, ...view.annexColors]
          .every((p: any) => !p.pendingTexture);
      }), { timeout: 60_000, polling: 100 }, ships.map(s => s.id));
      const query = (q: object): Promise<any> => page.evaluate(q => (window as any).__empiresDebug(q), q);
      const snapshot = await query({ type: 'snapshot' });
      assert.equal(snapshot.tick, saved.tick, 'fixture stays at its staged tick');
      assert.equal(snapshot.entities.length, saved.entities.length, 'fixture resumed');
      await query({ type: 'look', rect: [at.x + 3, at.y + 6] });
      const drawn = (await query({ type: 'entities', id: ships[4].id })).entities[0];
      assert(drawn.screen.x > 100 && drawn.screen.x < 1180 && drawn.screen.y > 80 && drawn.screen.y < 650,
        'fleet is inside the sampled viewport');
      const sim = await query({ type: 'sim' });
      const pixels = await query({ type: 'pixels', png: true, rect: [100, 80, 1080, 570] });
      await page.evaluate(ids => { for (const id of ids) (window as any).__sharingViews.get(`e${id}`).group.visible = false; }, ships.map(s => s.id));
      const hidden = await query({ type: 'pixels', png: true, rect: [100, 80, 1080, 570] });
      assert.notEqual(pixels.png, hidden.png, 'the comparison contains actual fleet pixels');
      const residency = await page.evaluate(() => ({ ...(window as any).__sharingAssets.spriteResidency.stats,
        gpuTextures: (window as any).__sharingRenderer.info.memory.textures }));
      assert.deepEqual(errors, []);
      results.push({ mode, residency, pixels, hash: sim.synchronizationHash });
    } finally { await browser.close(); }
  }
  assert.equal(results[0].hash, results[1].hash);
  assert.deepEqual(results[0].pixels, results[1].pixels, 'all sampled sRGB pixels are unchanged by shared URLs');
  assert(results[1].residency.bytes < results[0].residency.bytes);
  assert(results[1].residency.gpuTextures < results[0].residency.gpuTextures);
  console.log('ATLAS SHARING SMOKE GREEN:', JSON.stringify(results.map(({ mode, residency }) => ({ mode, ...residency }))));
} finally { await server.close(); }
