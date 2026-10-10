/** #138: real menu entry, owned labels/geometry, Escape/focus, close, fallback.
 * Read-only source fixture, not a publication/import: no DAT or sprite generation.
 * Set OPEN_FALLBACK=1 for the explicitly disabled open-content entry, or
 * OWNED_PUBLIC=<public dir> to exercise a complete published import instead.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const fallback = process.env.OPEN_FALLBACK === '1';
const published = fallback ? undefined : process.env.OWNED_PUBLIC;
const fixture = fallback || published ? undefined : JSON.parse(execFileSync('uv', ['run', '--locked', 'python',
  'tools/test_objectives_extraction.py', '--fixture'], { cwd: root, encoding: 'utf8' }));
const port = 5233;
const out = `${root}.local/objectives-${fallback ? 'fallback' : published ? 'owned-published' : 'owned-source'}`;
mkdirSync(`${root}.local`, { recursive: true });
const server = await createServer({ root, configFile: `${root}vite.config.ts`, publicDir: published ?? false, logLevel: 'error',
  server: { host: '127.0.0.1', port, strictPort: true }, plugins: [{
    name: 'objectives-read-only-source-fixture', enforce: 'pre',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = decodeURIComponent((req.url ?? '').split('?')[0]);
        if (published || !url.startsWith('/imported/')) { next(); return; }
        const prefix = '/imported/aoe2/ui/';
        if (fixture && url === `${prefix}manifest.json`) {
          res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(fixture.manifest)); return;
        }
        const file = url.startsWith(prefix) ? fixture?.files[url.slice(prefix.length)] : undefined;
        if (file) { res.setHeader('Content-Type', 'image/png'); createReadStream(file).pipe(res); return; }
        res.statusCode = 404; res.end();
      });
    },
  }] });
let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
try {
  await server.listen();
  const libs = `${homedir()}/.cache/puppeteer/extra-libs/usr/lib/x86_64-linux-gnu`;
  browser = await puppeteer.launch({ headless: true,
    env: existsSync(libs) ? { ...process.env, LD_LIBRARY_PATH: libs } : process.env,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebGPU'] });
  console.log(JSON.stringify({ pid: process.pid, browserPid: browser.process()?.pid, port }));
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.evaluateOnNewDocument('globalThis.__name = f => f');
  const errors: string[] = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}/?solo=1&seed=138`, { waitUntil: 'networkidle0', timeout: 120000 });
  await page.waitForFunction(() => typeof (window as any).__empiresDebug === 'function');
  const button = '[data-command="objectives"]';
  if (fallback) {
    await page.waitForFunction(selector => document.querySelector(selector)?.getAttribute('title')?.includes('requires imported owned'), {}, button);
    assert(await page.$eval(button, e => (e as HTMLButtonElement).disabled));
    assert(await page.$eval(button, e => e.getBoundingClientRect().width > 0 && getComputedStyle(e).display !== 'none'));
    await page.screenshot({ path: `${out}.png` });
  } else {
    const text = published
      ? JSON.parse(readFileSync(`${published}/imported/aoe2/ui/manifest.json`, 'utf8')).objectivesStrings
      : fixture.manifest.objectivesStrings;
    assert(text?.['10910'], 'publication must carry objectives strings');
    await page.waitForFunction(selector => !(document.querySelector(selector) as HTMLButtonElement)?.disabled, {}, button);
    await page.keyboard.press('F3'); // Public pause action makes read-only verification exact.
    const query = (request: object): Promise<any> => page.evaluate(request => (window as any).__empiresDebug(request), request);
    const before = await query({ type: 'sim' });
    await page.click(button); await page.waitForSelector('#objectives-dialog[open]');
    assert.equal(await page.$eval('#objectives-title', e => e.textContent), text['10910']);
    assert.deepEqual(await page.$$eval('.objectives-lines p', rows => rows.map(e => e.textContent)), [text['9823']]);
    assert.equal(await page.$eval('[data-objectives-close]', e => e.textContent), text['9249']);
    assert(await page.$eval('#objectives-dialog', e => getComputedStyle(e).backgroundImage.includes('objectives-menu_objectives_hints_bg.png')));
    const geometry = await page.$eval('#objectives-dialog', e => {
      const r = e.getBoundingClientRect();
      return { width: r.width, height: r.height, inside: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight };
    });
    assert(geometry.inside); assert(Math.abs(geometry.width / geometry.height - 1358 / 1512) < .001);
    assert(await page.$eval('.objectives-lines', e => e.scrollWidth === e.clientWidth), 'text must wrap inside its owned box');
    await page.screenshot({ path: `${out}.png` });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !(document.querySelector('#objectives-dialog') as HTMLDialogElement).open);
    assert.equal(await page.evaluate(() => (document.activeElement as HTMLElement)?.dataset.command), 'objectives');
    await page.click(button); await page.click('[data-objectives-close]');
    assert.equal(await page.$eval('#objectives-dialog', e => (e as HTMLDialogElement).open), false);
    assert.equal(await page.evaluate(() => (document.activeElement as HTMLElement)?.dataset.command), 'objectives');
    assert.equal((await query({ type: 'sim' })).synchronizationHash, before.synchronizationHash, 'dialog actions cannot mutate simulation');
    // Enable Wonder victory through real Game Settings, not a state injection.
    await page.click('[data-menu="open"]');
    await page.click('#wonder-victory');
    await page.click('#map-setup [type="submit"]');
    await page.waitForFunction(() => document.querySelector('#menu-dialog')!.classList.contains('hidden'));
    assert.equal((await query({ type: 'snapshot' })).wonderVictory, true, 'new match must use the selected condition');
    await page.click(button); await page.waitForSelector('#objectives-dialog[open]');
    assert.deepEqual(await page.$$eval('.objectives-lines p', rows => rows.map(e => e.textContent)),
      [text['9823'], `${text['11436']} — ${text['11301'].replace('%d', '200')}`]);
    await page.screenshot({ path: `${out}-wonder.png` });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !(document.querySelector('#objectives-dialog') as HTMLDialogElement).open);
    console.log(JSON.stringify({ conquest: true, wonderSetting: true, readOnly: true, escape: true, close: true, focusRestored: true, geometry }));
  }
  assert.deepEqual(errors, []);
  writeFileSync(`${out}.json`, JSON.stringify({ mode: fallback ? 'fallback' : published ? 'owned-published' : 'owned-source-ui/open-simulation',
    errors, source: fixture?.manifest.source, screenshot: `${out}.png` }, null, 2));
  console.log('PASS');
} finally {
  await browser?.close(); await server.close();
}
