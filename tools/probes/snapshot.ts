/**
 * Photograph a state a fresh match cannot reach.
 *
 * Builds a Castle Age town in Node, hands it to the page as a dev-session
 * snapshot, and reports what each building actually drew. Change the `put`
 * calls to stage whatever you need to look at.
 */
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer';
import { FALLBACK_RULES, rulesFromManifest, type ContentManifest } from '../../src/sim/data';
import { createGame, stepGame } from '../../src/sim/game';
import type { BuildingKind, Entity, UnitKind } from '../../src/sim/types';

const ROOT = join(import.meta.dirname, '../..');
const PORT = Number(process.env.PROBE_PORT ?? 5300);
const BASE = `http://127.0.0.1:${PORT}`;
const MANIFEST = join(ROOT, 'public/imported/aoe2/manifest.json');
const rules = existsSync(MANIFEST)
  ? rulesFromManifest(JSON.parse(readFileSync(MANIFEST, 'utf8')) as ContentManifest)
  : FALLBACK_RULES;

// 1. Build the state through the simulation, not around it.
const state = createGame(11, rules);
state.players[1].age = 2;
state.players[1].researched.push('feudal-age', 'castle-age', 'man-at-arms');
const home = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
const put = (kind: BuildingKind | UnitKind, dx: number, dy: number) => {
  const r = (rules.buildings as Record<string, { hp: number; radius: number }>)[kind]
    ?? (rules.units as Record<string, { hp: number; radius: number }>)[kind];
  const entity: Entity = {
    id: state.nextId++, kind: kind as Entity['kind'], owner: 1,
    position: { x: home.position.x + dx, y: home.position.y + dy },
    hp: r.hp, maxHp: r.hp, radius: r.radius, activity: 'idle', order: { kind: 'idle' },
  };
  state.entities.push(entity);
  return entity;
};
put('barracks', 6, -4);
put('archery-range', 6, 1);
put('university', 11, -4);
put('man-at-arms', 2, 3);
for (let i = 0; i < 6; i++) stepGame(state);

// 2. `rules` is deliberately not part of the snapshot: a re-import must take
//    effect, and a snapshot taken under different content would resume against
//    mismatched entities. See src/dev-session.ts.
const { rules: _drop, ...rest } = state;
const snapshot = JSON.stringify({ version: 1, rulesOrigin: rules.origin, state: rest });

const extraLibs = join(homedir(), '.cache/puppeteer/extra-libs/usr/lib/x86_64-linux-gnu');
const launchEnv = existsSync(extraLibs)
  ? { ...process.env, LD_LIBRARY_PATH: [extraLibs, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') }
  : process.env;
const { createServer } = await import('vite');
// Its own port, and `root`/`configFile` explicitly: see tools/probes/README.md.
const server = await createServer({
  root: ROOT, configFile: join(ROOT, 'vite.config.ts'),
  server: { host: '127.0.0.1', port: PORT, strictPort: true },
});
await server.listen();
const browser = await puppeteer.launch({
  headless: true, env: launchEnv,
  // WSL2/CI have no GPU, and SwiftShader's WebGPU device dies under this app.
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebGPU'],
});
const query = async (payload: unknown) => {
  const response = await fetch(`${BASE}/__debug`, { method: 'POST', body: JSON.stringify(payload) });
  const body = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(body));
  return body as never;
};
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  page.on('pageerror', error => console.log('page error:', error.message));
  // 3. The snapshot has to be in sessionStorage *before* the page loads.
  await page.evaluateOnNewDocument(
    (raw: string) => sessionStorage.setItem('open-empires-lab:dev-session', raw), snapshot);
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 120_000 });
  await page.waitForFunction(() => document.querySelector('canvas.battlefield') !== null,
    { timeout: 120_000 });
  await sleep(4000);

  // 4. Ask the protocol what it drew. `animation` and `frame` are the fields
  //    that answer "which art", without anybody squinting at a screenshot.
  await query({ type: 'look', entity: home.id });
  await sleep(1200);
  for (const kind of ['town-center', 'barracks', 'archery-range', 'university', 'man-at-arms']) {
    const rows = ((await query({ type: 'entities', kind })) as { entities: Record<string, unknown>[] }).entities;
    for (const row of rows.filter(r => r.owner === 1)) {
      console.log(`${kind.padEnd(15)} animation=${row.animation} frame=${row.frame} colour=${row.colorTint}`);
    }
  }
  await page.screenshot({ path: join(ROOT, '.local/probes/snapshot.png') });
  console.log('screenshot: .local/probes/snapshot.png');
} finally {
  await browser.close();
  await server.close();
}
