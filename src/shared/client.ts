import { applyCommand, stepGame, type CommandResult } from '../sim/game';
import { synchronizationHash } from './checksum';
import { isAnimal, isUnit } from '../sim/data';
import type { Command, Entity, GameState, PlayerId, Point, Projectile } from '../sim/types';
import { SHARED_VERSION, type HostMessage, type MatchSettings } from './protocol';
import { TickPlayback } from './playback';
import { validMatchSetup, type MatchSetup } from '../match-setup';

export class SharedClient {
  state!: GameState;
  settings!: MatchSettings;
  setup?: MatchSetup;
  connected = false;
  onSnapshot?: (state: GameState, changedMap: boolean) => void;
  onSettings?: (settings: MatchSettings) => void;
  onNotice?: (notice: string) => void;
  private socket?: WebSocket;
  private syncing = true;
  private playback = new TickPlayback();
  private timer?: ReturnType<typeof setTimeout>;
  private immediate = new MessageChannel();
  private scheduled = false;
  private scheduleEpoch = 0;
  private receivedTick = 0;
  private previousEntities = new Map<number, Point>();
  private previousProjectiles = new Map<number, Point>();
  private renderAlpha = 1;
  readonly stats = {
    checks: 0, resyncs: 0, snapshots: 0, lastReason: '',
    maxQueuedTicks: 0, maxStepMs: 0, maxHashMs: 0,
    ticksApplied: 0, totalStepMs: 0, totalHashMs: 0,
  };
  constructor(readonly player: PlayerId) {
    this.immediate.port1.onmessage = event => {
      if (event.data === this.scheduleEpoch) this.pump();
    };
  }

  get pendingTicks(): number { return this.playback.pendingTicks; }

  beginRender(now: number): void { this.renderAlpha = this.playback.alpha(now); }

  renderPosition(entity: Entity): Point {
    return this.interpolate(this.previousEntities.get(entity.id), entity.position);
  }

  renderProjectile(projectile: Projectile): Point {
    return this.interpolate(this.previousProjectiles.get(projectile.id), projectile.position);
  }

  private interpolate(previous: Point | undefined, current: Point): Point {
    if (!previous || this.renderAlpha === 1 || (previous.x === current.x && previous.y === current.y)) return current;
    return { x: previous.x + (current.x - previous.x) * this.renderAlpha, y: previous.y + (current.y - previous.y) * this.renderAlpha };
  }

  private clearPlayback(): void {
    clearTimeout(this.timer); this.timer = undefined;
    this.scheduleEpoch++; this.scheduled = false;
    this.playback.clear();
    this.previousEntities.clear(); this.previousProjectiles.clear();
    this.renderAlpha = 1;
  }

  private schedulePump(delay: number): void {
    if (this.scheduled) return;
    this.scheduled = true;
    if (delay > 0) this.timer = setTimeout(this.pump, delay);
    // A MessageChannel yields a task without the nested setTimeout(0) 4 ms
    // clamp, which otherwise limits catch-up at 200 simulation ticks/second.
    else this.immediate.port2.postMessage(this.scheduleEpoch);
  }

  private pump = (): void => {
    this.timer = undefined; this.scheduled = false;
    const delay = this.playback.drain(() => performance.now(), message => {
      if (message.type === 'tick') {
        const started = performance.now();
        this.previousEntities.clear(); this.previousProjectiles.clear();
        for (const entity of this.state.entities) {
          if (!entity.dead && (isUnit(entity.kind) || isAnimal(entity.kind))) {
            this.previousEntities.set(entity.id, { ...entity.position });
          }
        }
        for (const projectile of this.state.projectiles) this.previousProjectiles.set(projectile.id, { ...projectile.position });
        for (const command of message.commands) {
          if (!applyCommand(this.state, command).ok) { this.resync('command rejected'); return; }
        }
        stepGame(this.state);
        const stepMs = performance.now() - started;
        this.stats.ticksApplied++;
        this.stats.totalStepMs += stepMs;
        this.stats.maxStepMs = Math.max(this.stats.maxStepMs, stepMs);
        if (message.hash) {
          const startHash = performance.now();
          const hash = synchronizationHash(this.state);
          const hashMs = performance.now() - startHash;
          this.stats.totalHashMs += hashMs;
          this.stats.maxHashMs = Math.max(this.stats.maxHashMs, hashMs);
          this.stats.checks++;
          if (hash !== message.hash) { this.resync(`checksum at tick ${message.tick}`); return; }
        }
      }
      this.settings = message.settings;
      this.onSettings?.(this.settings);
    });
    if (delay !== undefined && !this.syncing) this.schedulePump(delay);
  };

