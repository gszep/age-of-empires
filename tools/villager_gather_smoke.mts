/** #132: real right-clicks produce the task's actual banked load. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import { createGame } from '../src/sim/game.ts';
import { FALLBACK_RULES, rulesFromManifest } from '../src/sim/data.ts';
import { SNAPSHOT_VERSION } from '../src/dev-session.ts';
import type { Entity } from '../src/sim/types.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = `${root}public/imported/aoe2/manifest.json`;
const rules = existsSync(manifest) ? rulesFromManifest(JSON.parse(readFileSync(manifest, 'utf8'))) : FALLBACK_RULES;
const server = await createServer({ root, configFile: `${root}vite.config.ts`,
  server: { host: '127.0.0.1', port: 5217, strictPort: true }, logLevel: 'error' });
await server.listen();
const libs = `${homedir()}/.cache/puppeteer/extra-libs/usr/lib/x86_64-linux-gnu`;
const browser = await puppeteer.launch({ headless: true, env: existsSync(libs) ? { ...process.env, LD_LIBRARY_PATH: libs } : process.env,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebGPU'] });
try {
  for (const [kind, expected] of [['deer', 35], ['farm', 10]] as const) {
    const state = createGame(132, rules);
    state.entities = state.entities.filter(e => e.owner !== 0);
    state.terrain = state.terrain.map(() => 0);
    const home = state.entities.find(e => e.kind === 'town-center' && e.owner === 1)!;
    const worker = state.entities.find(e => e.kind === 'villager' && e.owner === 1)!;
    const base = kind === 'farm' ? rules.buildings.farm : rules.units.deer;
    const node: Entity = { id: state.nextId++, kind, owner: kind === 'farm' ? 1 : 0,
      position: { x: home.position.x + 7, y: home.position.y }, hp: base.hp, maxHp: base.hp,
      radius: base.radius, amount: 200, resourceKind: 'food', activity: 'idle', order: { kind: 'idle' },
      dead: kind === 'deer', decayTicks: 60 };
    state.entities.push(node);
    const before = state.players[1].food;
    const { rules: ignored, ...saved } = state;
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.evaluateOnNewDocument(snapshot => sessionStorage.setItem('open-empires-lab:dev-session', JSON.stringify(snapshot)),
      { version: SNAPSHOT_VERSION, rulesOrigin: rules.origin, state: saved });
    await page.goto('http://127.0.0.1:5217/?solo=1', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof (window as any).__empiresDebug === 'function', { timeout: 120_000, polling: 100 });
    const query = (q: object): Promise<any> => page.evaluate(q => (window as any).__empiresDebug(q), q);
    await page.keyboard.press('F3');
    assert((await query({ type: 'snapshot' })).entities.some((e: any) => e.id === node.id && e.kind === kind), 'fixture resumed');
    await query({ type: 'look', entity: node.id });
    await query({ type: 'select', ids: [worker.id] });
    const drawn = (await query({ type: 'entities', id: node.id, dead: true })).entities[0];
    await page.mouse.click(drawn.screen.x, drawn.screen.y, { button: 'right' });
    assert.deepEqual((await query({ type: 'snapshot' })).entities.find((e: any) => e.id === worker.id).order,
      { kind: 'gather', targetId: node.id });
    for (let i = 0; i < 6; i++) await page.keyboard.press('+');
    await page.keyboard.press('F3');
    await page.waitForFunction(async food => {
      const state = await (window as any).__empiresDebug({ type: 'snapshot' });
      return state.players[1].food > food;
    }, { timeout: 120_000, polling: 100 }, before);
    const result = await query({ type: 'snapshot' });
    assert.equal(result.players[1].food - before, expected);
    assert.deepEqual(errors, []);
    console.log(`${kind}: right-click → gather → bank ${expected} food GREEN (${rules.origin})`);
    await page.close();
  }
} finally { await browser.close(); await server.close(); }
