/**
 * Photograph a coast: a beach tile with grass behind it and water before
 * it, at zoom 1, for the edge's shape against the reference's (#116). Also
 * measures the width of the sand-to-grass crossing along a screen row with
 * the `edge` query. `MAP=`, `SEED=`, `OUT=`.
 */
import { existsSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer';
import { createGame } from '../../src/sim/game';
import { readFileSync } from 'node:fs';
import { rulesFromManifest, type ContentManifest } from '../../src/sim/data';
import { TERRAIN_BEACH, isOpenWater } from '../../src/sim/mapgen';

const ROOT = join(import.meta.dirname, '../..');
const OUT = process.env.OUT ?? join(ROOT, '.local/probes');
const PORT = 5309;
const BASE = `http://127.0.0.1:${PORT}`;
const SEED = Number(process.env.SEED ?? 2);
const MAP = process.env.MAP ?? 'islands';
const rules = rulesFromManifest(JSON.parse(readFileSync(join(ROOT, 'public/imported/aoe2/manifest.json'), 'utf8')) as ContentManifest);
const state = createGame(SEED, rules, undefined, MAP);
const { width, height } = state;
const at = (x: number, y: number) => state.terrain[y * width + x];
// A beach tile with grass to its -y (up-left on screen) and water to its +y.
let coast: [number, number] | undefined;
for (let y = 8; y < height - 8 && !coast; y++) for (let x = 8; x < width - 8; x++) {
  const land = (id: number) => id !== TERRAIN_BEACH && !isOpenWater(id);
  if (at(x, y) === TERRAIN_BEACH && land(at(x, y - 1)) && land(at(x, y - 2)) && isOpenWater(at(x, y + 1))
    && at(x - 1, y) === TERRAIN_BEACH && at(x + 1, y) === TERRAIN_BEACH) { coast = [x, y]; break; }
}
console.log('coast tile', coast);

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
  return body;
};
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  page.on('pageerror', error => console.log('page error:', error.message));
  await page.goto(`${BASE}/?map=${MAP}&seed=${SEED}`, { waitUntil: 'networkidle2', timeout: 120_000 });
  await page.waitForFunction(() => document.querySelector('canvas.battlefield') !== null, { timeout: 120_000 });
  await sleep(5000);
  await page.keyboard.press('F4');
  await sleep(1500);
  await query({ type: 'look', rect: [coast![0] + 0.5, coast![1] + 0.5] });
  await sleep(2500);
  // Rows through the tile above the coast tile's centre: from grass (left,
  // up-screen) into sand. The coast tile's centre is the viewport's centre.
  for (const dy of [-60, -40, -20, 0]) {
    const edge = await query({ type: 'edge', from: [340, 400 + dy], to: [940, 400 + dy] });
    console.log('edge row', 400 + dy, JSON.stringify(edge).slice(0, 200));
  }
  const shot = await query({ type: 'pixels', rect: [340, 200, 600, 400], png: true });
  writeFileSync(join(OUT, 'coast.png'), Buffer.from(shot.png, 'base64'));
} finally {
  await browser.close();
  await server.close();
}
