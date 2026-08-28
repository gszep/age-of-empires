/**
 * Issue #31: a keyup lost to a focus change left the camera panning for ever.
 *
 * Holds ArrowDown for real, then hands the window a blur *without* ever
 * releasing the key -- the alt-tab case -- and reads an entity's reported
 * screen position to see whether the camera is still moving.
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer';

const ROOT = join(import.meta.dirname, '../..');
const PORT = Number(process.env.PROBE_PORT ?? 5302);
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
const query = async (payload: unknown) => {
  const response = await fetch(`${BASE}/__debug`, { method: 'POST', body: JSON.stringify(payload) });
  const body = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(body));
  return body as never;
};
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const screenYOfTownCenter = async (): Promise<number> => {
  const rows = ((await query({ type: 'entities', kind: 'town-center' })) as
    { entities: { owner: number; screen: { y: number } }[] }).entities;
  return rows.find(r => r.owner === 1)!.screen.y;
};

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  page.on('pageerror', error => console.log('page error:', error.message));
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 120_000 });
  await page.waitForFunction(() => document.querySelector('canvas.battlefield') !== null,
    { timeout: 120_000 });
  await sleep(2000);

  const before = await screenYOfTownCenter();
  await page.keyboard.down('ArrowDown');
  await sleep(700);
  const heldSample = await screenYOfTownCenter();
  console.log(`held ArrowDown: screen y ${before} -> ${heldSample} (moved ${Math.abs(heldSample - before) > 5})`);

  // The alt-tab: focus leaves, the keyup never arrives.
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await sleep(500);
  const settled = await screenYOfTownCenter();
  await sleep(900);
  const later = await screenYOfTownCenter();
  const stillMoving = Math.abs(later - settled) > 2;
  console.log(`after blur without keyup: y ${settled} then ${later} -- camera ${stillMoving ? 'STILL MOVING (bug)' : 'stopped (fixed)'}`);
  process.exitCode = stillMoving ? 1 : 0;
} finally {
  await browser.close();
  await server.close();
}
