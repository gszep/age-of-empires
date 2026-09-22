/** Renderer allocation lifecycle: actual build/cancel and restart buttons. */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import puppeteer from 'puppeteer';

const root = fileURLToPath(new URL('../', import.meta.url));
const server = await createServer({ root, configFile: `${root}vite.config.ts`, plugins: [{
  name: 'view-lifecycle-probe', enforce: 'pre', transform(code, id) {
    if (!id.endsWith('/src/main.ts')) return;
    const anchor = 'renderer.setAnimationLoop(now => {';
    assert(code.includes(anchor));
    return code.replace(anchor, anchor + '\npaused = true; Object.assign(globalThis, { __lifecycleRenderer: renderer, __lifecycleGhost: () => ghostView, __lifecycleViews: views });');
  },
}], server: { host: '127.0.0.1', port: 5237, strictPort: true }, logLevel: 'error' });
await server.listen();
const libs = `${homedir()}/.cache/puppeteer/extra-libs/usr/lib/x86_64-linux-gnu`;
const browser = await puppeteer.launch({ headless: true, env: existsSync(libs) ? { ...process.env, LD_LIBRARY_PATH: libs } : process.env,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebGPU'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  if (process.env.OPEN_FALLBACK === '1') {
    await page.setRequestInterception(true);
    page.on('request', req => { void (req.url().includes('/imported/') ? req.respond({ status: 404, body: '' }) : req.continue()); });
  }
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto('http://127.0.0.1:5237/?solo=1&map=arabia&seed=42', { waitUntil: 'networkidle0', timeout: 120_000 });
  await page.waitForFunction(() => !!(window as any).__lifecycleRenderer, { timeout: 120_000 });
  const query = (q: object): Promise<any> => page.evaluate(q => (window as any).__empiresDebug(q), q);
  const sample = async () => {
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    return page.evaluate(() => ({ ...(window as any).__lifecycleRenderer.info.memory }));
  };
  const worker = (await query({ type: 'entities', owner: 1 })).entities.find((e: any) => e.kind === 'villager');
  assert(worker);
  await query({ type: 'select', ids: [worker.id] });
  await page.waitForSelector('[data-command="page-economic"]');
  await page.locator('[data-command="page-economic"]').click();
  const ghosts = [];
  for (let i = 0; i < 8; i++) {
    await page.waitForSelector('[data-command="build-house"]');
    await page.locator('[data-command="build-house"]').click();
    await page.mouse.move(680, 340);
    await page.waitForFunction(() => (window as any).__lifecycleGhost()?.body.mesh.visible, { timeout: 30_000 });
    const active = await sample(); // force a drawn preview before cancelling it
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !(window as any).__lifecycleGhost());
    const retired = await sample();
    if (process.env.MEASURE_BASELINE !== '1') assert(active.geometries > retired.geometries, 'the actual drawn preview was released');
    ghosts.push(retired);
  }
  await query({ type: 'select', ids: [] });
  const restarts = [];
  const initialHash = (await query({ type: 'sim' })).synchronizationHash;
  const initialPixels = await query({ type: 'pixels', png: true, rect: [100, 80, 1080, 560] });
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('F10');
    await page.locator('#menu-dialog [data-menu="restart"]').click();
    await page.waitForSelector('#menu-dialog.hidden');
    restarts.push(await sample());
    assert.equal((await query({ type: 'sim' })).synchronizationHash, initialHash, 'same seed restarts to the same paused state');
    assert.deepEqual(await query({ type: 'pixels', png: true, rect: [100, 80, 1080, 560] }), initialPixels,
      'the recreated world still draws the same pixels');
  }
  const reveal = [];
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('F4');
    await sample();
    await page.keyboard.press('F4');
    reveal.push(await sample());
  }
  console.log(JSON.stringify({ mode: process.env.OPEN_FALLBACK === '1' ? 'fallback' : 'imported', ghosts, restarts, reveal }));
  if (process.env.MEASURE_BASELINE !== '1') {
    assert.equal(ghosts.at(-1)!.geometries, ghosts[0].geometries, 'cancelled previews release geometry');
    assert.deepEqual(restarts.at(-1), restarts[0], 'restarting does not retain old rendered objects');
    // First reveal can finish a previously cold page used by a fog snapshot;
    // compare subsequent retire/recreate cycles against that warmed scene.
    assert(reveal.every(sample => sample.geometries === reveal[0].geometries), 'fog/reveal retirement releases geometry');
  }
  assert.deepEqual(errors, []);
  console.log(process.env.MEASURE_BASELINE === '1' ? 'VIEW LIFECYCLE BASELINE RECORDED' : 'VIEW LIFECYCLE SMOKE GREEN');
} finally { await browser.close(); await server.close(); }
