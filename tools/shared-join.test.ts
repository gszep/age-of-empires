import { it, expect } from 'vitest';
import { createServer } from 'node:http';
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
