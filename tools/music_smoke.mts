/** Exercise actual owned soundtrack playback and native end/pause events. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(readFileSync(`${root}public/imported/aoe2/audio/manifest.json`, 'utf8'));
const playlist: string[] = manifest.music.playlist;
assert(playlist.length > 1);
let ownedAudio = true;
const server = await createServer({ root, configFile: `${root}vite.config.ts`, logLevel: 'error',
  server: { host: '127.0.0.1', port: 5296, strictPort: true }, plugins: [{
    name: 'private-music-probe', enforce: 'pre',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (!ownedAudio && request.url?.startsWith('/imported/aoe2/audio/')) {
          response.statusCode = 404; response.end(); return;
        }
        next();
      });
    },
    transform(code, id) {
      if (!id.endsWith('/src/main.ts')) return;
      const anchor = 'renderer.setAnimationLoop(now => {';
      assert(code.includes(anchor));
      return code.replace('if (!shared && !paused && !matchOver(game))', 'if (false && !shared && !paused && !matchOver(game))')
        .replace(anchor, `Object.assign(globalThis, {
          __musicState: () => { const element=(musicPlayer as any).element as HTMLAudioElement | undefined;
            return { index:(musicPlayer as any).index, element: element ? {
              src:element.src, paused:element.paused, time:element.currentTime,
              duration:element.duration, ready:element.readyState } : null }; },
          __musicEnd: () => { const element=(musicPlayer as any).element as HTMLAudioElement;
            element.currentTime=element.duration-0.1; },
          __musicQuiet: () => { renderer.setAnimationLoop(null); audioPlayer.stop(); }
        });\n${anchor}`);
    },
  }] });
await server.listen();
const libs = `${homedir()}/.cache/puppeteer/extra-libs/usr/lib/x86_64-linux-gnu`;
const browser = await puppeteer.launch({ headless: true,
  env: existsSync(libs) ? { ...process.env, LD_LIBRARY_PATH: libs } : process.env,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebGPU'] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 800 });
  const errors: string[] = []; page.on('pageerror', e => errors.push(String(e)));
  let progress: ((url: string) => void) | undefined;
  await page.exposeFunction('__musicProgress', (url: string) => progress?.(url));
  await page.evaluateOnNewDocument(() => {
    const active = new Set<HTMLMediaElement>();
    const played: string[] = [];
    Object.assign(window, { __musicProbe: { played, active } });
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (this.src.includes('/music/')) {
        active.add(this);
        this.addEventListener('emptied', () => active.delete(this), { once: true });
        this.addEventListener('playing', () => {
          played.push(this.src);
          void (window as any).__musicProgress(this.src);
        }, { once: true });
      }
      return play.call(this);
    };
  });
  const ready = () => page.waitForFunction(() => typeof (window as any).__musicState === 'function', { timeout: 120000 });
  const music = (): Promise<any> => page.evaluate(() => (window as any).__musicState());
  const playing = (alias: string) => page.waitForFunction(file => {
    const m = (window as any).__musicState().element;
    return m?.src.endsWith(file) && !m.paused && m.ready >= 2 && m.time > 0.02;
  }, { timeout: 60000, polling: 100 }, manifest.audio[alias].files[0].file);
  await page.goto('http://127.0.0.1:5296/?solo=1&seed=115&map=arabia', { waitUntil: 'networkidle0', timeout: 120000 });
  await ready(); assert.equal((await music()).element, null, 'no music before real gesture');
  await page.mouse.click(640, 300); await playing(playlist[0]);
  const first = await music();
  assert(Math.abs(first.element.duration - manifest.audio[playlist[0]].files[0].seconds) < 0.05);
  await page.keyboard.press('F3');
  await page.waitForFunction(() => (window as any).__musicState().element?.paused);
  const pausedAt = (await music()).element.time;
  await page.keyboard.press('F3'); await playing(playlist[0]);
  assert((await music()).element.time >= pausedAt, 'resume preserves playhead');

  const other = await browser.newPage(); await other.goto('about:blank'); await other.bringToFront();
  await page.waitForFunction(() => document.hidden && (window as any).__musicState().element?.paused);
  const hiddenAt = (await music()).element.time;
  await page.bringToFront(); await playing(playlist[0]);
  assert((await music()).element.time >= hiddenAt, 'foreground resumes the same track');
  await other.close();

  // Native seeking/end events, with every real owned track loading and playing.
  // A full natural-play duration soak can use MUSIC_SOAK=1 below.
  for (let i = 1; i <= playlist.length; i++) {
    await page.evaluate(() => (window as any).__musicEnd());
    await playing(playlist[i % playlist.length]);
    const m = await music();
    assert(m.element.duration > 60, 'never publishes millisecond-long prefetches');
    assert.equal(await page.evaluate(() => [...(window as any).__musicProbe.active]
      .filter((e: HTMLMediaElement) => !!e.getAttribute('src')).length), 1, 'only one live soundtrack source');
  }
  console.log(`MUSIC PLAYLIST GREEN: ${playlist.length} complete owned tracks play and wrap through native ended events`);
  await page.click('[data-menu="open"]'); await page.click('[data-menu="restart"]');
  await playing(playlist[0]);
  assert((await music()).element.time < 5, 'restart releases the old playhead');

  if (process.env.MUSIC_SOAK === '1') {
    const total = playlist.reduce((sum, alias) => sum + manifest.audio[alias].files[0].seconds, 0);
    console.log(`MUSIC SOAK START: natural playlist duration ${total.toFixed(3)} seconds`);
    // The long check is the audio lifecycle. Keep the real player and native
    // end callbacks running without spending two hours redrawing a frozen map.
    await page.evaluate(() => (window as any).__musicQuiet());
    // Do not leave a CDP Runtime.callFunctionOn pending for two hours: its RPC
    // lifetime is separate from waitForFunction's timeout. Each playing event
    // sends a short binding notification; the Node watchdog bounds the run.
    await new Promise<void>((resolve, reject) => {
      let count = 0;
      const watchdog = setTimeout(() => {
        progress = undefined;
        reject(new Error(`natural soundtrack stalled after ${count}/${playlist.length} tracks`));
      }, (total + 300) * 1000);
      progress = url => {
        if (count === 0 && url.endsWith(manifest.audio[playlist[0]].files[0].file)) return;
        count++;
        const expected = manifest.audio[playlist[count % playlist.length]].files[0].file;
        console.log(`MUSIC SOAK TRACK ${count}/${playlist.length} ${new Date().toISOString()} ${url}`);
        if (!url.endsWith(expected)) {
          clearTimeout(watchdog); progress = undefined;
          reject(new Error(`expected ${expected}, got ${url}`));
        } else if (count === playlist.length) {
          clearTimeout(watchdog); progress = undefined; resolve();
        }
      };
    });
    assert.equal(await page.evaluate(() => [...(window as any).__musicProbe.active]
      .filter((e: HTMLMediaElement) => !!e.getAttribute('src')).length), 1);
    console.log(`MUSIC SOAK GREEN: ${playlist.length} natural track endings, bounded live source count`);
  }
  ownedAudio = false;
  await page.reload({ waitUntil: 'networkidle0', timeout: 120000 }); await ready();
  await page.mouse.click(640, 300);
  assert.equal((await music()).element, null, 'optional absent audio remains a silent playable fallback');
  assert.deepEqual(errors, []);
  console.log('MUSIC SMOKE GREEN: gesture unlock, pause/resume, hidden/foreground, restart and absent-audio fallback');
} finally {
  await browser.close(); await server.close();
}
