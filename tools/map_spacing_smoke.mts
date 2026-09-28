/** #90: natural openings, full-map minimap geometry and fresh-seed reload.
 * MAPGEN_REF=<git-ref> substitutes only the old generator in a private server
 * for before/after inspection; it never restores or edits the working tree. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import puppeteer from 'puppeteer';

const root = fileURLToPath(new URL('../', import.meta.url));
const ref = process.env.MAPGEN_REF;
const label = ref ? 'before' : 'after';
const output = process.env.MAPGEN_OUTPUT ?? 'map90';
const baseline = ref ? execFileSync('git', ['show', `${ref}:src/sim/mapgen.ts`], { cwd: root, encoding: 'utf8' }) : undefined;
const server = await createServer({ root, configFile: `${root}vite.config.ts`, plugins: [{
  name: 'map-spacing-review', enforce: 'pre', transform(code, id) {
    if (baseline && id.endsWith('/src/sim/mapgen.ts')) return baseline;
    if (!id.endsWith('/src/main.ts')) return;
    const loop = 'renderer.setAnimationLoop(now => {';
    const minimap = '}, assets, revealMap);';
    assert(code.includes(loop) && code.split(minimap).length === 2);
    // Reveal only the minimap: inspect whole-board layout without requesting
    // every world sprite page or changing authoritative fog/state.
    return code.replace(loop, loop + '\npaused = true;').replace(minimap, '}, assets, true);');
  },
}], server: { host: '127.0.0.1', port: 5276, strictPort: true }, logLevel: 'error' });
await server.listen();
const libs = `${homedir()}/.cache/puppeteer/extra-libs/usr/lib/x86_64-linux-gnu`;
const browser = await puppeteer.launch({ headless: true,
  env: existsSync(libs) ? { ...process.env, LD_LIBRARY_PATH: libs } : process.env,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebGPU'] });
try {
  const results = [];
  for (const map of ['arabia', 'black-forest', 'islands']) for (const seed of [3, 7]) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(String(e)));
    const ready = async () => {
      await page.waitForFunction(() => typeof (window as any).__empiresDebug === 'function', { timeout: 60_000 });
      await page.waitForNetworkIdle({ idleTime: 500, timeout: 60_000 });
    };
    await page.goto(`http://127.0.0.1:5276/?solo=1&map=${map}&seed=${seed}`, { waitUntil: 'networkidle0', timeout: 120_000 });
    await ready();
    const query = (q: object): Promise<any> => page.evaluate(q => (window as any).__empiresDebug(q), q);
    const sim = await query({ type: 'sim' }), state = await query({ type: 'snapshot' });
    assert.equal(sim.tick, 0);
    assert.equal(sim.connection.setup.map, map);
    const objects = state.entities.filter(e => e.kind === 'resource').map(e => ({ node: e.node, resource: e.resourceKind, x: e.position.x, y: e.position.y }));
    const counts = Object.fromEntries(['wood', 'food', 'gold', 'stone'].map(kind => [kind, objects.filter(e => e.resource === kind).length]));
    assert(Object.values(counts).every(count => count > 0), 'all starting resource kinds exist');
    const data = { map, seed, ref: ref ?? 'working-tree', hash: sim.synchronizationHash, counts, objects };
    writeFileSync(`${root}.local/${output}-${label}-${map}-${seed}.json`, JSON.stringify(data) + '\n');
    await page.screenshot({ path: `${root}.local/${output}-${label}-${map}-${seed}.png` });
    await (await page.$('#minimap-canvas'))!.screenshot({ path: `${root}.local/${output}-${label}-${map}-${seed}-minimap.png` });
    await page.reload({ waitUntil: 'networkidle0', timeout: 120_000 });
    await ready();
    assert.equal((await query({ type: 'sim' })).synchronizationHash, sim.synchronizationHash, 'fresh same-seed reload is deterministic');
    assert.deepEqual(errors, []);
    results.push({ map, seed, hash: data.hash, counts });
    await page.close();
  }
  console.log(`MAP SPACING BROWSER GREEN (${label}): ${JSON.stringify(results)}`);
} finally { await browser.close(); await server.close(); }
