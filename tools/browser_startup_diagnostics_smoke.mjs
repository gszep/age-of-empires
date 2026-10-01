/** #265: real browser failure fixture; the game smoke's clocks are unchanged. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer';
import { startupDiagnostics } from './browser-startup-diagnostics.mjs';

const root = join(import.meta.dirname, '..');
const server = createServer((request, response) => {
  if (request.url === '/pending') return;
  if (request.url === '/failed') { request.socket.destroy(); return; }
  if (request.url === '/http-error') { response.writeHead(503); response.end('fixture unavailable'); return; }
  response.setHeader('Content-Type', 'text/html');
  response.end(`<div id="game-message">Fixture initialization stalled</div><canvas class="battlefield"></canvas>
    <script>
      console.warn('fixture renderer warning');
      console.error('fixture console error');
      fetch('/pending'); fetch('/failed').catch(() => {}); fetch('/http-error');
      document.querySelector('canvas').getContext('webgl2');
      throw new Error('fixture init error');
    </script>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const libs = join(homedir(), '.cache/puppeteer/extra-libs/usr/lib/x86_64-linux-gnu');
const browser = await puppeteer.launch({ headless: true,
  env: existsSync(libs) ? { ...process.env, LD_LIBRARY_PATH: libs } : process.env,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebGPU'] });
try {
  const page = await browser.newPage();
  const diagnostics = startupDiagnostics(page, browser, join(root, '.local/browser-diagnostics-fixture'));
  await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'domcontentloaded' });
  let original;
  try {
    await page.waitForFunction(() => document.querySelector('canvas.battlefield') !== null
      && typeof window.__empiresDebug === 'function', { timeout: 1000 });
  } catch (error) { original = error; }
  assert.equal(original?.name, 'TimeoutError', 'fixture must fail readiness despite having a canvas');
  const output = await diagnostics.capture(original, 'canvas/debug readiness');
  diagnostics.dispose();
  const read = async name => JSON.parse(await readFile(join(output, name), 'utf8'));
  const events = await read('events.json');
  assert(events.error.includes('TimeoutError'));
  assert(events.pendingRequests.some(r => r.url.endsWith('/pending')));
  assert(events.failedRequests.some(r => r.url.endsWith('/failed') && r.error));
  assert(events.httpErrors.some(r => r.url.endsWith('/http-error') && r.status === 503));
  assert(events.consoleMessages.some(m => m.type === 'error' && m.text === 'fixture console error'));
  assert(events.consoleMessages.some(m => m.type === 'warn' && m.text === 'fixture renderer warning'));
  assert(events.pageErrors.some(e => e.message.includes('fixture init error')));
  const dom = await read('page.json');
  assert.equal(dom.debugType, 'undefined');
  assert.equal(dom.loadingMessage, 'Fixture initialization stalled');
  assert.equal(dom.canvases.length, 1);
  assert(dom.html.includes('battlefield'));
  assert(dom.resources.some(r => r.name.endsWith('/http-error')));
  const renderer = await read('renderer.json');
  assert(renderer.gpu.devices.length > 0, 'real renderer information retained');
  console.log('STARTUP DIAGNOSTICS GREEN: timeout, pending/failed/HTTP requests, console/init errors, DOM/readiness and GPU evidence retained');
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
