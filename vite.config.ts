import { defineConfig } from 'vite';

export default defineConfig({
  // Public deployments must never package locally converted Microsoft assets.
  // The viewer automatically uses its open fallback when this directory is absent.
  publicDir: process.env.OPEN_CONTENT_ONLY === '1' ? false : 'public',
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    allowedHosts: ['calcifer.tail6e864b.ts.net'],
    hmr: { protocol: 'wss', clientPort: 5173 },
  },
});
