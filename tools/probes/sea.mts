/**
 * Photograph the sea: the shallow rim and the open body, read back as mean
 * colours against the reference screenshot (docs/status.md "Water"). MAP=,
 * SEED=, EXTRA= (a query string), OUT=.
 */
/** Photograph the Islands sea: the rim and the open body, against the reference's numbers. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer';
import { createGame } from '../../src/sim/game';
import { rulesFromManifest, type ContentManifest } from '../../src/sim/data';
import { TERRAIN_WATER, TERRAIN_WATER_MEDIUM, isOpenWater } from '../../src/sim/mapgen';

const ROOT = join(import.meta.dirname, '../..');
const OUT = process.env.OUT ?? join(ROOT, '.local/probes');
const PORT = 5307;
const BASE = `http://127.0.0.1:${PORT}`;
const SEED = Number(process.env.SEED ?? 2);
const rules = rulesFromManifest(JSON.parse(readFileSync(join(ROOT, 'public/imported/aoe2/manifest.json'), 'utf8')) as ContentManifest);
const MAP = process.env.MAP ?? 'islands';
const state = createGame(SEED, rules, undefined, MAP);
const { width, height } = state;
const landWithin = (x: number, y: number, reach: number) => {
  for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
    if (!isOpenWater(state.terrain[ny * width + nx])) return true;
  }
  return false;
};
// A rim tile three off the land, a medium tile nine off it, each well inside the board.
let rim: [number, number] | undefined, open: [number, number] | undefined;
for (let y = 5; y < height - 5 && !(rim && open); y++) for (let x = 5; x < width - 5; x++) {
  const id = state.terrain[y * width + x];
  if (!rim && id === TERRAIN_WATER && (MAP !== 'islands' || (!landWithin(x, y, 2) && landWithin(x, y, 3)))) rim = [x, y];
  if (!open && id === TERRAIN_WATER_MEDIUM && !landWithin(x, y, 9)) open = [x, y];
}
console.log('rim tile', rim, 'open tile', open);

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
  page.on('console', msg => { if (msg.type() === 'error') console.log('console error:', msg.text()); });
  await page.goto(`${BASE}/?map=${MAP}&seed=${SEED}${process.env.EXTRA ?? ''}`, { waitUntil: 'networkidle2', timeout: 120_000 });
  await page.waitForFunction(() => document.querySelector('canvas.battlefield') !== null, { timeout: 120_000 });
  await sleep(5000);
  await page.keyboard.press('F4');
  await sleep(1500);
  for (const [name, tile] of ([['rim', rim!], ['open', open!]] as const).filter(([, t]) => t)) {
    await query({ type: 'look', rect: [tile[0] + 0.5, tile[1] + 0.5] });
    await sleep(2500);
    const stats = await query({ type: 'pixels', rect: [600, 330, 80, 40] });
    console.log(name, JSON.stringify(stats.mean ?? stats).slice(0, 300));
    const shot = await query({ type: 'pixels', rect: [340, 150, 600, 400], png: true });
    writeFileSync(join(OUT, `sea-${name}.png`), Buffer.from(shot.png, 'base64'));
  }
  // The minimap's most common colours.
  const colours = await page.evaluate(() => {
    const map = [...document.querySelectorAll('canvas')].find(c => !c.classList.contains('battlefield'))!;
    const { data } = map.getContext('2d')!.getImageData(0, 0, map.width, map.height);
    const counts: Record<string, number> = {};
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue;
      const key = `${data[i]},${data[i + 1]},${data[i + 2]}`;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6);
  });
  console.log('minimap', colours);
  const dataUrl = await page.evaluate(() => [...document.querySelectorAll('canvas')].find(c => !c.classList.contains('battlefield'))!.toDataURL('image/png'));
  writeFileSync(join(OUT, 'minimap.png'), Buffer.from(dataUrl.split(',')[1], 'base64'));
} finally {
  await browser.close();
  await server.close();
}
