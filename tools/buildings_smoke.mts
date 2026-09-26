/** Private real-input wall/gate/tower acceptance, including both owned profiles. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import { activateAutomaticTechnologies, createGame } from '../src/sim/game.ts';
import { buildingRulesFor } from '../src/sim/rules.ts';
import { FALLBACK_RULES, rulesFromManifest } from '../src/sim/data.ts';
import { updateVisibility } from '../src/sim/visibility.ts';
import { SNAPSHOT_VERSION } from '../src/dev-session.ts';
import type { BuildingKind, Entity } from '../src/sim/types.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const fallback = process.env.OPEN_FALLBACK === '1';
const manifest = fallback ? undefined : JSON.parse(readFileSync(`${root}public/imported/aoe2/manifest.json`, 'utf8'));
const rules = manifest ? rulesFromManifest(manifest) : FALLBACK_RULES;
const server = await createServer({ root, configFile: `${root}vite.config.ts`, plugins: [{
  name: 'building-presentation-observation', enforce: 'pre', transform(code, id) {
    if (!id.endsWith('/src/main.ts')) return;
    const anchor = 'renderer.setAnimationLoop(now => {'; assert(code.includes(anchor));
    return code.replace('let paused = false;', 'let paused = true;').replace(anchor, anchor + `
      Object.assign(globalThis, { __buildingProbe: {
        paused: () => paused,
        preview: () => ({ kind: buildMode, target: placementTarget(), tint: ghostFootprint?.material.color.getHex() }),
        screen: at => { const iso = elevatedWorldToIso(game, at.x, at.y);
          const p = new THREE.Vector3(iso.x, iso.y, 0).project(camera);
          return { x: (p.x + 1) * innerWidth / 2, y: (1 - p.y) * innerHeight / 2 }; },
        art: id => { const e = game.entities.find(e => e.id === id); if (!e) return;
          const key = artKey(assets, e, chooseAnimation(game, e).key, game.matchSeed);
          const v = views.get('e' + id);
          return { key, animation: v?.animationState, frame: v?.frameIndex, fallback: v?.fallback,
            pieces: v ? [v.body, ...v.annexes].map(p => ({ image: p.textureImage, pending: p.pendingTexture, visible: p.mesh.visible })) : [] }; },
      } });`);
  },
}], server: { host: '127.0.0.1', port: 5266, strictPort: true }, logLevel: 'error' });
await server.listen();
const libs = `${homedir()}/.cache/puppeteer/extra-libs/usr/lib/x86_64-linux-gnu`;
const browser = await puppeteer.launch({ headless: true,
  env: existsSync(libs) ? { ...process.env, LD_LIBRARY_PATH: libs } : process.env,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebGPU'] });
try {
  for (const civ of fallback ? ['open'] : ['britons', 'franks']) {
    const state = createGame(126, rules, { 1: civ, 2: fallback ? civ : civ === 'britons' ? 'franks' : 'britons' });
    state.entities = state.entities.filter(e => e.kind === 'town-center' || e.kind === 'villager');
    state.terrain.fill(0); state.elevation.fill(0);
    Object.assign(state.players[1], { age: fallback ? 3 : 1, food: 20000, wood: 20000, gold: 20000, stone: 20000 });
    const home = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
    home.position = { x: 30, y: 40 };
    const workers = state.entities.filter(e => e.owner === 1 && e.kind === 'villager');
    workers.forEach((e, i) => { e.position = { x: 37, y: 40 + i * 4 }; });
    const add = (kind: BuildingKind, x: number, y: number): Entity => {
      const b = buildingRulesFor(state, 1, kind);
      const e: Entity = { id: state.nextId++, kind, owner: 1, position: { x, y }, hp: b.hp,
        maxHp: b.hp, radius: b.radius, activity: 'idle', order: { kind: 'idle' } };
      state.entities.push(e); return e;
    };
    const university = add('university', 25, 30);
    add('blacksmith', 20.5, 30.5); add('market', 20.5, 36.5); add('castle', 25, 24);
    activateAutomaticTechnologies(state);
    const wounded = add('house', 40.5, 52.5); wounded.hp -= 17;
    updateVisibility(state);
    const { rules: ignored, ...saved } = state;
    const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 800 });
    const errors: string[] = [];
    page.on('pageerror', e => { errors.push(String(e)); console.error(e); });
    if (fallback) {
      await page.setRequestInterception(true);
      page.on('request', req => { void (req.url().includes('/imported/') ? req.respond({ status: 404, body: '' }) : req.continue()); });
    }
    const handle = await page.evaluateOnNewDocument(value => sessionStorage.setItem('open-empires-lab:dev-session', JSON.stringify(value)),
      { version: SNAPSHOT_VERSION, rulesOrigin: rules.origin, state: saved });
    const ready = () => page.waitForFunction(() => !!(window as any).__buildingProbe
      && typeof (window as any).__empiresDebug === 'function', { timeout: 120_000 });
    await page.goto('http://127.0.0.1:5266/?solo=1', { waitUntil: 'domcontentloaded' }); await ready();
    await page.removeScriptToEvaluateOnNewDocument(handle.identifier);
    const query = (q: object): Promise<any> => page.evaluate(q => (window as any).__empiresDebug(q), q);
    const snapshot = () => query({ type: 'snapshot' });
    assert.equal((await snapshot()).players[1].civilization, civ, 'fixture resumed');
    assert.equal((await snapshot()).players[1].stone, 20000);
    const pause = async (wanted: boolean) => {
      if (await page.evaluate(() => (window as any).__buildingProbe.paused()) !== wanted) await page.keyboard.press('F3');
    };
    const click = (key: string) => page.locator(`[data-command="${key}"]`).click();
    const select = async (id: number) => { await query({ type: 'select', ids: [id] }); };
    const runUntil = async (predicate: (s: any, a: any) => boolean, arg: any) => {
      await pause(false);
      try {
        await page.waitForFunction(async (code, arg) => new Function('s', 'a', `return (${code})(s,a)`)(
          await (window as any).__empiresDebug({ type: 'snapshot' }), arg),
        { timeout: 120_000, polling: 100 }, predicate.toString(), arg);
      } finally { await pause(true); }
    };
    for (let i = 0; i < 6; i++) await page.keyboard.press('+');
    const screen = async (target: { x: number; y: number }) => {
      await query({ type: 'look', rect: [target.x, target.y] });
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      return page.evaluate(at => (window as any).__buildingProbe.screen(at), target);
    };
    const military = async (worker = workers[0]) => {
      await select(worker.id);
      await page.waitForFunction(() => !!document.querySelector('[data-command="page-back"], [data-command="page-military"]'));
      if (await page.$('[data-command="page-back"]')) await click('page-back');
      await click('page-military');
      await page.waitForSelector('[data-command="build-palisade-wall"]');
    };
    const place = async (kind: BuildingKind, target: { x: number; y: number }, worker = workers[0]) => {
      await military(worker); await click(`build-${kind}`);
      const at = await screen(target); await page.mouse.move(at.x, at.y);
      await page.waitForFunction(({ kind, target }) => {
        const p = (window as any).__buildingProbe.preview();
        return p.kind === kind && p.target.x === target.x && p.target.y === target.y && p.tint === 0x7fff9e;
      }, {}, { kind, target });
      await page.mouse.click(at.x, at.y);
      if (await page.evaluate(() => !!(window as any).__buildingProbe.preview().kind)) await click('cancel');
      const site = (await snapshot()).entities.find((e: any) => e.kind === kind && e.owner === 1 && e.position.x === target.x && e.position.y === target.y);
      assert(site, `real placement of ${kind}`); return site;
    };
    const art = async (id: number, kind: string, minPieces = 1) => {
      await query({ type: 'look', entity: id });
      if (fallback) { assert((await query({ type: 'entities', id })).entities[0].rendered); return; }
      await page.waitForFunction(({ id, minPieces }) => {
        const a = (window as any).__buildingProbe.art(id);
        return a && !a.fallback && a.pieces.filter((p: any) => p.visible && p.image && !p.pending).length >= minPieces;
      }, { timeout: 120_000 }, { id, minPieces });
      const a = await page.evaluate(id => (window as any).__buildingProbe.art(id), id);
      assert.equal(a.key, civ === 'franks' ? `civilizations/franks/${kind}` : kind);
      const entity = (civ === 'franks' ? manifest.civilizations.franks : manifest).entities[kind];
      const images = new Set(Object.values(entity.atlases).flatMap((v: any) => [v.image, ...(v.pages ?? []).map((p: any) => p.image)]));
      for (const piece of a.pieces.filter((p: any) => p.visible)) assert(images.has(piece.image), JSON.stringify(a));
      return a;
    };
    const research = async (key: string, producer = university.id) => {
      await select(producer); await click(`research-${key}`);
      await runUntil((s, key) => s.players[1].researched.includes(key), key);
    };

    console.log(civ, 'wall drag, gate and tower');
    await military(); await click('build-stone-wall');
    await screen({ x: 42.5, y: 40.5 });
    const from = await page.evaluate(at => (window as any).__buildingProbe.screen(at), { x: 40.5, y: 40.5 });
    const to = await page.evaluate(at => (window as any).__buildingProbe.screen(at), { x: 44.5, y: 40.5 });
    const stoneBefore = (await snapshot()).players[1].stone;
    await page.mouse.move(from.x, from.y); await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 }); await page.mouse.up();
    if (await page.evaluate(() => !!(window as any).__buildingProbe.preview().kind)) await click('cancel');
    const walls = (await snapshot()).entities.filter((e: any) => e.owner === 1 && e.kind === 'stone-wall');
    assert.equal(walls.length, 5); assert.equal(stoneBefore - (await snapshot()).players[1].stone, 25);
    const gate = await place('stone-gate', { x: 47, y: 40.5 });
    const tower = await place('watch-tower', { x: 44.5, y: 47.5 }, workers[1]);
    await runUntil((s, ids) => ids.every((id: number) => s.entities.some((e: any) => e.id === id && e.buildProgress === undefined)),
      [...walls.map((e: any) => e.id), gate.id, tower.id]);
    await art(walls[2].id, 'stone-wall'); await art(gate.id, 'stone-gate', 5); await art(tower.id, 'watch-tower');
    if (!fallback) {
      await research('castle-age', home.id);
      const aged = await snapshot();
      const house = aged.entities.find((e: any) => e.id === wounded.id);
      assert.equal(house.maxHp, 900); assert.equal(house.hp, 883);
      assert(Math.abs(aged.entities.find((e: any) => e.id === walls[0].id).maxHp - 1800) < .001);
    }
    await research('guard-tower');
    assert.equal((await snapshot()).entities.find((e: any) => e.id === tower.id).kind, 'guard-tower');
    await art(tower.id, 'guard-tower');
    await research('fortified-wall');
    let s = await snapshot();
    assert(walls.every((w: any) => s.entities.some((e: any) => e.id === w.id && e.kind === 'fortified-wall')));
    assert.equal(s.entities.find((e: any) => e.id === gate.id).kind, 'fortified-gate');
    await art(walls[2].id, 'fortified-wall'); await art(gate.id, 'fortified-gate', 5);
    await military();
    assert(await page.$('[data-command="build-fortified-gate"]'));
    assert.equal(await page.$('[data-command="build-stone-gate"]'), null);
    // A real joining wall selects the other public gate axis.
    await place('fortified-wall', { x: 54.5, y: 40.5 }, workers[2]);
    const rotated = await place('fortified-gate', { x: 54.5, y: 43 }, workers[2]);
    await runUntil((s, id) => s.entities.some((e: any) => e.id === id && e.buildProgress === undefined), rotated.id);
    assert.deepEqual((await snapshot()).entities.find((e: any) => e.id === gate.id).footprint, { x: 2, y: .5 });
    assert.deepEqual((await snapshot()).entities.find((e: any) => e.id === rotated.id).footprint, { x: .5, y: 2 });
    await art(rotated.id, 'fortified-gate-y', 5);
    if (!fallback) await research('imperial-age', home.id);
    await select(university.id);
    await page.waitForSelector('[data-command="research-arrowslits"], [data-command="research-keep"]');
    if (civ === 'franks') assert.equal(await page.$('[data-command="research-keep"]'), null);
    else { await research('keep'); await art(tower.id, 'keep'); }
    if (!fallback) {
      await research('arrowslits');
      s = await snapshot();
      assert(s.players[1].researched.includes('automatic-610'));
      assert.equal(s.players[1].researched.includes('automatic-611'), civ === 'britons');
    }
    await page.reload({ waitUntil: 'domcontentloaded' }); await ready();
    s = await snapshot();
    assert.equal(s.players[1].civilization, civ);
    assert.equal(s.entities.find((e: any) => e.id === tower.id).kind, civ === 'franks' ? 'guard-tower' : 'keep');
    assert.equal(s.entities.find((e: any) => e.id === gate.id).kind, 'fortified-gate');
    assert.deepEqual(errors, []);
    console.log(`${civ}: BUILDINGS GREEN (${fallback
      ? 'real wall drag/gate/tower construction, paid fallback tiers, both gate axes and reload'
      : 'real wall drag/gate/tower construction, age HP, paid tiers, imported composites, Keep permission, Arrowslits descendants and reload'})`);
    await page.close();
  }
} finally { await browser.close(); await server.close(); }
