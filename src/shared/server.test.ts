import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer as createTcpServer } from 'node:net';
import type { Socket } from 'node:net';
import { EventEmitter, once } from 'node:events';
import { WebSocket } from 'ws';
import { createServer } from 'vite';
import { applyCommand, createGame, stepGame } from '../sim/game';
import { checksumState } from '../sim/checksum';
import { useLegacyScore } from '../sim/score';
import { entitiesWithGarrison } from '../sim/garrison';
import type { GameState } from '../sim/types';
import { FALLBACK_RULES } from '../sim/data';
import { sharedMatchPlugin } from './server';
import { SHARED_CHECKPOINT_VERSION, SHARED_VERSION } from './protocol';

const directories: string[] = [];
function fixture() {
  const directory = mkdtempSync(resolve(tmpdir(), 'empires-checkpoint-'));
  directories.push(directory);
  return { directory, checkpoint: resolve(directory, 'saved-match.json') };
}
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });

it('carries Regicide/Treason over the real wire, rejects old clients and bad modes, and restores mode after restart/checkpoint', async () => {
  const { directory, checkpoint } = fixture();
  const { rules: ignored, ...state } = createGame(130, FALLBACK_RULES, undefined, 'arabia', 'regicide');
  state.players[1].gold = 900;
  const castle = state.entities.find(e => e.owner === 1 && e.kind === 'castle')!;
  writeFileSync(checkpoint, JSON.stringify({ version: SHARED_CHECKPOINT_VERSION,
    rulesHash: createHash('sha256').update(JSON.stringify(FALLBACK_RULES)).digest('hex'), state,
    settings: { paused: true, speed: 1, generation: 0 }, humanTwo: true, setup: { map: 'arabia', seed: 130, mode: 'regicide' } }));
  for (const restored of [false, true]) {
    const server = await createServer({ root: directory, configFile: false, logLevel: 'silent',
      server: { host: '127.0.0.1', port: 0 }, plugins: [sharedMatchPlugin(directory, checkpoint)] });
    await server.listen();
    const address = server.httpServer!.address();
    if (!address || typeof address === 'string') throw new Error('missing address');
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/__match/socket?player=1`);
    const packets = new EventEmitter();
    socket.on('message', bytes => { const p = JSON.parse(bytes.toString()); packets.emit(p.type, p); });
    await once(socket, 'open');
    const request = async (message: object, response: string) => {
      const next = once(packets, response, { signal: AbortSignal.timeout(10000) });
      socket.send(JSON.stringify(message)); return (await next)[0];
    };
    try {
      const joined = await request({ type: 'join', version: SHARED_VERSION }, 'snapshot');
      expect(joined.state.mode).toBe('regicide'); expect(joined.setup.mode).toBe('regicide');
      if (restored) {
        expect(joined.setup.map).toBe('islands'); expect(joined.setup.seed).toBe(131);
        expect(joined.setup.populationLimit).toBe(25); expect(joined.state.populationLimit).toBe(25);
        expect(joined.setup.wonderVictory).toBe(true); expect(joined.state.wonderVictory).toBe(true);
        continue;
      }
      socket.send(JSON.stringify({ type: 'command', command: { kind: 'treason', player: 1, castleId: castle.id } }));
      const tick = await request({ type: 'settings', paused: false }, 'tick');
      expect(tick.commands).toContainEqual({ kind: 'treason', player: 1, castleId: castle.id });
      await request({ type: 'settings', paused: true }, 'settings');
      const paid = await request({ type: 'resync' }, 'snapshot');
      expect(paid.state.players[1].gold).toBe(500); expect(paid.state.treasonUntil['1']).toBeGreaterThan(paid.state.tick);
      expect((await request({ type: 'restart', map: 'islands', seed: 131, mode: 'king-hunt' }, 'error')).reason).toContain('Invalid');
      expect((await request({ type: 'restart', map: 'islands', seed: 131, populationLimit: 26 }, 'error')).reason).toContain('Invalid');
      const reset = await request({ type: 'restart', map: 'islands', seed: 131, mode: 'regicide', populationLimit: 25, wonderVictory: true }, 'snapshot');
      expect(reset.state.populationLimit).toBe(25); expect(reset.setup.populationLimit).toBe(25);
      expect(reset.state.mode).toBe('regicide'); expect(reset.state.treasonUntil).toBeUndefined();
      expect(reset.state.entities.filter((e: any) => e.kind === 'king')).toHaveLength(2);
      const legacy = new WebSocket(`ws://127.0.0.1:${address.port}/__match/socket?player=2`);
      await once(legacy, 'open');
      const refused = once(legacy, 'message'); const closed = once(legacy, 'close');
      legacy.send(JSON.stringify({ type: 'join', version: SHARED_VERSION - 1 }));
      expect(JSON.parse(String((await refused)[0])).reason).toContain('version mismatch'); await closed;
    } finally { socket.close(); await once(socket, 'close'); await server.close(); }
  }
});

