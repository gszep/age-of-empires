/** Screenshot the HUD at the reference scale (2000x1125) and report the labels' computed fonts. MAP=, SEED=, LOOK=x,y, NAME=, OUT=. */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer';
const ROOT = join(import.meta.dirname, '../..');
const OUT = process.env.OUT ?? join(ROOT, '.local/probes');
const PORT = 5309; const BASE = `http://127.0.0.1:${PORT}`;
const extraLibs = join(homedir(), '.cache/puppeteer/extra-libs/usr/lib/x86_64-linux-gnu');
const launchEnv = existsSync(extraLibs) ? { ...process.env, LD_LIBRARY_PATH: [extraLibs, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') } : process.env;
const { createServer } = await import('vite');
const server = await createServer({ root: ROOT, configFile: join(ROOT, 'vite.config.ts'), server: { host: '127.0.0.1', port: PORT, strictPort: true } });
await server.listen();
const browser = await puppeteer.launch({ headless: true, env: launchEnv, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebGPU'] });
const query = async (payload: unknown) => { const r = await fetch(`${BASE}/__debug`, { method: 'POST', body: JSON.stringify(payload) }); const b = await r.json(); if (!r.ok) throw new Error(JSON.stringify(b)); return b as any; };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 2000, height: 1125 });
  page.on('pageerror', e => console.log('page error:', e.message));
  await page.goto(`${BASE}/?map=${process.env.MAP ?? 'islands'}&seed=${process.env.SEED ?? 2}`, { waitUntil: 'networkidle2', timeout: 120_000 });
  await page.waitForFunction(() => document.querySelector('canvas.battlefield') !== null, { timeout: 120_000 });
  await sleep(5000);
  await page.keyboard.press('F4');
  if (process.env.LOOK) { const [x, y] = process.env.LOOK.split(',').map(Number); await query({ type: 'look', rect: [x, y] }); }
  await sleep(2500);
  try { await page.screenshot({ path: join(OUT, process.env.NAME ?? 'ours.png') }); console.log('shot ok'); } catch (e) { console.log('shot failed', e); }
  const fonts = await page.evaluate(() => [...document.querySelectorAll('.resource-value, .age-label, #age, .score-row, .score-name')].slice(0, 6).map(el => { const cs = getComputedStyle(el); return `${el.className || el.id}: ${cs.fontFamily} ${cs.fontSize} ${cs.fontWeight} text=${(el as HTMLElement).innerText?.slice(0, 20)}`; }));
  console.log(fonts);
} finally { await browser.close(); await server.close(); }
