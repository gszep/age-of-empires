/** #154: measure real cold/warm module loads and raw negotiated wire bytes.
 * Open fallback isolates host code transfer from the locally served artwork. */
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { startServer, launchBrowser, newPage, blockImported } from './smoke-harness.mjs';

const server = await startServer({ port: 5234 });
const browser = await launchBrowser();
function raw(url: string, encoding: string, etag?: string) {
  return new Promise<{ body: Buffer; headers: import('node:http').IncomingHttpHeaders; status: number }>((resolve, reject) => {
    const req = request(url, { headers: { 'accept-encoding': encoding, ...(etag ? { 'if-none-match': etag } : {}) } }, res => {
      const chunks: Buffer[] = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ body: Buffer.concat(chunks), headers: res.headers, status: res.statusCode! }));
      res.on('error', reject);
    });
    req.on('error', reject); req.end();
  });
}
try {
  const { page, errors } = await newPage(browser, { viewport: { width: 1000, height: 700 } });
  await blockImported(page);
  const loads = [];
  for (const kind of ['cold', 'warm']) {
    const start = performance.now();
    await page.goto('http://127.0.0.1:5234/?solo=1', { waitUntil: 'networkidle0', timeout: 120_000 });
    await page.waitForFunction(() => typeof (window as any).__empiresDebug === 'function', { timeout: 120_000 });
    const resources = await page.evaluate(() => (performance.getEntriesByType('resource') as PerformanceResourceTiming[])
      .filter(r => r.name.includes('/src/') || r.name.includes('/node_modules/'))
      .map(r => ({ url: r.name, encoded: r.encodedBodySize, decoded: r.decodedBodySize, transferred: r.transferSize })));
    loads.push({ kind, readyMs: Math.round(performance.now() - start), resources });
  }
  const largest = loads[0].resources.reduce((a, b) => a.decoded > b.decoded ? a : b);
  assert(largest.decoded > 1_000_000, 'measures the large actual Three.js dependency');
  const identity = await raw(largest.url, 'identity');
  const gzip = await raw(largest.url, 'gzip');
  const br = await raw(largest.url, 'br');
  assert.equal(gzip.headers['content-encoding'], 'gzip');
  assert.equal(br.headers['content-encoding'], 'br');
  assert.deepEqual(gunzipSync(gzip.body), identity.body);
  assert.deepEqual(brotliDecompressSync(br.body), identity.body);
  assert(br.body.length < identity.body.length / 3, 'material reduction in cold bytes');
  assert(gzip.headers.vary?.includes('Accept-Encoding'));
  const validated = await raw(largest.url, 'br', br.headers.etag);
  assert.equal(validated.status, 304);
  assert.equal(validated.body.length, 0);
  const source = await raw('http://127.0.0.1:5234/src/main.ts', 'gzip');
  assert.equal(source.headers['content-encoding'], 'gzip');
  assert(gunzipSync(source.body).includes(Buffer.from('renderer.render')));
  assert.deepEqual(errors, []);
  console.log('COMPRESSION SMOKE GREEN:', JSON.stringify({
    chunk: new URL(largest.url).pathname, identity: identity.body.length, gzip: gzip.body.length, br: br.body.length,
    loads: loads.map(({ kind, readyMs, resources }) => ({ kind, readyMs,
      transferred: resources.reduce((n, r) => n + r.transferred, 0),
      encoded: resources.reduce((n, r) => n + r.encoded, 0), decoded: resources.reduce((n, r) => n + r.decoded, 0) })),
  }));
} finally { await browser.close(); await server.close(); }
