/** #278: real Stop/move/attack gestures, held fire, original art and friendly HP. */
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
import type { Entity, GameState, PlayerId, UnitKind, BuildingKind } from '../src/sim/types.ts';

const root = fileURLToPath(new URL('../', import.meta.url)), fallback = process.env.OPEN_FALLBACK === '1';
const manifest = fallback ? undefined : JSON.parse(readFileSync(`${root}public/imported/aoe2/manifest.json`, 'utf8'));
const rules = fallback ? FALLBACK_RULES : rulesFromManifest(manifest);
const server = await createServer({ root, configFile: `${root}vite.config.ts`, logLevel: 'error',
  server: { host: '127.0.0.1', port: 5248, strictPort: true }, plugins: [{ name: 'siege-safety-fixture', enforce: 'pre',
    configureServer(server) { if (fallback) server.middlewares.use((req, res, next) => {
      if (!req.url?.startsWith('/imported/')) { next(); return; } res.writeHead(404); res.end();
    }); },
    transform(code, id) {
      if (!id.endsWith('/src/main.ts')) return;
      const anchor = 'renderer.setAnimationLoop(now => {'; assert(code.includes(anchor));
      return code.replace('let paused = false;', 'let paused = true;')
        .replace('exampleAiCommands(observe(game, 2))', '[]').replace(anchor, anchor + `
        Object.assign(globalThis, { __siegeSafety: {
          paused: () => paused,
          screen: at => { const iso = elevatedWorldToIso(game, at.x, at.y);
            const p = new THREE.Vector3(iso.x, iso.y, 0).project(camera);
            return { x: (p.x + 1) * innerWidth / 2, y: (1 - p.y) * innerHeight / 2 }; },
          art: id => { const v = views.get('e' + id); return v && { image: v.body.textureImage,
            visible: v.body.mesh.visible, pending: v.body.pendingTexture, fallback: v.fallback }; }
        } });`);
    },
  }] });
