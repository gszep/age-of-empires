import { it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { supervise } from './run-supervised.mjs';

it('bounds silent/heartbeat-only children, preserves healthy leased jobs, and records nonzero exits', async () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'supervised-'));
  const run = (name: string, script: string, deadlineMs = 1200) => supervise({ command: process.execPath,
    args: ['-e', script], directory, run: resolve(directory, name), deadlineMs, idleMs: 250, pollMs: 20, graceMs: 100 });
  try {
    expect((await run('silent', 'setInterval(()=>{},1000)')).reason).toBe('no-completed-tool');
    expect((await run('heartbeat', 'setInterval(()=>process.stdout.write("."),100)')).reason).toBe('no-completed-tool');
    expect((await run('error', 'process.exit(7)')).code).toBe(7);
    const lease = `const fs=require('fs');fs.writeFileSync(process.env.EMPIRES_RUN_DIR+'/job.json',JSON.stringify({pid:process.pid,until:Date.now()+700}));setTimeout(()=>process.exit(0),450)`;
    expect((await run('healthy', lease)).state).toBe('completed');
    expect((await run('deadline', 'setInterval(()=>{},1000)', 150)).reason).toBe('run-deadline');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
