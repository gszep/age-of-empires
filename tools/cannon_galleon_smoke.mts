/** #297: a public Cannon Galleon attack must draw its owned cannonball pixels. */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import puppeteer from 'puppeteer';
import { createGame } from '../src/sim/game.ts';
import { rulesFromManifest } from '../src/sim/data.ts';
import { updateVisibility } from '../src/sim/visibility.ts';
import { SNAPSHOT_VERSION } from '../src/dev-session.ts';
import type { Entity, UnitKind } from '../src/sim/types.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(readFileSync(`${root}public/imported/aoe2/manifest.json`, 'utf8'));
const rules = rulesFromManifest(manifest), state = createGame(297, rules);
state.entities = state.entities.filter(e => e.kind === 'town-center');
state.elevation.fill(0);
for (let y = 15; y < 36; y++) for (let x = 35; x < 70; x++) state.terrain[y * state.width + x] = 1;
const add = (kind: UnitKind, owner: 1 | 2, x: number): Entity => {
  const rule = rules.units[kind];
  const entity: Entity = { id: state.nextId++, kind, owner, position: { x, y: 25 }, hp: rule.hp, maxHp: rule.hp,
    radius: rule.radius, activity: 'idle', order: { kind: 'idle' } };
  state.entities.push(entity); return entity;
};
const ship = add('cannon-galleon', 1, 45), target = add('transport-ship', 2, 55);
state.players[1].age = 3;
Object.assign(state.players[2], { food: 0, wood: 0, gold: 0, stone: 0 });
updateVisibility(state);
const { rules: ignored, ...saved } = state;
const server = await createServer({ root, configFile: `${root}vite.config.ts`, plugins: [{
  name: 'cannonball-fixture', enforce: 'pre', transform(code, id) {
    if (!id.endsWith('/src/main.ts')) return;
    assert(code.includes('renderer.render(scene, camera);') && code.includes('let paused = false;'));
    return code.replace('let paused = false;', 'let paused = true;').replace('renderer.render(scene, camera);',
      'Object.assign(globalThis, { __cannon: { views, renderer, scene, camera, assets } }); renderer.render(scene, camera);');
  },
}], server: { host: '127.0.0.1', port: 5269, strictPort: true }, logLevel: 'error' });
await server.listen();
const libs = `${homedir()}/.cache/puppeteer/extra-libs/usr/lib/x86_64-linux-gnu`;
const browser = await puppeteer.launch({ headless: true,
  env: existsSync(libs) ? { ...process.env, LD_LIBRARY_PATH: libs } : process.env,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebGPU'] });
try {
  const page = await browser.newPage(), errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.setViewport({ width: 1280, height: 800 });
  await page.evaluateOnNewDocument(snapshot => sessionStorage.setItem('open-empires-lab:dev-session', JSON.stringify(snapshot)),
    { version: SNAPSHOT_VERSION, rulesOrigin: rules.origin, state: saved });
  await page.goto('http://127.0.0.1:5269/?solo=1', { waitUntil: 'networkidle0', timeout: 120_000 });
  const query = (q: object): Promise<any> => page.evaluate(q => (window as any).__empiresDebug(q), q);
  assert((await query({ type: 'snapshot' })).entities.some((e: any) => e.id === ship.id && e.kind === ship.kind), 'snapshot resumed');
  await query({ type: 'look', rect: [50, 25, 0, 0] });
  await page.keyboard.press('F4');
  await query({ type: 'select', ids: [ship.id] });
  const enemy = (await query({ type: 'entities', id: target.id })).entities[0];
  await page.mouse.click(enemy.screen.x, enemy.screen.y, { button: 'right' });
  assert.equal((await query({ type: 'snapshot' })).entities.find((e: any) => e.id === ship.id).order.targetId, target.id);
  await page.keyboard.press('F3');
  await page.waitForFunction(async id => {
    const state = await (window as any).__empiresDebug({ type: 'snapshot' });
    return state.projectiles.some((p: any) => p.shooterId === id && p.position.x > 48 && p.position.x < 52);
  }, { timeout: 30_000, polling: 50 }, ship.id);
  await page.keyboard.press('F3');
  const snapshot = await query({ type: 'snapshot' });
  const shot = snapshot.projectiles.find((p: any) => p.shooterId === ship.id);
  assert.equal(shot.art, 'naval-cannonball');
  // Finish current frame's ordinary lazy texture loads, including any composite
  // body requested by the renderer. No atlas is injected or forced visible.
  await page.waitForNetworkIdle({ idleTime: 500, timeout: 30_000 });
  const parts = await page.evaluate(id => {
    const context = (window as any).__cannon, view = context.views.get(`p${id}`);
    context.renderer.setAnimationLoop(null); // freeze presentation for pixel A/B
    // Water's shader clock advances on render even while paused. Isolate the
    // production shot on the scene background so water cannot fake a pass.
    for (const child of context.scene.children) child.visible = child === view.group;
    return [view.body, ...view.annexes].map(p => ({ visible: p.mesh.visible, image: p.textureImage }));
  }, shot.id);
  const before = (await query({ type: 'sim' })).synchronizationHash;
  const withBall = await query({ type: 'pixels', png: true });
  await page.evaluate(id => { (window as any).__cannon.views.get(`p${id}`).group.visible = false; }, shot.id);
  const withoutBall = await query({ type: 'pixels', png: true });
  const changed = await page.evaluate(async ({ a, b }) => {
    const decoded: Uint8ClampedArray[] = [];
    for (const png of [a, b]) {
      const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob());
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0); image.close();
      decoded.push(context.getImageData(0, 0, canvas.width, canvas.height).data);
    }
    const [first, second] = decoded;
    let count = 0;
    for (let i = 0; i < first.length; i += 4) {
      if (first[i] !== second[i] || first[i + 1] !== second[i + 1] || first[i + 2] !== second[i + 2]) count++;
    }
    return count;
  }, { a: withBall.png, b: withoutBall.png });
  console.log(JSON.stringify({ art: shot.art, parts, changedPixelsSRGB: changed }));
  assert(changed > 4, 'the in-flight cannonball must contribute visible pixels');
  await page.evaluate(id => { (window as any).__cannon.views.get(`p${id}`).group.visible = true; }, shot.id);
  assert.equal((await query({ type: 'sim' })).synchronizationHash, before);
  assert((await query({ type: 'sim' })).projectileViews.some((p: any) => p.id === shot.id && p.rendered), 'debug reports composite projectile visibility');
  assert.deepEqual(errors, []);
  console.log('CANNON GALLEON GREEN: public attack, owned in-flight ball pixels, unchanged paused simulation');
} finally { await browser.close(); await server.close(); }
