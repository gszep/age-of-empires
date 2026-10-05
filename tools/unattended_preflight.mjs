/** Check the installed OpenCode's merged permissions without invoking a model. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { harnessFingerprint } from './harness-safeguards.mjs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

// OpenCode permission wildcards match across slashes; the last match wins.
function matches(pattern, value) {
  const regex = pattern.split('*').map(part => part.split('?')
    .map(literal => literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.')).join('.*');
  return new RegExp(`^${regex}$`, 's').test(value);
}

export function actionFor(rules, permission, pattern) {
  return rules.findLast(rule => matches(rule.action, permission) && matches(rule.resource, pattern))?.effect;
}

export function unresolvedAsks(rules) {
  // Conservative: an ask is eliminated only when a later rule covers its whole
  // domain. Do not accept one harmless sample as proof that every path is safe.
  return rules.filter((rule, i) => rule.effect === 'ask' && !rules.slice(i + 1).some(later =>
    (later.action === '*' || later.action === rule.action)
    && (later.resource === '*' || later.resource === rule.resource)));
}

function run(command, args) {
  return execFileSync(command, args, {
    cwd: root, encoding: 'utf8', timeout: 60_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

export function verifyHarnessReceipt(receipt, directory, version) {
  assert.equal(receipt?.fingerprint, harnessFingerprint(directory), 'Safeguards/config changed; rerun node tools/harness_smoke.mjs');
  assert.equal(receipt?.version, version, 'Installed CLI changed; rerun the harness smoke');
}

export function preflight() {
  assert(!['1', 'true'].includes(process.env.OPENCODE_PURE), 'OPENCODE_PURE disables external safeguard plugins');
  const receiptPath = resolve(root, '.local/harness.ok.json');
  assert(existsSync(receiptPath), 'Run node tools/harness_smoke.mjs: actual installed-CLI safeguard evidence required');
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  verifyHarnessReceipt(receipt, root, run('opencode', ['--version']));
  const location = `location%5Bdirectory%5D=${encodeURIComponent(root)}`;
  const response = JSON.parse(run('opencode', ['api', 'get', `/api/agent?${location}`]));
  const agent = response.data?.find(agent => agent.id === 'orchestrator');
  assert(Array.isArray(agent?.permissions), 'OpenCode did not return the resolved orchestrator; reload project configuration');
  const asks = unresolvedAsks(agent.permissions);
  assert.equal(asks.length, 0, `approval rules remain: ${JSON.stringify(asks)}`);
  for (const [permission, pattern] of [
    ['shell', 'npm test'], ['shell', 'npm run verify:owned'], ['shell', 'git push'],
    ['shell', 'gh issue comment 79 --body evidence'], ['edit', `${root}src/sim/game.ts`],
    ['read', `${root}docs/overnight.md`], ['glob', '**/*.json'], ['grep', 'gather'],
    ['webfetch', 'https://opencode.ai/v2/docs/permissions/'],
  ]) {
    assert.equal(actionFor(agent.permissions, permission, pattern), 'allow', `${permission}: ${pattern}`);
  }
  for (const permission of ['question', 'doom_loop']) {
    assert.equal(actionFor(agent.permissions, permission, '*'), 'deny', `${permission} must fail without a prompt`);
  }
  assert.equal(actionFor(agent.permissions, 'read', `${root}.env`), 'deny');
  assert.equal(actionFor(agent.permissions, 'external_directory', '/unconfigured-location/*'), 'deny');

  const depot = run('uv', ['run', '--locked', 'python', 'tools/depot.py']);
  const source = `${depot}/depot_813781/resources/_common/dat/dropsites.json`;
  assert(existsSync(source), `owned source missing: ${source}`);
  assert.equal(actionFor(agent.permissions, 'external_directory', `${depot}/*`), 'allow',
    `depot is not preauthorized: ${depot}`);
  assert.equal(actionFor(agent.permissions, 'read', source), 'allow');
  assert.equal(actionFor(agent.permissions, 'edit', source), 'deny', 'owned source must stay read-only');
  assert.equal(actionFor(agent.permissions, 'external_directory', '/tmp/opencode/*'), 'allow');
  assert.equal(actionFor(agent.permissions, 'external_directory', `${homedir()}/.claude/skills/*`), 'allow');
  verifyAgentRouting(response.data, source);

  const repo = JSON.parse(run('gh', ['repo', 'view', '--json', 'nameWithOwner,viewerPermission']));
  assert(['ADMIN', 'MAINTAIN', 'WRITE'].includes(repo.viewerPermission), 'GitHub account lacks repository write permission');
  run('git', ['ls-remote', '--exit-code', 'origin', 'HEAD']);
  console.log(`UNATTENDED PREFLIGHT GREEN: Opus coordinator / Haiku worker / Astra escalation and review resolved; depot access and ${repo.nameWithOwner} authentication checked.`);
  console.log(`Fresh-process safeguard enforcement verified ${receipt.at}: ${receipt.evidence}`);
  console.log('This validates a fresh OpenCode process, not an already-running server. Restart/recreate the session after config changes, then read the owned source with the actual Read tool before starting the clock.');
  console.log(`Owned-source probe: ${source}`);
}

export function verifyAgentRouting(agents, ownedSource) {
  const roles = {
    orchestrator: ['anthropic', 'claude-opus-5-5'],
    worker: ['anthropic', 'claude-haiku-4-5'],
    escalation: ['openai', 'gpt-6-astra'],
    reviewer: ['openai', 'gpt-6-astra'],
  };
  for (const [role, [provider, model]] of Object.entries(roles)) {
    const agent = agents.find(agent => agent.id === role);
    assert.equal(agent?.model?.providerID, provider, `${role} provider drift`);
    assert.equal(agent?.model?.id, model, `${role} model drift`);
    assert.equal(agent.mode, role === 'orchestrator' ? 'primary' : 'subagent', `${role} mode`);
    assert.deepEqual(unresolvedAsks(agent.permissions), [], `${role} has unresolved permission prompts`);
    assert.equal(actionFor(agent.permissions, 'edit', ownedSource), 'deny', `${role} can edit owned sources`);
    assert.equal(actionFor(agent.permissions, 'read', '/repo/.env'), 'deny', `${role} can read credential files`);
    assert.equal(actionFor(agent.permissions, 'subagent', 'general'), 'deny', `${role} can bypass the worker tier`);
    for (const target of ['worker', 'escalation', 'reviewer']) {
      assert.equal(actionFor(agent.permissions, 'subagent', target), role === 'orchestrator' ? 'allow' : 'deny', `${role} -> ${target}`);
    }
    if (role === 'reviewer') {
      assert.equal(actionFor(agent.permissions, 'edit', '/repo/src/main.ts'), 'deny');
      assert.equal(actionFor(agent.permissions, 'shell', 'npm test'), 'deny');
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { preflight(); }
  catch (error) {
    console.error(`UNATTENDED PREFLIGHT FAILED: ${error.message}`);
    process.exitCode = 1;
  }
}