it('rejects v4 simulators while preserving a marker-less v4 checkpoint and its legacy research rules (#293)', async () => {
  const { directory, checkpoint } = fixture();
  const original = createGame(293);
  delete original.researchQueueVersion;
  useLegacyScore(original);
  for (const player of Object.values(original.players)) {
    delete player.scoreSpentOnResearch;
    delete player.scoreKilledValue;
  }
  const expectScoreless = (state: GameState) => {
    expect(state).not.toHaveProperty('scoreVersion');
    for (const player of Object.values(state.players)) {
      expect(player).not.toHaveProperty('scoreSpentOnResearch');
      expect(player).not.toHaveProperty('scoreKilledValue');
    }
    for (const entity of entitiesWithGarrison(state.entities)) {
      expect(entity).not.toHaveProperty('scorePaidCost');
      expect(entity).not.toHaveProperty('scoreConverted');
    }
  };
  expectScoreless(original);
  original.tick = 123;
  original.players[1].food = 2000;
  const buildingId = original.entities.find(e => e.owner === 1 && e.kind === 'town-center')!.id;
  expect(applyCommand(original, { kind: 'research', player: 1, buildingId, tech: 'loom' }).ok).toBe(true);
  const { rules, ...state } = original;
  const saved = { version: 4, rulesHash: createHash('sha256').update(JSON.stringify(rules)).digest('hex'), state,
    settings: { speed: 1, paused: true, generation: 7 }, humanTwo: true, setup: { map: 'arabia', seed: 293 } };
  writeFileSync(checkpoint, JSON.stringify(saved));
  // Reopen after the first save as well: only the checkpoint envelope advances
  // to v5, never the old match's state, paid research, setup or rule marker.
  for (const reopen of [false, true]) {
    const beforeStartup = readFileSync(checkpoint, 'utf8');
    const server = await createServer({ root: directory, configFile: false, logLevel: 'silent',
      server: { host: '127.0.0.1', port: 0 }, plugins: [sharedMatchPlugin(directory, checkpoint)] });
    try {
      await server.listen();
      expect(readFileSync(checkpoint, 'utf8')).toBe(beforeStartup);
      const address = server.httpServer!.address();
      if (!address || typeof address === 'string') throw new Error('Missing HTTP address');
      const url = `ws://127.0.0.1:${address.port}/__match/socket?player=1`;
      const config = await fetch(`http://127.0.0.1:${address.port}/__match/config`).then(r => r.json());
      expect(config.version).toBe(SHARED_VERSION);
      if (!reopen) {
        const stale = new WebSocket(url), received: string[] = [];
        stale.on('message', bytes => received.push(JSON.parse(String(bytes)).type));
        await once(stale, 'open', { signal: AbortSignal.timeout(10_000) });
        try {
          const refused = once(stale, 'message', { signal: AbortSignal.timeout(10_000) });
          const closed = once(stale, 'close', { signal: AbortSignal.timeout(10_000) });
          stale.send(JSON.stringify({ type: 'join', version: 4 }));
          expect(JSON.parse(String((await refused)[0]))).toEqual({ type: 'error', reason: 'Match protocol version mismatch' });
          await closed;
          expect(received).toEqual(['error']); // no snapshot/admission
        } finally { stale.terminate(); }
      }
      const client = new WebSocket(url);
      await once(client, 'open', { signal: AbortSignal.timeout(10_000) });
      try {
        const response = once(client, 'message', { signal: AbortSignal.timeout(10_000) });
        client.send(JSON.stringify({ type: 'join', version: SHARED_VERSION }));
        const snapshot = JSON.parse(String((await response)[0]));
        expect(snapshot.type).toBe('snapshot');
        expect(snapshot.state).not.toHaveProperty('researchQueueVersion');
        expectScoreless(snapshot.state);
        expect(checksumState(snapshot.state)).toBe(checksumState(original));
        expect(snapshot.settings).toEqual(saved.settings); expect(snapshot.setup).toEqual(saved.setup);
        const beforeCommand = checksumState(snapshot.state);
        expect(applyCommand(snapshot.state, { kind: 'research', player: 1, buildingId, tech: 'feudal-age' }))
          .toEqual({ ok: false, reason: 'building is already researching' });
        expect(checksumState(snapshot.state)).toBe(beforeCommand);
        // Continue the actual wire-decoded legacy state through completion,
        // not just startup: neither research nor production injects counters.
        const resumed: GameState = snapshot.state;
        const building = resumed.entities.find(e => e.id === buildingId)!;
        const trainedId = resumed.nextId;
        expect(applyCommand(resumed, { kind: 'train', player: 1, buildingId, unit: 'villager' }).ok).toBe(true);
        for (let i = 0; i < 1000 && (building.researching || building.training); i++) stepGame(resumed);
        expect(resumed.players[1].researched).toContain('loom');
        expect(building.researching).toBeUndefined();
        expect(building.training).toBeUndefined();
        expect(resumed.entities.find(e => e.id === trainedId)?.kind).toBe('villager');
        expectScoreless(resumed);
        expectScoreless(JSON.parse(JSON.stringify(resumed)));
      } finally { client.close(); await once(client, 'close'); }
    } finally { await server.close(); }
    expect(JSON.parse(readFileSync(checkpoint, 'utf8'))).toEqual(JSON.parse(JSON.stringify({ ...saved, version: SHARED_CHECKPOINT_VERSION })));
  }
});

