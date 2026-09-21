import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer as createTcpServer } from 'node:net';
import { createServer } from 'vite';
import { createGame } from '../sim/game';
import { FALLBACK_RULES } from '../sim/data';
import { sharedMatchPlugin } from './server';
import { SHARED_VERSION } from './protocol';

const directories: string[] = [];
function fixture() {
  const directory = mkdtempSync(resolve(tmpdir(), 'empires-checkpoint-'));
  directories.push(directory);
  return { directory, checkpoint: resolve(directory, 'saved-match.json') };
}
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });

function host(checkpoint: string, port = 0) {
  return spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'tools/shared-host.mts'], {
    env: { ...process.env, MATCH_CHECKPOINT: checkpoint, MATCH_PORT: String(port) },
    encoding: 'utf8', timeout: 20_000,
  });
}

describe('shared host startup failure policy', () => {
  it.each([
    JSON.stringify({ version: -1, rulesHash: 'old-rules', state: { tick: 123 } }),
    JSON.stringify({ version: SHARED_VERSION, rulesHash: 'old-rules', state: { tick: 123 } }),
    '{interrupted JSON',
  ])('exits without retry status and preserves incompatible checkpoint bytes: %s', bytes => {
    const { checkpoint } = fixture();
    writeFileSync(checkpoint, bytes);
    const result = host(checkpoint);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(78);
    expect(result.stderr).toContain(checkpoint);
    expect(result.stderr).toContain('Saved match preserved');
    expect(readFileSync(checkpoint, 'utf8')).toBe(bytes);
  });

  it('keeps a transient port conflict retryable', async () => {
    const { checkpoint } = fixture();
    const occupied = createTcpServer();
    await new Promise<void>(resolve => occupied.listen(0, '127.0.0.1', resolve));
    try {
      const address = occupied.address();
      if (!address || typeof address === 'string') throw new Error('Missing TCP address');
      const result = host(checkpoint, address.port);
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('already in use');
    } finally { await new Promise<void>(resolve => occupied.close(() => resolve())); }
  });

  it('restores a compatible checkpoint and serves the shared endpoint', async () => {
    const { directory, checkpoint } = fixture();
    const { rules: ignored, ...state } = createGame(157);
    state.tick = 123;
    const rulesHash = createHash('sha256').update(JSON.stringify(FALLBACK_RULES)).digest('hex');
    const saved = { version: SHARED_VERSION, rulesHash, state,
      settings: { speed: 1, paused: true, generation: 2 }, humanTwo: true, setup: { map: 'arabia', seed: 157 } };
    writeFileSync(checkpoint, JSON.stringify(saved));
    const server = await createServer({ root: directory, configFile: false, logLevel: 'silent',
      server: { host: '127.0.0.1', port: 0 }, plugins: [sharedMatchPlugin(directory, checkpoint)] });
    try {
      await server.listen();
      const address = server.httpServer!.address();
      if (!address || typeof address === 'string') throw new Error('Missing HTTP address');
      const response = await fetch(`http://127.0.0.1:${address.port}/__match/config`);
      expect(await response.json()).toMatchObject({ enabled: true, version: SHARED_VERSION });
    } finally { await server.close(); }
    expect(JSON.parse(readFileSync(checkpoint, 'utf8'))).toEqual(saved);
  });
});
