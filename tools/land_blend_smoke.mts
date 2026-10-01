/** #116: all native family routes, overlay crossings and both farm stages. */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import puppeteer from 'puppeteer';
const root=fileURLToPath(new URL('../',import.meta.url));
const server=await createServer({ root,configFile:`${root}vite.config.ts`,
  server:{ host:'127.0.0.1',port:5281,strictPort:true },logLevel:'error',
  plugins:[{ name:'land-blend-fixture',configureServer(s) {
    s.middlewares.use('/__land_fixture',(_req,res) => {
      res.setHeader('content-type','text/html');
      res.end('<!doctype html><script type="module" src="/tools/land_blend_fixture.ts"></script>');
    });
  } }],
});
await server.listen();
const libs=`${homedir()}/.cache/puppeteer/extra-libs/usr/lib/x86_64-linux-gnu`;
const browser=await puppeteer.launch({ headless:true,env:existsSync(libs)?{ ...process.env,LD_LIBRARY_PATH:libs }:process.env,
  args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-features=WebGPU'] });
try {
  const page=await browser.newPage(); await page.setViewport({ width:1024,height:768 });
  const errors:string[]=[]; page.on('pageerror',error => errors.push(String(error)));
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