function host(checkpoint: string, port = 0) {
  return spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'tools/shared-host.mts'], {
    env: { ...process.env, MATCH_CHECKPOINT: checkpoint, MATCH_PORT: String(port) },
    encoding: 'utf8', timeout: 20_000,
  });
}

describe('shared host startup failure policy', () => {
  it.each([
    JSON.stringify({ version: -1, rulesHash: 'old-rules', state: { tick: 123 } }),
    JSON.stringify({ version: SHARED_CHECKPOINT_VERSION, rulesHash: 'old-rules', state: { tick: 123 } }),
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
    const saved = { version: SHARED_CHECKPOINT_VERSION, rulesHash, state,
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

it('compresses real host snapshots but leaves a large command tick plain (#174)', async () => {
  const { directory, checkpoint } = fixture();
  const { rules: ignored, ...state } = createGame(174, FALLBACK_RULES, undefined, 'windsor');
  const settings = { paused: true, speed: 1, generation: 0 };
  writeFileSync(checkpoint, JSON.stringify({ version: SHARED_CHECKPOINT_VERSION,
    rulesHash: createHash('sha256').update(JSON.stringify(FALLBACK_RULES)).digest('hex'),
    state, settings, humanTwo: true, setup: { map: 'windsor', seed: 174 } }));
  const server = await createServer({ root: directory, configFile: false, logLevel: 'silent',
    server: { host: '127.0.0.1', port: 0 }, plugins: [sharedMatchPlugin(directory, checkpoint)] });
  let plain: string | undefined;
  try {
    await server.listen();
    const address = server.httpServer!.address();
    if (!address || typeof address === 'string') throw new Error('missing HTTP address');
    for (const negotiate of [false, true]) {
      const client = new WebSocket(`ws://127.0.0.1:${address.port}/__match/socket?player=1`, { perMessageDeflate: negotiate });
      const packets = new EventEmitter();
      let transport: Socket;
      client.on('upgrade', response => { transport = response.socket; });
      client.on('error', error => packets.emit('error', error));
      client.on('message', bytes => {
        const raw = bytes.toString();
        const message = JSON.parse(raw);
        packets.emit(`packet:${message.type}`, { raw, message, wireAt: transport.bytesRead });
      });
      await once(client, 'open', { signal: AbortSignal.timeout(10_000) });
      try {
        const before = transport!.bytesRead;
        const response = once(packets, 'packet:snapshot', { signal: AbortSignal.timeout(10_000) });
        client.send(JSON.stringify({ type: 'join', version: SHARED_VERSION }));
        const [snapshot] = await response;
        if (!negotiate) plain = snapshot.raw;
        else {
          expect(snapshot.raw).toBe(plain);
          expect(client.extensions).toContain('permessage-deflate');
          expect(snapshot.wireAt - before).toBeLessThan(Buffer.byteLength(snapshot.raw) / 4);
          client.send(JSON.stringify({ type: 'ready' }));
          const worker = state.entities.find(e => e.kind === 'villager' && e.owner === 1)!;
          const nextTick = once(packets, 'packet:tick', { signal: AbortSignal.timeout(10_000) });
          for (let i = 0; i < 50; i++) client.send(JSON.stringify({ type: 'command',
            command: { kind: 'stop', player: 1, entityIds: [worker.id] } }));
          const controlStart = transport!.bytesRead;
          client.send(JSON.stringify({ type: 'settings', paused: false }));
          const [tick] = await nextTick;
          expect(tick.message.commands).toHaveLength(50);
          expect(Buffer.byteLength(tick.raw)).toBeGreaterThan(1024);
          expect(tick.wireAt - controlStart).toBeGreaterThanOrEqual(Buffer.byteLength(tick.raw));
        }
      } finally { client.close(); await once(client, 'close'); }
    }
  } finally { await server.close(); }
});
