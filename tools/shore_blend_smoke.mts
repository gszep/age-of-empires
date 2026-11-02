import assert from 'node:assert/strict';
import { startServer, launchBrowser } from './smoke-harness.mjs';

const server = await startServer({ port: 5247, plugins: [{ name: 'shore-shape-fixture', configureServer(s) {
    s.middlewares.use('/__shore_fixture', (_req, res) => {
      res.setHeader('content-type', 'text/html');
      res.end('<!doctype html><script type="module" src="/tools/shore_blend_fixture.ts"></script>');
    });
  } }],
});
const browser = await launchBrowser();
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
  assert.equal(result.seamSamples, 160);
  assert(result.maxSeamExposure < 0.025, 'shore joins must not expose sand along the water tile grid');
  assert.deepEqual(errors, []);
  console.log('SHORE BLEND SMOKE GREEN: 31 mask orientations, 775 linear-sRGB alpha samples, 160 shoreline joins, classic fallback and state immutability');
} finally { await browser.close(); await server.close(); }
