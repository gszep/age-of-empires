import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { freemem, totalmem, loadavg } from 'node:os';

// Diagnostics must not replace the original failure or wait forever for a hung
// renderer. Node-side request/console evidence is saved before any CDP query.
async function bounded(operation, milliseconds = 5000) {
  let timer;
  try {
    return await Promise.race([operation(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('diagnostic query timed out')), milliseconds);
    })]);
  } catch (error) { return { diagnosticError: String(error) }; }
  finally { clearTimeout(timer); }
}

export function startupDiagnostics(page, browser, directory) {
  const started = Date.now();
  const pending = new Map();
  const consoleMessages = [], pageErrors = [], failedRequests = [], httpErrors = [], completedRequests = [], navigations = [];
  const elapsed = () => Date.now() - started;
  const retain = (list, value) => { list.push(value); if (list.length > 500) list.shift(); };
  const requestInfo = request => ({ url: request.url(), method: request.method(), type: request.resourceType(), atMs: elapsed() });
  const listeners = {
    request: request => pending.set(request, requestInfo(request)),
    requestfinished: request => {
      retain(completedRequests, { ...pending.get(request), finishedAtMs: elapsed(), status: request.response()?.status() });
      pending.delete(request);
    },
    requestfailed: request => {
      retain(failedRequests, { ...pending.get(request), ...requestInfo(request), error: request.failure()?.errorText });
      pending.delete(request);
    },
    response: response => {
      if (response.status() >= 400) retain(httpErrors, { url: response.url(), status: response.status(), atMs: elapsed() });
    },
    console: message => retain(consoleMessages, { type: message.type(), text: message.text(), location: message.location(), atMs: elapsed() }),
    pageerror: error => retain(pageErrors, { message: String(error), stack: error.stack, atMs: elapsed() }),
    framenavigated: frame => retain(navigations, { url: frame.url(), main: frame === page.mainFrame(), atMs: elapsed() }),
  };
  for (const [event, listener] of Object.entries(listeners)) page.on(event, listener);
  return {
    dispose() { for (const [event, listener] of Object.entries(listeners)) page.off(event, listener); },
    async capture(error, phase) {
      await mkdir(directory, { recursive: true });
      const output = await mkdtemp(join(directory, 'startup-'));
      const report = { started: new Date(started).toISOString(), elapsedMs: elapsed(), phase,
        error: String(error), stack: error?.stack, url: page.url(), browserPid: browser.process()?.pid,
        host: { freeMemory: freemem(), totalMemory: totalmem(), loadAverage: loadavg(), node: process.version },
        pendingRequests: [...pending.values()], failedRequests, httpErrors, completedRequests,
        consoleMessages, pageErrors, navigations };
      await writeFile(join(output, 'events.json'), JSON.stringify(report, null, 2));
      console.error(`Browser startup diagnostics: ${output}`);
      const dom = await bounded(() => page.evaluate(() => ({
        url: location.href, readyState: document.readyState, title: document.title,
        debugType: typeof window.__empiresDebug,
        loadingMessage: document.querySelector('#game-message')?.textContent,
        html: document.documentElement.outerHTML.slice(0, 100_000),
        canvases: [...document.querySelectorAll('canvas')].map(canvas => ({
          className: canvas.className, width: canvas.width, height: canvas.height,
          rect: canvas.getBoundingClientRect().toJSON(),
        })),
        resources: performance.getEntriesByType('resource').map(entry => entry.toJSON()),
        navigation: performance.getEntriesByType('navigation').map(entry => entry.toJSON()),
      })));
      await writeFile(join(output, 'page.json'), JSON.stringify(dom, null, 2));
      const renderer = await bounded(async () => {
        const session = await browser.target().createCDPSession();
        try { return await session.send('SystemInfo.getInfo'); }
        finally { await session.detach(); }
      });
      await writeFile(join(output, 'renderer.json'), JSON.stringify(renderer, null, 2));
      return output;
    },
  };
}
