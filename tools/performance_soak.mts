/** Sustained real-browser performance/memory workload. Private transforms only
 * add metrics and have the existing AI issue public commands for both seats.
 * No simulation shortcuts, skipped rendering, artificial cache clock or GC. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { setTimeout as sampleDelay } from 'node:timers/promises';
import { createServer } from 'vite';
import puppeteer from 'puppeteer';

const root = fileURLToPath(new URL('../', import.meta.url));
const sampleMs = Number(process.env.SAMPLE_MS ?? 60_000);
const tickLimit = Number(process.env.MATCH_TICKS ?? 36_000);
const until = process.env.SOAK_UNTIL ? Date.parse(process.env.SOAK_UNTIL) : Date.now() + Number(process.env.SOAK_MINUTES ?? 30) * 60_000;
const maps = (process.env.SOAK_MAPS ?? 'arabia,windsor,black-forest,senlac').split(',');
const speeds = (process.env.SOAK_SPEEDS ?? '1,3,5').split(',').map(Number); // Normal, Extra Fast, 10x fast-forward
assert(Number.isFinite(until) && until > Date.now() && sampleMs >= 1000 && tickLimit > 0);
assert(speeds.length && speeds.every(index => Number.isInteger(index) && index >= 0 && index <= 5));
const port = Number(process.env.PROBE_PORT ?? 5238);
const instrumentation = `
const soakSamples = { frame: [], interval: [], step: [], ai: [], sync: [], render: [] };
const soakDistribution = values => {
  const sorted = values.splice(0).sort((a,b) => a-b);
  const pick = q => Math.round((sorted[Math.min(sorted.length-1, Math.floor(sorted.length*q))] ?? 0)*100)/100;
  return { count: sorted.length, totalMs: Math.round(sorted.reduce((sum, value) => sum + value, 0)*100)/100,
    p50: pick(0.5), p95: pick(0.95), max: pick(1) };
};
Object.assign(globalThis, { __performanceSoak: () => ({
  timings: Object.fromEntries(Object.entries(soakSamples).map(([key, values]) => [key, soakDistribution(values)])),
  gpu: { ...renderer.info.memory }, sprites: assets?.spriteResidency?.stats,
  heap: performance.memory?.usedJSHeapSize, views: views.size, tick: game.tick,
  missingBodies: [...views.values()].filter(view => view.body.pendingTexture).length, speed: gameSpeed(),
  entities: game.entities.length, winner: game.winner, setup: activeSetup,
  ages: [game.players[1].age, game.players[2].age],
  look: game.entities.find(e => e.owner === 1 && !e.dead && e.activity === 'attacking')?.id
    ?? game.entities.find(e => e.owner === 1 && !e.dead && e.activity === 'moving')?.id
    ?? game.entities.find(e => e.owner === 1 && e.kind === 'town-center' && !e.dead)?.id,
}) });
`;
const server = await createServer({ root, configFile: `${root}vite.config.ts`, plugins: [{
  name: 'performance-soak', enforce: 'pre', transform(code, id) {
    if (!id.endsWith('/src/main.ts')) return;
    const ai = 'for (const command of exampleAiCommands(observe(game, 2))) applyCommand(game, command);';
    const loop = 'renderer.setAnimationLoop(now => {';
    const sync = '  syncScene(gameTimeSeconds(game));\n  fog.mesh.visible';
    const render = '  renderer.render(scene, camera);';
    for (const anchor of [ai, loop, sync, render]) assert(code.includes(anchor), `probe anchor: ${anchor}`);
    assert.equal(code.split('stepGame(game);').length - 1, 2);
    return code.replace(ai, '{ const at = performance.now(); for (const player of [1, 2]) for (const command of exampleAiCommands(observe(game, player))) applyCommand(game, command); soakSamples.ai.push(performance.now() - at); }')
      .replaceAll('stepGame(game);', '{ const at = performance.now(); stepGame(game); soakSamples.step.push(performance.now() - at); }')
      .replace(loop, instrumentation + loop + '\nconst soakStart = performance.now(); soakSamples.interval.push(now - previous);')
      .replace(sync, '  const soakSync = performance.now();\n  syncScene(gameTimeSeconds(game));\n  soakSamples.sync.push(performance.now() - soakSync);\n  fog.mesh.visible')
      .replace(render, '  const soakRender = performance.now();\n' + render + '\n  soakSamples.render.push(performance.now()-soakRender); soakSamples.frame.push(performance.now()-soakStart);');
  },
}], server: { host: '127.0.0.1', port, strictPort: true }, logLevel: 'error' });
await server.listen();
const libs = `${homedir()}/.cache/puppeteer/extra-libs/usr/lib/x86_64-linux-gnu`;
const browser = await puppeteer.launch({ headless: true, protocolTimeout: 120_000,
  env: existsSync(libs) ? { ...process.env, LD_LIBRARY_PATH: libs } : process.env,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebGPU'] });
const errors: string[] = [];
const interruption = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => {
  process.exitCode = signal === 'SIGINT' ? 130 : 143;
  interruption.abort();
});
let rounds = 0, samples = 0;
const started = new Date().toISOString();
console.log(JSON.stringify({ event: 'start', pid: process.pid, started, until: new Date(until).toISOString(), maps, speeds, tickLimit, sampleMs,
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), backend: 'WebGL2/SwiftShader' }));
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  page.on('pageerror', error => errors.push(String(error)));
  page.on('error', error => errors.push(`page crash: ${error}`));
  page.on('response', response => {
    if (response.url().includes('/imported/') && response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  await page.goto(`http://127.0.0.1:${port}/?solo=1&map=${maps[0]}&seed=3`, { waitUntil: 'networkidle0', timeout: 120_000 });
  await page.waitForFunction(() => typeof (window as any).__performanceSoak === 'function' && typeof (window as any).__empiresDebug === 'function', { timeout: 120_000 });
  const setSpeed = async () => {
    for (let i = 0; i < 6; i++) await page.keyboard.press('-');
    for (let i = 0; i < speeds[rounds % speeds.length]; i++) await page.keyboard.press('+');
  };
  await setSpeed();
  const query = (q: object): Promise<any> => page.evaluate(q => (window as any).__empiresDebug(q), q);
  let lastTick = -1, stalled = 0, roundStarted = Date.now();
  const startRound = async () => {
    const transition = await page.evaluate(() => (window as any).__performanceSoak());
    console.log(JSON.stringify({ event: 'round-start', at: new Date().toISOString(), round: rounds, ...transition }));
    roundStarted = Date.now(); lastTick = -1; stalled = 0;
  };
  await startRound();
  while (Date.now() < until && !interruption.signal.aborted) {
    try { await sampleDelay(Math.min(sampleMs, Math.max(1, until - Date.now())), undefined, { signal: interruption.signal }); }
    catch (error) { if (interruption.signal.aborted) break; throw error; }
    const metrics = await page.evaluate(() => (window as any).__performanceSoak());
    assert(metrics.sprites, 'owned-content renderer is active');
    const free = execFileSync('free', ['-b'], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } });
    const available = Number(free.split('\n').find(line => line.startsWith('Mem:'))!.trim().split(/\s+/).at(-1));
    console.log(JSON.stringify({ event: 'sample', at: new Date().toISOString(), round: rounds, roundAgeMs: Date.now() - roundStarted, available, ...metrics }));
    samples++;
    assert.deepEqual(errors, [], 'no page crashes, script failures or missing owned assets');
    assert(available > 1.5 * 1024 ** 3, 'stop workload before exhausting the host memory envelope');
    stalled = metrics.tick === lastTick && !metrics.winner ? stalled + 1 : 0;
    assert(stalled < 3, 'simulation must continue advancing');
    lastTick = metrics.tick;
    if (metrics.winner || metrics.tick >= tickLimit || Date.now() - roundStarted > 30 * 60_000) {
      console.log(JSON.stringify({ event: 'round-end', at: new Date().toISOString(), round: rounds, tick: metrics.tick, winner: metrics.winner,
        reason: metrics.winner ? 'victory' : metrics.tick >= tickLimit ? 'tick-limit' : 'wall-limit',
        synchronizationHash: (await query({ type: 'sim' })).synchronizationHash }));
      rounds++;
      if (Date.now() >= until) break;
      if (metrics.winner) await page.locator('#end-dialog [data-menu="restart"]').click();
      await page.keyboard.press('F10');
      await page.select('#map-choice', maps[rounds % maps.length]);
      await page.locator('#map-seed').fill(String(3 + rounds));
      await page.locator('#map-setup button[type="submit"]').click();
      await page.waitForSelector('#menu-dialog.hidden');
      const setup = (await query({ type: 'sim' })).connection.setup;
      assert.equal(setup.map, maps[rounds % maps.length]);
      assert.equal(setup.seed, 3 + rounds);
      await setSpeed();
      await startRound();
    } else if (metrics.look !== undefined) await query({ type: 'look', entity: metrics.look });
  }
  if (!interruption.signal.aborted) assert(samples > 0);
  console.log(JSON.stringify({ event: interruption.signal.aborted ? 'interrupted' : 'complete', started, ended: new Date().toISOString(), samples, completedRounds: rounds, errors }));
} finally { await browser.close(); await server.close(); }
