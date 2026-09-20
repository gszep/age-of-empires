/** #88: delay the owned tree shadow sheet until the tree is a fog snapshot,
 * then prove that it arrives in the cached view and darkens real sRGB pixels.
 * A private-server transform exposes view handles for the render comparison;
 * the match itself is staged once, then driven only through public commands. */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import puppeteer, { type HTTPRequest } from 'puppeteer';
import { createGame } from '../src/sim/game.ts';
import { rulesFromManifest } from '../src/sim/data.ts';
import { SNAPSHOT_VERSION } from '../src/dev-session.ts';
import { worldToIso } from '../src/view/iso.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(readFileSync(`${root}public/imported/aoe2/manifest.json`, 'utf8'));
const rules = rulesFromManifest(manifest);
const state = createGame(42, rules);
const variants = manifest.entities['tree-oak'].atlases.idle.framesInFile;
const tree = state.entities.find(e => e.resourceKind === 'wood' && e.id % variants === 0)!;
const scout = state.entities.find(e => e.kind === 'scout-cavalry' && e.owner === 1)!;
assert(tree && scout);
tree.position = { x: 50, y: 50 };
scout.position = { x: 50, y: 51 };
state.elevation.fill(0);
state.entities = state.entities.filter(e => e.kind === 'town-center' || e.id === tree.id || e.id === scout.id);
const { rules: ignored, ...saved } = state;
const server = await createServer({ root, configFile: `${root}vite.config.ts`, plugins: [{
  name: 'tree-shadow-probe', enforce: 'pre', transform(code, id) {
    if (!id.endsWith('/src/dev-debug.ts')) return;
    const anchor = 'const hot = import.meta.hot!;';
    assert(code.includes(anchor), 'probe must expose the real debug view context');
    return code.replace(anchor, 'Object.assign(globalThis, { __treeContext: context }); ' + anchor);
  },
}], server: { host: '127.0.0.1', port: 5215, strictPort: true }, logLevel: 'error' });
await server.listen();
const libs = `${homedir()}/.cache/puppeteer/extra-libs/usr/lib/x86_64-linux-gnu`;
const browser = await puppeteer.launch({ headless: true, env: existsSync(libs) ? { ...process.env, LD_LIBRARY_PATH: libs } : process.env,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebGPU'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  const held: HTTPRequest[] = [];
  let holdShadow = true;
  const shadowPath = `/imported/aoe2/${manifest.entities['tree-oak'].atlases['idle-shadow'].image}`;
  await page.setRequestInterception(true);
  page.on('request', request => {
    if (holdShadow && request.url().endsWith(shadowPath)) held.push(request);
    else void request.continue();
  });
  await page.evaluateOnNewDocument(snapshot => sessionStorage.setItem('open-empires-lab:dev-session', JSON.stringify(snapshot)),
    { version: SNAPSHOT_VERSION, rulesOrigin: rules.origin, state: saved });
  await page.goto('http://127.0.0.1:5215/?solo=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window as any).__treeContext, { timeout: 120_000, polling: 100 });
  const query = (q: object): Promise<any> => page.evaluate(q => (window as any).__empiresDebug(q), q);
  assert((await query({ type: 'snapshot' })).entities.some((e: any) => e.id === tree.id && e.position.x === 50), 'fixture resumed');
  await query({ type: 'look', entity: tree.id });
  await page.waitForFunction(id => (window as any).__treeContext.views.get(`e${id}`)?.body.mesh.visible,
    { timeout: 30_000, polling: 100 }, tree.id);
  assert(held.length > 0, 'the shadow load is actually delayed');
  await page.waitForFunction(id => (window as any).__treeContext.views.get(`e${id}`)?.body.mesh.visible,
    { timeout: 30_000, polling: 100 }, scout.id);
  const drawnScout = (await query({ type: 'entities', id: scout.id })).entities[0];
  await page.mouse.click(drawnScout.screen.x, drawnScout.screen.y);
  assert((await query({ type: 'sim' })).selected.includes(scout.id));
  for (let i = 0; i < 6; i++) await page.keyboard.press('+');
  const destination = { x: tree.position.x - rules.units['scout-cavalry'].lineOfSight - 3, y: tree.position.y };
  const target = worldToIso(destination.x, destination.y);
  const center = await page.evaluate(() => ({ at: (window as any).__treeContext.cameraCenter(), zoom: (window as any).__treeContext.zoom() }));
  const click = { x: 640 + (target.x - center.at.x) * center.zoom, y: 400 - (target.y - center.at.y) * center.zoom };
  assert(click.x > 20 && click.x < 1260 && click.y > 60 && click.y < 650, 'departure target is inside the battlefield');
  await page.mouse.click(click.x, click.y, { button: 'right' });
  await page.waitForFunction(id => (window as any).__treeContext.views.has(`m${id}`), { timeout: 30_000, polling: 100 }, tree.id);
  await page.keyboard.press('F3');
  const frozen = () => page.evaluate(id => {
    const view = (window as any).__treeContext.views.get(`m${id}`);
    return { body: view.body.mesh.visible, shadow: view.shadow.mesh.visible,
      animation: view.animationState, frame: view.frameIndex,
      position: view.shadow.mesh.position.toArray(), size: view.shadow.mesh.scale.toArray() };
  }, tree.id);
  const before = await frozen();
  assert(before.body && !before.shadow);
  const simBefore = await query({ type: 'sim' });
  holdShadow = false;
  for (const request of held) await request.continue();
  await page.waitForFunction(id => (window as any).__treeContext.views.get(`m${id}`)?.shadow.mesh.visible,
    { timeout: 30_000, polling: 100 }, tree.id);
  const after = await frozen();
  assert.deepEqual({ ...after, shadow: false }, before, 'only texture readiness changed, not the frozen pose');
  const rect = [520, 350, 180, 90];
  const withShadow = await query({ type: 'pixels', rect });
  await page.evaluate(id => { (window as any).__treeContext.views.get(`m${id}`).shadow.mesh.material.visible = false; }, tree.id);
  const withoutShadow = await query({ type: 'pixels', rect });
  await page.evaluate(id => { (window as any).__treeContext.views.get(`m${id}`).shadow.mesh.material.visible = true; }, tree.id);
  assert.equal(withShadow.colorSpace, 'srgb');
  assert.equal(withoutShadow.colorSpace, 'srgb');
  assert(withoutShadow.mean[0] - withShadow.mean[0] >= 1 && withoutShadow.mean[1] - withShadow.mean[1] >= 1,
    `real shadow must darken the ground: ${withShadow.mean} against ${withoutShadow.mean}`);
  assert.equal((await query({ type: 'sim' })).synchronizationHash, simBefore.synchronizationHash);
  assert.deepEqual(errors, []);
  console.log(`TREE SHADOW SMOKE GREEN: delayed fog shadow appears at its frozen pose; sRGB ${withShadow.mean} vs ${withoutShadow.mean} without shadow; simulation unchanged`);
} finally { await browser.close(); await server.close(); }
