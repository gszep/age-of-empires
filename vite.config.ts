import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  // Worktrees under .claude/ carry a full copy of the suite; collecting them
  // doubles every run and reports stale branches as if they were this tree.
  test: { exclude: [...configDefaults.exclude, '.claude/**'] },
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
