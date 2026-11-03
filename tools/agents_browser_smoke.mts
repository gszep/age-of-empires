/**
 * #352 browser smoke: the real `?agents=2` spectator page against a private
 * Vite dev server and a fake OpenCode transport (never a live service, never
 * a paid generation).
 *
 * Proves, in a real browser: catalogue-unavailable UX, model selection and
 * explicit Start, accepted commands with live ticks and a rendered board,
 * second-tab late join, Stop settling with retained replay, an auth failure
 * surfaced typed and sanitized, cross-origin/host/capability denials, the
 * absence of any player command route, ended-state late snapshots, a small
 * viewport, and finite cleanup with a match in flight.
 *
 * The fake transport derives every command from the prompt's own observation
 * JSON (never external IDs), and the injected client class is loaded through
 * the Vite server's own SSR module runner so `instanceof` checks inside the
 * backend match the real module identity, not just a parallel Node realm.
 */
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { createServer, loadConfigFromFile } from 'vite';
import { launchBrowser, newPage, root } from './smoke-harness.mjs';
import { agentsPagePlugin } from '../src/agents/server/plugin.ts';
import { catalogueWire, declaredError, promptObservation, textWire } from '../src/headless/opencode-fake.ts';

const port = 5317;
const base = `http://127.0.0.1:${port}`;
const pageUrl = `${base}/?agents=2`;
let mode: 'unavailable' | 'happy' | 'authfail' = 'unavailable';
let generations = 0;

// Exercise the actual npm-dev config, without requesting the catalogue or a
// start (the only routes that can discover/contact OpenCode). Page routing is
// lazy; a status read loads the backend but does not discover a service.
const defaultServer = await createServer({ root, configFile: `${root}vite.config.ts`, logLevel: 'error',
  server: { host: '127.0.0.1', port, strictPort: true } });
try {
  await defaultServer.listen();
  const plain = await (await fetch(`${base}/`)).text();
  assert.ok(plain.includes('/src/main.ts') && !plain.includes('/src/agents/client/entry.ts'));
  const agentHtml = await (await fetch(pageUrl)).text();
  assert.ok(agentHtml.includes('/src/agents/client/entry.ts') && !agentHtml.includes('/src/main.ts'));
  assert.equal(defaultServer.environments.ssr.moduleGraph.getModuleById(`${root}src/agents/server/backend.ts`), undefined, 'HTML routing does not load backend');
  const status = await (await fetch(`${base}/agents/api/status`)).json();
  assert.equal(status.status, 'idle');
  assert.equal(status.rulesMode, 'fallback');
  assert.ok(defaultServer.environments.ssr.moduleGraph.getModuleById(`${root}src/agents/server/backend.ts`), 'status lazily loads backend');
  assert.equal((await fetch(`${base}/index.html?agents=2`, { method: 'HEAD' })).status, 200);
  console.log('DEFAULT CONFIG GREEN: normal/agents HTML isolation, lazy backend, idle fallback status and HEAD (no service requests)');
} finally { await defaultServer.close(); }

/** Fake V2 transport: sanitized catalogue; commands derived from the prompt only. */
const transport = {
  async listModels() {
    if (mode === 'unavailable') throw declaredError('LocationNotFoundError', 'no healthy registered OpenCode service found');
    return catalogueWire([
      { id: 'vendor/model-a', providerID: 'provider-a', name: 'Model A', type: 'chat', enabled: true },
      { id: 'model-b', providerID: 'provider-b', name: 'Model B', type: 'chat', enabled: true },
    ]);
  },
  async generateText(request: { prompt: string }) {
    generations += 1;
    if (mode === 'authfail') throw declaredError('UnauthorizedError', 'api_key=PRIVATE_SECRET');
    await new Promise(resolve => setTimeout(resolve, 15)); // pace so spectators attach mid-match
    const seen = promptObservation(request.prompt);
    const tc = seen.entities.find(e => e.owner === seen.player && e.kind === 'town-center');
    if (tc && seen.player === 1) {
      return textWire(JSON.stringify({ type: 'commands', time: seen.time,
        commands: [{ kind: 'train', player: seen.player, buildingId: tc.id, unit: 'villager' }] }));
    }
    const unit = seen.entities.find(e => e.owner === seen.player && e.kind === 'villager');
    return textWire(JSON.stringify({ type: 'commands', time: seen.time,
      commands: unit ? [{ kind: 'stop', player: seen.player, entityIds: [unit.id] }] : [] }));
  },
};

