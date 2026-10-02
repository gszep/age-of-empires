/** #131: actual Stop/train/right-click/group pack controls and original poses. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import { FALLBACK_RULES, isBuilding, rulesFromManifest } from '../src/sim/data.ts';
import { activateAutomaticTechnologies, createGame } from '../src/sim/game.ts';
import { buildingRulesFor, unitRulesFor } from '../src/sim/rules.ts';
import { updateVisibility } from '../src/sim/visibility.ts';
import { SNAPSHOT_VERSION } from '../src/dev-session.ts';
import { startupDiagnostics } from './browser-startup-diagnostics.mjs';
import type { BuildingKind, Entity, GameState, Point, UnitKind } from '../src/sim/types.ts';

const root = fileURLToPath(new URL('../', import.meta.url)), fallback = process.env.OPEN_FALLBACK === '1';
const manifest = fallback ? undefined : JSON.parse(readFileSync(`${root}public/imported/aoe2/manifest.json`, 'utf8'));
const rules = fallback ? FALLBACK_RULES : rulesFromManifest(manifest);
const server = await createServer({ root, configFile: `${root}vite.config.ts`, logLevel: 'error',
  server: { host: '127.0.0.1', port: 5274, strictPort: true }, plugins: [{ name: 'trebuchet-observation', enforce: 'pre',
    configureServer(server) { if (fallback) server.middlewares.use((req, res, next) => {
      if (!req.url?.startsWith('/imported/')) { next(); return; } res.writeHead(404); res.end();
    }); },
    transform(code, id) {
      if (!id.endsWith('/src/main.ts')) return;
      const anchor = 'renderer.setAnimationLoop(now => {'; assert(code.includes(anchor));
      const ai = 'exampleAiCommands(observe(game, 2))'; assert(code.includes(ai));
      return code.replace('let paused = false;', 'let paused = true;').replace(ai, '[]').replace(anchor, anchor + `
        Object.assign(globalThis, { __trebuchetProbe: {
          paused: () => paused,
          screen: at => { const iso = elevatedWorldToIso(game, at.x, at.y);
            const p = new THREE.Vector3(iso.x, iso.y, 0).project(camera);
            return { x: (p.x + 1) * innerWidth / 2, y: (1 - p.y) * innerHeight / 2 }; },
          art: id => { const v = views.get('e' + id); return v && { image: v.body.textureImage,
            animation: v.animationState, visible: v.body.mesh.visible, pending: v.body.pendingTexture, fallback: v.fallback }; }
        } });`);
    },
  }] });
await server.listen();
const libs = `${homedir()}/.cache/puppeteer/extra-libs/usr/lib/x86_64-linux-gnu`;
const browser = await puppeteer.launch({ headless: true,
  env: existsSync(libs) ? { ...process.env, LD_LIBRARY_PATH: libs } : process.env,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebGPU'] });
const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 800 });
const errors: string[] = []; page.on('pageerror', e => errors.push(String(e)));
const diagnostics = startupDiagnostics(page, browser, `${root}.local/browser-diagnostics/trebuchet-${fallback ? 'open' : 'owned'}`);
const query = (q: object): Promise<any> => page.evaluate(q => (window as any).__empiresDebug(q), q);
const snapshot = () => query({ type: 'snapshot' });
const pause = async (value: boolean) => {
  if (await page.evaluate(() => (window as any).__trebuchetProbe.paused()) !== value) await page.keyboard.press('F3');
};
const until = async (predicate: (s: any, arg: any) => boolean, arg: any) => {
  await pause(false);
  try { await page.waitForFunction(async (code, arg) => new Function('s', 'a', `return (${code})(s,a)`)(
    await (window as any).__empiresDebug({ type: 'snapshot' }), arg), { timeout: 120_000, polling: 50 }, predicate.toString(), arg);
  } catch (error) {
    const s = await snapshot(); console.error('predicate', predicate.toString(), 'tick', s.tick,
      s.entities.filter((e: any) => ['trebuchet', 'castle'].includes(e.kind)));
    throw error;
  } finally { await pause(true); }
};
function fixture() {
  const state = createGame(131, rules);
  state.entities = state.entities.filter(e => e.kind === 'town-center');
  state.terrain.fill(0); state.elevation.fill(0);
  for (const player of [1, 2] as const) {
    Object.assign(state.players[player], { age: 3, wood: 1000, gold: 1000 });
  }
  activateAutomaticTechnologies(state);
  const put = (kind: BuildingKind | UnitKind, x: number, y: number, owner: 1 | 2 = 1): Entity => {
    const r = isBuilding(kind) ? buildingRulesFor(state, owner, kind) : unitRulesFor(state, owner, kind);
    const e: Entity = { id: state.nextId++, kind, owner, position: { x, y }, hp: r.hp, maxHp: r.hp,
      radius: r.radius, activity: 'idle', order: { kind: 'idle' } };
    state.entities.push(e); return e;
  };
  return { state, put };
}
const stage = async (state: GameState) => {
  updateVisibility(state);
  const { rules: ignored, ...saved } = state;
  const handle = await page.evaluateOnNewDocument(value => sessionStorage.setItem('open-empires-lab:dev-session', JSON.stringify(value)),
    { version: SNAPSHOT_VERSION, rulesOrigin: rules.origin, state: saved });
  await page.goto('http://127.0.0.1:5274/?solo=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window as any).__trebuchetProbe && !!(window as any).__empiresDebug, { timeout: 120_000 });
  await page.removeScriptToEvaluateOnNewDocument(handle.identifier);
  const resumed = await snapshot(); assert.equal(resumed.nextId, state.nextId); assert.equal(resumed.tick, 0);
  for (let n = 0; n < 6; n++) await page.keyboard.press('+');
};
const rightClick = async (id: number, at: Point) => {
  await query({ type: 'select', ids: [id] }); await query({ type: 'look', rect: [at.x, at.y] });
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const screen = await page.evaluate(at => (window as any).__trebuchetProbe.screen(at), at);
  await page.mouse.click(screen.x, screen.y, { button: 'right' });
};
const art = async (id: number, unpacked: boolean) => {
  await query({ type: 'look', entity: id });
  if (fallback) { assert((await query({ type: 'entities', id })).entities[0].rendered); return; }
  const key = unpacked ? 'trebuchet-unpacked' : 'trebuchet';
  const images = Object.values(manifest.entities[key].atlases).flatMap((a: any) => [a.image, ...(a.pages ?? []).map((p: any) => p.image)]);
  await page.waitForFunction(({ id, key, images }) => {
    const a = (window as any).__trebuchetProbe.art(id);
    return a?.visible && !a.pending && !a.fallback && a.animation?.startsWith(key + '/') && images.includes(a.image);
  }, { timeout: 30_000 }, { id, key, images });
};
try {
  // No attack order: actual Stop lets normal idle acquisition deploy the engine.
  {
    const { state, put } = fixture();
    const treb = put('trebuchet', 40.5, 40.5), target = put('house', 52.5, 40.5, 2);
    await stage(state); await query({ type: 'select', ids: [treb.id] }); await art(treb.id, false);
    await page.locator('[data-command="stop"]').click();
    await until((s, id) => s.entities.find((e: any) => e.id === id)?.packingTicks > 0, treb.id);
    let s = await snapshot();
    assert.equal(s.entities.find((e: any) => e.id === treb.id).order.automatic, true);
    assert.equal(s.entities.find((e: any) => e.id === target.id).hp, target.hp);
    assert.equal(s.projectiles.length, 0);
    await until((s, id) => s.entities.find((e: any) => e.id === id)?.hp < s.entities.find((e: any) => e.id === id)?.maxHp, target.id);
    s = await snapshot(); assert.deepEqual(s.entities.find((e: any) => e.id === treb.id).position, treb.position);
    await art(treb.id, true);
    await query({ type: 'select', ids: [treb.id] }); await page.locator('[data-command="pack"]').click();
    await until((s, id) => { const e = s.entities.find((e: any) => e.id === id); return e && !e.unpacked && e.packingTicks === undefined; }, treb.id);
    const tick = (await snapshot()).tick;
    await until((s, tick) => s.tick >= tick + 200, tick);
    assert.equal((await snapshot()).entities.find((e: any) => e.id === treb.id).unpacked, false);
    await art(treb.id, false);
    console.log('automatic visible-building deployment, setup, actual damage and manual Pack hold: GREEN');
  }
  // A paid fresh engine must obey a real right-click without a separate Unpack.
  {
    const { state, put } = fixture();
    const castle = put('castle', 32, 32), target = put('house', 70.5, 40.5, 2);
    put('outpost', 66.5, 44.5);
    await stage(state); await query({ type: 'look', entity: castle.id }); await query({ type: 'select', ids: [castle.id] });
    await page.locator('[data-command="train-trebuchet"]').click();
    let s = await snapshot(); assert.equal(s.players[1].wood, 800); assert.equal(s.players[1].gold, 800);
    await until(s => s.entities.some((e: any) => e.kind === 'trebuchet'), null);
    const engine = (await snapshot()).entities.find((e: any) => e.kind === 'trebuchet');
    await art(engine.id, false); await rightClick(engine.id, target.position);
    assert.deepEqual((await snapshot()).entities.find((e: any) => e.id === engine.id).order, { kind: 'attack', targetId: target.id });
    await until((s, id) => s.entities.find((e: any) => e.id === id)?.hp < s.entities.find((e: any) => e.id === id)?.maxHp, target.id);
    s = await snapshot(); const deployed = s.entities.find((e: any) => e.id === engine.id);
    assert.equal(deployed.unpacked, true); assert(deployed.position.x > engine.position.x + 5);
    await art(engine.id, true);
    await rightClick(engine.id, { x: 40.5, y: 30.5 });
    assert((await snapshot()).entities.find((e: any) => e.id === engine.id).packingTicks > 0);
    await until((s, id) => { const e = s.entities.find((e: any) => e.id === id); return e && !e.unpacked && e.position.x < 45; }, engine.id);
    console.log('paid castle train button, packed right-click approach/setup/shot and ground-click repacking: GREEN');
  }
  {
    const { state, put } = fixture();
    const ids = [put('trebuchet', 40.5, 40.5).id, put('trebuchet', 42.5, 40.5).id];
    await stage(state); await query({ type: 'look', entity: ids[0] }); await query({ type: 'select', ids });
    await page.locator('[data-command="unpack"]').click();
    await until((s, ids) => ids.every((id: number) => s.entities.find((e: any) => e.id === id)?.unpacked), ids);
    await page.locator('[data-command="pack"]').click();
    await until((s, ids) => ids.every((id: number) => { const e = s.entities.find((e: any) => e.id === id); return e && !e.unpacked && e.packingTicks === undefined; }), ids);
    console.log('group Unpack and Pack buttons: GREEN');
  }
  assert.deepEqual(errors, []);
  console.log(`TREBUCHET ${fallback ? 'OPEN' : 'OWNED'} SMOKE GREEN`);
} catch (error) { await diagnostics.capture(error, 'trebuchet automatic deployment and public commands'); throw error;
} finally { diagnostics.dispose(); await browser.close(); await server.close(); }
