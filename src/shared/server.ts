import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import type { Plugin } from 'vite';
import { FALLBACK_RULES, rulesFromManifest, TICK_SECONDS } from '../sim/data';
import { createGame } from '../sim/game';
import { validMatchSetup } from '../match-setup';
import { validateCommand } from '../protocol/validate';
import type { PlayerId } from '../sim/types';
import { SharedMatch } from './match';
import { SHARED_SPEEDS, SHARED_VERSION, type HostMessage } from './protocol';
import { SNAPSHOT_COMPRESSION } from './snapshot-compression';

/** EX_CONFIG: retrying cannot repair a saved match; leave it for its owner. */
export class SharedCheckpointError extends Error {
  readonly exitCode = 78;
  constructor(path: string, reason: string) {
    super(`Shared checkpoint ${JSON.stringify(path)} ${reason}. Saved match preserved. Restore matching game rules/version, or move this checkpoint aside to start a new match, then start open-empires-shared.service.`);
    this.name = 'SharedCheckpointError';
  }
}

export function sharedMatchPlugin(root: string, checkpointPath = resolve(root, '.local/shared-match.json')): Plugin {
  let cleanup: (() => void) | undefined;
  return {
    name: 'household-match',
    closeBundle() { cleanup?.(); cleanup = undefined; },
    configureServer(server) {
      const manifest = resolve(root, 'public/imported/aoe2/manifest.json');
      const rules = existsSync(manifest) ? rulesFromManifest(JSON.parse(readFileSync(manifest, 'utf8'))) : FALLBACK_RULES;
      const rulesHash = createHash('sha256').update(JSON.stringify(rules)).digest('hex');
      const checkpoint = checkpointPath;
      const match = new SharedMatch(createGame(42, rules), { map: 'arabia', seed: 42 });
      let pristine = !existsSync(checkpoint);
      if (existsSync(checkpoint)) {
        let saved;
        try { saved = JSON.parse(readFileSync(checkpoint, 'utf8')); }
        catch (error) {
          if (error instanceof SyntaxError) throw new SharedCheckpointError(checkpoint, 'is not valid JSON');
          throw error;
        }
        if (!saved || saved.version !== SHARED_VERSION || saved.rulesHash !== rulesHash) {
          throw new SharedCheckpointError(checkpoint, 'uses different rules/version');
        }
        match.state = { ...saved.state, rules };
        match.settings = saved.settings;
        match.humanTwo = saved.humanTwo;
        match.setup = validMatchSetup(saved.setup) ? saved.setup : undefined;
      }
      const sockets = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 * 1024,
        perMessageDeflate: SNAPSHOT_COMPRESSION });
      const players = new Map<WebSocket, PlayerId>();
      const snapshotBytes = new Map<WebSocket, number>();
      const send = (socket: WebSocket, message: HostMessage) => {
        if (socket.readyState !== WebSocket.OPEN) return;
        const data = JSON.stringify(message);
        // A surveyed-map snapshot can exceed the ordinary tick-backlog budget.
        // Keep its allowance until the browser acknowledges receiving it.
        if (message.type === 'snapshot') snapshotBytes.set(socket, Buffer.byteLength(data));
        socket.send(data, { compress: message.type === 'snapshot' });
      };
      const broadcast = (message: HostMessage) => {
        if (message.type === 'snapshot') {
          for (const socket of players.keys()) send(socket, message);
          return;
        }
        const data = JSON.stringify(message);
        for (const socket of players.keys()) {
          // A suspended browser reconnects from a snapshot instead of retaining an unbounded tick backlog.
          if (socket.bufferedAmount > (snapshotBytes.get(socket) ?? 0) + 1024 * 1024) socket.terminate();
          else if (socket.readyState === WebSocket.OPEN) socket.send(data, { compress: false });
        }
      };
      const save = () => {
        // Merely starting the service must not prevent the first host browser
        // from handing over its current game (or its requested map and seed).
        if (pristine) return;
        mkdirSync(resolve(root, '.local'), { recursive: true });
        const { rules: _rules, ...state } = match.state;
        writeFileSync(checkpoint + '.tmp', JSON.stringify({ version: SHARED_VERSION, rulesHash, state, settings: match.settings, humanTwo: match.humanTwo, setup: match.setup }));
        renameSync(checkpoint + '.tmp', checkpoint);
      };
      server.middlewares.use('/__match/config', (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify({ enabled: true, player: 1, version: SHARED_VERSION }));
      });
      const upgrade = (req: import('node:http').IncomingMessage, socket: import('node:stream').Duplex, head: Buffer) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        if (url.pathname !== '/__match/socket') return;
        sockets.handleUpgrade(req, socket, head, ws => {
          const player: PlayerId = url.searchParams.get('player') === '2' ? 2 : 1;
          ws.on('message', bytes => {
            const error = (reason: string) => send(ws, { type: 'error', reason });
            try {
              const message = JSON.parse(bytes.toString());
              if (message.type === 'join' && !players.has(ws)) {
                if (message.version !== SHARED_VERSION) { error('Match protocol version mismatch'); ws.close(); return; }
                const resume = message.resume;
                if (pristine && player === 1 && resume && Number.isInteger(resume.tick)
                  && Array.isArray(resume.entities) && resume.players && resume.visibility
                  && createHash('sha256').update(JSON.stringify(resume.rules)).digest('hex') === rulesHash) {
                  match.state = { ...resume, rules };
                  match.setup = validMatchSetup(message.setup) ? message.setup : undefined;
                }
                pristine = false;
                players.set(ws, player);
                if (player === 2) match.humanTwo = true;
                send(ws, match.snapshot());
                save();
                return;
              }
              if (!players.has(ws)) return;
              if (message.type === 'ready') { snapshotBytes.delete(ws); return; }
              if (message.type === 'resync') { send(ws, match.snapshot()); return; }
              if (message.type === 'command') {
                if (!validateCommand(message.command)) { error('Invalid command'); return; }
                match.enqueue(player, message.command, error);
              } else if (message.type === 'settings') {
                if (typeof message.paused === 'boolean') match.settings.paused = message.paused;
                if (Number.isInteger(message.speed) && message.speed >= 0 && message.speed < SHARED_SPEEDS.length) match.settings.speed = message.speed;
                broadcast({ type: 'settings', settings: match.settings });
              } else if (message.type === 'restart' && player === 1) {
                if (!validMatchSetup(message)) { error('Invalid map or seed'); return; }
                match.restart(message.seed, message.map, message.civilizations);
                broadcast(match.snapshot());
                save();
              }
            } catch { error('Invalid match message'); }
          });
          ws.on('close', () => {
            if (!players.has(ws)) return;
            players.delete(ws);
            snapshotBytes.delete(ws);
            if (![...players.values()].includes(player)) {
              match.settings.paused = true;
              broadcast({ type: 'settings', settings: match.settings });
              save();
            }
          });
          ws.on('error', () => ws.terminate());
        });
      };
      server.httpServer!.on('upgrade', upgrade);
      let previous = performance.now();
      let accumulator = 0;
      const timer = setInterval(() => {
        const now = performance.now();
        const elapsed = Math.min(0.25, (now - previous) / 1000);
        previous = now;
        if (!players.size || match.settings.paused || match.state.winner) { accumulator = 0; return; }
        accumulator += elapsed * SHARED_SPEEDS[match.settings.speed];
        while (accumulator >= TICK_SECONDS && !match.state.winner) {
          broadcast(match.advance());
          accumulator -= TICK_SECONDS;
        }
      }, 16);
      const saver = setInterval(save, 5000);
      cleanup = () => {
        clearInterval(timer); clearInterval(saver);
        match.settings.paused = true;
        save();
        for (const socket of players.keys()) socket.terminate();
        players.clear();
        snapshotBytes.clear();
        sockets.close();
        server.httpServer!.off('upgrade', upgrade);
      };
      server.httpServer!.on('close', () => { cleanup?.(); cleanup = undefined; });
    },
  };
}
