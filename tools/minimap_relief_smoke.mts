/** #96: actual sRGB canvas pixels for relief, forests, fog and palette refresh. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import { createGame } from '../src/sim/game.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(readFileSync(`${root}public/imported/aoe2/manifest.json`, 'utf8'));
// Exact palette entries, read from original.pal and terrain slots 0/10. These
// are exact colour expectations. The editor screenshot supplies the screen-right
// lighting orientation; the game's full discrete slope classifier is inferred.
const grass = [[0, 169, 0], [51, 151, 39], [0, 141, 0]];
const forest = [[37, 116, 57], [21, 118, 21], [0, 114, 0]];
assert.deepEqual(manifest.terrain.ground.minimapShades, grass);
assert.deepEqual(manifest.terrain.forest.minimapShades, forest);
assert.equal(manifest.terrain['water-medium'].terrainId, 23);
const state = createGame(96);
state.width = 12; state.height = 8; state.entities = [];
state.terrain = new Array(96).fill(0);
state.elevation = new Array(96).fill(0);
for (const player of [1, 2] as const) {
  state.visibility[player] = { explored: new Array(96).fill(1), visible: new Array(96).fill(1), memory: {} };
}
const server = await createServer({ root, configFile: `${root}vite.config.ts`,
  server: { host: '127.0.0.1', port: 5228, strictPort: true }, logLevel: 'error',
  plugins: [{ name: 'minimap-fixture', configureServer(server) {
    server.middlewares.use('/__minimap_fixture', (_req, res) => {
      res.setHeader('Content-Type', 'text/html');
      // tsx preserves local function names with this helper when Puppeteer
      // serializes the fixture callback. It has no bearing on the game module.
      res.end('<!doctype html><script>window.__name = fn => fn;</script><canvas id="probe" width="240" height="160"></canvas>');
    });
  } }] });
await server.listen();
const libs = `${homedir()}/.cache/puppeteer/extra-libs/usr/lib/x86_64-linux-gnu`;
const browser = await puppeteer.launch({ headless: true,
  env: existsSync(libs) ? { ...process.env, LD_LIBRARY_PATH: libs } : process.env,
  args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto('http://127.0.0.1:5228/__minimap_fixture', { waitUntil: 'domcontentloaded' });
  const measurements = await page.evaluate(async ({ state, terrain }) => {
    const { Minimap } = await import('/src/view/minimap.ts');
    const canvas = document.querySelector<HTMLCanvasElement>('#probe')!;
    const minimap = new Minimap(canvas);
    const assets = { terrain };
    const ctx = canvas.getContext('2d')!;
    const point = { x: 5.5, y: 3.5 };
    const sample = (owned: any = assets, reveal = false) => {
      const before = JSON.stringify(state);
      // Put the camera marker outside the map so it cannot contaminate pixels.
      minimap.draw(state, { x: -100, y: -100 }, { w: 1, h: 1 }, owned, reveal);
      if (JSON.stringify(state) !== before) throw new Error('minimap mutated simulation state');
      const px = Math.floor(canvas.width / 2 + (point.y - point.x) * canvas.width / (state.width + state.height));
      const py = Math.floor((point.x + point.y) * canvas.height / (state.width + state.height));
      return Array.from(ctx.getImageData(px, py, 1, 1).data).slice(0, 3);
    };
    const results: Record<string, number[]> = {};
    results.fallback = sample({});
    for (const [name, slope] of [['light', -1], ['flat', 0], ['dark', 1]] as const) {
      state.elevation = state.elevation.map((_, i) => 30 + slope * (Math.floor(i / state.width) - i % state.width));
      state.terrain.fill(0);
      results[`grass-${name}`] = sample();
      state.terrain.fill(10);
      results[`forest-${name}`] = sample();
      state.terrain.fill(0);
      const tree = { id: 99999, kind: 'resource', node: 'tree', resourceKind: 'wood', owner: 0,
        position: point, radius: 0.5, hp: 100, maxHp: 100, amount: 100, order: { kind: 'idle' }, activity: 'idle' };
      state.entities = [tree];
      results[`tree-${name}`] = sample();
      state.entities = [];
      state.visibility[1].visible.fill(0);
      state.visibility[1].memory = { [tree.id]: { id: tree.id, kind: 'resource', node: 'tree', resource: 'wood',
        owner: 0, x: point.x, y: point.y, hp: 100, maxHp: 100, amount: 100, lastSeenAt: 0 } };
      results[`remembered-tree-${name}`] = sample();
      state.visibility[1].memory = {};
      results[`fog-${name}`] = sample();
      state.visibility[1].explored.fill(0);
      results[`unexplored-${name}`] = sample();
      results[`reveal-${name}`] = sample(assets, true);
      state.visibility[1].visible.fill(1); state.visibility[1].explored.fill(1);
    }
    state.elevation = state.elevation.map((_, i) => Math.max(0,
      5 - Math.max(Math.abs(i % state.width - 6), Math.abs(Math.floor(i / state.width) - 4))));
    for (const [name, x, y] of [
      ['hill-upper-right', 3.5, 4.5], ['hill-lower-right', 6.5, 6.5],
      ['hill-lower-left', 9.5, 4.5], ['hill-upper-left', 6.5, 1.5],
    ] as const) {
      point.x = x; point.y = y;
      results[name] = sample();
    }
    point.x = 5.5; point.y = 3.5;
    state.elevation = state.elevation.map((_, i) => 30 + Math.floor(i / state.width) - i % state.width);
    state.terrain.fill(23);
    results.water = sample();
    state.terrain.fill(0);
    results.oldManifest = sample({ terrain: { ground: { ...terrain.ground, minimapShades: undefined } } });
    results.replacedPalette = sample({ terrain: { ground: { ...terrain.ground, minimapShades: undefined,
      minimapColor: [17, 29, 41] } } });
    results.restoredPalette = sample();
    // The surveyed boards are much larger than the classic board. Exercise
    // buffer resizing and sample their real output, with draw-only timings.
    state.width = 392; state.height = 392;
    state.terrain = new Array(392 * 392).fill(10);
    state.elevation = state.terrain.map((_, i) => 4 + (Math.floor(i / 392) - i % 392) / 100);
    state.visibility[1].visible = new Array(392 * 392).fill(1);
    state.visibility[1].explored = new Array(392 * 392).fill(1);
    point.x = 195.5; point.y = 195.5;
    results.largeForest = sample();
    results.largeDrawMs = [];
    for (let i = 0; i < 7; i++) {
      const started = performance.now();
      minimap.draw(state, { x: -100, y: -100 }, { w: 1, h: 1 }, assets);
      results.largeDrawMs.push(performance.now() - started);
    }
    return results;
  }, { state, terrain: manifest.terrain });
  for (const [index, name] of ['light', 'flat', 'dark'].entries()) {
    assert.deepEqual(measurements[`grass-${name}`], grass[index], `grass ${name}, sRGB`);
    assert.deepEqual(measurements[`forest-${name}`], forest[index], `forest ${name}, sRGB`);
    assert.deepEqual(measurements[`tree-${name}`], forest[index], `tree overlay ${name}, sRGB`);
    assert.deepEqual(measurements[`remembered-tree-${name}`], forest[index], `remembered tree ${name}, sRGB`);
    assert.deepEqual(measurements[`fog-${name}`], grass[index].map(c => Math.round(c * 0.55)), `fog ${name}, sRGB`);
    assert.deepEqual(measurements[`unexplored-${name}`], [0, 0, 0], `unexplored ${name}`);
    assert.deepEqual(measurements[`reveal-${name}`], grass[index], `reveal ${name}, sRGB`);
  }
  assert.deepEqual(measurements.fallback, [111, 143, 74]);
  for (const name of ['hill-upper-right', 'hill-lower-right']) {
    assert.deepEqual(measurements[name], grass[0], `${name} lit from screen-right`);
  }
  for (const name of ['hill-upper-left', 'hill-lower-left']) {
    assert.deepEqual(measurements[name], grass[2], `${name} facing away from screen-right`);
  }
  assert.deepEqual(measurements.water, [0, 74, 187]);
  assert.deepEqual(measurements.oldManifest, grass[1]);
  assert.deepEqual(measurements.replacedPalette, [17, 29, 41]);
  assert.deepEqual(measurements.restoredPalette, grass[2]);
  assert.deepEqual(measurements.largeForest, forest[2]);
  assert.deepEqual(errors, []);
  console.log('MINIMAP RELIEF SMOKE GREEN: exact sRGB terrain/tree shades, fog/reveal, flat water, old/fallback/changed palettes; state unchanged');
  console.log(JSON.stringify(measurements));
} finally { await browser.close(); await server.close(); }
