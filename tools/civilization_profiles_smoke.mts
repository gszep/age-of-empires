/** Real Briton/Frank selection, construction, research, unique production and art. */
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
import { buildingRulesFor } from '../src/sim/rules.ts';
import type { BuildingKind, Entity } from '../src/sim/types.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(readFileSync(`${root}public/imported/aoe2/manifest.json`, 'utf8'));
assert(manifest.civilizations?.franks?.civilizationBonuses, 'full profile publication required');
const pending = process.env.CIV_ACCEPT_PENDING === '1';
if (pending) manifest.civilizations.franks.civilization.enabled = true;
assert.equal(manifest.civilizations.franks.civilization.enabled, true, 'Franks enabled, or explicit pre-enablement acceptance');
const rules = rulesFromManifest(manifest);
const pendingBody = pending ? gzipSync(JSON.stringify(manifest)) : undefined;
const server = await createServer({ root, configFile: `${root}vite.config.ts`, plugins: [{
  name: 'civilization-acceptance-observation', enforce: 'pre',
  configureServer(server) {
    if (!pendingBody) return;
    // Serve over HTTP: this full two-profile manifest exceeds CDP's 100 MiB
    // interception message limit after base64 encoding.
    server.middlewares.use((req, res, next) => {
      if (req.url?.split('?')[0] !== '/imported/aoe2/manifest.json') return next();
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' });
      res.end(pendingBody);
    });
  }, transform(code, id) {
    if (!id.endsWith('/src/main.ts')) return;
    const anchor = 'renderer.setAnimationLoop(now => {';
    assert(code.includes(anchor));
    return code.replace('let paused = false;', 'let paused = true;').replace(anchor, anchor + `
      Object.assign(globalThis, { __civAcceptance: {
        paused: () => paused,
        screen: at => { const iso = elevatedWorldToIso(game, at.x, at.y);
          const p = new THREE.Vector3(iso.x, iso.y, 0).project(camera);
          return { x: (p.x + 1) * innerWidth / 2, y: (1 - p.y) * innerHeight / 2 }; },
        preview: () => ({ kind: buildMode, target: placementTarget(), tint: ghostFootprint?.material.color.getHex() }),
        art: id => { const e = game.entities.find(e => e.id === id); if (!e) return;
          const key = artKey(assets, e, chooseAnimation(game, e).key, game.matchSeed);
          const v = views.get('e' + id); const imported = assets?.entities[key];
          return { key, name: nameOf(e), icon: imported?.iconId, animation: v?.animationState,
            texture: v?.body.textureImage, pending: v?.body.pendingTexture, fallback: v?.fallback,
            sources: Object.fromEntries(Object.entries(imported?.animations ?? {}).map(([k,a]) => [k,a.source])) }; },
      } });`);
  },
}], server: { host: '127.0.0.1', port: 5267, strictPort: true }, logLevel: 'error' });
await server.listen();
const libs = `${homedir()}/.cache/puppeteer/extra-libs/usr/lib/x86_64-linux-gnu`;
const browser = await puppeteer.launch({ headless: true, dumpio: process.env.CIV_BROWSER_DIAGNOSTICS === '1',
  env: existsSync(libs) ? { ...process.env, LD_LIBRARY_PATH: libs } : process.env,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebGPU'] });
browser.process()?.on('exit', (code, signal) => console.log('browser exit', { code, signal }));
try {
  for (const civ of ['britons', 'franks'] as const) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    const errors: string[] = [];
    page.on('pageerror', error => { errors.push(String(error)); console.error('pageerror', error); });
    page.on('error', error => console.error('page crash', error));
    const ready = () => page.waitForFunction(() => !!(window as any).__civAcceptance
      && typeof (window as any).__empiresDebug === 'function', { timeout: 120_000 });
    const query = (q: object): Promise<any> => page.evaluate(q => (window as any).__empiresDebug(q), q);
    const snapshot = () => query({ type: 'snapshot' });
    const pause = async (wanted: boolean) => {
      if (await page.evaluate(() => (window as any).__civAcceptance.paused()) !== wanted) await page.keyboard.press('F3');
    };
    const click = (key: string) => page.locator(`[data-command="${key}"]`).click();
    const select = async (id: number) => { await query({ type: 'select', ids: [id] }); };
    const runUntil = async (predicate: (s: any, a: any) => boolean, arg: any = null) => {
      await pause(false);
      try {
        await page.waitForFunction(async (code, arg) => {
          const s = await (window as any).__empiresDebug({ type: 'snapshot' });
          return new Function('s', 'a', `return (${code})(s,a)`)(s, arg);
        }, { timeout: 120_000, polling: 100 }, predicate.toString(), arg);
      } finally { await pause(true); }
    };
    console.log(civ, 'opening');
    await page.goto('http://127.0.0.1:5267/?solo=1', { waitUntil: 'domcontentloaded' });
    await ready();
    console.log(civ, 'selecting menu');
    await page.keyboard.press('F10');
    assert.deepEqual(await page.$$eval('#civilization-1 option', options => options.map(e => (e as HTMLOptionElement).value)), ['britons', 'franks']);
    const rival = civ === 'britons' ? 'franks' : 'britons';
    await page.select('#civilization-1', civ);
    await page.select('#civilization-2', rival);
    await page.locator('#map-setup button[type="submit"]').click();
    await pause(true);
    let s = await snapshot();
    assert.equal(s.players[1].civilization, civ); assert.equal(s.players[2].civilization, rival);
    console.log(civ, 'reloading menu choice');
    await page.reload({ waitUntil: 'domcontentloaded' }); await ready();
    s = await snapshot();
    assert.equal(s.players[1].civilization, civ); assert.equal(s.players[2].civilization, rival);
    await page.keyboard.press('F10');
    assert.equal(await page.$eval('#civilization-1', e => (e as HTMLSelectElement).value), civ);
    await page.locator('#menu-dialog [data-menu="restart"]').click();
    await pause(true);
    assert.equal((await snapshot()).players[1].civilization, civ, 'menu restart retained selection');

    // Stage a rich Feudal scenario using the chosen identities. The page resumes
    // plain data, then every researched/built/trained outcome uses public input.
    const state = createGame(122, rules, { 1: civ, 2: rival });
    state.entities = state.entities.filter(e => e.owner !== 0);
    state.terrain.fill(0); state.elevation.fill(0);
    Object.assign(state.players[1], { age: 1, food: 20000, wood: 20000, gold: 20000, stone: 20000 });
    const tc = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
    tc.position = { x: 30, y: 40 };
    const workers = state.entities.filter(e => e.owner === 1 && e.kind === 'villager');
    workers.forEach((e, i) => { e.position = { x: 37, y: 40 + i * 4 }; });
    for (const [i, kind] of (['barracks', 'blacksmith', 'market', 'house', 'house'] as BuildingKind[]).entries()) {
      const b = buildingRulesFor(state, 1, kind);
      const e: Entity = { id: state.nextId++, kind, owner: 1, position: { x: 22, y: 28 + i * 5 },
        hp: b.hp, maxHp: b.hp, radius: b.radius, activity: 'idle', order: { kind: 'idle' } };
      state.entities.push(e);
    }
    activateAutomaticTechnologies(state);
    const { rules: ignored, ...saved } = state;
    const handle = await page.evaluateOnNewDocument(value => sessionStorage.setItem('open-empires-lab:dev-session', JSON.stringify(value)),
      { version: SNAPSHOT_VERSION, rulesOrigin: rules.origin, state: saved,
        setup: { seed: 122, map: 'arabia', civilizations: { 1: civ, 2: rival } } });
    console.log(civ, 'staging lifecycle');
    await page.reload({ waitUntil: 'domcontentloaded' }); await ready();
    await page.removeScriptToEvaluateOnNewDocument(handle.identifier);
    s = await snapshot();
    assert.equal(s.players[1].food, 20000, 'fixture resumed');
    assert.equal(s.players[1].age, 1);
    assert(!s.players[1].researched.includes('horse-collar'), 'mill required for free farm research');
    for (let i = 0; i < 6; i++) await page.keyboard.press('+');

    const build = async (kind: BuildingKind, target: { x: number; y: number }, worker = workers[0]) => {
      console.log(civ, 'build', kind, target);
      await select(worker.id);
      await page.waitForFunction(() => !!document.querySelector('[data-command="page-back"], [data-command="page-economic"]'));
      if (await page.$('[data-command="page-back"]')) await click('page-back');
      await click(['castle', 'barracks'].includes(kind) ? 'page-military' : 'page-economic');
      await click(`build-${kind}`);
      await query({ type: 'look', rect: [target.x, target.y] });
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      const at = await page.evaluate(p => (window as any).__civAcceptance.screen(p), target);
      await page.mouse.move(at.x, at.y);
      await page.waitForFunction(({ kind, target }) => {
        const p = (window as any).__civAcceptance.preview();
        return p.kind === kind && p.tint === 0x7fff9e && p.target.x === target.x && p.target.y === target.y;
      }, {}, { kind, target });
      const before = await snapshot();
      await page.mouse.click(at.x, at.y);
      const after = await snapshot();
      const site = after.entities.find((e: any) => e.owner === 1 && e.kind === kind && e.buildProgress !== undefined
        && !before.entities.some((old: any) => old.id === e.id));
      assert(site, `${civ}: real click placed ${kind}`);
      await runUntil((s, id) => s.entities.some((e: any) => e.id === id && e.buildProgress === undefined), site.id);
      assert((await query({ type: 'command', command: { kind: 'stop', player: 1, entityIds: [worker.id] } })).ok);
      return { site, before, after };
    };
    const researchAge = async (key: string, age: number) => {
      console.log(civ, 'research', key);
      await select(tc.id); await click(`research-${key}`);
      await runUntil((s, age) => s.players[1].age === age, age);
    };
    await build('mill', { x: 40, y: 40 });
    s = await snapshot();
    assert.equal(s.players[1].researched.includes('horse-collar'), civ === 'franks');
    assert.equal(s.players[1].food, 20000, 'free research did not charge food');
    const early = await build('farm', { x: 40.5, y: 46.5 }, workers[1]);
    let earlyFarm = (await snapshot()).entities.find((e: any) => e.id === early.site.id);
    const earlyFood = earlyFarm.amount;
    assert(earlyFood <= (civ === 'franks' ? 250 : 175) && earlyFood > (civ === 'franks' ? 245 : 170));
    await researchAge('castle-age', 2);
    const expansion = await build('town-center', { x: 49, y: 40 });
    assert.equal(expansion.before.players[1].wood - expansion.after.players[1].wood, civ === 'britons' ? 138 : 275);
    const castle = await build('castle', { x: 49, y: 48 }, workers[2]);
    assert.equal(castle.before.players[1].stone - castle.after.players[1].stone, civ === 'franks' ? 553 : 650);
    const own = civ === 'britons' ? 'longbowman' : 'dat-unit-281';
    const foreign = civ === 'britons' ? 'dat-unit-281' : 'longbowman';
    await select(castle.site.id);
    await page.waitForSelector(`[data-command="train-${own}"]`);
    assert.equal(await page.$(`[data-command="train-${foreign}"]`), null);
    const profile = civ === 'britons' ? manifest : manifest.civilizations.franks;
    const button = await page.$eval(`[data-command="train-${own}"]`, e => ({ title: e.getAttribute('title'), icon: (e as HTMLElement).style.backgroundImage }));
    assert.match(button.title ?? '', new RegExp(profile.entities[own].text.name));
    assert(button.icon?.includes(String(profile.entities[own].iconId)), JSON.stringify(button));
    await click(`train-${own}`);
    await runUntil((s, kind) => s.entities.some((e: any) => e.owner === 1 && e.kind === kind), own);
    s = await snapshot();
    const trained = s.entities.find((e: any) => e.owner === 1 && e.kind === own);
    for (const id of [castle.site.id, trained.id]) {
      await query({ type: 'look', entity: id }); await select(id);
      await page.waitForFunction(id => { const a = (window as any).__civAcceptance.art(id); return a?.texture && !a.pending && !a.fallback; }, { timeout: 120_000 }, id);
      const art = await page.evaluate(id => (window as any).__civAcceptance.art(id), id);
      assert.equal(art.key, civ === 'franks' ? `civilizations/franks/${id === trained.id ? own : 'castle'}` : id === trained.id ? own : 'castle');
      const entity = profile.entities[id === trained.id ? own : 'castle'];
      assert.equal(art.name, entity.text.name);
      assert.equal(art.sources.idle, entity.animations.idle.source);
      const images = Object.values(entity.atlases).flatMap((a: any) => [a.image, ...(a.pages ?? [])]);
      assert(images.includes(art.texture), `rendered texture belongs to ${civ}: ${JSON.stringify(art)}`);
    }
    await researchAge('imperial-age', 3);
    s = await snapshot();
    for (const key of ['horse-collar', 'heavy-plow', 'crop-rotation']) {
      assert.equal(s.players[1].researched.filter((k: string) => k === key).length, civ === 'franks' ? 1 : 0);
    }
    assert.equal(s.entities.find((e: any) => e.id === early.site.id).amount, earlyFood, 'existing farm was not refilled by free upgrades');
    const late = await build('farm', { x: 55.5, y: 46.5 }, workers[1]);
    s = await snapshot();
    const lateFood = s.entities.find((e: any) => e.id === late.site.id).amount;
    assert(lateFood <= (civ === 'franks' ? 550 : 175) && lateFood > (civ === 'franks' ? 545 : 170));
    const imperialCastle = await build('castle', { x: 57, y: 54 }, workers[2]);
    assert.equal(imperialCastle.before.players[1].stone - imperialCastle.after.players[1].stone, civ === 'franks' ? 488 : 650);
    await page.reload({ waitUntil: 'domcontentloaded' }); await ready();
    s = await snapshot();
    assert.equal(s.players[1].civilization, civ); assert.equal(s.players[1].age, 3);
    assert.equal(s.entities.filter((e: any) => e.owner === 1 && e.kind === own).length, 1);
    assert.deepEqual(errors, []);
    console.log(`${civ}: menu/reload/restart, unique ${own} + icon/name/rendered art, own castle art, age prices, free farm lifecycle GREEN`);
    await page.close();
  }
  console.log(`CIVILIZATION PROFILES SMOKE GREEN (${pending ? 'pending enablement only' : 'published enabled profiles'}; unmodified gameplay clocks)`);
} catch (error) {
  console.error('CIV ACCEPTANCE FAILURE', error);
  throw error;
} finally { await browser.close(); await server.close(); }
