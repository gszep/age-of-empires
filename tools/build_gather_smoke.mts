/** #79: right-click a camp foundation, finish it, then gather without another order. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import { addNode, createGame } from '../src/sim/game.ts';
import { FALLBACK_RULES, rulesFromManifest } from '../src/sim/data.ts';
import { SNAPSHOT_VERSION } from '../src/dev-session.ts';
import type { Entity } from '../src/sim/types.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = `${root}public/imported/aoe2/manifest.json`;
const rules = existsSync(manifest) ? rulesFromManifest(JSON.parse(readFileSync(manifest, 'utf8'))) : FALLBACK_RULES;
const server = await createServer({ root, configFile: `${root}vite.config.ts`,
  server: { host: '127.0.0.1', port: 5214, strictPort: true }, logLevel: 'error' });
await server.listen();
const libs = `${homedir()}/.cache/puppeteer/extra-libs/usr/lib/x86_64-linux-gnu`;
const browser = await puppeteer.launch({ headless: true, env: existsSync(libs) ? { ...process.env, LD_LIBRARY_PATH: libs } : process.env,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebGPU'] });
try {
  for (const [kind, nodeKind] of [['lumber-camp', 'tree'], ['mining-camp', 'gold'], ['mill', 'berries']] as const) {
    const state = createGame(79, rules);
    state.entities = state.entities.filter(e => e.owner !== 0);
    state.terrain.fill(0);
    const home = state.entities.find(e => e.kind === 'town-center' && e.owner === 1)!;
    const workers = state.entities.filter(e => e.kind === 'villager' && e.owner === 1);
    const site: Entity = { id: state.nextId++, kind, owner: 1,
      position: { x: home.position.x + 7, y: home.position.y },
      hp: rules.buildings[kind].hp, maxHp: rules.buildings[kind].hp, radius: rules.buildings[kind].radius,
      buildProgress: 0.95, activity: 'idle', order: { kind: 'idle' } };
    state.entities.push(site);
    const node = addNode(state, nodeKind, { x: site.position.x + 3, y: site.position.y });
    const amount = node.amount!;
    const { rules: ignored, ...saved } = state;
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.evaluateOnNewDocument(snapshot => sessionStorage.setItem('open-empires-lab:dev-session', JSON.stringify(snapshot)),
      { version: SNAPSHOT_VERSION, rulesOrigin: rules.origin, state: saved });
    await page.goto('http://127.0.0.1:5214/?solo=1', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof (window as any).__empiresDebug === 'function', { timeout: 120_000, polling: 100 });
    const query = (q: object): Promise<any> => page.evaluate(q => (window as any).__empiresDebug(q), q);
    await page.keyboard.press('F3');
    assert((await query({ type: 'snapshot' })).entities.some((e: any) => e.id === site.id && e.kind === kind && e.buildProgress !== undefined), 'fixture resumed');
    await query({ type: 'look', entity: site.id });
    await query({ type: 'select', ids: workers.map(e => e.id) });
    const drawn = (await query({ type: 'entities', id: site.id })).entities[0];
    await page.mouse.click(drawn.screen.x, drawn.screen.y, { button: 'right' });
    assert.equal((await query({ type: 'snapshot' })).entities.filter((e: any) => e.order.kind === 'build' && e.order.targetId === site.id).length, workers.length);
    for (let i = 0; i < 6; i++) await page.keyboard.press('+');
    await page.keyboard.press('F3');
    await page.waitForFunction(async ({ siteId, nodeId, amount }) => {
      const state = await (window as any).__empiresDebug({ type: 'snapshot' });
      return state.entities.find((e: any) => e.id === siteId)?.buildProgress === undefined
        && state.entities.find((e: any) => e.id === nodeId)?.amount < amount;
    }, { timeout: 60_000, polling: 100 }, { siteId: site.id, nodeId: node.id, amount });
    const working = await query({ type: 'snapshot' });
    assert(working.entities.some((e: any) => e.order.kind === 'gather' && e.order.targetId === node.id));
    assert.deepEqual(errors, []);
    console.log(`${kind}: right-click → construction → automatic ${nodeKind} gathering GREEN (${rules.origin})`);
    await page.close();
  }
} finally { await browser.close(); await server.close(); }