  async connect(resume?: GameState, setup?: MatchSetup): Promise<void> {
    return new Promise(resolve => {
      const open = () => {
        const url = new URL('/__match/socket', location.href);
        url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        url.searchParams.set('player', String(this.player));
        const socket = this.socket = new WebSocket(url);
        socket.onopen = () => {
          socket.send(JSON.stringify({ type: 'join', version: SHARED_VERSION, resume, setup }));
          resume = undefined;
        };
        socket.onmessage = event => {
          const message = JSON.parse(event.data) as HostMessage;
          if (message.type === 'snapshot') {
            const changedMap = !this.state || !this.settings || this.settings.generation !== message.settings.generation
              || this.state.width !== message.state.width || this.state.height !== message.state.height
              || this.state.matchSeed !== message.state.matchSeed
              || this.state.terrain.some((tile, index) => tile !== message.state.terrain[index])
              || this.state.elevation.some((level, index) => level !== message.state.elevation[index]);
            this.clearPlayback();
            this.state = message.state;
            this.setup = validMatchSetup(message.setup) ? message.setup : undefined;
            this.receivedTick = this.state.tick;
            this.settings = message.settings;
            this.connected = true; this.syncing = false;
            this.stats.snapshots++;
            socket.send(JSON.stringify({ type: 'ready' }));
            this.onSnapshot?.(this.state, changedMap);
            this.onSettings?.(this.settings);
            this.onNotice?.(`Connected as player ${this.player}${this.settings.paused ? ' — match paused (F3)' : ''}`);
            resolve();
          } else if ((message.type === 'tick' || message.type === 'settings') && !this.syncing) {
            if (message.type === 'tick') {
              if (message.tick !== this.receivedTick + 1 || message.settings.generation !== this.settings.generation) { this.resync('tick gap'); return; }
              this.receivedTick = message.tick;
            }
            this.playback.enqueue(message, performance.now());
            this.stats.maxQueuedTicks = Math.max(this.stats.maxQueuedTicks, this.pendingTicks);
            if (this.pendingTicks > 2000) { this.resync('client tick backlog'); return; }
            this.schedulePump(0);
          } else if (message.type === 'error') this.onNotice?.(message.reason);
        };
        socket.onclose = () => {
          this.connected = false; this.syncing = true;
          this.clearPlayback();
          this.onNotice?.('Disconnected — reconnecting to Ysgramor…');
          setTimeout(open, 1500);
        };
        socket.onerror = () => socket.close();
      };
      open();
    });
  }

  private resync(reason: string): void {
    this.syncing = true;
    this.clearPlayback();
    this.stats.resyncs++;
    this.stats.lastReason = reason;
    console.warn(`[shared] resync: ${reason}`);
    this.onNotice?.('Synchronizing match…');
    this.socket?.send(JSON.stringify({ type: 'resync' }));
  }

  requestResync(): void {
    if (this.connected && !this.syncing) this.resync('diagnostic request');
  }

  send(message: object): boolean {
    if (!this.connected || this.syncing || this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  command(command: Command): CommandResult {
    return this.send({ type: 'command', command }) ? { ok: true } : { ok: false, reason: 'Disconnected from host' };
  }
}

export async function connectSharedMatch(initialState?: () => GameState | undefined, notice?: (text: string) => void, setup?: MatchSetup): Promise<SharedClient | undefined> {
  // An independent browser match for solo play and QA, even on the shared host.
  if (new URLSearchParams(location.search).get('solo') === '1') return;
  let config;
  try {
    const response = await fetch('/__match/config');
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return;
    config = await response.json();
  } catch { return; }
  if (!config.enabled) return;
  if (config.version !== SHARED_VERSION) throw new Error('Host/client version mismatch; reload the game');
  const requested = new URLSearchParams(location.search).get('player');
  const player: PlayerId = requested === '2' ? 2 : requested === '1' ? 1 : config.player;
  const client = new SharedClient(player);
  client.onNotice = notice;
  await client.connect(player === 1 ? initialState?.() : undefined, player === 1 ? setup : undefined);
  return client;
}
