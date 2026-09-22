import compression from 'compression';
import type { Connect, Plugin } from 'vite';

/** Keep host-sourced modules small over the remote join gateway (#154).
 * Use maintained negotiation/streaming rather than buffering a second copy of
 * every module. Defaults: 1 KiB threshold, gzip level 6 / Brotli quality 4. */
export function gameCompression(): Plugin {
  return {
    name: 'game-compression',
    apply: 'serve',
    configureServer(server) {
      // The package works on Node request/response objects; its DefinitelyTyped
      // declaration unnecessarily narrows these to Express extensions.
      server.middlewares.use(compression({
        filter(req, res) {
          // Command/debug traffic must not acquire compression buffering. HMR
          // and shared-play WebSocket upgrades never traverse this middleware.
          const path = (req.url ?? '').split('?')[0];
          if (/^\/__(?:match|debug)(?:\/|$)/.test(path) || req.headers.range || res.statusCode === 206) return false;
          if (String(res.getHeader('Content-Type')).startsWith('text/event-stream')) return false;
          return compression.filter(req, res);
        },
      }) as Connect.NextHandleFunction);
    },
  };
}
