/** Private acceptance. TECHTREE_UI may point at a private UI-stage extraction;
 * OWNED_PUBLIC may point at an existing publication, both read-only. No imports. */
import assert from 'node:assert/strict';
import { createReadStream, existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import type { Browser } from 'puppeteer';
import { root, startServer, launchBrowser, newPage } from './smoke-harness.mjs';

const publicDir = resolve(process.env.OWNED_PUBLIC ?? `${root}public`);
const privateUi = resolve(process.env.TECHTREE_UI ?? `${publicDir}/imported/aoe2/ui`);
const fallback = process.env.OPEN_FALLBACK === '1';
const port = Number(process.env.TECHTREE_PORT ?? 5298);
const out = `${root}.local/techtree-${fallback ? 'fallback' : 'owned'}`;
mkdirSync(`${root}.local`, { recursive: true });
const manifest = fallback ? undefined : JSON.parse(readFileSync(`${privateUi}/manifest.json`, 'utf8'));
const server = await startServer({ publicDir, port, plugins: [{
    name: 'private-tech-tree-ui', enforce: 'pre',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = decodeURIComponent((req.url ?? '').split('?')[0]);
        if (fallback && url.startsWith('/imported/')) { res.statusCode = 404; res.end(); return; }
        const prefix = '/imported/aoe2/ui/';
        if (!url.startsWith(prefix)) { next(); return; }
        const path = resolve(privateUi, url.slice(prefix.length));
        if (!path.startsWith(privateUi + '/') || !existsSync(path)) { res.statusCode = 404; res.end(); return; }
        const mime: Record<string, string> = { '.json': 'application/json', '.png': 'image/png', '.ttf': 'font/ttf', '.otf': 'font/otf' };
        res.setHeader('Content-Type', mime[extname(path)] ?? 'application/octet-stream');
        createReadStream(path).pipe(res);
      });
    },
  }] });
let browser: Browser | undefined;
try {
  browser = await launchBrowser();
  console.log(JSON.stringify({ pid: process.pid, browserPid: browser.process()?.pid, port }));
  const { page, errors } = await newPage(browser);
  await page.evaluateOnNewDocument('globalThis.__name = f => f');
  await page.goto(`http://127.0.0.1:${port}/?solo=1&seed=138`, { waitUntil: 'networkidle0', timeout: 120000 });
  await page.waitForFunction(() => typeof (window as any).__empiresDebug === 'function');
  const button = '[data-command="techtree"]';
  if (fallback) {
    assert(await page.$eval(button, e => (e as HTMLButtonElement).disabled));
    assert.match(await page.$eval(button, e => e.getAttribute('title')!), /requires imported owned/);
    assert(await page.$eval(button, e => e.getBoundingClientRect().width > 0));
    await page.screenshot({ path: `${out}.png` });
  } else {
    await page.waitForFunction(selector => !(document.querySelector(selector) as HTMLButtonElement)?.disabled, {}, button);
    await page.click(button); await page.waitForSelector('#techtree-dialog[open]');
    const expected = manifest.techTrees.britons.nodes.length;
    assert.equal(await page.$$eval('.techtree-node', n => n.length), expected);
    assert.equal(await page.$$eval('.techtree-scroll tbody tr', n => n.length), 4);
    assert((await page.$$eval('.techtree-icon', n => n.length)) > 50);
    await page.evaluate(() => document.fonts.ready);
    const textBounds = await page.$$eval('.techtree-name', names => names.map(name => {
      const card = name.closest('button')!.getBoundingClientRect();
      const range = document.createRange(); range.selectNodeContents(name);
      return { name: name.textContent, inside: [...range.getClientRects()].every(r =>
        r.left >= card.left && r.right <= card.right && r.top >= card.top && r.bottom <= card.bottom) };
    }));
    assert(textBounds.some(n => n.name === 'Crossbowman'));
    assert(textBounds.some(n => n.name === 'Wheelbarrow'));
    assert.deepEqual(textBounds.filter(n => !n.inside), [], 'every text line stays inside its card at 1280×800');
    const columnOf = (id: number) => page.$eval(`[data-node="Building:${id}"]`, e => (e.closest('td') as HTMLElement).dataset.column);
    assert.equal(await columnOf(621), await columnOf(109));
    for (const id of [79, 234, 235, 236]) assert.equal(await columnOf(id), await columnOf(598));
    await page.screenshot({ path: `${out}-opening.png` });
    await page.hover('.techtree-scroll');
    await page.mouse.wheel({ deltaX: 400 });
    await page.waitForFunction(() => document.querySelector('.techtree-scroll')!.scrollLeft > 0);
    assert(await page.$eval('.techtree-scroll thead th:first-child', e => {
      const r = e.getBoundingClientRect();
      return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === e;
    }), 'sticky blank corner covers scrolled column headings');
    const loom = '[data-node="Tech:22"]';
    await page.$eval(loom, e => { e.scrollIntoView({ block: 'center', inline: 'center' }); (e as HTMLElement).focus({ preventScroll: true }); });
    await page.waitForFunction(() => document.querySelector('.techtree-preview')!.textContent!.includes('Villagers +15 HP'));
    assert.equal(await page.$eval(loom, e => e.getAttribute('data-status')), 'available');
    assert.equal(await page.$eval('[data-node="Unit:569"]', e => e.getAttribute('data-status')), 'disabled');
    await page.screenshot({ path: `${out}.png` });
    await page.keyboard.press('Escape');
    assert.equal(await page.$eval('#techtree-dialog', e => (e as HTMLDialogElement).open), false);
    assert.equal(await page.evaluate(() => (document.activeElement as HTMLElement)?.dataset.command), 'techtree');
    await page.click(button); await page.click('[data-techtree-close]');
    assert.equal(await page.$eval('#techtree-dialog', e => (e as HTMLDialogElement).open), false);
    // Real public research command, not a private mutation or fake highlighted DOM.
    const snapshot = await page.evaluate(() => (window as any).__empiresDebug({ type: 'snapshot' }));
    const tc = snapshot.entities.find((e: any) => e.owner === 1 && e.kind === 'town-center');
    const accepted = await page.evaluate(id => (window as any).__empiresDebug({ type: 'command', command: {
      kind: 'research', player: 1, buildingId: id, tech: 'loom' } }), tc.id);
    assert(accepted.ok, JSON.stringify(accepted));
    await page.click(button);
    await page.waitForFunction(() => document.querySelector('[data-node="Tech:22"]')?.getAttribute('data-status') === 'researched', { timeout: 60000 });
    await page.$eval(loom, e => { e.scrollIntoView({ block: 'center', inline: 'center' }); (e as HTMLElement).focus({ preventScroll: true }); });
    assert.equal(await page.$eval(loom, e => getComputedStyle(e).borderTopColor), 'rgb(57, 114, 57)');
    assert.equal(await page.$eval(loom, e => getComputedStyle(e).backgroundColor), 'rgb(197, 223, 177)');
    await page.screenshot({ path: `${out}-researched.png` });
    await page.keyboard.press('Escape');
    console.log(JSON.stringify({ nodes: expected, rows: 4, loom: 'public command → researched', escape: true, close: true }));
  }
  assert.deepEqual(errors, []);
  writeFileSync(`${out}.json`, JSON.stringify({ mode: fallback ? 'fallback' : 'owned-private-ui', errors, screenshot: `${out}.png` }, null, 2));
  console.log('PASS');
} finally {
  await browser?.close(); await server.close();
}