const loaded = await loadConfigFromFile({ command: 'serve', mode: 'development' }, `${root}vite.config.ts`, root);
assert.ok(loaded, 'real dev config loaded');
const fakePlugin = agentsPagePlugin({
    // The client class comes from the server's own SSR module runner, so the
    // backend's `instanceof` checks see the real module identity.
    client: async () => {
      const module = await server.ssrLoadModule('/src/headless/opencode-client.ts') as { OpenCodeClient: new (t: unknown, d?: unknown) => never };
      return new module.OpenCodeClient(transport, { timeoutMs: 5_000 });
    },
  });
// Keep every real config option/plugin, substituting only the agents plugin's
// injected client. There is no fake branch, environment flag or route in app code.
assert.equal(loaded.config.plugins!.filter((p: any) => p?.name === 'agents-live-browser').length, 1);
const server = await createServer({
  ...loaded.config, root, configFile: false, logLevel: 'error',
  plugins: loaded.config.plugins!.map((p: any) => p?.name === 'agents-live-browser' ? fakePlugin : p),
  server: { host: '127.0.0.1', port, strictPort: true },
});
await server.listen();

let browser: Awaited<ReturnType<typeof launchBrowser>>;
const tabs: Awaited<ReturnType<typeof newPage>>[] = [];
const open = async (viewport?: { width: number; height: number }) => {
  const tab = await newPage(browser, viewport ? { viewport } : {});
  tabs.push(tab);
  await tab.page.evaluateOnNewDocument('globalThis.__name = f => f');
  await tab.page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
  await tab.page.waitForFunction(() => typeof (window as any).__agentsDebug === 'function', { timeout: 60_000, polling: 100 });
  return tab;
};
const view = (page: any) => page.evaluate(() => (window as any).__agentsDebug({ type: 'view' }));
const pageState = (page: any) => page.evaluate(() => (window as any).__agentsDebug({ type: 'page' }));

