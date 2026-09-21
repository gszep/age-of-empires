import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { sharedMatchPlugin, SharedCheckpointError } from '../src/shared/server.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const server = await createServer({ root, configFile: `${root}vite.config.ts`,
  plugins: [sharedMatchPlugin(root, process.env.MATCH_CHECKPOINT)],
  ...(process.env.MATCH_PORT ? { server: { port: Number(process.env.MATCH_PORT) } } : {}),
}).catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(error instanceof SharedCheckpointError ? error.exitCode : 1);
});
await server.listen();
server.printUrls();
console.log('Shared match hosted here; Artemis joins through its local gateway.');
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, async () => { await server.close(); process.exit(0); });
