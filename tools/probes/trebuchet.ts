/**
 * Issue #30: what does a trebuchet actually draw while it attacks?
 *
 * Stages an unpacked trebuchet bombarding an enemy house, hands it to the page
 * as a dev-session snapshot, and samples the animation name and frame the view
 * chose over a few seconds -- the frame advancing is the animation playing.
 * Also reports the projectile art key in flight.
 */
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer';
import { FALLBACK_RULES, rulesFromManifest, type ContentManifest } from '../../src/sim/data';
import { applyCommand, createGame, stepGame } from '../../src/sim/game';
import type { Entity } from '../../src/sim/types';

const ROOT = join(import.meta.dirname, '../..');
const PORT = Number(process.env.PROBE_PORT ?? 5301);
const BASE = `http://127.0.0.1:${PORT}`;
const MANIFEST = join(ROOT, 'public/imported/aoe2/manifest.json');
const rules = existsSync(MANIFEST)
  ? rulesFromManifest(JSON.parse(readFileSync(MANIFEST, 'utf8')) as ContentManifest)
  : FALLBACK_RULES;

const state = createGame(11, rules);
state.players[1].age = 3;
const home = state.entities.find(e => e.owner === 1 && e.kind === 'town-center')!;
const put = (kind: Entity['kind'], owner: 1 | 2, dx: number, dy: number, hp = 0) => {
  const r = (rules.buildings as Record<string, { hp: number; radius: number }>)[kind]
    ?? (rules.units as Record<string, { hp: number; radius: number }>)[kind];
  const entity: Entity = {
    id: state.nextId++, kind, owner,
    position: { x: home.position.x + dx, y: home.position.y + dy },
    hp: hp || r.hp, maxHp: r.hp, radius: r.radius, activity: 'idle', order: { kind: 'idle' },
  };
  state.entities.push(entity);
  return entity;
};
const treb = put('trebuchet', 1, 4, 0);
const house = put('house', 2, 14, 0, 100_000);
house.maxHp = 100_000; // a target that survives the whole observation
applyCommand(state, { kind: 'pack', player: 1, entityIds: [treb.id], unpacked: true });
for (let i = 0; i < 400 && !treb.unpacked; i++) stepGame(state);
applyCommand(state, {
  kind: 'order', player: 1, entityIds: [treb.id], target: house.position, targetId: house.id,
});
for (let i = 0; i < 4; i++) stepGame(state);
console.log('staged: unpacked', treb.unpacked, 'activity', treb.activity);

const { rules: _drop, ...rest } = state;
const snapshot = JSON.stringify({ version: 1, rulesOrigin: rules.origin, state: rest });

const extraLibs = join(homedir(), '.cache/puppeteer/extra-libs/usr/lib/x86_64-linux-gnu');
const launchEnv = existsSync(extraLibs)
  ? { ...process.env, LD_LIBRARY_PATH: [extraLibs, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') }
  : process.env;
const { createServer } = await import('vite');
const server = await createServer({
  root: ROOT, configFile: join(ROOT, 'vite.config.ts'),
  server: { host: '127.0.0.1', port: PORT, strictPort: true },
});
await server.listen();
const browser = await puppeteer.launch({
  headless: true, env: launchEnv,
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
  await page.evaluateOnNewDocument(
    (raw: string) => sessionStorage.setItem('open-empires-lab:dev-session', raw), snapshot);
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 120_000 });
  await page.waitForFunction(() => document.querySelector('canvas.battlefield') !== null,
    { timeout: 120_000 });
  await sleep(3000);
  await query({ type: 'look', entity: treb.id });
  await sleep(500);
  for (let sample = 0; sample < 14; sample++) {
    const rows = ((await query({ type: 'entities', kind: 'trebuchet' })) as
      { entities: Record<string, unknown>[] }).entities;
    for (const row of rows) {
      console.log(`t+${sample * 400}ms activity=${row.activity} animation=${row.animation} frame=${row.frame}`);
    }
    await sleep(400);
  }
  await page.screenshot({ path: join(ROOT, '.local/treb-probe.png') });
  console.log('screenshot: .local/treb-probe.png');
} finally {
  await browser.close();
  await server.close();
}
