/** External wall-clock/tool-progress supervisor; never relies on a model response. */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function supervise({ command, args = [], directory, run, deadlineMs, idleMs, pollMs = 1000, graceMs = 5000 }) {
  if (!(deadlineMs > 0 && idleMs > 0)) throw new Error('Positive total and idle deadlines required');
  mkdirSync(run, { recursive: true });
  if (existsSync(resolve(run, 'status.json'))) throw new Error('Run directory already used; choose a fresh run');
  const start = Date.now();
  const child = spawn(command, args, { cwd: directory, detached: true, stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, EMPIRES_RUN_DIR: run } });
  let reason, killer;
  const save = data => {
    const file = resolve(run, 'status.json');
    writeFileSync(file + '.tmp', JSON.stringify({ started: start, deadline: start + deadlineMs, pid: child.pid, ...data }, null, 2));
    renameSync(file + '.tmp', file);
  };
  const terminate = why => {
    if (reason) return;
    reason = why; save({ state: 'stopping', reason, at: Date.now() });
    try { process.kill(-child.pid, 'SIGTERM'); } catch {}
    killer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, graceMs);
  };
  save({ state: 'running' });
  const timer = setInterval(() => {
    const now = Date.now();
    if (now >= start + deadlineMs) return terminate('run-deadline');
    let progress = start;
    try {
      const at = JSON.parse(readFileSync(resolve(run, 'tool-progress.json'), 'utf8')).at;
      if (Number.isFinite(at) && at <= now) progress = Math.max(start, at);
    } catch {}
    // Explicit finite leases distinguish a healthy long local job from a stalled provider.
    let lease;
    try { lease = JSON.parse(readFileSync(resolve(run, 'job.json'), 'utf8')); } catch {}
    if (lease && Number.isInteger(lease.pid) && lease.pid > 1 && lease.until > now && lease.until <= start + deadlineMs) {
      try { process.kill(lease.pid, 0); return; } catch {}
    }
    if (now - progress >= idleMs) terminate('no-completed-tool');
  }, pollMs);
  const interrupted = () => terminate('supervisor-interrupted');
  process.once('SIGTERM', interrupted); process.once('SIGINT', interrupted);
  return new Promise(resolveDone => {
    const done = (code, signal, error) => {
      clearInterval(timer);
      // A wrapper can exit on TERM while a descendant ignores it. Keep the
      // scheduled group KILL in that case; leader exit is not group cleanup.
      if (!reason) clearTimeout(killer);
      process.removeListener('SIGTERM', interrupted); process.removeListener('SIGINT', interrupted);
      const status = { state: reason || error || code !== 0 ? 'blocked' : 'completed', reason: reason ?? error?.message,
        code, signal, finished: Date.now(), note: 'Inspect registered/detached jobs; they are not implicitly killed.' };
      save(status); resolveDone(status);
    };
    child.once('error', error => done(null, null, error));
    child.once('exit', (code, signal) => done(code, signal));
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [name, minutes, idleMinutes, command, ...args] = process.argv.slice(2);
  if (!name || !/^[a-zA-Z0-9_-]+$/.test(name) || !command) throw new Error('Usage: node tools/run-supervised.mjs name minutes idle-minutes command [args...]');
  const status = await supervise({ command, args, directory: process.cwd(), run: resolve('.local/runs', name),
    deadlineMs: Number(minutes) * 60_000, idleMs: Number(idleMinutes) * 60_000 });
  console.log(JSON.stringify(status));
  process.exitCode = status.state === 'completed' ? 0 : 1;
}
