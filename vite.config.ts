import type { Plugin } from 'vite';
import { configDefaults, defineConfig } from 'vitest/config';

/**
 * Dev-only debug bridge: forwards HTTP requests on /__debug to the running
 * game over the HMR websocket (src/dev-debug.ts answers them) so agents and
 * scripts can query live simulation and rendering state as text. See the
 * "Visual debug protocol" section of AGENTS.md for the query surface.
 */
function gameDebug(): Plugin {
  return {
    name: 'game-debug',
    apply: 'serve',
    configureServer(server) {
      let sequence = 0;
      const pending = new Map<number, { resolve: (value: never) => void; reject: (error: Error) => void }>();
      server.ws.on('aoe:debug-response', (data: { id: number; result?: unknown; error?: string }) => {
        const entry = pending.get(data.id);
        if (!entry) return;
        pending.delete(data.id);
        if (data.error !== undefined) entry.reject(new Error(data.error));
        else entry.resolve(data.result as never);
      });
      const query = <T>(payload: unknown): Promise<T> =>
        new Promise((resolve, reject) => {
          const id = ++sequence;
          pending.set(id, { resolve, reject });
          server.ws.send('aoe:debug-request', { id, query: payload });
          setTimeout(() => {
            if (pending.delete(id)) {
              reject(new Error('no debug client answered within 5s — is the game open in a (visible) browser tab?'));
            }
          }, 5000);
        });

      server.middlewares.use('/__debug', (req, res) => {
        const fail = (status: number, error: unknown): void => {
          res.writeHead(status, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: String(error) }));
        };
        (async () => {
          const url = new URL(req.url ?? '/', 'http://localhost');
          if (req.method === 'GET' && url.pathname === '/screenshot') {
            const param = (key: string): number | undefined =>
              url.searchParams.has(key) ? Number(url.searchParams.get(key)) : undefined;
            const rect = url.searchParams.has('x')
              ? [param('x'), param('y'), param('w'), param('h')]
              : undefined;
            const shot = await query<{ png: string }>({ type: 'pixels', png: true, rect, entity: param('entity') });
            const bytes = Buffer.from(shot.png, 'base64');
            res.writeHead(200, { 'content-type': 'image/png', 'content-length': bytes.length });
            res.end(bytes);
            return;
          }
          if (req.method !== 'POST') {
            fail(405, 'POST a JSON query, e.g. {"type":"sim"} — or GET /__debug/screenshot');
            return;
          }
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const result = await query(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(result));
        })().catch(error => fail(502, error));
      });
    },
  };
}

export default defineConfig({
  plugins: [gameDebug()],
  // Worktrees under .claude/ carry a full copy of the suite; collecting them
  // doubles every run and reports stale branches as if they were this tree.
  // A whole simulated match runs in a few seconds here, but the 5s default
  // leaves no room for a machine that is also rendering one in a browser; the
  // suite has flaked on wall time alone rather than on anything it measured.
  test: { exclude: [...configDefaults.exclude, '.claude/**'], testTimeout: 30_000 },
  // Public deployments must never package locally converted Microsoft assets.
  // The viewer automatically uses its open fallback when this directory is absent.
  publicDir: process.env.OPEN_CONTENT_ONLY === '1' ? false : 'public',
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    // No hmr override: Vite's client already matches the page protocol, so
    // localhost gets ws:// and the Tailscale-served HTTPS URL gets wss://.
    // Forcing wss here broke the websocket (HMR and /__debug) on plain HTTP.
    allowedHosts: ['calcifer.tail6e864b.ts.net'],
  },
});
