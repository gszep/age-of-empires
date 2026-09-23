import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import puppeteer from 'puppeteer';

const root = fileURLToPath(new URL('../', import.meta.url));
const server = await createServer({ root, configFile: `${root}vite.config.ts`,
  server: { host: '127.0.0.1', port: 5247, strictPort: true }, logLevel: 'error',
  plugins: [{ name: 'shore-shape-fixture', configureServer(s) {
    s.middlewares.use('/__shore_fixture', (_req, res) => {
      res.setHeader('content-type', 'text/html');
      res.end('<!doctype html><script type="module" src="/tools/shore_blend_fixture.ts"></script>');
    });
  } }],
});
await server.listen();
const libs = `${homedir()}/.cache/puppeteer/extra-libs/usr/lib/x86_64-linux-gnu`;
const browser = await puppeteer.launch({ headless: true,
  env: existsSync(libs) ? { ...process.env, LD_LIBRARY_PATH: libs } : process.env,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebGPU'] });
try {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto('http://127.0.0.1:5247/__shore_fixture', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window as any).__shoreBlendResult, { timeout: 180_000 });
  const result = await page.evaluate(() => (window as any).__shoreBlendResult);
  console.log(JSON.stringify(result));
  assert.equal(result.error, undefined);
  assert.equal(result.configurations, 31);
  assert.equal(result.samples, 775);
  assert(result.maxError < 0.025, 'rendered alpha must match the owned window through the production UVs');
  assert(result.changedFromClassic > 100, 'native shapes must visibly replace the classic masks');
  assert.deepEqual(errors, []);
  console.log('SHORE BLEND SMOKE GREEN: 31 mask orientations, 775 linear-sRGB alpha samples, classic fallback and state immutability');
} finally { await browser.close(); await server.close(); }
