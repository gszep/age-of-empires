/**
 * Vite dev-server glue for the live agent-match browser page (#352).
 *
 * Routing is deliberately minimal: `?agents=2` on the normal game URL serves
 * the standalone spectator page instead of the interactive game, and every
 * `/agents/api/*` request plus the `/agents/ws` upgrade goes to the local
 * backend. Nothing about the normal game route changes.
 *
 * This module must stay loadable by Vite's config bundler and by Node's
 * TypeScript stripping: it imports types only and defers the real backend to
 * the dev server's SSR module runner, which transforms the backend chain
 * (parameter properties, extensionless imports) exactly like vitest does.
 */
import type { Plugin, ViteDevServer } from 'vite';
import type { AgentsBackend, AgentsBackendOptions } from './backend';

/** True for `/` or `/index.html` with `?agents=2`. */
export function isAgentsPageRequest(rawUrl: string | undefined): boolean {
  if (!rawUrl) return false;
  const url = new URL(rawUrl, 'http://localhost');
  if (url.searchParams.get('agents') !== '2') return false;
  return url.pathname === '/' || url.pathname === '/index.html';
}

const AGENTS_API_PREFIX = '/agents/api/';
const AGENTS_PAGE_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="theme-color" content="#182119" />
    <title>Live agent match — Open Empires Lab</title>
  </head>
  <body>
    <div id="agents-app"><div class="agents-loading">Loading the live agent match page…</div></div>
    <script type="module" src="/src/agents/client/entry.ts"></script>
  </body>
</html>`;

/**
 * The `?agents=2` dev plugin. Test setup may inject a client factory
 * (`options.client`); the production config passes none, so the backend
 * discovers the shared local OpenCode service itself and no fake is builtin.
 */
export function agentsPagePlugin(options: AgentsBackendOptions = {}): Plugin {
  let close: (() => Promise<void>) | undefined;
  const load = async (server: ViteDevServer): Promise<AgentsBackend> => {
    const module = await server.ssrLoadModule('/src/agents/server/backend.ts');
    return new module.AgentsBackend(options);
  };
  return {
    name: 'agents-live-browser',
    apply: 'serve',
    // An HTTP 'close' event does not await async listeners. Own the backend's
    // lifetime through Vite's awaited shutdown hook, including in-flight Start.
    async closeBundle() { await close?.(); },
    configureServer(server) {
      let backend: Promise<AgentsBackend> | undefined;
      let closing = false;
      const ensure = (): Promise<AgentsBackend> => {
        if (closing) return Promise.reject(new Error('agents backend is closing'));
        return backend ??= load(server);
      };
      close = async () => {
        closing = true;
        const instance = await backend?.catch(() => undefined);
        await instance?.close();
      };

      // Registered before Vite's own upgrade listener: handle only our path,
      // and leave HMR upgrades untouched.
      server.httpServer?.on('upgrade', (req, socket, head) => {
        void (async () => {
          const url = new URL(req.url ?? '/', 'http://localhost');
          if (url.pathname !== '/agents/ws') return;
          try { (await ensure()).upgrade(req, socket, head); }
          catch { socket.destroy(); }
        })();
      });

      server.middlewares.use((req, res, next) => {
        void (async () => {
          try {
            const url = new URL(req.url ?? '/', 'http://localhost');
            if ((req.method === 'GET' || req.method === 'HEAD') && isAgentsPageRequest(req.url)) {
              const html = await server.transformIndexHtml(req.url ?? '/', AGENTS_PAGE_HTML);
              res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
              res.end(req.method === 'HEAD' ? undefined : html);
              return;
            }
            if (url.pathname.startsWith(AGENTS_API_PREFIX)) {
              await (await ensure()).handle(req, res);
              return;
            }
          } catch {
            if (!res.headersSent) {
              res.writeHead(500, { 'content-type': 'application/json' });
              res.end(JSON.stringify({ error: { code: 'unknown', message: 'agents route failed' } }));
            }
            return;
          }
          next();
        })();
      });

    },
  };
}
