import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { createServer } from 'vite';
import puppeteer from 'puppeteer';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const server = await createServer({ root, configFile: root + 'vite.config.ts', server: { host: '127.0.0.1', port: 5243, strictPort: true },
  plugins: [{ name: 'sampler-fixture', configureServer(s) { s.middlewares.use('/fixture', (_req, res) => {
    res.setHeader('content-type', 'text/html'); res.end('<script type="module" src="/tools/sampler_residency_fixture.ts"></script>');
  }); } }], logLevel: 'error' });
await server.listen();
const libs = homedir() + '/.cache/puppeteer/extra-libs/usr/lib/x86_64-linux-gnu';
const browser = await puppeteer.launch({ headless: true, env: existsSync(libs) ? { ...process.env, LD_LIBRARY_PATH: libs } : process.env,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebGPU'] });
try {
  for (const mode of ['', '?ramp=1']) {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log(e.stack));
    await page.goto(`http://127.0.0.1:5243/fixture${mode}`);
    await page.waitForFunction(() => !!(window as any).__samplerResult, { timeout: 60000 });
    const result = await page.evaluate(() => (window as any).__samplerResult);
    assert.deepEqual(result, { equalPixels: true, green: 64, unchangedState: true, evictions: 1, disposedA: true });
    console.log(`SAMPLER RESIDENCY GREEN (${mode ? 'player ramp' : 'basic'}): A -> B -> dispose A -> new B object; identical pixels and state`);
    await page.close();
  }
} finally { await browser.close(); await server.close(); }
