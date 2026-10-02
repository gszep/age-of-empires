/** #133: private-browser public move orders and actual imported gate poses. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import { createGame } from '../src/sim/game.ts';
import { rulesFromManifest } from '../src/sim/data.ts';
import { updateVisibility } from '../src/sim/visibility.ts';
import { SNAPSHOT_VERSION } from '../src/dev-session.ts';
import type { Entity, Point } from '../src/sim/types.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const rules = rulesFromManifest(JSON.parse(readFileSync(`${root}public/imported/aoe2/manifest.json`, 'utf8')));
const server = await createServer({ root, configFile: `${root}vite.config.ts`, plugins: [{
  name: 'gate-observation', enforce: 'pre', transform(code, id) {
    if (!id.endsWith('/src/main.ts')) return;
    const anchor = 'renderer.setAnimationLoop(now => {';
    assert(code.includes(anchor));
    const ai = 'for (const command of exampleAiCommands(observe(game, 2))) applyCommand(game, command);';
    assert(code.includes(ai));
    return code.replace(ai, '').replace('let paused = false;', 'let paused = true;').replace(anchor, anchor + `
      Object.assign(globalThis, { __gateProbe: { paused: () => paused, art: id => {
        const v = views.get('e' + id);
        return v && { animation: v.animationState, fallback: v.fallback,
          pieces: [v.body, ...v.annexes].filter(p => p.mesh.visible).map(p => ({ image: p.textureImage, pending: p.pendingTexture })) };
      } } });`);
  },
}], server: { host: '127.0.0.1', port: 5273, strictPort: true }, logLevel: 'error' });
await server.listen();
const libs = `${homedir()}/.cache/puppeteer/extra-libs/usr/lib/x86_64-linux-gnu`;
const browser = await puppeteer.launch({ headless: true,
  env: existsSync(libs) ? { ...process.env, LD_LIBRARY_PATH: libs } : process.env,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebGPU'] });
try {
  for (const [kind, axis] of [['palisade-gate', 'x'], ['stone-gate', 'y'], ['fortified-gate', 'x']] as const) {
    const state = createGame(133, rules, { 1: 'britons', 2: 'britons' });
    state.entities = state.entities.filter(e => e.kind === 'town-center');
    state.terrain.fill(0); state.elevation.fill(0);
    const at = (along: number, across: number): Point => axis === 'x' ? { x: along, y: across } : { x: across, y: along };
    const r = rules.buildings[kind], half = kind === 'palisade-gate' ? 1 : 2;
    const gate: Entity = { id: state.nextId++, kind, owner: 1, position: at(40, 40.5),
      hp: r.hp, maxHp: r.hp, radius: r.radius, gateState: 'closed',
      footprint: axis === 'x' ? { x: half, y: .5 } : { x: .5, y: half }, activity: 'idle', order: { kind: 'idle' } };
    state.entities.push(gate);
    for (let n = 0; n < state.width; n++) {
      if (n >= 40 - half && n < 40 + half) continue;
      state.entities.push({ ...gate, id: state.nextId++, kind: 'palisade-wall', radius: .5,
        footprint: { x: .5, y: .5 }, position: at(n + .5, 40.5), gateState: undefined });
    }
    const add = (owner: 1 | 2, across: number) => {
      const u = rules.units.villager;
      const e: Entity = { id: state.nextId++, kind: 'villager', owner, position: at(39.5, across),
        hp: u.hp, maxHp: u.hp, radius: u.radius, activity: 'idle', order: { kind: 'idle' } };
      state.entities.push(e); return e;
    };
    const friend = add(1, 32.5), enemy = add(2, 48.5);
    updateVisibility(state);
    const { rules: ignored, ...saved } = state;
    const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 800 });
    const errors: string[] = []; page.on('pageerror', e => errors.push(String(e)));
    const handle = await page.evaluateOnNewDocument(value => sessionStorage.setItem('open-empires-lab:dev-session', JSON.stringify(value)),
      { version: SNAPSHOT_VERSION, rulesOrigin: rules.origin, state: saved });
    await page.goto('http://127.0.0.1:5273/?solo=1', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!(window as any).__gateProbe && typeof (window as any).__empiresDebug === 'function', { timeout: 120_000 });
    await page.removeScriptToEvaluateOnNewDocument(handle.identifier);
    const query = (q: object): Promise<any> => page.evaluate(q => (window as any).__empiresDebug(q), q);
    const snapshot = () => query({ type: 'snapshot' });
    assert.equal((await snapshot()).entities.find((e: any) => e.id === gate.id)?.kind, kind, 'fixture resumed');
    await query({ type: 'look', entity: gate.id });
    const pause = async (wanted: boolean) => {
      if (await page.evaluate(() => (window as any).__gateProbe.paused()) !== wanted) await page.keyboard.press('F3');
    };
    const runUntil = async (predicate: (s: any, a: any) => boolean, arg: any) => {
      await pause(false);
      try {
        await page.waitForFunction(async (code, arg) => new Function('s', 'a', `return (${code})(s,a)`)(
          await (window as any).__empiresDebug({ type: 'snapshot' }), arg),
        { timeout: 120_000, polling: 50 }, predicate.toString(), arg);
      } catch (error) {
        const s = await snapshot();
        console.error(kind, axis, 'failed predicate', predicate.toString(), 'tick', s.tick,
          s.entities.filter((e: any) => [gate.id, friend.id, enemy.id].includes(e.id)));
        throw error;
      } finally { await pause(true); }
    };
    const move = async (e: Entity, across: number) => {
      assert.equal((await query({ type: 'command', command: { kind: 'order', player: e.owner,
        entityIds: [e.id], target: at(39.5, across) } })).ok, true);
    };
    const art = async (pose: 'open' | 'idle') => {
      await page.waitForFunction(({ id, pose }) => {
        const a = (window as any).__gateProbe.art(id);
        return a && !a.fallback && a.animation?.endsWith('/' + pose)
          && a.pieces.length > 0 && a.pieces.every((p: any) => p.image && !p.pending);
      }, { timeout: 120_000 }, { id: gate.id, pose });
    };
    for (let n = 0; n < 3; n++) await page.keyboard.press('+');
    await move(friend, 42.5);
    await runUntil((s, id) => s.entities.find((e: any) => e.id === id)?.gateState === 'open', gate.id);
    await art('open');
    await runUntil((s, id) => s.entities.find((e: any) => e.id === id)?.order.kind === 'idle', friend.id);
    const across = axis === 'x' ? 'y' : 'x';
    assert((await snapshot()).entities.find((e: any) => e.id === friend.id).position[across] > 42);
    // Owner holds the far side open; enemy tries to follow through it.
    await move(enemy, 35.5);
    await runUntil((s, id) => s.entities.find((e: any) => e.id === id)?.gateState === 'blocked', gate.id);
    await art('idle');
    const closedTick = (await snapshot()).tick;
    await runUntil((s, tick) => s.tick >= tick + 60, closedTick);
    let current = await snapshot();
    assert.equal(current.entities.find((e: any) => e.id === gate.id).gateState, 'blocked');
    assert(current.entities.find((e: any) => e.id === enemy.id).position[across] > 41, 'enemy stopped outside the doorway');
    await move(enemy, 48.5);
    await runUntil((s, id) => s.entities.find((e: any) => e.id === id)?.gateState === 'open', gate.id);
    await art('open');
    await move(friend, 34.5);
    await runUntil((s, id) => s.entities.find((e: any) => e.id === id)?.order.kind === 'idle', friend.id);
    current = await snapshot();
    assert(current.entities.find((e: any) => e.id === friend.id).position[across] < 35);
    assert.equal(current.entities.find((e: any) => e.id === gate.id).gateState, 'closed');
    await art('idle');
    assert.deepEqual(errors, []);
    console.log(`${kind}/${axis}: GREEN — owner crosses, enemy closes shared leaf, retreat reopens, owner returns and gate shuts; imported poses match`);
    await page.close();
  }
} finally { await browser.close(); await server.close(); }
