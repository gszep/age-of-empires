/**
 * Read the HUD out of the DOM and the minimap out of its canvas.
 *
 * HUD questions are DOM questions: a button's title says what it offers and
 * its background image says whether it has art, which is faster and more
 * certain than looking. The minimap is a plain 2D canvas, so its pixels come
 * back directly -- unlike the world view, which needs the debug protocol's
 * `pixels` query because a WebGPU canvas cannot be read back.
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer';

const ROOT = join(import.meta.dirname, '../..');
const PORT = Number(process.env.PROBE_PORT ?? 5301);
const BASE = `http://127.0.0.1:${PORT}`;
const extraLibs = join(homedir(), '.cache/puppeteer/extra-libs/usr/lib/x86_64-linux-gnu');
const launchEnv = existsSync(extraLibs)
  ? { ...process.env, LD_LIBRARY_PATH: [extraLibs, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') }
  : process.env;

const { createServer } = await import('vite');
const server = await createServer({
  root: ROOT, configFile: join(ROOT, 'vite.config.ts'),
  server: { host: '127.0.0.1', port: PORT, strictPort: true },
});
await server.listen();
const browser = await puppeteer.launch({
  headless: true, env: launchEnv,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebGPU'],
});
const query = async payload => {
  const response = await fetch(`${BASE}/__debug`, { method: 'POST', body: JSON.stringify(payload) });
  const body = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(body));
  return body;
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  page.on('pageerror', error => console.log('page error:', error.message));
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 120_000 });
  await page.waitForFunction(() => document.querySelector('canvas.battlefield') !== null,
    { timeout: 120_000 });
  await sleep(4000);

  // The command panel, with the town center selected.
  const town = (await query({ type: 'entities', kind: 'town-center' }))
    .entities.find(entity => entity.owner === 1);
  await query({ type: 'select', ids: [town.id] });
  await sleep(600);
  const buttons = await page.evaluate(() => [...document.querySelectorAll('.command-button')]
    .map(button => ({
      title: button.title,
      art: getComputedStyle(button).backgroundImage !== 'none',
    })));
  for (const button of buttons) {
    console.log(`${button.art ? 'art   ' : 'NO ART'} ${button.title}`);
  }

  // The minimap's own pixels: which colours it is actually drawing.
  const colours = await page.evaluate(() => {
    const map = [...document.querySelectorAll('canvas')]
      .find(canvas => !canvas.classList.contains('battlefield'));
    if (!map) return null;
    const { data } = map.getContext('2d').getImageData(0, 0, map.width, map.height);
    const counts = {};
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue;
      const hex = '#' + [data[i], data[i + 1], data[i + 2]]
        .map(value => value.toString(16).padStart(2, '0')).join('');
      counts[hex] = (counts[hex] ?? 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  });
  console.log('minimap, most common colours:', colours);
} finally {
  await browser.close();
  await server.close();
}
