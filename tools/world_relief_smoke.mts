/** #160: full-world rendered hill faces, not minimap palette classification. */
import assert from 'node:assert/strict';
import { startServer, launchBrowser } from './smoke-harness.mjs';

const server = await startServer({ port: 5245, plugins: [{ name: 'world-relief-probe', configureServer(s) {
    s.middlewares.use('/__world_relief', (_req, res) => {
      res.setHeader('content-type', 'text/html');
      res.end('<!doctype html><script type="module" src="/tools/world_relief_fixture.ts"></script>');
    });
  } }],
});
const browser = await launchBrowser();
try {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto('http://127.0.0.1:5245/__world_relief', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window as any).__worldRelief, { timeout: 120_000 });
  const result = await page.evaluate(() => (window as any).__worldRelief);
  console.log(JSON.stringify(result));
  assert.equal(result.error, undefined);
  assert.equal(result.colorSpace, 'linear-srgb');
  assert.equal(result.unchangedState, true);
  for (const [mode, measured] of Object.entries(result.results) as [string, any][]) {
    assert(measured.unchangedGeometry, `${mode}: no projection/UV change`);
    const f = measured.faces;
    // The reference supplies orientation, not these exact RGB values. A paired
    // crop cancels both the altitude factor and texture detail. A >8% normalized
    // difference is comfortably below the existing 14% directional separation.
    assert(f.lowerRight.factor - f.lowerLeft.factor > 0.08, `${mode}: front right must be lighter than front left`);
    assert(f.upperRight.factor - f.upperLeft.factor > 0.08, `${mode}: back right must be lighter than back left`);
    assert(Math.abs(f.upperRight.factor - f.lowerRight.factor) < 0.035, `${mode}: right faces agree`);
    assert(Math.abs(f.upperLeft.factor - f.lowerLeft.factor) < 0.035, `${mode}: left faces agree`);
  }
  assert.deepEqual(errors, []);
  console.log('WORLD RELIEF SMOKE GREEN: both screen-right faces brighter than screen-left; imported/fallback pixels; state and geometry unchanged');
} finally { await browser.close(); await server.close(); }
