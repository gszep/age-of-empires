/** Owned petard impact, live ram crew and siege-tower wall crossing via real input. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import { activateAutomaticTechnologies, createGame } from '../src/sim/game.ts';
import { buildingRulesFor, unitRulesFor } from '../src/sim/rules.ts';
import { isBuilding, rulesFromManifest } from '../src/sim/data.ts';
import { updateVisibility } from '../src/sim/visibility.ts';
import { SNAPSHOT_VERSION } from '../src/dev-session.ts';
import type { BuildingKind, UnitKind, Entity, PlayerId } from '../src/sim/types.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(readFileSync(`${root}public/imported/aoe2/manifest.json`, 'utf8'));
assert(manifest.entities.petard?.deathEffect && manifest.entities['siege-tower']?.unloadOverWall, 'full specialist import required');
const rules = rulesFromManifest(manifest);
const server = await createServer({ root, configFile: `${root}vite.config.ts`, plugins: [{
  name: 'specialist-readonly-observation', enforce: 'pre', transform(code, id) {
    if (!id.endsWith('/src/main.ts')) return;
    const anchor = 'renderer.setAnimationLoop(now => {'; assert(code.includes(anchor));
    return code.replace('let paused = false;', 'let paused = true;').replace(anchor, anchor + `
      Object.assign(globalThis, { __specialistProbe: {
        paused: () => paused,
        screen: at => { const iso = elevatedWorldToIso(game, at.x, at.y);
          const p = new THREE.Vector3(iso.x, iso.y, 0).project(camera);
          return { x: (p.x + 1) * innerWidth / 2, y: (1 - p.y) * innerHeight / 2 }; },
        art: id => { const e = game.entities.find(e => e.id === id), v = views.get('e' + id); if (!e || !v) return;
          const center = v.body.mesh.getWorldPosition(new THREE.Vector3()).project(camera);
          const w = Math.abs(v.body.mesh.scale.x * camera.zoom), h = Math.abs(v.body.mesh.scale.y * camera.zoom);
          return { key: artKey(assets, e, chooseAnimation(game, e).key, game.matchSeed),
            frame: v.frameIndex, animation: v.animationState, image: v.body.textureImage,
            visible: v.body.mesh.visible, pending: v.body.pendingTexture, fallback: v.fallback,
            rect: [(center.x + 1) * innerWidth / 2 - w/2, (1 - center.y) * innerHeight / 2 - h/2, w, h] }; },
      } });`);
  },
}], server: { host: '127.0.0.1', port: 5268, strictPort: true }, logLevel: 'error' });
await server.listen();
const libs = `${homedir()}/.cache/puppeteer/extra-libs/usr/lib/x86_64-linux-gnu`;
const browser = await puppeteer.launch({ headless: true,
  env: existsSync(libs) ? { ...process.env, LD_LIBRARY_PATH: libs } : process.env,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebGPU'] });
try {
  for (const civ of ['britons', 'franks']) {
    const state = createGame(161, rules, { 1: civ, 2: civ === 'britons' ? 'franks' : 'britons' });
    state.entities = state.entities.filter(e => e.kind === 'town-center' || e.owner === 1 && e.kind === 'villager');
    state.terrain.fill(0); state.elevation.fill(0);
    Object.assign(state.players[1], { age: 2, food: 20000, wood: 20000, gold: 20000, stone: 20000 });
    Object.assign(state.players[2], { age: 2, food: 0, wood: 0, gold: 0, stone: 0 });
    state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!.position = { x: 20, y: 45 };
    state.entities.find(e => e.owner === 2 && e.kind === 'town-center')!.position = { x: 85, y: 85 };
    state.entities.filter(e => e.owner === 1 && e.kind === 'villager')
      .forEach((e, i) => { e.position = { x: 36.5, y: 50.5 + i * 2 }; });
    // A non-attacking spotter keeps the real house target visible before and
    // after the petard dies; right-click must be an attack, not a fog move.
    state.entities.filter(e => e.owner === 1 && e.kind === 'villager')[2].position = { x: 47.5, y: 38.5 };
    activateAutomaticTechnologies(state);
    const add = (kind: BuildingKind | UnitKind, x: number, y: number, owner: PlayerId = 1): Entity => {
      const r = isBuilding(kind) ? buildingRulesFor(state, owner, kind) : unitRulesFor(state, owner, kind);
      const e: Entity = { id: state.nextId++, kind, owner, position: { x, y }, hp: r.hp, maxHp: r.hp,
        radius: r.radius, activity: 'idle', order: { kind: 'idle' } };
      state.entities.push(e); return e;
    };
    const castle = add('castle', 28, 40), workshop = add('siege-workshop', 30.5, 46.5);
    const crew = add('militia', 35.5, 50.5), towerCrew = add('militia', 35.5, 56.5);
    const worker = state.entities.find(e => e.owner === 1 && e.kind === 'villager')!;
    worker.position = { x: 36.5, y: 50.5 }; worker.carrying = { kind: 'food', amount: 7, node: 'berries' };
    const houseA = add('house', 58.5, 58.5, 2), houseB = add('house', 58.5, 64.5, 2);
    const blastHouse = add('house', 49.5, 41.5, 2), bystander = add('villager', 47.5, 41.5, 2);
    const wall = add('fortified-wall', 50.5, 75.5, 2);
    add('fortified-wall', 50.5, 74.5, 2); add('fortified-wall', 50.5, 76.5, 2);
    updateVisibility(state);
    const { rules: ignored, ...saved } = state;
    const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 800 });
    const errors: string[] = [];
    page.on('pageerror', e => { errors.push(String(e)); console.error(e); });
    const handle = await page.evaluateOnNewDocument(value => sessionStorage.setItem('open-empires-lab:dev-session', JSON.stringify(value)),
      { version: SNAPSHOT_VERSION, rulesOrigin: rules.origin, state: saved });
    const ready = () => page.waitForFunction(() => !!(window as any).__specialistProbe
      && typeof (window as any).__empiresDebug === 'function', { timeout: 120_000 });
    await page.goto('http://127.0.0.1:5268/?solo=1', { waitUntil: 'domcontentloaded' }); await ready();
    await page.removeScriptToEvaluateOnNewDocument(handle.identifier);
    const query = (q: object): Promise<any> => page.evaluate(q => (window as any).__empiresDebug(q), q);
    const snapshot = () => query({ type: 'snapshot' });
    const entity = async (id: number) => (await snapshot()).entities.find((e: any) => e.id === id);
    const pause = async (wanted: boolean) => {
      if (await page.evaluate(() => (window as any).__specialistProbe.paused()) !== wanted) await page.keyboard.press('F3');
    };
    const speed = async (fast: boolean) => { for (let i = 0; i < 6; i++) await page.keyboard.press(fast ? '+' : '-'); };
    const select = (ids: number[]) => query({ type: 'select', ids });
    const click = (key: string) => page.locator(`[data-command="${key}"]`).click();
    const runUntil = async (predicate: (s: any, a: any) => boolean, arg: any) => {
      await pause(false);
      try {
        await page.waitForFunction(async (code, arg) => new Function('s', 'a', `return (${code})(s,a)`)(
          await (window as any).__empiresDebug({ type: 'snapshot' }), arg),
        { timeout: 120_000, polling: 50 }, predicate.toString(), arg);
      } finally { await pause(true); }
    };
    const screen = async (point: { x: number; y: number }) => {
      await query({ type: 'look', rect: [point.x, point.y] });
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      return page.evaluate(at => (window as any).__specialistProbe.screen(at), point);
    };
    const rightClick = async (ids: number[], target: number) => {
      await select(ids);
      const at = await screen((await entity(target)).position);
      await page.mouse.move(at.x, at.y);
      await page.mouse.click(at.x, at.y, { button: 'right' });
    };
    const move = async (id: number, x: number, y: number) => {
      assert((await query({ type: 'command', command: { kind: 'order', player: 1, entityIds: [id], target: { x, y } } })).ok);
    };
    const idle = (s: any, ids: number[]) => ids.every(id => s.entities.find((e: any) => e.id === id)?.order.kind === 'idle');
    const rendered = async (id: number, kind: string) => {
      await query({ type: 'look', entity: id });
      await page.waitForFunction(id => { const a = (window as any).__specialistProbe.art(id);
        return a?.visible && a.image && !a.pending && !a.fallback; }, { timeout: 120_000 }, id);
      const a = await page.evaluate(id => (window as any).__specialistProbe.art(id), id);
      assert.equal(a.key, civ === 'franks' ? `civilizations/franks/${kind}` : kind);
      return a;
    };
    assert.equal((await snapshot()).players[1].civilization, civ, 'fixture resumed');
    assert.equal((await snapshot()).players[1].gold, 20000);
    await speed(true);
    console.log(civ, 'training specialists through real buttons');
    await select([castle.id]); await click('train-petard');
    await select([workshop.id]); await click('train-siege-tower');
    await click('train-battering-ram'); await click('train-battering-ram');
    assert.equal((await snapshot()).players[1].gold, 20000 - 20 - 120 - 75 * 2);
    await runUntil(s => s.entities.filter((e: any) => e.owner === 1 && e.kind === 'battering-ram').length === 2
      && s.entities.some((e: any) => e.owner === 1 && e.kind === 'petard') && s.entities.some((e: any) => e.owner === 1 && e.kind === 'siege-tower'), null);
    let s = await snapshot();
    const petard = s.entities.find((e: any) => e.owner === 1 && e.kind === 'petard');
    const tower = s.entities.find((e: any) => e.owner === 1 && e.kind === 'siege-tower');
    const [loaded, empty] = s.entities.filter((e: any) => e.owner === 1 && e.kind === 'battering-ram');
    await rendered(petard.id, 'petard'); await rendered(tower.id, 'siege-tower');
    console.log(civ, 'boarding ram and preserving cargo through reload');
    await rightClick([crew.id, worker.id], loaded.id);
    await runUntil((s, id) => s.entities.find((e: any) => e.id === id)?.garrison?.length === 2, loaded.id);
    const payload = (await entity(loaded.id)).garrison;
    assert.equal(payload.find((e: any) => e.id === worker.id).carrying.amount, 7);
    await page.reload({ waitUntil: 'domcontentloaded' }); await ready(); await speed(true);
    assert.deepEqual((await entity(loaded.id)).garrison, payload);
    await move(loaded.id, 42.5, 58.5); await move(empty.id, 42.5, 64.5);
    await runUntil(idle, [loaded.id, empty.id]);
    await speed(false);
    const beforeMove = await snapshot();
    await move(loaded.id, 52.5, 58.5); await move(empty.id, 52.5, 64.5);
    await runUntil((s, tick) => s.tick >= tick + 40, beforeMove.tick);
    s = await snapshot();
    const seconds = (s.tick - beforeMove.tick) * .05;
    const distance = (id: number) => s.entities.find((e: any) => e.id === id).position.x - beforeMove.entities.find((e: any) => e.id === id).position.x;
    assert(Math.abs(distance(loaded.id) / seconds - .65) < .015, `loaded movement ${distance(loaded.id)} / ${seconds}`);
    assert(Math.abs(distance(empty.id) / seconds - .6) < .015, `empty movement ${distance(empty.id)} / ${seconds}`);
    await speed(true);
    console.log(civ, 'actual ram target damage and unload reversal');
    await rightClick([loaded.id], houseA.id); await rightClick([empty.id], houseB.id);
    await runUntil((s, ids) => ids.every((id: number) => { const e = s.entities.find((e: any) => e.id === id); return e.hp < e.maxHp; }), [houseA.id, houseB.id]);
    const hitA = await entity(houseA.id), hitB = await entity(houseB.id);
    assert.equal((hitA.maxHp - hitA.hp) - (hitB.maxHp - hitB.hp), 10);
    await select([loaded.id]); await click('stop'); await click('ungarrison');
    await select([empty.id]); await click('stop');
    await move(crew.id, 40.5, 50.5); await move(worker.id, 40.5, 48.5);
    await move(loaded.id, 42.5, 58.5); await move(empty.id, 42.5, 64.5);
    await runUntil(idle, [loaded.id, empty.id, crew.id, worker.id]);
    await speed(false);
    const unloadedStart = await snapshot();
    await move(loaded.id, 52.5, 58.5); await move(empty.id, 52.5, 64.5);
    await runUntil((s, tick) => s.tick >= tick + 40, unloadedStart.tick);
    s = await snapshot();
    const travelled = (id: number) => s.entities.find((e: any) => e.id === id).position.x - unloadedStart.entities.find((e: any) => e.id === id).position.x;
    assert(Math.abs(travelled(loaded.id) - travelled(empty.id)) < .015);
    const beforeBaseHit = (await entity(houseA.id)).hp;
    await speed(true); await rightClick([loaded.id], houseA.id);
    await runUntil((s, a) => s.entities.find((e: any) => e.id === a.id).hp < a.hp, { id: houseA.id, hp: beforeBaseHit });
    assert.equal(beforeBaseHit - (await entity(houseA.id)).hp, hitB.maxHp - hitB.hp);
    await select([loaded.id]); await click('stop');

    console.log(civ, 'tower right-click crossing an intact fortified wall');
    await rightClick([towerCrew.id], tower.id);
    await runUntil((s, id) => s.entities.find((e: any) => e.id === id)?.garrison?.length === 1, tower.id);
    await move(tower.id, 47.5, 75.5); await runUntil(idle, [tower.id]);
    await speed(false); // stop the released infantry before its first autonomous swing
    await select([tower.id]);
    const atWall = await screen(wall.position); await page.mouse.move(atWall.x, atWall.y);
    await page.waitForFunction(() => [...document.querySelectorAll('canvas')].some(e => e.style.cursor.includes('unboard')));
    await page.mouse.click(atWall.x, atWall.y, { button: 'right' });
    assert.equal((await entity(tower.id)).order.kind, 'cross-wall');
    const wallHp = (await entity(wall.id)).hp;
    await runUntil((s, id) => !s.entities.find((e: any) => e.id === id)?.garrison?.length, tower.id);
    assert((await entity(towerCrew.id)).position.x > wall.position.x + .5);
    assert((await entity(tower.id)).position.x < wall.position.x - .5);
    assert.equal((await entity(wall.id)).hp, wallHp);
    await select([towerCrew.id]); await click('stop');

    console.log(civ, 'petard contact damage and rendered particle pixels');
    await speed(true);
    await move(petard.id, 44.5, 41.5);
    // Position, not an idle tick: the now-visible defender can be auto-acquired
    // on the following tick before the probe samples the completed move.
    await runUntil((s, id) => s.entities.find((e: any) => e.id === id)?.position.x >= 44.45, petard.id);
    assert(!(await entity(petard.id)).dead, 'petard reached the staged approach alive');
    await speed(false); await rightClick([petard.id], blastHouse.id);
    assert.deepEqual((await entity(petard.id)).order, { kind: 'attack', targetId: blastHouse.id });
    // The defender follows into melee contact, so the blast precondition does
    // not depend on which free corner the petard's navigation chooses.
    const attack = await query({ type: 'command', command: { kind: 'order', player: 2,
      entityIds: [bystander.id], target: (await entity(petard.id)).position, targetId: petard.id } });
    assert(attack.ok, JSON.stringify(attack));
    await screen({ x: 48.2, y: 41.5 });
    const oldHp = (await entity(blastHouse.id)).hp;
    await runUntil((s, id) => s.entities.some((e: any) => e.id === id && e.dead), petard.id);
    const died = (await snapshot()).tick;
    await runUntil((s, tick) => s.tick >= tick + 8, died);
    await page.waitForFunction(id => { const a = (window as any).__specialistProbe.art(id);
      return a?.visible && a.image?.includes('impact_petard') && !a.pending && a.frame > 10; }, { timeout: 30_000 }, petard.id);
    const explosion = await page.evaluate(id => (window as any).__specialistProbe.art(id), petard.id);
    assert.equal(explosion.image, manifest.particles.impact_petard.atlas.image);
    assert(oldHp - (await entity(blastHouse.id)).hp >= 500);
    assert((await entity(bystander.id)).dead, JSON.stringify({ petard: await entity(petard.id), defender: await entity(bystander.id) }));
    const [x, y, w, h] = explosion.rect;
    const crop = [x + w * .5, y + h * .2, w * .3, h * .6];
    const peak = await query({ type: 'pixels', rect: crop, match: '#ff9933', tolerance: 110 });
    await runUntil((s, tick) => s.tick >= tick + 34, died);
    const gone = await query({ type: 'pixels', rect: crop, match: '#ff9933', tolerance: 110 });
    assert.equal(peak.colorSpace, gone.colorSpace);
    assert(peak.matched > gone.matched, `explosion pixels ${peak.matched} -> ${gone.matched} (${peak.colorSpace})`);
    console.log(`${civ}: SPECIALISTS GREEN; ram .65 vs .6 tiles/s and +10 building damage reversed on unload; tower crosses intact wall; petard pixels ${peak.matched} -> ${gone.matched} (${peak.colorSpace})`);
    assert.deepEqual(errors, []);
    await page.close();
  }
} catch (error) { console.error('SPECIALIST ACCEPTANCE FAILED', error); throw error; }
finally { await browser.close(); await server.close(); }
