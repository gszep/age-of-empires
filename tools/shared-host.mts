import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { sharedMatchPlugin } from '../src/shared/server.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const server = await createServer({ root, configFile: `${root}vite.config.ts`, plugins: [sharedMatchPlugin(root)] });
await server.listen();
server.printUrls();
console.log('Shared match hosted here; Artemis joins through its local gateway.');
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, async () => { await server.close(); process.exit(0); });
