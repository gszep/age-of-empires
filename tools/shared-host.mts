import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { sharedMatchPlugin, SharedCheckpointError } from '../src/shared/server.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const releasePath = `${root}release.json`;
if (existsSync(releasePath)) {
  const release = JSON.parse(readFileSync(releasePath, 'utf8'));
  for (const [path, expected] of Object.entries(release.files)) {
    const hash = createHash('sha256').update(readFileSync(`${root}${path}`)).digest('hex');
    if (hash !== expected) { console.error(`Release file changed: ${path}`); process.exit(78); }
  }
  const dependencyHash = createHash('sha256').update(readFileSync(release.dependencies)).digest('hex');
  if (dependencyHash !== release.files['package-lock.json']) {
    console.error('Release dependencies changed; prepare and verify a new release.'); process.exit(78);
  }
  console.log(`Shared release ${release.fingerprint} (${release.revision})`);
}
const server = await createServer({ root, configFile: `${root}vite.config.ts`,
  ...(existsSync(releasePath) ? { cacheDir: `${root}.local/vite-cache` } : {}),
  plugins: [sharedMatchPlugin(root, process.env.MATCH_CHECKPOINT)],
  server: { ...(process.env.MATCH_PORT ? { port: Number(process.env.MATCH_PORT) } : {}),
    ...(existsSync(releasePath) ? { watch: null, hmr: false } : {}) },
}).catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(error instanceof SharedCheckpointError ? error.exitCode : 1);
});
await server.listen();
server.printUrls();
console.log('Shared match hosted here; Artemis joins through its local gateway.');
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, async () => { await server.close(); process.exit(0); });
