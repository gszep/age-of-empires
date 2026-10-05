import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

export const harnessInputs = ['tools/harness-safeguards.mjs', 'tools/hooks/guard_bash.sh', 'tools/hooks/guard_commit.sh',
  '.opencode/plugins/safeguards.js', 'tools/harness_smoke.mjs', 'tools/wait_for.sh',
  'tools/unattended_preflight.mjs', 'opencode.jsonc'];

export function harnessFingerprint(root) {
  const hash = createHash('sha256');
  for (const path of harnessInputs) hash.update(path).update('\0').update(readFileSync(resolve(root, path))).update('\0');
  return hash.digest('hex');
}

export function checkShell(root, command, cwd = root) {
  for (const script of ['guard_bash.sh', 'guard_commit.sh']) {
    const result = spawnSync('bash', [resolve(root, 'tools/hooks', script)], {
      cwd, encoding: 'utf8', input: JSON.stringify({ tool_input: { command } }), timeout: 10_000,
    });
    if (result.error || result.status !== 0) throw new Error(result.stderr || result.error?.message || `${script} failed`);
  }
}

export function recordToolProgress() {
  const run = process.env.EMPIRES_RUN_DIR;
  if (!run) return;
  mkdirSync(run, { recursive: true });
  const target = resolve(run, 'tool-progress.json');
  const temporary = `${target}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify({ at: Date.now(), pid: process.pid }));
  renameSync(temporary, target);
}
