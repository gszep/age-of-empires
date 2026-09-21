/** Check the installed OpenCode's merged permissions without invoking a model. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
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
  return rules.findLast(rule => matches(rule.permission, permission) && matches(rule.pattern, pattern))?.action;
}

export function unresolvedAsks(rules) {
  // Conservative: an ask is eliminated only when a later rule covers its whole
  // domain. Do not accept one harmless sample as proof that every path is safe.
  return rules.filter((rule, i) => rule.action === 'ask' && !rules.slice(i + 1).some(later =>
    (later.permission === '*' || later.permission === rule.permission)
    && (later.pattern === '*' || later.pattern === rule.pattern)));
}

function run(command, args) {
  return execFileSync(command, args, {
    cwd: root, encoding: 'utf8', timeout: 60_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

export function preflight() {
  const agent = JSON.parse(run('opencode', ['debug', 'agent', 'build']));
  assert(Array.isArray(agent.permission), 'OpenCode did not return resolved agent permissions');
  const asks = unresolvedAsks(agent.permission);
  assert.equal(asks.length, 0, `approval rules remain: ${JSON.stringify(asks)}`);
  for (const [permission, pattern] of [
    ['bash', 'npm test'], ['bash', 'tools/gate.sh'], ['bash', 'git push'],
    ['bash', 'gh issue comment 79 --body evidence'], ['edit', `${root}src/sim/game.ts`],
    ['read', `${root}docs/overnight.md`], ['glob', '**/*.json'], ['grep', 'gather'],
    ['webfetch', 'https://opencode.ai/docs/permissions/'],
  ]) {
    assert.equal(actionFor(agent.permission, permission, pattern), 'allow', `${permission}: ${pattern}`);
  }
  for (const permission of ['question', 'doom_loop']) {
    assert.equal(actionFor(agent.permission, permission, '*'), 'deny', `${permission} must fail without a prompt`);
  }
  assert.equal(actionFor(agent.permission, 'read', `${root}.env`), 'deny');
  assert.equal(actionFor(agent.permission, 'external_directory', '/unconfigured-location/*'), 'deny');

  const depot = run('uv', ['run', '--locked', 'python', 'tools/depot.py']);
  const source = `${depot}/depot_813781/resources/_common/dat/dropsites.json`;
  assert(existsSync(source), `owned source missing: ${source}`);
  assert.equal(actionFor(agent.permission, 'external_directory', `${depot}/*`), 'allow',
    `depot is not preauthorized: ${depot}`);
  assert.equal(actionFor(agent.permission, 'read', source), 'allow');
  assert.equal(actionFor(agent.permission, 'edit', source), 'deny', 'owned source must stay read-only');
  assert.equal(actionFor(agent.permission, 'external_directory', '/tmp/opencode/*'), 'allow');
  assert.equal(actionFor(agent.permission, 'external_directory', `${homedir()}/.claude/skills/*`), 'allow');

  const repo = JSON.parse(run('gh', ['repo', 'view', '--json', 'nameWithOwner,viewerPermission']));
  assert(['ADMIN', 'MAINTAIN', 'WRITE'].includes(repo.viewerPermission), 'GitHub account lacks repository write permission');
  run('git', ['ls-remote', '--exit-code', 'origin', 'HEAD']);
  console.log(`UNATTENDED PREFLIGHT GREEN: resolved build agent has no outstanding ask rules; depot access and ${repo.nameWithOwner} authentication checked.`);
  console.log('This validates a fresh OpenCode process, not an already-running server. Restart/recreate the session after config changes, then read the owned source with the actual Read tool before starting the clock.');
  console.log(`Owned-source probe: ${source}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { preflight(); }
  catch (error) {
    console.error(`UNATTENDED PREFLIGHT FAILED: ${error.message}`);
    process.exitCode = 1;
  }
}
