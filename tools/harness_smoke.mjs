/** Exercise the installed CLI's plugin hook with a local mock provider, no model/API credentials. */
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { harnessFingerprint } from './harness-safeguards.mjs';

mkdirSync('.local/harness-probes', { recursive: true });
// A failed new probe must not leave an older pass advertised as current.
rmSync('.local/harness.ok.json', { force: true });
const fingerprint = harnessFingerprint(process.cwd());
const root = mkdtempSync(resolve('.local/harness-probes/run-'));
const work = resolve(root, 'work'); mkdirSync(resolve(work, 'tools/hooks'), { recursive: true });
for (const name of ['guard_bash.sh', 'guard_commit.sh']) copyFileSync(resolve('tools/hooks', name), resolve(work, 'tools/hooks', name));
copyFileSync(resolve('tools/wait_for.sh'), resolve(work, 'tools/wait_for.sh'));
mkdirSync(resolve(work, '.opencode/plugins'), { recursive: true });
copyFileSync(resolve('tools/harness-safeguards.mjs'), resolve(work, 'tools/harness-safeguards.mjs'));
copyFileSync(resolve('.opencode/plugins/safeguards.js'), resolve(work, '.opencode/plugins/safeguards.js'));
execFileSync('git', ['init', '-q', work]);
writeFileSync(resolve(work, '.gitignore'), '.local/\ntools/\n.opencode/\n');
writeFileSync(resolve(work, 'app.ts'), 'fixture');
execFileSync('git', ['add', '.gitignore', 'app.ts'], { cwd: work });
const commit = 'git -c user.name=Fixture -c user.email=fixture@example.invalid commit -m fixture';
const gate = resolve(work, '.local/gate.ok');
const cases = [
  { id: 'bare-wait', command: 'sleep 0', refusal: 'bare sleep', commits: 0 },
  { id: 'pattern-wait', command: 'pgrep -f "^OEL_NONEXISTENT_FIXTURE_PROCESS$"', refusal: 'pgrep -f / pkill -f', commits: 0 },
  { id: 'pattern-kill', command: 'pkill -f "^OEL_NONEXISTENT_FIXTURE_PROCESS$"', refusal: 'pgrep -f / pkill -f', commits: 0 },
  { id: 'loop-wait', command: 'while false; do sleep 0; done', refusal: 'sleep loop', commits: 0 },
  { id: 'missing-gate', command: commit, refusal: 'no green gate', commits: 0 },
  { id: 'stale-gate', command: commit, refusal: 'changed since', commits: 0, prepare() {
    mkdirSync(resolve(work, '.local')); writeFileSync(gate, ''); utimesSync(gate, 1, 1);
  } },
  { id: 'fresh-gate', command: commit, commits: 1, prepare() { writeFileSync(gate, ''); } },
  { id: 'markdown-exemption', command: commit.replace('-m fixture', '-m markdown'), commits: 2, prepare() {
    rmSync(gate); writeFileSync(resolve(work, 'README.md'), 'Markdown-only fixture\n');
    execFileSync('git', ['add', 'README.md'], { cwd: work });
  } },
  { id: 'file-handle', command: 'bash tools/wait_for.sh file .local/job.exit 0 && node -p "\'file-handle-ok\'"', output: 'file-handle-ok', commits: 2, prepare() {
    writeFileSync(resolve(work, '.local/job.exit'), '0');
  } },
  { id: 'gone-handle', command: 'bash tools/wait_for.sh gone .local/absent 0 && node -p "\'gone-handle-ok\'"', output: 'gone-handle-ok', commits: 2 },
  { id: 'pid-handle', commits: 2, output: 'pid-handle-ok', prepare() {
    const job = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 250)'], { stdio: 'ignore' });
    this.command = `bash tools/wait_for.sh pid ${job.pid} 10 && node -p "'pid-handle-ok'"`;
  } },
];
let requests = 0;
const responses = [];
const outcomes = [];
const server = createServer(async (req, res) => {
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString());
  responses.push(body);
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const event = (delta, finish = null) => res.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 0,
    model: 'probe', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
  // Title/summary requests are separate from the tool-driving conversation.
  if (!body.tools?.length) { event({ content: 'Local fixture' }); event({}, 'stop'); res.end('data: [DONE]\n\n'); return; }
  const index = requests++;
  if (index > 0 && index <= cases.length) {
    const previous = cases[index - 1];
    const result = body.messages.findLast(message => message.role === 'tool' && message.tool_call_id === `call_${index - 1}`);
    const commits = Number(execFileSync('git', ['rev-list', '--count', '--all'], { cwd: work, encoding: 'utf8' }).trim());
    outcomes.push({ id: previous.id, result: result?.content, commits });
  }
  if (index < cases.length) {
    cases[index].prepare?.();
    event({ role: 'assistant', tool_calls: [{ index: 0, id: `call_${index}`, type: 'function', function: { name: 'bash',
      arguments: JSON.stringify({ command: cases[index].command, workdir: work, description: `Isolated hook fixture: ${cases[index].id}` }) } }] });
    event({}, 'tool_calls');
  } else { event({ content: 'Fixture complete.' }); event({}, 'stop'); }
  res.end('data: [DONE]\n\n');
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const config = { snapshot: false, autoupdate: false, formatter: false, lsp: false, enabled_providers: ['harness-fixture'],
  permission: { '*': 'allow' },
  provider: { 'harness-fixture': { npm: '@ai-sdk/openai-compatible', env: [],
    options: { apiKey: 'dummy', baseURL: `http://127.0.0.1:${server.address().port}/v1`, timeout: 10000 },
    models: { probe: { name: 'Local fixture', tool_call: true, limit: { context: 100000, output: 10000 } } } } } };
const child = spawn('opencode', ['run', '--model', 'harness-fixture/probe', '--format', 'json', 'Execute local hook fixtures.'], {
  cwd: work, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, HOME: root,
    XDG_DATA_HOME: resolve(root, 'data'), XDG_CONFIG_HOME: resolve(root, 'config'), XDG_CACHE_HOME: resolve(root, 'cache'),
    XDG_STATE_HOME: resolve(root, 'state'), OPENCODE_DISABLE_DEFAULT_PLUGINS: '1', OPENCODE_DISABLE_EXTERNAL_SKILLS: '1',
    OPENCODE_AUTH_CONTENT: '{}', OPENCODE_CONFIG_CONTENT: JSON.stringify(config) },
});
let output = '', errors = '';
child.stdout.on('data', bytes => output += bytes); child.stderr.on('data', bytes => errors += bytes);
const watchdog = setTimeout(() => { try { process.kill(-child.pid, 'SIGTERM'); } catch {} }, 60000);
try {
  const [code] = await once(child, 'exit');
  writeFileSync(resolve(root, 'stdout.jsonl'), output); writeFileSync(resolve(root, 'stderr.log'), errors);
   writeFileSync(resolve(root, 'provider-messages.json'), JSON.stringify(responses, null, 2));
   writeFileSync(resolve(root, 'outcomes.json'), JSON.stringify(outcomes, null, 2));
   assert.equal(code, 0, errors);
   assert.equal(outcomes.length, cases.length, 'every fixture must execute through the installed CLI');
   for (const [index, fixture] of cases.entries()) {
     const outcome = outcomes[index];
     assert.equal(outcome.commits, fixture.commits, `${fixture.id}: actual scratch Git history`);
     assert(outcome.result !== undefined, `${fixture.id}: tool result returned to provider`);
     const text = JSON.stringify(outcome.result);
     if (fixture.refusal) assert(text.includes(fixture.refusal), `${fixture.id}: expected guard refusal, got ${text}`);
     else assert(!text.includes('Refused:'), `${fixture.id}: must be allowed`);
     if (fixture.output) assert(text.includes(fixture.output), `${fixture.id}: handle wait really completed`);
   }
   assert.equal(execFileSync('git', ['log', '-1', '--format=%s'], { cwd: work, encoding: 'utf8' }).trim(), 'markdown');
   assert.equal(readFileSync(resolve(work, 'app.ts'), 'utf8'), 'fixture');
   assert.equal(harnessFingerprint(process.cwd()), fingerprint, 'safeguards/config changed during the probe');
   writeFileSync(resolve('.local/harness.ok.json'), JSON.stringify({ fingerprint,
     version: execFileSync('opencode', ['--version'], { encoding: 'utf8' }).trim(), at: new Date().toISOString(), evidence: root,
     cases: outcomes.map(outcome => outcome.id) }));
   console.log(`HARNESS SMOKE GREEN: ${cases.length} real CLI cases; wait/missing/stale refusals, gated and Markdown commits, file/gone/PID handles; ${root}`);
} finally { clearTimeout(watchdog); server.closeAllConnections(); await new Promise(resolveDone => server.close(resolveDone)); }
