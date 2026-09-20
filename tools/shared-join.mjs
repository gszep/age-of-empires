/** Zero dependencies: local artwork, everything else (including game code) from the host. */
import { createServer, request } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { createReadStream, statSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { connect } from 'node:net';
import { connect as tlsConnect } from 'node:tls';

const host = new URL(process.env.MATCH_HOST ?? 'https://ysgramor.tail6e864b.ts.net:5173');
const root = resolve(process.env.MATCH_ASSETS ?? 'public');
const port = Number(process.env.PORT ?? 5174);
const types = { '.png': 'image/png', '.json': 'application/json', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.ttf': 'font/ttf', '.woff2': 'font/woff2' };
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/__match/config') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ enabled: true, player: 2, version: 1 }));
    return;
  }
  if (url.pathname.startsWith('/imported/')) {
    try {
      const path = resolve(root, '.' + decodeURIComponent(url.pathname));
      if (!path.startsWith(root + sep)) throw new Error('Invalid asset path');
      const stat = statSync(path);
      if (!stat.isFile()) throw new Error('Not a file');
      const etag = `"${stat.size}-${stat.mtimeMs}"`;
      if (req.headers['if-none-match'] === etag) {
        res.writeHead(304, { etag, 'x-empires-assets': 'local' }); res.end(); return;
      }
      res.writeHead(200, {
        'content-type': types[extname(path)] ?? 'application/octet-stream',
        'content-length': stat.size,
        'cache-control': 'no-cache',
        'last-modified': stat.mtime.toUTCString(),
        etag,
        'x-empires-assets': 'local',
      });
      if (req.method === 'HEAD') res.end();
      else createReadStream(path).on('error', () => res.destroy()).pipe(res);
    } catch { res.writeHead(404); res.end(`Local asset missing: ${url.pathname}`); }
    return;
  }
  const upstream = (host.protocol === 'https:' ? httpsRequest : request)(new URL(req.url, host), {
    method: req.method, headers: { ...req.headers, host: host.host },
  }, response => {
    res.writeHead(response.statusCode, response.headers);
    response.pipe(res);
  });
  upstream.on('error', error => { res.writeHead(502); res.end(`Ysgramor unavailable: ${error.message}`); });
  req.pipe(upstream);
});
server.on('upgrade', (req, socket, head) => {
  const options = { host: host.hostname, port: Number(host.port || (host.protocol === 'https:' ? 443 : 80)), servername: host.hostname };
  const upstream = host.protocol === 'https:' ? tlsConnect(options) : connect(options);
  upstream.once(host.protocol === 'https:' ? 'secureConnect' : 'connect', () => {
    const headers = { ...req.headers, host: host.host };
    upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n${Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`);
    if (head.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
  socket.on('close', () => upstream.destroy());
});
server.listen(port, '127.0.0.1', () => console.log(`Join Ysgramor at http://localhost:${port}/; artwork: ${root}`));
