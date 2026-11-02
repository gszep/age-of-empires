/** #116: all native family routes, overlay crossings and both farm stages. */
import assert from 'node:assert/strict';
import { root, startServer, launchBrowser, newPage } from './smoke-harness.mjs';
const server=await startServer({ port:5281,
  plugins:[{ name:'land-blend-fixture',configureServer(s) {
    s.middlewares.use('/__land_fixture',(_req,res) => {
      res.setHeader('content-type','text/html');
      res.end('<!doctype html><script type="module" src="/tools/land_blend_fixture.ts"></script>');
    });
  } }],
});
const browser=await launchBrowser();
try {
  const { page, errors }=await newPage(browser,{ viewport:{ width:1024,height:768 } });
  await page.goto('http://127.0.0.1:5281/__land_fixture',{ waitUntil:'domcontentloaded' });
  await page.waitForFunction(() => !!(window as any).__landBlendResult,{ timeout:180_000 });
  const result=await page.evaluate(() => (window as any).__landBlendResult);
  console.log(JSON.stringify(result));
  assert.equal(result.error,undefined); assert.equal(result.configurations,248); assert.equal(result.samples,6200);
  assert.equal(result.farmSamples,450);
  assert(result.maxError<.025,'family alpha must match source windows');
  assert(result.gatedError<.025,'land crossings must match source shape × overlay masks');
  assert(result.farmError<.025,'farm alpha must match source windows');
  assert(result.cornerAlpha>0,'native farm corners must actually render');
  assert(result.changedFromClassic>100,'native shapes must replace classic shapes');
  assert.deepEqual(errors,[]);
  await page.screenshot({ path:`${root}.local/land116-crossings.png` });
  console.log('LAND BLEND GREEN: eight families, 6200 shape + 50 crossing + 450 farm samples, partial fallback and state immutability');
} finally { await browser.close(); await server.close(); }
