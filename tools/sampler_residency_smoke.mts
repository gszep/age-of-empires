import assert from 'node:assert/strict';
import { startServer, launchBrowser } from './smoke-harness.mjs';
const server = await startServer({ port: 5243,
  plugins: [{ name: 'sampler-fixture', configureServer(s) { s.middlewares.use('/fixture', (_req, res) => {
    res.setHeader('content-type', 'text/html'); res.end('<script type="module" src="/tools/sampler_residency_fixture.ts"></script>');
  }); } }] });
const browser = await launchBrowser();
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
