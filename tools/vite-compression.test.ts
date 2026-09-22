import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { request } from 'node:http';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { createServer, type ViteDevServer } from 'vite';
import { gameCompression } from './vite-compression';

describe('Vite HTTP compression (#154)', () => {
  let server: ViteDevServer;
  let port: number;
  const source = Buffer.from('export const value = "a repeatable module fixture";\n'.repeat(4000));
  beforeAll(async () => {
    server = await createServer({ configFile: false, root: import.meta.dirname,
      publicDir: false, logLevel: 'silent', server: { host: '127.0.0.1', port: 0 },
      plugins: [gameCompression(), { name: 'compression-fixture', configureServer(s) {
        s.middlewares.use((req, res) => {
          const path = req.url!;
          res.setHeader('Content-Type', path === '/image.png' ? 'image/png' : path === '/events' ? 'text/event-stream' : 'text/javascript');
          res.setHeader('ETag', 'W/"fixture"');
          if (req.headers['if-none-match'] === 'W/"fixture"') { res.statusCode = 304; res.end(); return; }
          if (path === '/no-transform') res.setHeader('Cache-Control', 'no-transform');
          if (req.headers.range) { res.statusCode = 206; res.setHeader('Content-Range', `bytes 0-${source.length - 1}/${source.length}`); }
          const body = path === '/small' ? source.subarray(0, 12) : source;
          res.setHeader('Content-Length', body.length);
          res.end(body);
        });
      } }],
    });
    await server.listen();
    port = (server.httpServer!.address() as { port: number }).port;
  });
  afterAll(async () => { await server?.close(); });
  function get(path: string, headers: Record<string, string> = {}, method = 'GET') {
    return new Promise<{ body: Buffer; headers: import('node:http').IncomingHttpHeaders; status: number }>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, path, headers, method }, res => {
        const chunks: Buffer[] = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve({ body: Buffer.concat(chunks), headers: res.headers, status: res.statusCode! }));
        res.on('error', reject);
      });
      req.on('error', reject); req.end();
    });
  }
  it.each(['gzip', 'br'])('negotiates %s and preserves the full decoded module and ETag', async encoding => {
    const response = await get('/module.js', { 'accept-encoding': encoding });
    expect(response.headers['content-encoding']).toBe(encoding);
    expect(response.headers.vary).toContain('Accept-Encoding');
    expect(response.headers['content-length']).toBeUndefined();
    expect(response.headers.etag).toBe('W/"fixture"');
    expect(response.body.length).toBeLessThan(source.length / 3);
    expect((encoding === 'br' ? brotliDecompressSync : gunzipSync)(response.body)).toEqual(source);
  });
  it('honours encoding opt-out and warm conditional requests', async () => {
    const identity = await get('/module.js', { 'accept-encoding': 'gzip;q=0, br;q=0, identity' });
    expect(identity.headers['content-encoding']).toBeUndefined();
    expect(identity.body).toEqual(source);
    const warm = await get('/module.js', { 'accept-encoding': 'br', 'if-none-match': 'W/"fixture"' });
    expect(warm.status).toBe(304);
    expect(warm.body.length).toBe(0);
    const head = await get('/module.js', { 'accept-encoding': 'br' }, 'HEAD');
    expect(head.body.length).toBe(0);
    expect(head.headers['content-encoding']).toBeUndefined();
  });
  it.each(['/__match/config', '/__debug', '/image.png', '/events', '/small', '/no-transform'])(
    'does not recompress or buffer %s', async path => {
      const response = await get(path, { 'accept-encoding': 'gzip, br' });
      expect(response.headers['content-encoding']).toBeUndefined();
      expect(response.body).toEqual(path === '/small' ? source.subarray(0, 12) : source);
    });
  it('leaves partial content unencoded', async () => {
    const response = await get('/module.js', { 'accept-encoding': 'br', range: 'bytes=0-' });
    expect(response.status).toBe(206);
    expect(response.headers['content-encoding']).toBeUndefined();
    expect(response.body).toEqual(source);
  });
});
