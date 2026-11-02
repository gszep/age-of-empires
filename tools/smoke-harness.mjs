/**
 * The shared launch for browser smokes: a private Vite server on the script's
 * own fixed port, headless Chrome on SwiftShader, and a page that records its
 * errors. Plain ESM so tsx-run `.mts` smokes and `node`-run `.mjs` ones share it.
 * Script-specific plugins, waits and timeouts stay in each script.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { createServer } from 'vite';

export const root = fileURLToPath(new URL('../', import.meta.url));

// WSL2/CI have no GPU. SwiftShader's WebGPU device dies spontaneously under this
// app, so WebGPU is disabled and three's WebGL2 fallback renders via SwiftShader.
export const chromeArgs = ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebGPU'];

// Minimal systems (e.g. fresh WSL2) lack Chrome's NSS libraries and may have no
// sudo; `apt-get download libnspr4 libnss3` + `dpkg-deb -x` into this directory
// makes Chrome runnable without root.
const libs = `${homedir()}/.cache/puppeteer/extra-libs/usr/lib/x86_64-linux-gnu`;
export const launchEnv = () => existsSync(libs) ? { ...process.env, LD_LIBRARY_PATH: libs } : process.env;

/** The owned import's manifest, parsed; `base` selects another checkout. */
export const ownedManifest = (base = root) => JSON.parse(readFileSync(`${base}public/imported/aoe2/manifest.json`, 'utf8'));

/**
 * A listening private dev server. Only one tab may attach to it: the debug
 * bridge answers from whichever page replies first.
 * @param {{ port: number, strictPort?: boolean, root?: string } & import('vite').InlineConfig} options
 */
export async function startServer({ port, strictPort = true, root: base = root, ...options }) {
  const server = await createServer({ root: base, configFile: `${base}vite.config.ts`, logLevel: 'error',
    ...options, server: { host: '127.0.0.1', port, strictPort } });
  await server.listen();
  return server;
}

/** @param {import('puppeteer').LaunchOptions} [options] */
export const launchBrowser = ({ args = chromeArgs, ...options } = {}) =>
  puppeteer.launch({ headless: true, env: launchEnv(), args, ...options });

/**
 * A new page at the given viewport whose uncaught errors collect in `errors`.
 * @param {import('puppeteer').Browser} browser
 * @param {{ viewport?: import('puppeteer').Viewport }} [options]
 */
export async function newPage(browser, { viewport = { width: 1280, height: 800 } } = {}) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  /** @type {string[]} */
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  return { page, errors };
}

/** Open-content mode: every owned asset request fails with 404. */
export async function blockImported(page) {
  await page.setRequestInterception(true);
  page.on('request', request => { void (request.url().includes('/imported/') ? request.respond({ status: 404, body: '' }) : request.continue()); });
}
