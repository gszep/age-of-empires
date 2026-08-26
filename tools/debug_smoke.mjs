#!/usr/bin/env node
/**
 * End-to-end check of the /__debug protocol: boots the dev server (unless one
 * is already listening), opens the game in headless Chrome, and exercises the
 * sim/entities/pixels/screenshot queries. Exits non-zero on any failure, so
 * agents can verify rendering changes without a human playtest.
 *
 * Usage: npm run debug:smoke
 */

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer';

const BASE = 'http://127.0.0.1:5173';

// Minimal systems (e.g. fresh WSL2) lack Chrome's NSS libraries and there may
// be no sudo; `apt-get download libnspr4 libnss3` + `dpkg-deb -x` into this
// directory makes Chrome runnable without root.
const extraLibs = join(homedir(), '.cache/puppeteer/extra-libs/usr/lib/x86_64-linux-gnu');
const launchEnv = existsSync(extraLibs)
  ? { ...process.env, LD_LIBRARY_PATH: [extraLibs, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') }
  : process.env;

async function devServerUp() {
  try {
    await fetch(BASE, { signal: AbortSignal.timeout(1000) });
    return true;
  } catch {
    return false;
  }
}

const failures = [];
function check(name, condition, detail) {
  const mark = condition ? 'ok  ' : 'FAIL';
  console.log(`${mark} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failures.push(name);
}

let server;
if (!(await devServerUp())) {
  const { createServer } = await import('vite');
  server = await createServer({ server: { host: '127.0.0.1', port: 5173 } });
  await server.listen();
  console.log('started dev server');
}

const browser = await puppeteer.launch({
  headless: true,
  env: launchEnv,
  // WSL2/CI have no GPU. SwiftShader's WebGPU device dies spontaneously
  // (~2s in) under this app, so WebGPU is disabled and three's WebGL2
  // fallback renders via SwiftShader instead — a supported first-class path.
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebGPU'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  page.on('pageerror', error => console.log(`page error: ${error.message}`));
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 60_000 });
  // The game is up once the first frame has been rendered.
  await page.waitForFunction(
    () => document.querySelector('canvas.battlefield') !== null,
    { timeout: 60_000 },
  );
  await new Promise(resolve => setTimeout(resolve, 3000));

  const query = async payload => {
    const response = await fetch(`${BASE}/__debug`, { method: 'POST', body: JSON.stringify(payload) });
    const body = await response.json();
    if (!response.ok) throw new Error(`${payload.type}: ${body.error}`);
    return body;
  };

  const sim = await query({ type: 'sim' });
  check('sim query', Number.isInteger(sim.tick) && sim.players?.['1'] !== undefined,
    `tick ${sim.tick}, p1 food ${sim.players?.['1']?.food}`);

  const entities = await query({ type: 'entities', owner: 1 });
  check('entities query', entities.count > 0, `${entities.count} entities for player 1`);
  const townCenter = entities.entities.find(entity => entity.kind === 'town-center');
  check('town center reported', townCenter !== undefined,
    townCenter && `screen (${townCenter.screen.x}, ${townCenter.screen.y}), rendered=${townCenter.rendered}`);

  const pixels = await query({ type: 'pixels' });
  check('pixel readback', pixels.pixels > 0 && pixels.colors.length > 0,
    `mean rgb(${pixels.mean}) over ${pixels.pixels}px, top ${pixels.colors[0]?.hex} ${pixels.colors[0]?.fraction}`);
  check('canvas is not blank', pixels.colors[0]?.fraction < 0.995,
    'a single colour covering everything means nothing rendered');

  if (townCenter) {
    const area = await query({ type: 'pixels', entity: townCenter.id });
    check('entity pixel sample', area.pixels > 0, `mean rgb(${area.mean})`);
  }

  const shot = await fetch(`${BASE}/__debug/screenshot?x=0&y=0&w=400&h=300`);
  const png = Buffer.from(await shot.arrayBuffer());
  check('screenshot endpoint', shot.ok && png.subarray(1, 4).toString() === 'PNG', `${png.length} bytes`);
} finally {
  await browser.close();
  await server?.close();
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('\nall debug protocol checks passed');
