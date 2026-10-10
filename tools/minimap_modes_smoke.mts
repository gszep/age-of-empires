/** #138 slice A: actual HUD clicks and sRGB minimap readback on private port5231.
 * OWNED_PUBLIC selects an existing read-only full publication; MINIMAP_UI may
 * overlay a private UI-stage fixture. OPEN_FALLBACK=1 blocks imported requests.
 * No import, clock shim or simulation mutation. */
import assert from 'node:assert/strict';
import { createReadStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const fallback = process.env.OPEN_FALLBACK === '1';
const publicDir = resolve(process.env.OWNED_PUBLIC ?? `${root}public`);
// Optional isolated UI-stage fixture; other content remains read-only.
const privateUi = process.env.MINIMAP_UI ? resolve(process.env.MINIMAP_UI) : undefined;
const out = `${root}.local/minimap-modes-${fallback ? 'fallback' : 'owned'}`;
mkdirSync(`${root}.local`, { recursive: true });
const server = await createServer({ root, configFile: `${root}vite.config.ts`, publicDir, logLevel: 'error',
  server: { host: '127.0.0.1', port: 5231, strictPort: true }, plugins: [{
    name: 'minimap-open-fallback', enforce: 'pre', configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = decodeURIComponent((req.url ?? '').split('?')[0]);
        if (fallback && url.startsWith('/imported/')) { res.statusCode = 404; res.end(); return; }
        const prefix = '/imported/aoe2/ui/';
        if (!privateUi || !url.startsWith(prefix)) { next(); return; }
        const path = resolve(privateUi, url.slice(prefix.length));
        if (!path.startsWith(privateUi + '/') || !existsSync(path)) { res.statusCode = 404; res.end(); return; }
        const mime: Record<string, string> = { '.json': 'application/json', '.png': 'image/png',
          '.ttf': 'font/ttf', '.otf': 'font/otf', '.cur': 'image/x-icon' };
        res.setHeader('Content-Type', mime[extname(path)] ?? 'application/octet-stream');
        createReadStream(path).pipe(res);
      });
    },
  }] });
let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
const evidence: Record<string, unknown> = { mode: fallback ? 'fallback' : 'owned', seed: 138, port: 5231,
  publicDir, privateUi, colorSpace: 'sRGB (Canvas2D RGBA8)', deltas: [] };
try {
  await server.listen();
  const libs = `${homedir()}/.cache/puppeteer/extra-libs/usr/lib/x86_64-linux-gnu`;
  browser = await puppeteer.launch({ headless: true,
    env: existsSync(libs) ? { ...process.env, LD_LIBRARY_PATH: libs } : process.env,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebGPU'] });
  evidence.pid = process.pid; evidence.browserPid = browser.process()?.pid;
  console.log(JSON.stringify({ pid: process.pid, browserPid: browser.process()?.pid, port: 5231 }));
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.evaluateOnNewDocument('globalThis.__name = f => f');
  const errors: string[] = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://127.0.0.1:5231/?solo=1&seed=138', { waitUntil: 'networkidle0', timeout: 120000 });
  await page.waitForFunction(() => typeof (window as any).__empiresDebug === 'function', { timeout: 60000 });
  assert.equal(await page.$eval('#hud', e => e.classList.contains('fallback')), fallback, 'requested content mode loaded');
  await page.keyboard.press('F3'); // normal player pause, not a private state edit
  const query = () => page.evaluate(() => (window as any).__empiresDebug({ type: 'sim' }));
  const initial = await query();
  assert.equal(initial.connection.paused, true);
  evidence.tick = initial.tick; evidence.hash = initial.synchronizationHash;
  const read = () => page.$eval('#minimap-canvas', e => {
    const c = e as HTMLCanvasElement;
    return Array.from(c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data);
  });
  const controls = await page.$$eval('[data-map="color"], [data-map="filter"]', buttons => buttons.map(e => ({
    control: (e as HTMLElement).dataset.map, disabled: (e as HTMLButtonElement).disabled,
    title: (e as HTMLElement).title, background: getComputedStyle(e).backgroundImage,
  })));
  evidence.controls = controls;
  await page.screenshot({ path: `${out}-initial.png` });
  assert(controls.every(b => !b.disabled), `owned publication incomplete: ${JSON.stringify(controls)}`);

  const deltas: { control: string; mode: string; changedPixels: number; absoluteRGBDelta: number }[] = [];
  for (const [control, modes, stems] of [
    ['color', ['grayscale', 'noterrain', 'color'], ['minimap_mode_grayscale', 'minimap_mode_noterrain', 'minimap_mode_color']],
    ['filter', ['military', 'economy', 'all'], ['minimap_filter_military', 'minimap_filter_economy', 'minimap_filter_all']],
  ] as const) {
    const selector = `[data-map="${control}"]`;
    const original = await read();
    for (let i = 0; i < modes.length; i++) {
      const before = await read();
      await page.click(selector);
      assert.equal(await page.$eval(selector, e => (e as HTMLElement).dataset.mode), modes[i]);
      if (fallback) {
        assert(await page.$eval(selector, e => !!e.textContent?.trim()), 'fallback has visible text');
      } else {
        const image = await page.$eval(selector, e => getComputedStyle(e).backgroundImage);
        assert(image.includes(stems[i]), `owned icon ${stems[i]}: ${image}`);
        assert(await page.$eval(selector, async e => {
          const url = getComputedStyle(e).backgroundImage.match(/url\(["']?(.*?)["']?\)/)?.[1];
          if (!url) return false;
          const image = new Image(); image.src = url; await image.decode();
          return image.naturalWidth > 0 && image.naturalHeight > 0;
        }), 'owned icon decodes, not just a CSS URL');
      }
      await page.waitForFunction(before => {
        const c = document.querySelector<HTMLCanvasElement>('#minimap-canvas')!;
        const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
        return data.some((v, i) => v !== before[i]);
      }, { timeout: 10000 }, before);
      const after = await read();
      let changedPixels = 0, absoluteRGBDelta = 0;
      for (let at = 0; at < after.length; at += 4) {
        const delta = [0, 1, 2].reduce((sum, channel) => sum + Math.abs(after[at + channel] - before[at + channel]), 0);
        if (delta) changedPixels++;
        absoluteRGBDelta += delta;
      }
      assert(changedPixels > 0 && absoluteRGBDelta > 0);
      deltas.push({ control, mode: modes[i], changedPixels, absoluteRGBDelta });
      evidence.deltas = deltas;
      console.log(JSON.stringify(deltas.at(-1)));
      await page.screenshot({ path: `${out}-${control}-${modes[i]}.png` });
      assert.equal((await query()).synchronizationHash, initial.synchronizationHash, 'mode click never mutates game');
    }
    assert.deepEqual(await read(), original, 'cycling restores the exact minimap pixels');
  }
  // Layout reapplication must retain the selected icon and accessible title.
  await page.click('[data-map="color"]');
  await page.setViewport({ width: 1360, height: 800 });
  assert.equal(await page.$eval('[data-map="color"]', e => (e as HTMLElement).dataset.mode), 'grayscale');
  if (!fallback) assert((await page.$eval('[data-map="color"]', e => getComputedStyle(e).backgroundImage)).includes('minimap_mode_grayscale'));
  assert.deepEqual(errors, []);
  evidence.errors = errors; evidence.result = 'PASS';
  console.log('PASS');
} catch (error) {
  evidence.result = 'FAIL'; evidence.error = String(error);
  throw error;
} finally {
  writeFileSync(`${out}.json`, JSON.stringify(evidence, null, 2));
  await browser?.close(); await server.close();
}
