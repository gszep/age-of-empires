import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer, normalizePath } from 'vite';
import { expect, it, vi } from 'vitest';
import { gameWatchScope, immutableWatch } from './vite-watch';

it('watches real source changes inside a private-root project, excluding its generated art and archives', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'empires-watch-'));
  const root = join(parent, '.local', 'project');
  for (const path of ['src', '.local/archive/src', 'public/imported/aoe2']) await mkdir(join(root, path), { recursive: true });
  const source = join(root, 'src/main.ts'), archived = join(root, '.local/archive/src/main.ts'), art = join(root, 'public/imported/aoe2/manifest.json');
  for (const path of [source, archived, art]) await writeFile(path, '{}');
  const server = await createServer({ root, configFile: false, plugins: [gameWatchScope()], logLevel: 'silent' });
  const changed: string[] = []; server.watcher.on('change', path => changed.push(normalizePath(path)));
  try {
    await vi.waitFor(() => expect(server.watcher.getWatched()[normalizePath(join(root, 'src'))]).toContain('main.ts'));
    await writeFile(archived, '{"changed":1}'); await writeFile(art, '{"changed":1}'); await writeFile(source, 'export const changed = 1;');
    await vi.waitFor(() => expect(changed).toContain(normalizePath(source)));
    expect(changed).not.toContain(normalizePath(archived)); expect(changed).not.toContain(normalizePath(art));
    for (const path of Object.keys(server.watcher.getWatched())) {
      expect(path.startsWith(normalizePath(resolve(root, '.local')))).toBe(false);
      expect(path.startsWith(normalizePath(resolve(root, 'public/imported')))).toBe(false);
    }
  } finally { await server.close(); await rm(parent, { recursive: true, force: true }); }
});

it('preserves the immutable ignore-all option through the actual inline config merge', async () => {
  const root = await mkdtemp(join(tmpdir(), 'empires-immutable-watch-'));
  await writeFile(join(root, 'source.ts'), 'export const value = 1;');
  const server = await createServer({ root, configFile: false, plugins: [gameWatchScope()], logLevel: 'silent',
    server: { watch: immutableWatch, hmr: false } });
  try {
    expect(server.config.server.watch).toBeDefined();
    expect(server.config.server.hmr).toBe(false);
    await server.watcher.add(join(root, 'source.ts'));
    expect(server.watcher.getWatched()).toEqual({});
  } finally { await server.close(); await rm(root, { recursive: true, force: true }); }
});