await server.listen();
const libs = `${homedir()}/.cache/puppeteer/extra-libs/usr/lib/x86_64-linux-gnu`;
const browser = await puppeteer.launch({ headless: true,
  env: existsSync(libs) ? { ...process.env, LD_LIBRARY_PATH: libs } : process.env,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebGPU'] });
const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 800 });
const errors: string[] = []; page.on('pageerror', error => errors.push(String(error)));
const diagnostics = startupDiagnostics(page, browser, `${root}.local/browser-diagnostics/siege-safety-${fallback ? 'fallback' : 'owned'}`);
const query = (q: object): Promise<any> => page.evaluate(q => (window as any).__empiresDebug(q), q);
const snapshot = () => query({ type: 'snapshot' });
const pause = async (value: boolean) => {
  if (await page.evaluate(() => (window as any).__siegeSafety.paused()) !== value) await page.keyboard.press('F3');
};
const until = async (predicate: (state: any, arg: any) => boolean, arg: any) => {
  await pause(false);
  try { await page.waitForFunction(async (code, arg) => new Function('s', 'a', `return (${code})(s,a)`)(
    await (window as any).__empiresDebug({ type: 'snapshot' }), arg), { timeout: 120_000, polling: 100 }, predicate.toString(), arg);
  } finally { await pause(true); }
};
const stage = async (state: GameState) => {
  const { rules: ignored, ...saved } = state;
  const handle = await page.evaluateOnNewDocument(value => sessionStorage.setItem('open-empires-lab:dev-session', JSON.stringify(value)),
    { version: SNAPSHOT_VERSION, rulesOrigin: rules.origin, state: saved });
  await page.goto('http://127.0.0.1:5248/?solo=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window as any).__siegeSafety && !!(window as any).__empiresDebug, { timeout: 120_000 });
  await page.removeScriptToEvaluateOnNewDocument(handle.identifier);
  const resumed = await snapshot(); assert.equal(resumed.nextId, state.nextId); assert.equal(resumed.tick, 0);
  for (let i = 0; i < 6; i++) await page.keyboard.press('+');
};
const rightClick = async (unit: number, at: { x: number; y: number }) => {
  await query({ type: 'select', ids: [unit] }); await query({ type: 'look', rect: [at.x, at.y] });
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const screen = await page.evaluate(at => (window as any).__siegeSafety.screen(at), at);
  await page.mouse.click(screen.x, screen.y, { button: 'right' });
};
try {
  const kinds: UnitKind[] = fallback ? ['mangonel', 'onager'] : ['mangonel', 'onager', 'dat-unit-588'];
  for (const kind of kinds) {
    const state = createGame(278, rules, fallback ? undefined : { 1: 'teutons', 2: 'teutons' });
    state.entities = state.entities.filter(e => e.kind === 'town-center');
    state.terrain.fill(0); state.elevation.fill(0);
    for (const player of [1, 2] as const) state.players[player].age = 3;
    activateAutomaticTechnologies(state);
    const put = (kind: UnitKind | BuildingKind, x: number, y: number, owner: PlayerId = 1): Entity => {
      const rule = isBuilding(kind) ? buildingRulesFor(state, owner, kind) : unitRulesFor(state, owner, kind);
      const entity: Entity = { id: state.nextId++, kind, owner, position: { x, y }, hp: rule.hp, maxHp: rule.hp,
        radius: rule.radius, activity: 'idle', order: { kind: 'idle' } };
      state.entities.push(entity); return entity;
    };
    const siege = put(kind, 42.5, 40.5), target = put('outpost', 48.5, 40.5, 2), friend = put('villager', 49.5, 40.5);
    updateVisibility(state); await stage(state);
    await query({ type: 'look', entity: siege.id }); await query({ type: 'select', ids: [siege.id] });
    await page.locator('[data-command="stop"]').click();
    await until(s => s.tick >= 260, null);
    let observed = await snapshot();
    assert.equal(observed.entities.find(e => e.id === target.id).hp, target.hp);
    assert.equal(observed.entities.find(e => e.id === friend.id).hp, friend.hp);
    assert.equal(observed.entities.find(e => e.id === siege.id).activity, 'idle'); assert.equal(observed.projectiles.length, 0);
    if (!fallback) {
      const image = manifest.civilizations.teutons.entities[kind].atlases.idle.image;
      await page.waitForFunction(({ id, image }) => { const art = (window as any).__siegeSafety.art(id);
        return art?.visible && !art.pending && !art.fallback && art.image === image;
      }, { timeout: 30_000 }, { id: siege.id, image });
    }
    await rightClick(friend.id, { x: 53.5, y: 40.5 });
    assert.equal((await snapshot()).entities.find(e => e.id === friend.id).order.kind, 'move');
    await until((s, id) => s.entities.find(e => e.id === id).hp < s.entities.find(e => e.id === id).maxHp, target.id);
    observed = await snapshot();
    assert.equal(observed.entities.find(e => e.id === friend.id).hp, friend.hp);
    assert.equal(observed.entities.find(e => e.id === siege.id).order.automatic, true);

    // A fresh identical hazardous scene: an actual player right-click retains
    // deliberate control and its existing friendly-fire consequence.
    await stage(state); await rightClick(siege.id, target.position);
    const manual = (await snapshot()).entities.find(e => e.id === siege.id).order;
    assert.equal(manual.kind, 'attack'); assert.equal(manual.targetId, target.id); assert.equal(manual.automatic, undefined);
    await until((s, id) => s.entities.find(e => e.id === id)?.hp < s.entities.find(e => e.id === id)?.maxHp
      || !s.entities.some(e => e.id === id), friend.id);

    // The separate command-grid override must work in both imported and fallback
    // modes too; a public command test alone would miss a missing/disabled button.
    await stage(state);
    await query({ type: 'look', entity: siege.id }); await query({ type: 'select', ids: [siege.id] });
    await page.locator('[data-command="attack-ground"]').click();
    const ground = await page.evaluate(at => (window as any).__siegeSafety.screen(at), target.position);
    await page.mouse.click(ground.x, ground.y);
    const groundOrder = (await snapshot()).entities.find(e => e.id === siege.id).order;
    assert.equal(groundOrder.kind, 'attack-ground'); assert.equal(groundOrder.automatic, undefined);
    await until((s, id) => s.entities.find(e => e.id === id)?.hp < s.entities.find(e => e.id === id)?.maxHp
      || !s.entities.some(e => e.id === id), friend.id);
    console.log(kind, fallback ? 'fallback' : 'owned', 'GREEN: Stop holds fire; move clears risk; explicit attack and Attack Ground button cause real splash');
  }
  assert.deepEqual(errors, []);
  console.log('SIEGE SAFETY SMOKE GREEN');
} catch (error) { await diagnostics.capture(error, 'automatic catapult friendly blast'); throw error;
} finally { diagnostics.dispose(); await browser.close(); await server.close(); }
