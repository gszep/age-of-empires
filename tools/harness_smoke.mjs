/** Exercise the installed CLI's plugin hook with a local mock provider, no model/API credentials. */
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { harnessFingerprint } from './harness-safeguards.mjs';

mkdirSync('.local/harness-probes', { recursive: true });
const root = mkdtempSync(resolve('.local/harness-probes/run-'));
const work = resolve(root, 'work'); mkdirSync(resolve(work, 'tools/hooks'), { recursive: true });
for (const name of ['guard_bash.sh', 'guard_commit.sh']) copyFileSync(resolve('tools/hooks', name), resolve(work, 'tools/hooks', name));
mkdirSync(resolve(work, '.opencode/plugins'), { recursive: true });
copyFileSync(resolve('tools/harness-safeguards.mjs'), resolve(work, 'tools/harness-safeguards.mjs'));
copyFileSync(resolve('.opencode/plugins/safeguards.js'), resolve(work, '.opencode/plugins/safeguards.js'));
execFileSync('git', ['init', '-q', work]);
writeFileSync(resolve(work, '.gitignore'), '.local/\ntools/\n.opencode/\n');
writeFileSync(resolve(work, 'app.ts'), 'fixture');
execFileSync('git', ['add', '.gitignore', 'app.ts'], { cwd: work });
const commit = 'git -c user.name=Fixture -c user.email=fixture@example.invalid commit -m fixture';
const commands = ['sleep 1', commit, commit, commit];
let requests = 0;
const responses = [];
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
  if (index === 2) {
    mkdirSync(resolve(work, '.local')); writeFileSync(resolve(work, '.local/gate.ok'), '');
    utimesSync(resolve(work, '.local/gate.ok'), 1, 1);
  }
  if (index === 3) writeFileSync(resolve(work, '.local/gate.ok'), '');
  if (index < commands.length) {
    event({ role: 'assistant', tool_calls: [{ index: 0, id: `call_${index}`, type: 'function', function: { name: 'bash',
      arguments: JSON.stringify({ command: commands[index], workdir: work, description: 'Isolated hook fixture' }) } }] });
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
  const wire = JSON.stringify(responses);
  assert.equal(code, 0, errors);
  assert(wire.includes('bare sleep'), 'installed CLI must receive prohibited-wait refusal');
  assert(wire.includes('no green gate'), 'installed CLI must receive missing-gate refusal');
  assert(wire.includes('changed since'), 'installed CLI must receive stale-gate refusal');
  assert.equal(execFileSync('git', ['log', '-1', '--format=%s'], { cwd: work, encoding: 'utf8' }).trim(), 'fixture');
  assert.equal(readFileSync(resolve(work, 'app.ts'), 'utf8'), 'fixture');
  writeFileSync(resolve('.local/harness.ok.json'), JSON.stringify({ fingerprint: harnessFingerprint(process.cwd()),
    version: execFileSync('opencode', ['--version'], { encoding: 'utf8' }).trim(), at: new Date().toISOString(), evidence: root }));
  console.log(`HARNESS SMOKE GREEN: real CLI rejected wait, missing/stale gates; accepted gated scratch commit; ${root}`);
} finally { clearTimeout(watchdog); server.closeAllConnections(); await new Promise(resolveDone => server.close(resolveDone)); }
