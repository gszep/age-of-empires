import { it, expect, describe, beforeEach, afterEach, vi } from 'vitest';
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, utimesSync,
  rmSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import * as helpers from './harness-safeguards.mjs';
import safeguards from '../.opencode/plugins/safeguards.js';

const source = fileURLToPath(new URL('..', import.meta.url));
type ToolEvent = { tool: string; input: unknown; status?: string; result?: unknown; error?: unknown };
type Hook = (event: ToolEvent) => void | Promise<void>;
let root: string;

beforeEach(() => {
  const scratch = resolve(tmpdir(), 'opencode');
  mkdirSync(scratch, { recursive: true });
  root = mkdtempSync(resolve(scratch, 'harness-guards-'));
  vi.stubEnv('EMPIRES_RUN_DIR', '');
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

function repository() {
  execFileSync('git', ['init', '-q', root]);
  mkdirSync(resolve(root, '.local'));
  mkdirSync(resolve(root, 'tools/hooks'), { recursive: true });
  for (const script of ['guard_bash.sh', 'guard_commit.sh']) {
    copyFileSync(resolve(source, 'tools/hooks', script), resolve(root, 'tools/hooks', script));
  }
  writeFileSync(resolve(root, '.git/info/exclude'), '.local/\ntools/\n');
  writeFileSync(resolve(root, 'app.ts'), 'code');
  execFileSync('git', ['add', 'app.ts'], { cwd: root });
}

async function registered(directory = root) {
  const hooks: Record<string, Hook> = {};
  const hook = vi.fn(async (name: string, callback: Hook) => {
    expect(hooks[name]).toBeUndefined();
    hooks[name] = callback;
    return { dispose: async () => {} };
  });
  await safeguards.setup({ location: { directory }, tool: { hook } });
  expect(hook.mock.calls.map(([name]) => name)).toEqual(['execute.before', 'execute.after']);
  // Normalize synchronous throws and returned rejections without losing either.
  const before = (tool: string, input: unknown) => Promise.resolve().then(() => hooks['execute.before']({ tool, input }));
  const after = (event: ToolEvent) => Promise.resolve().then(() => hooks['execute.after'](event));
  return { before, after };
}

describe('V2 safeguards registration', () => {
  it('exports one dependency-free V2 definition, with no obsolete duplicate', async () => {
    expect(safeguards.id).toBe('safeguards');
    expect(Object.keys(safeguards).sort()).toEqual(['id', 'setup']);
    expect(existsSync(resolve(source, '.opencode/plugins/safeguards.ts'))).toBe(false);
    await registered();
  });

  it('forwards native shell input, resolving omitted, relative and absolute workdirs', async () => {
    const check = vi.spyOn(helpers, 'checkShell').mockImplementation(() => {});
    const { before } = await registered();
    for (const workdir of [undefined, 'nested', resolve(root, 'absolute')]) {
      const input = { command: 'echo fixture', ...(workdir === undefined ? {} : { workdir }) };
      await before('shell', input);
      expect(check).toHaveBeenLastCalledWith(root, 'echo fixture', resolve(root, workdir ?? '.'));
      expect(input.command).toBe('echo fixture');
    }
    expect(check).toHaveBeenCalledTimes(3);
  });

  it('does not treat other tools or the obsolete bash name as native shell', async () => {
    const check = vi.spyOn(helpers, 'checkShell');
    const { before } = await registered();
    for (const tool of ['read', 'execute', 'bash']) await before(tool, { command: 'sleep 10' });
    expect(check).not.toHaveBeenCalled();
  });

  it('propagates guard exceptions instead of allowing execution', async () => {
    const failure = new Error('guard fixture failure');
    vi.spyOn(helpers, 'checkShell').mockImplementation(() => { throw failure; });
    const { before } = await registered();
    const execute = vi.fn();
    await expect(before('shell', { command: 'echo fixture' }).then(execute)).rejects.toBe(failure);
    expect(execute).not.toHaveBeenCalled();
  });

  it('propagates hook registration failures', async () => {
    const failure = new Error('registration failed');
    const hook = vi.fn().mockRejectedValue(failure);
    await expect(safeguards.setup({ location: { directory: root }, tool: { hook } })).rejects.toBe(failure);
    expect(hook).toHaveBeenCalledTimes(1);
  });

  it.each([null, {}, { command: 1 }, { command: 'echo fixture', workdir: 1 }])(
    'fails closed on malformed shell input %j', async input => {
      const { before } = await registered();
      await expect(before('shell', input)).rejects.toThrow('Refused: shell guard requires');
    });
});

describe('real shell guards through V2 callbacks', () => {
  beforeEach(repository);

  it.each([
    ['pgrep -f import', 'pgrep -f / pkill -f'],
    ['pkill -f import', 'pgrep -f / pkill -f'],
    ['sleep 10', 'bare sleep'],
    ['while false; do sleep 0; done', 'sleep loop'],
  ])('rejects %s before execution', async (command, reason) => {
    const { before } = await registered();
    await expect(before('shell', { command })).rejects.toThrow(reason);
  });

  it('rejects missing/stale checkpoints and permits a fresh checkpoint in the shell workdir', async () => {
    const { before } = await registered(source);
    const run = () => before('shell', { command: 'git commit -m fixture', workdir: root });
    await expect(run()).rejects.toThrow('no green owned checkpoint');
    const stamp = resolve(root, '.local/checkpoint.ok');
    writeFileSync(stamp, '');
    utimesSync(stamp, 1, 1);
    await expect(run()).rejects.toThrow('changed since');
    const future = new Date(Date.now() + 1000);
    utimesSync(stamp, future, future);
    await expect(run()).resolves.toBeUndefined();
  });

  it('permits Markdown-only commits without a checkpoint', async () => {
    execFileSync('git', ['rm', '-f', 'app.ts'], { cwd: root });
    writeFileSync(resolve(root, 'README.md'), 'fixture');
    execFileSync('git', ['add', 'README.md'], { cwd: root });
    const { before } = await registered();
    await expect(before('shell', { command: 'git commit -m docs' })).resolves.toBeUndefined();
  });

  it('permits handle waits but never executes the supplied command itself', async () => {
    const { before } = await registered();
    await expect(before('shell', { command: 'tools/wait_for.sh file .local/job.exit 600' })).resolves.toBeUndefined();
    const marker = resolve(root, 'must-not-exist');
    await before('shell', { command: `printf executed > '${marker}'` });
    expect(existsSync(marker)).toBe(false);
  });

  it('fails closed when the guard scripts cannot be loaded', async () => {
    rmSync(resolve(root, 'tools/hooks/guard_bash.sh'));
    const { before } = await registered();
    await expect(before('shell', { command: 'echo fixture' })).rejects.toThrow('guard_bash.sh');
  });
});

describe('completed-tool heartbeat', () => {
  it('atomically creates and replaces progress for shell and non-shell completions only', async () => {
    const run = resolve(root, 'run');
    vi.stubEnv('EMPIRES_RUN_DIR', run);
    const { before, after } = await registered();
    const target = resolve(run, 'tool-progress.json');
    await before('read', {});
    await after({ tool: 'shell', input: {}, status: 'error', error: { message: 'Refused' } });
    expect(existsSync(run)).toBe(false);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1234);
    await after({ tool: 'shell', input: {}, status: 'completed', result: {} });
    expect(JSON.parse(readFileSync(target, 'utf8'))).toEqual({ at: 1234, pid: process.pid });
    clock.mockReturnValue(5678);
    await after({ tool: 'read', input: {}, status: 'completed', result: {} });
    await after({ tool: 'read', input: {}, status: 'error', error: { message: 'failed' } });
    expect(JSON.parse(readFileSync(target, 'utf8'))).toEqual({ at: 5678, pid: process.pid });
    expect(readdirSync(run)).toEqual(['tool-progress.json']);
  });

  it('does nothing without EMPIRES_RUN_DIR', async () => {
    const { after } = await registered();
    await expect(after({ tool: 'read', input: {}, status: 'completed', result: {} })).resolves.toBeUndefined();
    expect(readdirSync(root)).toEqual([]);
  });

  it('does not hide progress write failures', async () => {
    const file = resolve(root, 'not-a-directory');
    writeFileSync(file, 'fixture');
    vi.stubEnv('EMPIRES_RUN_DIR', file);
    const { after } = await registered();
    await expect(after({ tool: 'read', input: {}, status: 'completed', result: {} })).rejects.toThrow();
  });
});

describe('harness fingerprint', () => {
  it('is stable and changes for every harness input, including the sole V2 entrypoint', () => {
    expect(helpers.harnessInputs).toContain('.opencode/plugins/safeguards.js');
    for (const path of helpers.harnessInputs) {
      mkdirSync(dirname(resolve(root, path)), { recursive: true });
      copyFileSync(resolve(source, path), resolve(root, path));
    }
    const fingerprint = helpers.harnessFingerprint(root);
    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(helpers.harnessFingerprint(root)).toBe(fingerprint);
    for (const path of helpers.harnessInputs) {
      writeFileSync(resolve(root, path), 'changed fixture');
      expect(helpers.harnessFingerprint(root), path).not.toBe(fingerprint);
      copyFileSync(resolve(source, path), resolve(root, path));
    }
    rmSync(resolve(root, '.opencode/plugins/safeguards.js'));
    expect(() => helpers.harnessFingerprint(root)).toThrow();
  });
});
