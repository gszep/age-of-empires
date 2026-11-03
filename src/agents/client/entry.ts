/**
 * `?agents=2` spectator entry (#352).
 *
 * A standalone read-only page: real model selectors populated from the
 * sanitized catalogue, an explicit capability-gated Start/Stop, live status,
 * per-player thinking/usage, typed failure surfacing, and the match rebuilt
 * and rendered live by the shared simulation through MatchView. The finished
 * or aborted match's canonical record is retained in-page and downloadable;
 * the board keeps showing the final state.
 *
 * It never initializes the interactive game, submits no gameplay commands,
 * and holds no OpenCode credentials: everything it learns comes from the
 * local agents wire, already sanitized.
 */
import './agents.css';
import { AgentsClient, AgentsClientError, type AgentsStartRequest } from './agents-client';
import { MatchView, type MatchViewSummary } from './match-view';
import type { OpenCodeModelSummary } from '../protocol';

const app = document.querySelector('#agents-app') as HTMLElement;
app.replaceChildren();

const collectedErrors: string[] = [];
window.addEventListener('error', event => { collectedErrors.push(String(event.message)); });
window.addEventListener('unhandledrejection', event => { collectedErrors.push(String(event.reason)); });

interface RetainedReplay {
  matchId: string;
  status: string;
  commands: number;
  record: unknown;
}

