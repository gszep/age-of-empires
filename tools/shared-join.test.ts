import { it, expect } from 'vitest';
import { createServer, request } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

it('obtains the wire version from the host and fails closed when that host is unavailable', async () => {
  let version = 2, status = 200;
  const host = createServer((_req, res) => { res.writeHead(status); res.end(JSON.stringify({ enabled: true, version, player: 1 })); });
  host.listen(0, '127.0.0.1'); await once(host, 'listening');
  const address = host.address();
  if (!address || typeof address === 'string') throw new Error('No address');
  const gateway = spawn(process.execPath, ['tools/shared-join.mjs'], {
    env: { ...process.env, PORT: '0', MATCH_HOST: `http://127.0.0.1:${address.port}` }, stdio: ['ignore', 'pipe', 'inherit'],
  });
  try {
    const [output] = await once(gateway.stdout!, 'data', { signal: AbortSignal.timeout(10_000) });
    const url = String(output).match(/http:\/\/localhost:\d+/)![0].replace('localhost', '127.0.0.1');
    expect(await (await fetch(`${url}/__match/config`)).json()).toEqual({ enabled: true, version: 2, player: 2 });
    version = 99;
    expect(await (await fetch(`${url}/__match/config`)).json()).toMatchObject({ version: 99, player: 2 });
    status = 503;
    expect((await fetch(`${url}/__match/config`)).status).toBe(502);
  } finally {
    const exited = once(gateway, 'exit'); gateway.kill(); await exited;
    host.close(); await once(host, 'close');
  }
});

it.each(['GET', 'HEAD'])('recovers a complete %s module response after a reused upstream socket resets', async method => {
  const sockets = new Set();
  const calls: string[] = [];
  const host = createServer((req, res) => {
    calls.push(req.url!);
    const reused = sockets.has(req.socket);
    sockets.add(req.socket);
    if (req.url === '/module' && reused) { req.socket.destroy(); return; }
    res.writeHead(200, { 'content-type': 'text/javascript', 'x-source': 'host' });
    res.end('export const ready = true;');
  });
  host.listen(0, '127.0.0.1'); await once(host, 'listening');
  const address = host.address();
  if (!address || typeof address === 'string') throw new Error('No address');
  const gateway = spawn(process.execPath, ['tools/shared-join.mjs'], {
    env: { ...process.env, PORT: '0', MATCH_HOST: `http://127.0.0.1:${address.port}` }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    const [output] = await once(gateway.stdout!, 'data', { signal: AbortSignal.timeout(10_000) });
    const url = String(output).match(/http:\/\/localhost:\d+/)![0].replace('localhost', '127.0.0.1');
    await (await fetch(`${url}/warm`)).text();
    const response = await fetch(`${url}/module`, { method });
    expect(response.status).toBe(200);
    expect(response.headers.get('x-source')).toBe('host');
    expect(await response.text()).toBe(method === 'HEAD' ? '' : 'export const ready = true;');
    expect(calls).toEqual(['/warm', '/module', '/module']);
    expect(sockets.size).toBe(2);
  } finally {
    const exited = once(gateway, 'exit'); gateway.kill(); await exited;
    host.closeAllConnections(); host.close(); await once(host, 'close');
  }
});

it.each(['POST', 'GET-body', 'fresh-GET', 'always-reset'])('does not replay unsafe or repeatedly failing requests: %s', async scenario => {
  const calls: { path: string; body: string }[] = [];
  const host = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    calls.push({ path: req.url!, body });
    if (req.url === '/warm') { res.end('warm'); return; }
    req.socket.destroy();
  });
  host.listen(0, '127.0.0.1'); await once(host, 'listening');
  const address = host.address();
  if (!address || typeof address === 'string') throw new Error('No address');
  const gateway = spawn(process.execPath, ['tools/shared-join.mjs'], {
    env: { ...process.env, PORT: '0', MATCH_HOST: `http://127.0.0.1:${address.port}` }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    const [output] = await once(gateway.stdout!, 'data', { signal: AbortSignal.timeout(10_000) });
    const url = String(output).match(/http:\/\/localhost:\d+/)![0].replace('localhost', '127.0.0.1');
    if (scenario !== 'fresh-GET') await (await fetch(`${url}/warm`)).text();
    const hasBody = scenario === 'POST' || scenario === 'GET-body';
    const result = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = request(`${url}/target`, { method: scenario === 'POST' ? 'POST' : 'GET',
        headers: hasBody ? { 'content-length': '7' } : {} }, res => {
        let body = ''; res.on('data', chunk => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode!, body }));
      });
      req.on('error', reject); req.end(hasBody ? 'command' : undefined);
    });
    expect(result.status).toBe(502);
    expect(result.body).toContain('Ysgramor unavailable');
    const targets = calls.filter(c => c.path === '/target');
    expect(targets).toHaveLength(scenario === 'always-reset' ? 2 : 1);
    expect(targets.every(c => c.body === (hasBody ? 'command' : ''))).toBe(true);
  } finally {
    const exited = once(gateway, 'exit'); gateway.kill(); await exited;
    host.closeAllConnections(); host.close(); await once(host, 'close');
  }
});

it('terminates a partial upstream response without replaying it or crashing the gateway', async () => {
  let calls = 0;
  const host = createServer((req, res) => {
    if (req.url !== '/partial') { res.end('healthy'); return; }
    calls++;
    res.writeHead(200, { 'content-length': '100' });
    res.write('prefix', () => res.destroy());
  });
  host.listen(0, '127.0.0.1'); await once(host, 'listening');
  const address = host.address();
  if (!address || typeof address === 'string') throw new Error('No address');
  const gateway = spawn(process.execPath, ['tools/shared-join.mjs'], {
    env: { ...process.env, PORT: '0', MATCH_HOST: `http://127.0.0.1:${address.port}` }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    const [output] = await once(gateway.stdout!, 'data', { signal: AbortSignal.timeout(10_000) });
    const url = String(output).match(/http:\/\/localhost:\d+/)![0].replace('localhost', '127.0.0.1');
    await (await fetch(`${url}/warm`)).text();
    await expect(fetch(`${url}/partial`).then(response => response.text())).rejects.toThrow();
    expect(calls).toBe(1);
    expect(await (await fetch(`${url}/healthy`)).text()).toBe('healthy');
  } finally {
    const exited = once(gateway, 'exit'); gateway.kill(); await exited;
    host.closeAllConnections(); host.close(); await once(host, 'close');
  }
});
