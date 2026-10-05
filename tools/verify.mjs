/** npm-owned verification; selector uncertainty runs everything, never nothing. */
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { selectTests, getChangedFiles } from './test-selection.mjs';

const args = process.argv.slice(2);
const full = args.includes('--full');
const owned = args.includes('--owned');
const testsOnly = args.includes('--tests-only');
const baseIndex = args.indexOf('--base');
const base = baseIndex < 0 ? 'origin/main' : args[baseIndex + 1];
const known = new Set(['--full', '--owned', '--tests-only', '--base']);
for (let i = 0; i < args.length; i++) {
  if (!known.has(args[i])) throw new Error(`Unknown verification option: ${args[i]}`);
  if (args[i] === '--base') {
    if (!args[++i] || args[i].startsWith('--')) throw new Error('--base requires a revision');
  }
}
if (owned && testsOnly) throw new Error('--owned includes build/import/browser checks; cannot combine with --tests-only');
const started = Date.now();
const directory = resolve('.local/verification', `${started}-${process.pid}`);
mkdirSync(directory, { recursive: true });
rmSync('.local/verify.ok.json', { force: true });
if (owned) {
  rmSync('.local/checkpoint.ok', { force: true });
  const record = status => writeFileSync('.local/checkpoint.latest.json', JSON.stringify({ status, pid: process.pid,
    started: started / 1000, updated: Date.now() / 1000, log: resolve(directory, 'result.json') }));
  record('running');
  // Fail before long simulations when this checkout has an incomplete old import.
  try {
    const manifest = JSON.parse(readFileSync('public/imported/aoe2/manifest.json', 'utf8'));
    for (const key of ['playerAttributes', 'strings', 'water', 'civilizations']) {
      if (!manifest[key]) throw new Error(`Owned import lacks ${key}; restore a complete compatible import before verification`);
    }
  } catch (error) {
    record('failed: owned manifest preflight');
    writeFileSync(resolve(directory, 'result.json'), JSON.stringify({ passed: false, started, error: error.message }));
    throw error;
  }
}
let selection = { full: true, reason: 'explicit full suite', tests: [] };
if (!full && !owned) {
  try { selection = await selectTests({ root: process.cwd(), changed: getChangedFiles(process.cwd(), base) }); }
  catch (error) { selection.reason = `uncertain selection: ${error.message}`; }
}
writeFileSync(resolve(directory, 'selection.json'), JSON.stringify(selection, null, 2));
console.log(`Verification: ${selection.reason}; ${selection.full ? 'all tests' : `${selection.tests.length} test files`}`);
const children = new Set();
const timings = [];
let interrupted = false;
const interrupt = () => {
  interrupted = true;
  for (const child of children) {
    try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGTERM'); } catch {}
  }
};
process.once('SIGINT', interrupt);
process.once('SIGTERM', interrupt);

async function step(script, extra = []) {
  const log = resolve(directory, `${script.replaceAll(':', '-')}.log`);
  const output = createWriteStream(log);
  const at = Date.now();
  console.log(`START npm run ${script}; ${log}`);
  const code = await new Promise(done => {
    const child = spawn('npm', ['run', script, ...(extra.length ? ['--', ...extra] : [])], {
      env: { ...process.env, OPEN_CONTENT_ONLY: script === 'build:public' ? '1' : '0' }, stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    children.add(child);
    child.stdout.pipe(output, { end: false });
    child.stderr.pipe(output, { end: false });
    child.once('error', error => { output.write(String(error)); done(1); });
    child.once('close', code => { children.delete(child); done(code ?? 1); });
  });
  await new Promise(done => output.end(done));
  const seconds = (Date.now() - at) / 1000;
  timings.push({ script, seconds, code, log });
  console.log(`${code === 0 ? 'PASS' : 'FAIL'} ${script}: ${seconds.toFixed(1)}s`);
  if (code !== 0) console.error(readFileSync(log, 'utf8').split('\n').slice(-35).join('\n'));
  if (script === 'test:import' && code === 0 && !/Ran [1-9][0-9]* tests?/.test(readFileSync(log, 'utf8'))) {
    console.error('Import verification collected no tests.');
    timings.at(-1).code = 1;
    return false;
  }
  return code === 0;
}

// Long fixed-window simulations near the 30 s test clock run alone after the
// parallel stage, with unchanged assertions and timeout (#307, #299): under the
// full suite's worker contention they took ~31 s versus ~17 s unloaded.
const SERIAL_TESTS = ['src/sim/ai-herding-seeds.test.ts', 'src/sim/ai-herding.test.ts'];
const serial = selection.full ? SERIAL_TESTS : selection.tests.filter(file => SERIAL_TESTS.includes(file));
const parallel = selection.full ? SERIAL_TESTS.flatMap(file => ['--exclude', file])
  : selection.tests.filter(file => !SERIAL_TESTS.includes(file));

// Independent CPU work runs together; each status is retained and must pass.
const checks = [];
if (selection.full || parallel.length) checks.push(step('test', parallel));
if (!testsOnly) checks.push(step('build:public'));
let passed = (await Promise.all(checks)).every(Boolean) && !interrupted;
if (passed && serial.length) passed = await step('test:serial', serial);
if (owned && passed) passed = await step('test:import');
if (owned && passed) passed = await step('debug:smoke');
passed &&= !interrupted;
const seconds = (Date.now() - started) / 1000;
const receipt = { passed, started, seconds, full: selection.full, owned, base, selection, timings };
writeFileSync(resolve(directory, 'result.json'), JSON.stringify(receipt, null, 2));
if (passed) writeFileSync('.local/verify.ok.json', JSON.stringify(receipt, null, 2));
if (owned) {
  writeFileSync('.local/checkpoint.latest.json', JSON.stringify({ status: passed ? 'green' : 'failed: npm verification',
    pid: process.pid, started: started / 1000, updated: Date.now() / 1000, log: resolve(directory, 'result.json') }));
  if (passed) {
    writeFileSync('.local/checkpoint.ok', '');
    utimesSync('.local/checkpoint.ok', started / 1000, started / 1000);
  }
}
console.log(`VERIFICATION ${passed ? 'GREEN' : 'FAILED'}: ${seconds.toFixed(1)}s elapsed; ${directory}`);
process.removeListener('SIGINT', interrupt);
process.removeListener('SIGTERM', interrupt);
process.exitCode = passed ? 0 : 1;
