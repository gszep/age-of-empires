/** #84: sample actual minimap pixels for live and remembered buildings. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import { createGame } from '../src/sim/game.ts';
import { FALLBACK_RULES, rulesFromManifest } from '../src/sim/data.ts';
import { SNAPSHOT_VERSION } from '../src/dev-session.ts';
import type { BuildingKind, Entity } from '../src/sim/types.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = `${root}public/imported/aoe2/manifest.json`;
const rules = existsSync(manifest) ? rulesFromManifest(JSON.parse(readFileSync(manifest, 'utf8'))) : FALLBACK_RULES;
const state = createGame(84, rules);
state.entities = [];
state.terrain.fill(0);
state.visibility[1].visible.fill(0);
state.visibility[1].explored.fill(1);
state.visibility[1].memory = {};
function building(kind: BuildingKind, owner: 1 | 2, x: number, y: number): Entity {
  const r = rules.buildings[kind];
  const entity: Entity = { id: state.nextId++, kind, owner, position: { x, y },
    hp: r.hp, maxHp: r.hp, radius: r.radius, activity: 'idle', order: { kind: 'idle' } };
  state.entities.push(entity);
  return entity;
}
const home = building('town-center', 1, 15.5, 25.5);
const house = building('house', 1, 45.5, 25.5);
const tower = building('watch-tower', 1, 75.5, 25.5);
const farm = building('farm', 1, 95.5, 25.5);
const memory = building('castle', 2, 55.5, 85.5);
building('town-center', 2, 105.5, 100.5);
state.visibility[1].memory[memory.id] = { id: memory.id, kind: memory.kind, owner: 2,
  x: memory.position.x, y: memory.position.y, hp: memory.hp, maxHp: memory.maxHp, lastSeenAt: 0 };
const { rules: ignored, ...saved } = state;
const server = await createServer({ root, configFile: `${root}vite.config.ts`,
  server: { host: '127.0.0.1', port: 5214, strictPort: true }, logLevel: 'error' });
await server.listen();
const libs = `${homedir()}/.cache/puppeteer/extra-libs/usr/lib/x86_64-linux-gnu`;
const browser = await puppeteer.launch({ headless: true, env: existsSync(libs) ? { ...process.env, LD_LIBRARY_PATH: libs } : process.env,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebGPU'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 2000, height: 1125 });
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.evaluateOnNewDocument(snapshot => sessionStorage.setItem('open-empires-lab:dev-session', JSON.stringify(snapshot)),
    { version: SNAPSHOT_VERSION, rulesOrigin: rules.origin, state: saved });
  await page.goto('http://127.0.0.1:5214/?solo=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).__empiresDebug === 'function', { timeout: 120_000, polling: 100 });
  const query = (q: object): Promise<any> => page.evaluate(q => (window as any).__empiresDebug(q), q);
  await page.keyboard.press('F3');
  const snapshot = await query({ type: 'snapshot' });
  assert(snapshot.entities.some((e: any) => e.id === house.id && e.kind === 'house'), 'fixture resumed');
  assert.equal(snapshot.visibility[1].visible[Math.floor(memory.position.y) * state.width + Math.floor(memory.position.x)], 0);
  const sample = (entity: Entity) => page.evaluate(({ entity, width, height }) => {
    const canvas = document.querySelector<HTMLCanvasElement>('#minimap-canvas')!;
    const x = canvas.width / 2 + (entity.position.y - entity.position.x) * canvas.width / (width + height);
    const y = (entity.position.x + entity.position.y) * canvas.height / (width + height);
    const data = canvas.getContext('2d')!.getImageData(Math.round(x) - 6, Math.round(y) - 6, 12, 12).data;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      const color = entity.owner === 1 ? data[i + 2] > 180 && data[i] < 80 && data[i + 1] < 140
        : data[i] > 180 && data[i + 1] < 100 && data[i + 2] < 100;
      if (color) count++;
    }
    return { count, cssWidth: 2 * canvas.getBoundingClientRect().width / canvas.width,
      cssHeight: 2 * canvas.getBoundingClientRect().height / canvas.height };
  }, { entity, width: state.width, height: state.height });
  // The minimap redraw is throttled independently of the simulation pause.
  await page.waitForFunction(() => new Promise(resolve => setTimeout(() => resolve(true), 600)));
  for (const entity of [home, house, tower, memory]) {
    const pixels = await sample(entity);
    assert.equal(pixels.count, 4, `${entity.kind}: a two-by-two marker in sRGB canvas readback`);
    assert(Math.abs(pixels.cssWidth - 3) < 0.3 && Math.abs(pixels.cssHeight - 3) < 0.3);
  }
  assert.equal((await sample(farm)).count, 0, 'farm minimap mode 0 has no player-coloured dot');
  await page.keyboard.press('F4');
  await page.waitForFunction(() => new Promise(resolve => setTimeout(() => resolve(true), 600)));
  assert.equal((await sample(memory)).count, 4, 'revealing the remembered castle does not change its marker size');
  assert.deepEqual(errors, []);
  console.log('MINIMAP MARKERS SMOKE GREEN: 2×2 backing pixels (about 3×3 CSS at reference scale), live/memory parity, no farm dot');
} finally { await browser.close(); await server.close(); }
