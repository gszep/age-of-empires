import { afterEach, expect, it } from 'vitest';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
async function run(fail = '', owned = false, stale = false) {
  mkdirSync('/tmp/opencode', { recursive: true });
  const root = mkdtempSync('/tmp/opencode/verify-'); roots.push(root);
  mkdirSync(join(root, '.local'));
  writeFileSync(join(root, '.local/checkpoint.latest.json'), JSON.stringify({ status: 'green', started: 1, log: 'old' }));
  mkdirSync(join(root, 'bin'));
  mkdirSync(join(root, 'public/imported/aoe2'), { recursive: true });
  writeFileSync(join(root, 'public/imported/aoe2/manifest.json'), JSON.stringify(stale ? {} : {
    playerAttributes: {}, strings: {}, water: {}, civilizations: {},
  }));
  // A local npm fixture executes no tests/builds: exercise status aggregation and receipts.
  const npm = join(root, 'bin/npm');
  writeFileSync(npm, `#!/usr/bin/env node
const fs=require('node:fs');
const script=process.argv[3];
if(script==='test:import')console.log('Ran 1 test');
fs.appendFileSync('events.jsonl',JSON.stringify({script,event:'start',at:Date.now(),open:process.env.OPEN_CONTENT_ONLY,args:process.argv.slice(4)})+'\\n');
setTimeout(()=>{
 fs.appendFileSync('events.jsonl',JSON.stringify({script,event:'end',at:Date.now()})+'\\n');
 process.exit(script===process.env.FAIL_SCRIPT?1:0);
},100);
`);
  chmodSync(npm, 0o755);
  const code = await new Promise<number | null>((done, reject) => {
    const child = spawn(process.execPath, [resolve('tools/verify.mjs'), '--full', ...(owned ? ['--owned'] : [])], {
      cwd: root, env: { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}`, FAIL_SCRIPT: fail },
      stdio: 'ignore',
    });
    child.once('error', reject); child.once('close', done);
  });
  const events = existsSync(join(root, 'events.jsonl'))
    ? readFileSync(join(root, 'events.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [];
  return { root, code, events };
}

it('runs test/build concurrently and records each successful outcome', async () => {
  const { root, code, events } = await run();
  expect(code).toBe(0);
  const receipt = JSON.parse(readFileSync(join(root, '.local/verify.ok.json'), 'utf8'));
  expect(receipt.timings.map((step: { script: string }) => step.script).sort()).toEqual(['build:public', 'test', 'test:serial']);
  expect(events.slice(0, 2).map(event => event.event)).toEqual(['start', 'start']);
  // Near-timeout simulations run alone after the parallel stage (#307), not dropped.
  const parallel = events.find(event => event.script === 'test' && event.event === 'start');
  const serial = events.find(event => event.script === 'test:serial' && event.event === 'start');
  expect(parallel.args).toEqual(['--', '--exclude', 'src/sim/ai-herding-seeds.test.ts', '--exclude', 'src/sim/ai-herding.test.ts']);
  expect(serial.args).toEqual(['--', 'src/sim/ai-herding-seeds.test.ts', 'src/sim/ai-herding.test.ts']);
  expect(serial.at).toBeGreaterThanOrEqual(Math.max(...events.filter(event => event.event === 'end' && event.script !== 'test:serial').map(event => event.at)));
  expect(existsSync(join(root, '.local/checkpoint.ok'))).toBe(false);
});

it.each(['test', 'build:public', 'test:serial', 'test:import', 'debug:smoke'])('never stamps a pass when %s fails', async fail => {
  const { root, code, events } = await run(fail, true);
  expect(code).toBe(1);
  expect(existsSync(join(root, '.local/verify.ok.json'))).toBe(false);
  expect(existsSync(join(root, '.local/checkpoint.ok'))).toBe(false);
  if (fail === 'test' || fail === 'build:public') expect(events.some(event => event.script === 'test:serial' || event.script === 'test:import')).toBe(false);
  if (fail === 'test:serial') expect(events.some(event => event.script === 'test:import')).toBe(false);
  if (fail === 'test:import') expect(events.some(event => event.script === 'debug:smoke')).toBe(false);
});

it('only stamps the owned checkpoint after every stage passes', async () => {
  const { root, code, events } = await run('', true);
  expect(code).toBe(0);
  expect(existsSync(join(root, '.local/checkpoint.ok'))).toBe(true);
  expect(events.filter(event => event.event === 'end').map(event => event.script).slice(-2)).toEqual(['test:import', 'debug:smoke']);
  expect(events.filter(event => event.event === 'start').map(event => [event.script, event.open]).sort()).toEqual([
    ['build:public', '1'], ['debug:smoke', '0'], ['test', '0'], ['test:import', '0'], ['test:serial', '0'],
  ]);
});

it('rejects a stale owned manifest before starting expensive checks', async () => {
  const { root, code, events } = await run('', true, true);
  expect(code).toBe(1);
  expect(events).toEqual([]);
  expect(existsSync(join(root, '.local/checkpoint.ok'))).toBe(false);
  const latest = JSON.parse(readFileSync(join(root, '.local/checkpoint.latest.json'), 'utf8'));
  expect(latest.status).toBe('failed: owned manifest preflight');
  expect(latest.started).toBeGreaterThan(1);
});
