import { expect, it } from 'vitest';
import { once } from 'node:events';
import type { Socket } from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import { createGame } from '../sim/game';
import { FALLBACK_RULES } from '../sim/data';
import { SNAPSHOT_COMPRESSION } from './snapshot-compression';

it('negotiates smaller byte-identical snapshots, leaves even large controls plain, and supports opt-out clients', async () => {
  const snapshot = JSON.stringify({ type: 'snapshot', state: createGame(3, FALLBACK_RULES, undefined, 'windsor'),
    settings: { paused: true, speed: 1, generation: 0 }, setup: { map: 'windsor', seed: 3 } });
  const control = JSON.stringify({ type: 'error', reason: 'fixture-control-'.repeat(500) });
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0, perMessageDeflate: SNAPSHOT_COMPRESSION });
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing fixture port');
  server.on('connection', peer => peer.on('message', data => {
    const isSnapshot = data.toString() === 'snapshot';
    peer.send(isSnapshot ? snapshot : control, { compress: isSnapshot });
  }));
  try {
    for (const negotiate of [false, true]) {
      const client = new WebSocket(`ws://127.0.0.1:${address.port}`, { perMessageDeflate: negotiate });
      let transport: Socket;
      client.on('upgrade', response => { transport = response.socket; });
      await once(client, 'open', { signal: AbortSignal.timeout(10_000) });
      try {
        const exchange = async (request: string) => {
          const before = transport.bytesRead;
          let firstByte = 0;
          transport.prependOnceListener('data', bytes => { firstByte = typeof bytes === 'string' ? bytes.charCodeAt(0) : bytes[0]; });
          const reply = once(client, 'message', { signal: AbortSignal.timeout(10_000) });
          client.send(request, { compress: false });
          const [data] = await reply;
          return { text: data.toString(), bytes: transport.bytesRead - before, compressed: !!(firstByte & 0x40) };
        };
        const loaded = await exchange('snapshot');
        expect(loaded.text).toBe(snapshot);
        expect(loaded.compressed).toBe(negotiate);
        if (negotiate) {
          expect(client.extensions).toContain('permessage-deflate');
          expect(loaded.bytes).toBeLessThan(Buffer.byteLength(snapshot) / 4);
        } else expect(loaded.bytes).toBeGreaterThanOrEqual(Buffer.byteLength(snapshot));
        const ordinary = await exchange('control');
        expect(ordinary.text).toBe(control);
        expect(ordinary.compressed).toBe(false);
        expect(ordinary.bytes).toBeGreaterThanOrEqual(Buffer.byteLength(control));
        console.log(`snapshot transport (${negotiate ? 'deflate' : 'plain'}): ${Buffer.byteLength(snapshot)} JSON bytes / ${loaded.bytes} wire bytes`);
      } finally { client.close(); await once(client, 'close'); }
    }
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
