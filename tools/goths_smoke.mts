/** Owned Goth selection, paid unique research, both Huskarl producers and art. */
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
import { buildingRulesFor, unitRulesFor } from '../src/sim/rules.ts';
import type { BuildingKind, Entity } from '../src/sim/types.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(readFileSync(`${root}public/imported/aoe2/manifest.json`, 'utf8'));
const pending = process.env.CIV_ACCEPT_PENDING === '1';
assert(manifest.civilizations.goths);
if (pending) manifest.civilizations.goths.civilization.enabled = true;
assert.equal(manifest.civilizations.goths.civilization.enabled, true);
const body = pending ? gzipSync(JSON.stringify(manifest)) : undefined;
const rules = rulesFromManifest(manifest);
const server = await createServer({ root, configFile: `${root}vite.config.ts`, logLevel: 'error',
  server: { host: '127.0.0.1', port: 5268, strictPort: true }, plugins: [{
    name: 'goth-acceptance', enforce: 'pre',
    configureServer(server) { if (body) server.middlewares.use((req, res, next) => {
      if (req.url?.split('?')[0] !== '/imported/aoe2/manifest.json') return next();
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' }); res.end(body);
    }); },
    transform(code, id) {
      if (!id.endsWith('/src/main.ts')) return;
      return code.replace('let paused = false;', 'let paused = true;')
        .replace('renderer.setAnimationLoop(now => {', `renderer.setAnimationLoop(now => {
          Object.assign(globalThis, { __goth: { paused: () => paused, speed: () => gameSpeed(),
            art: id => { const e = game.entities.find(e => e.id === id); if (!e) return;
              const key = artKey(assets,e,chooseAnimation(game,e).key,game.matchSeed);
              const v = views.get('e'+id); return { key, name: nameOf(e), texture: v?.body.textureImage,
                pending: v?.body.pendingTexture, fallback: v?.fallback }; } } });`);
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
  const ready = () => page.waitForFunction(() => !!(window as any).__goth && !!(window as any).__empiresDebug, { timeout: 120000 });
  const query = (q: object): Promise<any> => page.evaluate(q => (window as any).__empiresDebug(q), q);
  const snapshot = () => query({ type: 'snapshot' });
  const select = async (id: number) => { await query({ type: 'select', ids: [id] }); };
  const click = (key: string) => page.locator(`[data-command="${key}"]`).click();
  const pause = async (value: boolean) => { if (await page.evaluate(() => (window as any).__goth.paused()) !== value) await page.keyboard.press('F3'); };
  const until = async (fn: (s: any, arg: any) => boolean, arg: any = null) => {
    await pause(false);
    try { await page.waitForFunction(async (code, arg) => new Function('s','a',`return (${code})(s,a)`)(
      await (window as any).__empiresDebug({ type: 'snapshot' }), arg), { timeout: 120000, polling: 100 }, fn.toString(), arg);
    } finally { await pause(true); }
  };
  await page.goto('http://127.0.0.1:5268/?solo=1', { waitUntil: 'domcontentloaded' }); await ready();
  await page.keyboard.press('F10'); await page.select('#civilization-1', 'goths'); await page.select('#civilization-2', 'franks');
  await page.locator('#map-setup button[type="submit"]').click(); await pause(true);
  assert.equal((await snapshot()).players[1].civilization, 'goths');
  await page.reload({ waitUntil: 'domcontentloaded' }); await ready();
  assert.equal((await snapshot()).players[1].civilization, 'goths');
  await page.keyboard.press('F10'); await page.locator('#menu-dialog [data-menu="restart"]').click(); await pause(true);
  assert.equal((await snapshot()).players[1].civilization, 'goths');
  console.log('Goth menu, reload and restart GREEN');

  const state = createGame(181, rules, { 1: 'goths', 2: 'franks' });
  state.entities = state.entities.filter(e => e.owner !== 0); state.terrain.fill(0); state.elevation.fill(0);
  Object.assign(state.players[1], { age: 2, food: 20000, wood: 20000, gold: 20000, stone: 20000 });
  const homes: Record<string, Entity> = {};
  for (const [i, kind] of (['castle', 'barracks', 'stable', 'university', 'house', 'house'] as BuildingKind[]).entries()) {
    const r = buildingRulesFor(state, 1, kind), e: Entity = { id: state.nextId++, kind, owner: 1,
      position: { x: 30 + (i % 3) * 8, y: 40 + Math.floor(i / 3) * 10 }, hp: r.hp, maxHp: r.hp,
      radius: r.radius, activity: 'idle', order: { kind: 'idle' } };
    state.entities.push(e); homes[kind] = e;
  }
  const tc = state.entities.find(e => e.kind === 'town-center' && e.owner === 1)!;
  for (let y = 60; y < 85; y++) for (let x = 60; x < 90; x++) state.terrain[y * state.width + x] = 1;
  const boats: Entity[] = [];
  for (const [kind, owner, x, y] of [['fire-galley', 1, 70, 70], ['galley', 2, 85, 70], ['fishing-ship', 2, 70, 72]] as const) {
    const r = unitRulesFor(state, owner, kind), e: Entity = { id: state.nextId++, kind, owner,
      position: { x, y }, hp: r.hp, maxHp: r.hp, radius: r.radius, activity: 'idle', order: { kind: 'idle' } };
    if (kind === 'fire-galley') { e.hp = 1; e.attackCooldown = 100000; }
    boats.push(e); state.entities.push(e);
  }
  tc.position = { x: 30, y: 30 }; activateAutomaticTechnologies(state);
  const { rules: ignored, ...saved } = state;
  const h = await page.evaluateOnNewDocument(v => sessionStorage.setItem('open-empires-lab:dev-session', JSON.stringify(v)), {
    version: SNAPSHOT_VERSION, rulesOrigin: rules.origin, state: saved,
    setup: { seed: 181, map: 'arabia', civilizations: { 1: 'goths', 2: 'franks' } },
  });
  await page.reload({ waitUntil: 'domcontentloaded' }); await ready(); await page.removeScriptToEvaluateOnNewDocument(h.identifier);
  assert.equal((await snapshot()).players[1].food, 20000, 'staged fixture resumed');
  for (let i = 0; i < 6; i++) await page.keyboard.press('+');
  const paid = async (home: Entity, tech: string) => {
    await select(home.id); await page.waitForSelector(`[data-command="research-${tech}"]`);
    const before = await snapshot(); await click(`research-${tech}`); const after = await snapshot();
    for (const r of ['food','wood','gold','stone']) assert.equal(before.players[1][r] - after.players[1][r], manifest.civilizations.goths.technologies[tech].cost[r] ?? 0);
    await until((s, key) => s.players[1].researched.includes(key), tech);
    console.log('paid research', tech, 'GREEN');
  };
  const train = async (home: Entity, kind: string, hotkey?: string) => {
    await select(home.id); await page.waitForSelector(`[data-command="train-${kind}"]`);
    const before = await snapshot();
    if (hotkey) await page.keyboard.press(hotkey); else await click(`train-${kind}`);
    await until((s, a) => s.entities.some((e: any) => e.owner === 1 && e.kind === a.kind && e.id >= a.next), { kind, next: before.nextId });
    const s = await snapshot(); return s.entities.find((e: any) => e.owner === 1 && e.kind === kind && e.id >= before.nextId);
  };
  await paid(tc, 'loom');
  await select(homes.barracks.id); await page.waitForSelector('[data-command="train-militia"]');
  assert.equal(await page.$('[data-command="train-dat-unit-41"]'), null);
  const first = await train(homes.castle, 'dat-unit-41');
  await paid(homes.castle, 'anarchy');
  const second = await train(homes.barracks, 'dat-unit-41', 'r'); // owned secondary-slot Definitive binding
  assert.notEqual(first.id, second.id);
  await paid(tc, 'imperial-age');
  await paid(homes.castle, 'elite-huskarl');
  await paid(homes.castle, 'perfusion');
  const elite = await train(homes.barracks, 'dat-unit-555');
  await query({ type: 'look', entity: elite.id }); await select(elite.id);
  await page.waitForFunction(id => { const a = (window as any).__goth.art(id);
    return a?.key === 'civilizations/goths/dat-unit-555' && a.texture && !a.pending && !a.fallback;
  }, { timeout: 120000 }, elite.id);
  const art = await page.evaluate(id => (window as any).__goth.art(id), elite.id);
  const entity = manifest.civilizations.goths.entities['dat-unit-555'];
  assert.equal(art.name, entity.text.name);
  assert(Object.values(entity.atlases).flatMap((a: any) => [a.image, ...(a.pages ?? [])]).includes(art.texture));
  await paid(homes.university, 'siphons'); await paid(homes.university, 'incendiaries');
  // Slow down through normal controls so the short source explosion can be
  // measured in the live renderer rather than staged as an already-dead unit.
  while (await page.evaluate(() => (window as any).__goth.speed()) > 1) await page.keyboard.press('-');
  await query({ type: 'look', entity: boats[0].id });
  const beforeBlast = (await snapshot()).entities.find((e: any) => e.id === boats[2].id).hp;
  assert((await query({ type: 'command', command: { kind: 'order', player: 2,
    entityIds: [boats[1].id], targetId: boats[0].id, target: boats[0].position } })).ok);
  await until((s, id) => s.entities.some((e: any) => e.id === id && e.dead), boats[0].id);
  assert((await snapshot()).entities.find((e: any) => e.id === boats[2].id).hp < beforeBlast);
  await page.waitForFunction(id => { const a = (window as any).__goth.art(id);
    return a?.key.endsWith('/fire-ship-explosion') && a.texture && !a.pending && !a.fallback;
  }, { timeout: 120000 }, boats[0].id);
  const blastArt = await page.evaluate(id => (window as any).__goth.art(id), boats[0].id);
  assert.equal(blastArt.texture, manifest.particles.explosion_demo_ships.atlas.image);
  console.log('Incendiaries real paid research, sinking blast damage and owned explosion texture GREEN');
  await page.reload({ waitUntil: 'domcontentloaded' }); await ready();
  const end = await snapshot();
  for (const id of [first.id,second.id,elite.id]) assert.equal(end.entities.find((e: any) => e.id === id)?.kind, 'dat-unit-555');
  for (const tech of ['anarchy','perfusion','elite-huskarl']) {
    assert.equal(end.players[1].researched.filter((k: string) => k === tech).length, 1);
    assert(!end.players[2].researched.includes(tech));
  }
  assert.deepEqual(errors, []);
  console.log(`GOTHS SMOKE GREEN (${pending ? 'pending profile' : 'published enabled profile'}; real commands/unmodified gameplay clocks)`);
} finally { await browser.close(); await server.close(); }
