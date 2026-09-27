/** Real gestures, owned media playback, frame cues and public construction. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { createServer } from 'vite';
import { createGame, stepGame } from '../src/sim/game.ts';
import { rulesFromManifest } from '../src/sim/data.ts';
import { SNAPSHOT_VERSION } from '../src/dev-session.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(readFileSync(`${root}public/imported/aoe2/manifest.json`, 'utf8'));
const rules = rulesFromManifest(manifest);
const audio = JSON.parse(readFileSync(`${root}public/imported/aoe2/audio/manifest.json`, 'utf8'));
const state = createGame(114, rules);
state.terrain.fill(0);
state.entities = state.entities.filter(e => e.owner !== 0);
state.players[1].wood = 1000;
const home = state.entities.find(e => e.kind === 'town-center' && e.owner === 1)!;
const worker = state.entities.find(e => e.kind === 'villager' && e.owner === 1)!;
worker.position = { x: home.position.x + 6, y: home.position.y };
const soldier = { ...worker, id: state.nextId++, kind: 'militia' as const,
  hp: 1000, maxHp: 1000, position: { x: home.position.x + 7, y: home.position.y + 3 } };
const target = { ...home, id: state.nextId++, kind: 'house' as const, owner: 2 as const,
  radius: 1, footprint: { x: 1, y: 1 }, hp: 1000, maxHp: 1000,
  position: { x: home.position.x + 9, y: home.position.y + 3 } };
state.entities.push(soldier, target);
stepGame(state);
const { rules: omitted, ...saved } = state;
const server = await createServer({ root, configFile: `${root}vite.config.ts`, logLevel: 'error',
  server: { host: '127.0.0.1', port: 5295, strictPort: true }, plugins: [{
    name: 'private-audio-clock', enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('/src/main.ts')) return;
      const anchor = 'renderer.setAnimationLoop(now => {';
      assert(code.includes(anchor));
      assert(code.includes('if (!shared && !paused && !matchOver(game))'));
      return code.replace('if (!shared && !paused && !matchOver(game))', 'if (false && !shared && !paused && !matchOver(game))')
        .replace(anchor, `Object.assign(globalThis, {
          __audioStep: (n: number) => { for (let i=0;i<n;i++) { stepGame(game); syncScene(gameTimeSeconds(game)); } },
          __audioPoint: (p: Point) => { const q=elevatedWorldToIso(game,p.x,p.y); return {
            x:(q.x-cameraCenter.x)*zoom+innerWidth/2, y:-(q.y-cameraCenter.y)*zoom+innerHeight/2 }; }
        });\n${anchor}`);
    },
  }] });
await server.listen();
const libs = `${homedir()}/.cache/puppeteer/extra-libs/usr/lib/x86_64-linux-gnu`;
const browser = await puppeteer.launch({ headless: true,
  env: existsSync(libs) ? { ...process.env, LD_LIBRARY_PATH: libs } : process.env,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebGPU'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const errors: string[] = []; page.on('pageerror', e => errors.push(String(e)));
  await page.evaluateOnNewDocument(snapshot => {
    sessionStorage.setItem('open-empires-lab:dev-session', JSON.stringify(snapshot));
    const plays: { url: string; playing: boolean; error?: string }[] = [];
    Object.assign(window, { __audioPlays: plays });
    const original = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      const record = { url: this.src, playing: false, error: undefined as string | undefined };
      plays.push(record);
      this.addEventListener('playing', () => { record.playing = true; }, { once: true });
      return original.call(this).catch(error => { record.error = String(error); throw error; });
    };
  }, { version: SNAPSHOT_VERSION, rulesOrigin: rules.origin, state: saved, setup: { map: 'arabia', seed: 114 } });
  await page.goto('http://127.0.0.1:5295/?solo=1', { waitUntil: 'networkidle0', timeout: 120000 });
  await page.waitForFunction(() => typeof (window as any).__empiresDebug === 'function', { timeout: 120000 });
  const query = (q: object): Promise<any> => page.evaluate(q => (window as any).__empiresDebug(q), q);
  const step = (n: number) => page.evaluate(n => (window as any).__audioStep(n), n);
  const point = (p: { x: number; y: number }): Promise<{ x: number; y: number }> =>
    page.evaluate(p => (window as any).__audioPoint(p), p);
  const sounds = () => page.evaluate(() => (window as any).__audioPlays as { url: string; playing: boolean; error?: string }[]);
  const clickButton = async (selector: string) => {
    await page.waitForFunction(selector => {
      const button = document.querySelector<HTMLButtonElement>(selector);
      return button && !button.disabled && button.getBoundingClientRect().width > 0;
    }, {}, selector);
    const p = await page.evaluate(selector => {
      const r = document.querySelector(selector)!.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, selector);
    await page.mouse.click(p.x, p.y);
  };
  const heard = async (alias: string, since = 0) => {
    const files = Object.entries(audio.audio).filter(([key]) => key === alias || key.endsWith(`/${alias}`))
      .flatMap(([, value]: [string, any]) => value.files.map((file: any) => file.file));
    assert(files.length, `published ${alias}`);
    await page.waitForFunction(({ files, since }) => (window as any).__audioPlays.slice(since)
      .some((p: any) => p.playing && files.some(file => p.url.endsWith(`/${file}`))), { timeout: 30000 }, { files, since });
  };
  assert.equal((await query({ type: 'snapshot' })).tick, state.tick, 'fixture resumed');
  assert.equal((await sounds()).length, 0, 'no autoplay before gesture');
  await query({ type: 'look', entity: soldier.id });
  await page.waitForFunction(async id => (await (window as any).__empiresDebug({ type: 'entities', id })).entities[0]?.bodyVisible,
    { timeout: 60000 }, soldier.id);
  let drawn = (await query({ type: 'entities', id: soldier.id })).entities[0];
  await page.mouse.click(drawn.screen.x, drawn.screen.y);
  assert.deepEqual((await query({ type: 'sim' })).selected, [soldier.id]);
  await heard('militia-select');
  await heard('terrain/3923190460');
  let since = (await sounds()).length;
  let p = await point({ x: soldier.position.x - 1, y: soldier.position.y });
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await heard('militia-move', since);
  since = (await sounds()).length;
  p = await point(target.position); await page.mouse.click(p.x, p.y, { button: 'right' });
  await heard('militia-attack', since);
  await step(60);
  assert((await query({ type: 'snapshot' })).entities.find((e: any) => e.id === target.id).hp < target.hp);
  await heard('events/542552093', since);
  console.log('AUDIO COMBAT GREEN: actual select/move/attack gestures, owned frame cue and terrain media playing');

  // A real house button and placement, not a fabricated completion signal.
  await query({ type: 'look', entity: worker.id });
  drawn = (await query({ type: 'entities', id: worker.id })).entities[0];
  await page.mouse.click(drawn.screen.x, drawn.screen.y);
  assert.deepEqual((await query({ type: 'sim' })).selected, [worker.id]);
  await clickButton('[data-command="page-economic"]');
  await clickButton('[data-command="build-house"]');
  p = await point({ x: worker.position.x + 1, y: worker.position.y - 3 });
  await page.mouse.click(p.x, p.y);
  let snapshot = await query({ type: 'snapshot' });
  const foundation = snapshot.entities.find((e: any) => e.owner === 1 && e.kind === 'house' && e.buildProgress !== undefined);
  assert(foundation, 'public placement created foundation');
  since = (await sounds()).length;
  for (let i = 0; i < 12; i++) {
    await step(60);
    snapshot = await query({ type: 'snapshot' });
    if (snapshot.entities.find((e: any) => e.id === foundation.id)?.buildProgress === undefined) break;
  }
  assert.equal(snapshot.entities.find((e: any) => e.id === foundation.id).buildProgress, undefined);
  await heard('house-construction', since);
  await heard('events/1893274449', since);
  console.log('AUDIO BUILD GREEN: real house placement, hammer frame sound and one completion sound');

  // Decode played files in Chrome and measure actual non-silent PCM, alongside
  // the real HTMLMediaElement playing events above.
  const urls = [...new Set((await sounds()).filter(p => p.playing).map(p => p.url))];
  assert(urls.length >= 6);
  const measured = await page.evaluate(async urls => {
    const context = new OfflineAudioContext(1, 1, 44100);
    const result = [];
    for (const url of urls.slice(0, 12)) {
      const data = await (await fetch(url)).arrayBuffer();
      const decoded = await context.decodeAudioData(data);
      let peak = 0;
      for (const sample of decoded.getChannelData(0)) peak = Math.max(peak, Math.abs(sample));
      result.push({ url, seconds: decoded.duration, peak });
    }
    return result;
  }, urls);
  assert(measured.every(m => m.seconds > 0 && m.peak > 0.0001), JSON.stringify(measured));
  const oldCount = (await sounds()).length;
  const away = state.entities.find(e => e.owner === 2 && e.kind === 'town-center')!;
  await query({ type: 'look', entity: away.id }); await query({ type: 'resync' });
  await step(120);
  assert.equal((await sounds()).length, oldCount, 'offscreen combat and unseen terrain stay silent');
  assert.deepEqual(errors, []);
  console.log(`AUDIO SMOKE GREEN: ${measured.length} browser-decoded non-silent sounds; no hidden/offscreen leakage`);
} finally {
  await browser.close();
  await server.close();
}