try {
  browser = await launchBrowser({ protocolTimeout: 30_000 });
  // The regular game and agent page share this private real-config server.
  // Exercise actual rendering, ticking and Vite's accepted-module lifecycle
  // without editing source or touching the shared development server.
  const normal = await newPage(browser);
  tabs.push(normal);
  await normal.page.evaluateOnNewDocument('globalThis.__name = f => f');
  const normalLogs: string[] = [];
  normal.page.on('console', message => normalLogs.push(message.text()));
  await normal.page.goto(`${base}/?map=arabia&seed=352`, { waitUntil: 'domcontentloaded' });
  await normal.page.waitForFunction(() => typeof (window as any).__empiresDebug === 'function'
    && document.querySelector('canvas.battlefield'), { timeout: 60_000 });
  const simBefore = await normal.page.evaluate(() => (window as any).__empiresDebug({ type: 'sim' }));
  await normal.page.waitForFunction(async (tick: number) => (await (window as any).__empiresDebug({ type: 'sim' })).tick > tick,
    { timeout: 30_000 }, simBefore.tick);
  const normalPixels = await normal.page.evaluate(() => (window as any).__empiresDebug({ type: 'pixels' }));
  assert.ok(normalPixels.pixels > 0 && normalPixels.colors[0].fraction < 0.995, 'normal game really renders');
  const tc = await normal.page.evaluate(async () => (await (window as any).__empiresDebug({ type: 'entities', owner: 1 }))
    .entities.find((entity: any) => entity.kind === 'town-center'));
  assert.ok(tc, 'normal game has a player town center');
  await normal.page.mouse.click(tc.screen.x, tc.screen.y);
  await normal.page.waitForFunction(() => {
    const button = document.querySelector('.command-button[data-command="train-villager"]') as HTMLButtonElement;
    return button && !button.disabled;
  }, { timeout: 10_000 });
  await normal.page.click('.command-button[data-command="train-villager"]');
  await normal.page.waitForFunction(async (id: number) => {
    const entity = (await (window as any).__empiresDebug({ type: 'entities', id })).entities[0];
    return entity?.training === 'villager' && entity?.queued >= 1;
  }, { timeout: 10_000 }, tc.id);
  const tickBeforeHmr = (await normal.page.evaluate(() => (window as any).__empiresDebug({ type: 'sim' }))).tick;
  const hudModule = await server.moduleGraph.getModuleByUrl('/src/view/hud.ts');
  assert.ok(hudModule, 'normal HUD module loaded');
  await server.reloadModule(hudModule);
  await normal.page.waitForFunction(async (tick: number) => (await (window as any).__empiresDebug({ type: 'sim' })).tick > tick,
    { timeout: 30_000 }, tickBeforeHmr);
  // Page-side HMR handlers run asynchronously after reloadModule sends updates.
  await normal.page.waitForFunction(() => document.querySelector('canvas.battlefield') !== null);
  const hmrDeadline = Date.now() + 10_000;
  while (!normalLogs.some(line => line.includes('[hmr] rebuilt presentation (hud)'))) {
    assert.ok(Date.now() < hmrDeadline, 'normal HUD HMR acceptance logged');
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.equal(generations, 0, 'normal startup/HMR never generates');
  await normal.page.reload({ waitUntil: 'domcontentloaded' });
  await normal.page.waitForFunction(async () => typeof (window as any).__empiresDebug === 'function'
    && (await (window as any).__empiresDebug({ type: 'sim' })).tick > 0, { timeout: 60_000 });
  assert.deepEqual(normal.errors, []);
  await normal.page.close();
  console.log('NORMAL GAME GREEN: real canvas pixels, live ticks, click/select/train, accepted HUD HMR, reload on the same private server');
  // 1. Catalogue-unavailable UX: typed failure, no models, Start disabled.
  const first = await open();
  await first.page.waitForFunction(() => document.querySelector('#agents-catalogue')?.textContent?.includes('unavailable'), { timeout: 60_000 });
  let state = await pageState(first.page);
  assert(state.models === 0, `expected no models while unavailable, got ${state.models}`);
  assert(state.catalogueText.includes('unavailable'), `catalogue text: ${state.catalogueText}`);
  assert(state.startDisabled, 'Start must be disabled without a catalogue');
  assert.deepEqual(state.errors, []);
  console.log('STAGE unavailable UI passed');

  // 2. Catalogue returns; selectors populate; explicit Start begins a live match.
  mode = 'happy';
  await first.page.click('#agents-retry');
  await first.page.waitForFunction(() => typeof (window as any).__agentsDebug === 'function', { timeout: 60_000, polling: 100 });
  await first.page.waitForFunction(async () => (await (window as any).__agentsDebug({ type: 'page' })).models === 2, { timeout: 60_000 });
  state = await pageState(first.page);
  assert.equal(state.models, 2, 'two selectable models');
  assert.deepEqual(state.selected, ['provider-a/vendor/model-a', 'provider-b/model-b']);
  assert(state.rulesText.includes('fallback'), `rules badge: ${state.rulesText}`);
  await first.page.evaluate(() => { (document.getElementById('agents-seed') as HTMLInputElement).value = '352'; });
  await first.page.waitForFunction(async () => !(await (window as any).__agentsDebug({ type: 'page' })).startDisabled, { timeout: 30_000, polling: 100 });
  mode = 'unavailable';
  await first.page.click('#agents-start');
  await first.page.waitForFunction(async () => (await (window as any).__agentsDebug({ type: 'page' })).failureText.includes('start failed (unavailable)'), { timeout: 30_000 });
  assert.equal(generations, 0, 'failed startup never generates');
  console.log('STAGE startup failure surfaced; retrying');
  mode = 'happy';
  await first.page.click('#agents-start');
  await first.page.waitForFunction(async () => {
    const v = await (window as any).__agentsDebug({ type: 'view' });
    return v?.status === 'running' && v?.tick >= 40 && v?.painted > 0 && v?.entities > 0 && v?.commands > 0;
  }, { timeout: 60_000, polling: 200 });
  const live = await view(first.page);
  assert.equal(live.matchId, 'match-1');
  assert.equal(live.rulesOrigin, 'fallback');
  assert.ok(live.verified, 'initial checksum verified in the browser');
  assert.ok(live.tick >= 40 && live.entities > 0 && live.commands > 0, 'live ticks, entities and accepted commands');
  const pixels = await first.page.evaluate(() => {
    const canvas = document.querySelector('#agents-board') as HTMLCanvasElement;
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let red = 0, blue = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] === 226 && data[i + 1] === 83 && data[i + 2] === 75) red++;
      if (data[i] === 75 && data[i + 1] === 127 && data[i + 2] === 226) blue++;
    }
    return { red, blue };
  });
  assert.ok(pixels.red > 0 && pixels.blue > 0, 'canvas actually paints both players (sRGB pixels)');
  await first.page.screenshot({ path: `${root}.local/astra-agents-live.png` });
  console.log('STAGE live board passed');

  // 3. Second tab late-joins mid-match from a snapshot and keeps up.
  const second = await open();
  await second.page.waitForFunction(async () => {
    const v = await (window as any).__agentsDebug({ type: 'view' });
    return v?.status === 'running' && v?.tick >= 60 && v?.entities > 0;
  }, { timeout: 60_000, polling: 200 });
  const lateView = await view(second.page);
  assert.equal(lateView.matchId, 'match-1');
  assert.ok(lateView.verified, 'late joiner verified the initial checksum');
  console.log('STAGE late join passed');

  // 4. Cross-origin requests and websockets are refused; no command route exists.
  const crossOrigin = await second.page.evaluate(async (otherOrigin: string) => {
    const results: Record<string, unknown> = {};
    // Vite allows localhost CORS, but our backend must still refuse Origin.
    results.status = await fetch(`${otherOrigin}/agents/api/status`).then(r => r.status, () => 'blocked');
    results.command = (await fetch('/agents/api/command', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"kind":"order"}' })).status;
    results.order = (await fetch('/agents/api/order', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"kind":"order"}' })).status;
    results.websocket = await new Promise(resolve => {
      const socket = new WebSocket(`${otherOrigin.replace(/^http/, 'ws')}/agents/ws`);
      socket.onopen = () => { socket.close(); resolve('open'); };
      socket.onerror = () => resolve('error');
      socket.onclose = event => resolve(event.code === 1006 ? 'refused' : `closed-${event.code}`);
    });
    return results;
  }, `http://localhost:${port}`);
  assert.equal(crossOrigin.status, 403, 'cross-origin status fetch refused by backend');
  assert.equal((await fetch(`${base}/agents/api/status`, { headers: { Origin: `http://localhost:${port}` } })).status, 403, 'server refuses the foreign Origin, not merely CORS');
  assert.equal(crossOrigin.command, 404, 'no spectator command route');
  assert.equal(crossOrigin.order, 404, 'no gameplay order route');
  assert.notEqual(crossOrigin.websocket, 'open', 'cross-origin websocket refused');
  console.log('STAGE cross origin passed');
  await second.page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('readonly socket did not close')), 5000);
      const socket = new WebSocket(`${location.origin.replace(/^http/, 'ws')}/agents/ws`);
      socket.onopen = () => { socket.send(JSON.stringify({ type: 'command', command: { kind: 'delete', player: 1, entityIds: [1] } })); socket.close(); };
      socket.onclose = () => { clearTimeout(timer); resolve(); };
      socket.onerror = () => reject(new Error('same-origin readonly socket failed'));
    });
  });
  console.log('STAGE readonly injection sent');

  // Forged Host and missing/wrong capability, from a raw loopback client.
  const forged = await new Promise<number>(resolve => {
    const req = httpRequest({ host: '127.0.0.1', port, path: '/agents/api/status' });
    req.setHeader('Host', 'evil.example');
    req.on('response', res => { resolve(res.statusCode ?? 0); res.resume(); });
    req.on('error', () => resolve(-1));
    req.end();
  });
  assert.equal(forged, 403, 'forged Host refused');
  assert.equal((await fetch(`${base}/agents/api/start`, { method: 'POST', body: '{}' })).status, 403, 'start without capability refused');
  assert.equal((await fetch(`${base}/agents/api/start`, { method: 'POST', headers: { 'x-agents-capability': '0'.repeat(64) }, body: '{}' })).status, 403, 'start with wrong capability refused');
  console.log('STAGE HTTP security passed');

  // 5. Stop settles both tabs; the browser rebuild verifies the record checksums.
  await second.page.waitForFunction(async () => (await (window as any).__agentsDebug({ type: 'view' })).tick >= 120, { timeout: 60_000, polling: 200 });
  console.log('STAGE stopping at tick', (await view(second.page)).tick);
  await first.page.bringToFront();
  await first.page.click('#agents-stop');
  console.log('STAGE Stop clicked');
  await first.page.waitForFunction(async () => (await (window as any).__agentsDebug({ type: 'view' })).status === 'aborted', { timeout: 30_000, polling: 100 });
  await second.page.waitForFunction(async () => (await (window as any).__agentsDebug({ type: 'view' })).status === 'aborted', { timeout: 30_000, polling: 100 });
  const stopped = [await view(first.page), await view(second.page)];
  for (const summary of stopped) {
    assert.equal(summary.status, 'aborted');
    assert.ok(summary.reconstructionOk, 'serialized record checksums equal the browser rebuild');
    assert.equal(summary.reconstructionFailures, 0);
    assert.equal(summary.reconstructionChecked, summary.record.checksums.length);
    assert.ok(summary.record.checksums.length >= 1, 'at least one periodic checksum was verified');
    assert.ok(summary.record.commands.length > 0, 'commands retained');
    assert.ok(summary.record.commands.some((entry: any) => entry.command.player === 1));
    assert.ok(summary.record.commands.some((entry: any) => entry.command.player === 2));
    assert.ok(summary.record.commands.every((entry: any) => ['train', 'stop'].includes(entry.command.kind)), 'browser command injection never reaches the record');
    assert.ok(summary.record.result.rejectedCommands.length < summary.record.commands.length, 'some commands were accepted by the simulation');
  }
  assert.equal(stopped[0].tick, stopped[1].tick, 'both tabs settled at the same tick');
  assert.deepEqual(stopped[0].record, stopped[1].record, 'both tabs retained the same record');
  state = await pageState(first.page);
  assert.deepEqual(state.retained.map((entry: any) => entry.matchId), ['match-1'], 'replay retained in-page');
  assert.ok(state.retained[0].commands > 0);
  assert.ok((await first.page.evaluate(() => document.querySelectorAll('.agents-replay-row').length)) >= 1, 'replay download offered');
  const downloadPath = `${root}.local/review352-downloads`;
  await mkdir(downloadPath, { recursive: true });
  const downloads = await browser.target().createCDPSession();
  await downloads.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath, eventsEnabled: true });
  let downloadTimer: ReturnType<typeof setTimeout> | undefined;
  let suggestedFilename = '';
  downloads.on('Browser.downloadWillBegin', event => { suggestedFilename = event.suggestedFilename; });
  try {
    const completed = new Promise<string>((resolve, reject) => {
      downloadTimer = setTimeout(() => reject(new Error('replay download did not complete')), 10_000);
      downloads.on('Browser.downloadProgress', event => {
        if (event.state === 'completed') resolve(event.guid);
        if (event.state === 'canceled') reject(new Error('replay download canceled'));
      });
    });
    const [guid] = await Promise.all([completed, first.page.click('.agents-replay-row button')]);
    const downloaded = JSON.parse(await readFile(`${downloadPath}/${guid}`, 'utf8'));
    assert.equal(suggestedFilename, 'agents-replay-match-1.json');
    assert.deepEqual(downloaded, stopped[0].record, 'actual browser-downloaded JSON equals the canonical record');
    console.log('DOWNLOAD GREEN:', suggestedFilename, 'saved as', guid);
  } finally { clearTimeout(downloadTimer); await downloads.detach(); }

  // A real full-reload message over Vite's HMR websocket must rebuild the
  // spectator from the retained ended snapshot, without generating a match.
  const callsBeforeReload = generations;
  const reloaded = first.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30_000 });
  server.ws.send({ type: 'full-reload', path: '*' });
  await reloaded;
  await first.page.waitForFunction(async () => typeof (window as any).__agentsDebug === 'function'
    && (await (window as any).__agentsDebug({ type: 'view' })).reconstructionOk === true, { timeout: 60_000 });
  assert.deepEqual((await view(first.page)).record, stopped[0].record);
  assert.equal(generations, callsBeforeReload, 'HMR reload does not launch another match');
  console.log('AGENTS RELOAD GREEN: ended snapshot and exact record recovered without generation');

  // 6. A late snapshot of the *ended* state rebuilds and verifies too.
  const third = await open();
  await third.page.waitForFunction(async () => (await (window as any).__agentsDebug({ type: 'view' })).status === 'aborted', { timeout: 60_000 });
  const ended = await view(third.page);
  assert.equal(ended.status, 'aborted', 'ended-state snapshot carries the terminal status');
  assert.ok(ended.record?.commands.length > 0, 'ended-state snapshot carries the record');
  assert.ok(ended.reconstructionOk, 'ended-state rebuild verified the record checksums');
  assert.equal(ended.reconstructionChecked, ended.record.checksums.length);
  console.log('MATCH GREEN:', JSON.stringify({ seed: 352, tick: ended.tick, commands: ended.commands, checked: ended.reconstructionChecked, pixels }));

  // 7. An auth failure surfaces typed and sanitized, with no fabricated record.
  mode = 'authfail';
  await first.page.bringToFront();
  await first.page.waitForFunction(async () => !(await (window as any).__agentsDebug({ type: 'page' })).startDisabled, { timeout: 30_000, polling: 100 });
  await first.page.click('#agents-start');
  await first.page.waitForFunction(async () => {
    const v = await (window as any).__agentsDebug({ type: 'view' });
    return v?.status === 'failed' && v?.failure?.code === 'unauthorized';
  }, { timeout: 60_000, polling: 200 });
  state = await pageState(first.page);
  assert.ok(state.failureText.includes('unauthorized'), `failure surfaced: ${state.failureText}`);
  assert.ok(!state.failureText.includes('PRIVATE_SECRET'), 'no raw provider detail leaks');
  assert.equal((await view(first.page)).record, undefined, 'failed match has no fabricated replay');
  assert.deepEqual(state.errors, []);

  // 8. Small viewport: controls stay visible with no horizontal overflow.
  const small = await open({ width: 420, height: 640 });
  const fits = await small.page.evaluate(() => ({
    overflow: (document.scrollingElement as HTMLElement).scrollWidth <= window.innerWidth + 1,
    startVisible: (document.getElementById('agents-start') as HTMLElement).getBoundingClientRect().width > 0,
    stopVisible: (document.getElementById('agents-stop') as HTMLElement).getBoundingClientRect().width > 0,
    boardNote: !!document.querySelector('.agents-board-note'),
  }));
  assert.ok(fits.overflow, 'no horizontal overflow at 420x640');
  assert.ok(fits.startVisible && fits.stopVisible, 'Start and Stop remain visible');
  assert.ok(fits.boardNote, 'the limited-testing-view note is present');
  assert.deepEqual((await pageState(small.page)).errors, []);

  // 9. Cleanup/error path: a match in flight, browser gone, server closes finitely.
  mode = 'happy';
  await first.page.bringToFront();
  await first.page.waitForFunction(async () => !(await (window as any).__agentsDebug({ type: 'page' })).startDisabled, { timeout: 30_000, polling: 100 });
  await first.page.click('#agents-start');
  await first.page.waitForFunction(async () => (await (window as any).__agentsDebug({ type: 'view' })).status === 'running', { timeout: 60_000, polling: 200 });
  for (const tab of tabs) assert.deepEqual(tab.errors, [], 'no browser exceptions');
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Leave browser sockets open: shutdown must not depend on clients exiting.
    await Promise.race([
      server.close(),
      new Promise((_, reject) => { closeTimer = setTimeout(() => reject(new Error('server.close() hung with a match in flight')), 20_000); }),
    ]);
  } finally { clearTimeout(closeTimer); }
  await browser.close();
  const afterClose = generations;
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(generations, afterClose, 'no generations continue after server.close settles');
  let refused = false;
  try { await fetch(`${base}/agents/api/status`); } catch { refused = true; }
  assert.ok(refused, 'listener is gone after close');

  console.log('AGENTS BROWSER SMOKE GREEN: unavailable UX, selection, live accepted commands and ticks, rendered board,'
    + ' late join, ended-state snapshot, verified record checksums in every tab, typed auth failure, security denials,'
    + ' small viewport and finite cleanup all passed on a fake transport');
} catch (error) {
  console.error('PRIMARY SMOKE FAILURE (before teardown):', error);
  throw error;
} finally {
  try { await browser?.close(); } catch { /* already closed */ }
  try { await server.close(); } catch { /* already closed */ }
}