const ui = {
  models: [] as OpenCodeModelSummary[],
  capability: undefined as string | undefined,
  catalogueError: undefined as string | undefined,
  requestError: undefined as string | undefined,
  busy: false,
  retained: [] as RetainedReplay[],
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// --- page skeleton ---------------------------------------------------------

const header = el('header', 'agents-header');
const title = el('h1', undefined, 'Live agent match');
const rulesBadge = el('span', 'agents-badge', 'connecting…');
rulesBadge.id = 'agents-rules';
header.append(title, rulesBadge);

const controls = el('section', 'agents-controls');
const modelWrap1 = el('label', 'agents-field');
const modelWrap2 = el('label', 'agents-field');
const model1 = el('select', 'agents-select'); model1.id = 'agents-model-1';
const model2 = el('select', 'agents-select'); model2.id = 'agents-model-2';
model1.disabled = true; model2.disabled = true;
modelWrap1.append(el('span', undefined, 'Player 1 model'), model1);
modelWrap2.append(el('span', undefined, 'Player 2 model'), model2);
const seedWrap = el('label', 'agents-field');
const seed = el('input', 'agents-select'); seed.id = 'agents-seed';
seed.type = 'number'; seed.min = '1'; seed.value = String(1 + Math.floor(Math.random() * 2 ** 30));
seedWrap.append(el('span', undefined, 'Seed'), seed);
const start = el('button', 'agents-button agents-start', 'Start match'); start.id = 'agents-start';
const stop = el('button', 'agents-button agents-stop', 'Stop match'); stop.id = 'agents-stop';
const retryModels = el('button', 'agents-button', 'Retry'); retryModels.id = 'agents-retry';
start.disabled = true; stop.disabled = true;
controls.append(modelWrap1, modelWrap2, seedWrap, start, stop, retryModels);

const catalogue = el('div', 'agents-catalogue'); catalogue.id = 'agents-catalogue';
const status = el('div', 'agents-status', 'Idle — no match started'); status.id = 'agents-status';
const players = el('div', 'agents-players');
const player1 = el('div', 'agents-player'); player1.id = 'agents-player-1';
const player2 = el('div', 'agents-player'); player2.id = 'agents-player-2';
players.append(player1, player2);
const failure = el('div', 'agents-failure agents-hidden'); failure.id = 'agents-failure';
const board = document.createElement('canvas'); board.id = 'agents-board'; board.className = 'agents-board';
const boardNote = el('div', 'agents-board-note',
  'Tactical 2D board — a limited testing view over the authoritative simulation. The familiar in-game spectator renderer is not part of this slice.');
const footer = el('footer', 'agents-footer');
const result = el('div', 'agents-result'); result.id = 'agents-result';
const replays = el('div', 'agents-replays'); replays.id = 'agents-replays';
footer.append(result, replays);

app.append(header, controls, catalogue, status, players, failure, board, boardNote, footer);

// --- live view -------------------------------------------------------------

const view = new MatchView();
const client = new AgentsClient();
let painted = 0;

view.onChange(summary => { renderSummary(summary); markDirty(); });

const ctx = board.getContext('2d') as CanvasRenderingContext2D;
const PLAYER_COLORS: Record<number, string> = { 1: '#e2534b', 2: '#4b7fe2' };
const BUILDINGS = new Set(['town-center', 'house', 'barracks', 'mill', 'lumber-camp', 'mining-camp', 'farm', 'archery-range', 'stable', 'blacksmith', 'market', 'monastery', 'wonder', 'wall', 'gate', 'castle', 'dock', 'university', 'siege-workshop']);

function paint(): void {
  painted += 1;
  const state = view.gameState;
  const width = Math.max(1, Math.floor(board.clientWidth));
  const height = Math.max(1, Math.floor(board.clientHeight));
  if (board.width !== width || board.height !== height) { board.width = width; board.height = height; }
  ctx.fillStyle = '#182119';
  ctx.fillRect(0, 0, width, height);
  if (!state) {
    ctx.fillStyle = '#8fa396';
    ctx.font = '14px system-ui, sans-serif';
    ctx.fillText('No live match board yet — start a match to watch it here.', 12, 24);
    return;
  }
  const scale = Math.max(1, Math.floor(Math.min(width / state.width, height / state.height)));
  const offsetX = (width - state.width * scale) / 2;
  const offsetY = (height - state.height * scale) / 2;
  ctx.fillStyle = '#24352a';
  ctx.fillRect(offsetX, offsetY, state.width * scale, state.height * scale);
  for (const entity of state.entities) {
    const color = entity.owner === 1 || entity.owner === 2 ? PLAYER_COLORS[entity.owner] : '#7a8f4f';
    const size = BUILDINGS.has(entity.kind) ? Math.max(3, scale * 2) : Math.max(2, scale);
    ctx.fillStyle = color;
    ctx.fillRect(offsetX + entity.position.x * scale - size / 2, offsetY + entity.position.y * scale - size / 2, size, size);
  }
}

let dirty = false;
let frame = 0;
function markDirty(): void {
  if (dirty) return;
  dirty = true;
  frame = requestAnimationFrame(() => { dirty = false; paint(); });
}

new ResizeObserver(() => markDirty()).observe(board);

// --- rendering -------------------------------------------------------------

function renderSummary(summary: MatchViewSummary): void {
  rulesBadge.textContent = summary.rulesOrigin
    ? `rules: ${summary.rulesOrigin} (fallback bundle — owned rules are never applied silently)`
    : 'rules: fallback (backend bundle)';
  rulesBadge.title = summary.initialChecksum ? `initial checksum: ${summary.initialChecksum}` : '';
  const models = summary.players[1].model ? `${summary.players[1].model} vs ${summary.players[2].model}` : 'no models yet';
  const live = summary.status === 'running' ? `live` : (summary.status ?? 'idle');
  status.textContent = summary.matchId
    ? `${live} — match ${summary.matchId}, tick ${summary.tick}, ${summary.timeSeconds.toFixed(1)}s — ${models}`
    : `Idle — no match started (${models})`;
  for (const [node, player, label] of [[player1, 1, 'P1'], [player2, 2, 'P2']] as const) {
    const info = summary.players[player];
    node.textContent = `${label}: ${info.model || '—'} · ${info.usage} decisions · ${info.commands} commands ${info.thinking ? '· thinking…' : info.last === 'failed' ? '· last decision failed' : ''}`;
  }
  const problems: string[] = [];
  if (ui.requestError) problems.push(ui.requestError);
  if (summary.failure) problems.push(`match failed (${summary.failure.code}): ${summary.failure.message}`);
  if (summary.viewError) problems.push(`view: ${summary.viewErrorMessage}`);
  if (summary.reconstructionOk === false) problems.push(`reconstruction failed ${summary.reconstructionFailures} check(s) of commands, terminal progress or hashes — board may be wrong`);
  if (problems.length) {
    failure.classList.remove('agents-hidden');
    failure.textContent = problems.join(' · ');
  } else {
    failure.classList.add('agents-hidden');
  }
  const running = summary.status === 'running';
  start.disabled = ui.busy || running || !ui.capability || ui.models.length === 0;
  stop.disabled = !running;
  if (summary.record && summary.status && summary.matchId && !ui.retained.some(entry => entry.matchId === summary.matchId)) {
    ui.retained.unshift({ matchId: summary.matchId, status: summary.status, commands: summary.record.commands.length, record: summary.record });
    ui.retained.length = Math.min(ui.retained.length, 8);
    renderRetained();
  }
  if (summary.result) {
    const winner = summary.result.winner !== undefined ? `player ${summary.result.winner} wins` : summary.result.draw ? 'draw' : 'no winner';
    result.textContent = `Result: ${winner} at ${summary.result.timeSeconds}s (seed ${summary.result.seed}).`;
  } else if (summary.matchId) {
    result.textContent = 'Result: match not finished.';
  } else {
    result.textContent = '';
  }
}

function renderRetained(): void {
  replays.replaceChildren();
  const heading = el('div', 'agents-replays-heading', ui.retained.length ? 'Retained replays:' : 'No retained replays yet.');
  replays.append(heading);
  for (const entry of ui.retained) {
    const row = el('div', 'agents-replay-row');
    const label = el('span', undefined, `${entry.matchId} (${entry.status}, ${entry.commands} commands)`);
    const download = el('button', 'agents-button', 'Download replay');
    download.addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(entry.record, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = el('a'); link.href = url; link.download = `agents-replay-${entry.matchId}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 5_000);
    });
    row.append(label, download);
    replays.append(row);
  }
}

// --- wire ------------------------------------------------------------------

const unsubscribe = client.subscribe(
  event => view.apply(event),
  reason => { status.textContent = `Reconnecting after ${reason}… (resubscribing for a fresh snapshot)`; },
);
window.addEventListener('pagehide', () => { unsubscribe(); cancelAnimationFrame(frame); }, { once: true });

async function refreshCapability(): Promise<void> {
  try { ui.capability = await client.capability(); }
  catch (error) { catalogueError(error); }
}

function catalogueError(error: unknown): void {
  ui.catalogueError = error instanceof AgentsClientError
    ? `${error.code}: ${error.message}`
    : 'unknown: could not reach the local agents backend';
  catalogue.textContent = `Model catalogue unavailable — ${ui.catalogueError}`;
  start.disabled = true;
}

async function loadModels(): Promise<void> {
  ui.catalogueError = undefined;
  ui.models = [];
  ui.capability = undefined;
  start.disabled = true;
  model1.disabled = true; model2.disabled = true;
  catalogue.textContent = 'Loading model catalogue…';
  try {
    const [models] = await Promise.all([client.models(), refreshCapability()]);
    ui.models = models;
    for (const select of [model1, model2]) {
      select.replaceChildren();
      for (const model of models) {
        const option = el('option', undefined, `${model.providerID} — ${model.name}`);
        option.value = `${model.providerID}/${model.id}`;
        select.append(option);
      }
    }
    if (model2.options.length > 1) model2.selectedIndex = 1;
    model1.disabled = models.length === 0;
    model2.disabled = models.length === 0;
    catalogue.textContent = models.length
      ? `${models.length} models available from the local OpenCode service.`
      : 'Model catalogue is empty — start an OpenCode service and retry.';
    start.disabled = ui.busy || models.length === 0;
  } catch (error) {
    catalogueError(error);
  }
  renderSummary(view.summary());
}

start.addEventListener('click', () => {
  const provider = (select: HTMLSelectElement): { id: string; providerID: string } | undefined => {
    const model = ui.models[select.selectedIndex];
    return model ? { id: model.id, providerID: model.providerID } : undefined;
  };
  const first = provider(model1);
  const second = provider(model2);
  const seedValue = Number(seed.value);
  if (!first || !second || !Number.isSafeInteger(seedValue) || seedValue < 1) return;
  const spec: AgentsStartRequest = { seed: seedValue, models: { 1: first, 2: second } };
  void (async () => {
    ui.busy = true;
    ui.requestError = undefined;
    start.disabled = true;
    try {
      if (!ui.capability) await refreshCapability();
      const matchId = await client.start(spec, ui.capability ?? '');
      status.textContent = `Started ${matchId}…`;
    } catch (error) {
      failure.classList.remove('agents-hidden');
      ui.requestError = error instanceof AgentsClientError
        ? `start failed (${error.code}): ${error.message}`
        : 'start failed (unknown)';
      if (error instanceof AgentsClientError && (error.code === 'forbidden' || error.code === 'network')) {
        ui.capability = undefined;
        void refreshCapability();
      }
    } finally {
      ui.busy = false;
      renderSummary(view.summary());
    }
  })();
});

stop.addEventListener('click', () => {
  void (async () => {
    stop.disabled = true;
    ui.requestError = undefined;
    try {
      if (!ui.capability) await refreshCapability();
      await client.stop(ui.capability ?? '');
    } catch (error) {
      failure.classList.remove('agents-hidden');
      ui.requestError = error instanceof AgentsClientError
        ? `stop failed (${error.code}): ${error.message}`
        : 'stop failed (unknown)';
    } finally {
      renderSummary(view.summary());
    }
  })();
});

retryModels.addEventListener('click', () => { void loadModels(); });

void (async () => {
  try {
    const reply = await client.status();
    rulesBadge.textContent = `rules: ${reply.rulesOrigin} (${reply.rulesMode})`;
    rulesBadge.title = reply.rulesNote;
  } catch { /* the catalogue line below reports connection problems */ }
  await loadModels();
})();

// --- development probe hook (never present in a production build) ----------

if (import.meta.env.DEV) {
  const hook = async (query: unknown): Promise<unknown> => {
    const q = query as { type?: string };
    if (q?.type === 'view') {
      const summary = view.summary();
      return { ...summary, painted, entities: summary.entities, boardWidth: board.width };
    }
    if (q?.type === 'page') {
      return {
        models: ui.models.length,
        selected: [model1.value, model2.value],
        seed: seed.value,
        startDisabled: start.disabled,
        stopDisabled: stop.disabled,
        statusText: status.textContent,
        catalogueText: catalogue.textContent,
        failureText: failure.classList.contains('agents-hidden') ? '' : failure.textContent,
        rulesText: rulesBadge.textContent,
        resultText: result.textContent,
        retained: ui.retained.map(entry => ({ matchId: entry.matchId, status: entry.status, commands: entry.commands })),
        errors: collectedErrors,
      };
    }
    if (q?.type === 'errors') return collectedErrors;
    return undefined;
  };
  (window as unknown as Record<string, unknown>).__agentsDebug = hook;
}
