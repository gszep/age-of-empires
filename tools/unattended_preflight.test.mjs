import { test } from 'vitest';
import assert from 'node:assert/strict';
import { actionFor, unresolvedAsks, verifyHarnessReceipt, verifyAgentRouting } from './unattended_preflight.mjs';
import { harnessFingerprint, harnessInputs } from './harness-safeguards.mjs';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';

test('default external ask is superseded by deny with a narrow depot exception', () => {
  const rules = [
    { action: '*', resource: '*', effect: 'allow' },
    { action: 'external_directory', resource: '*', effect: 'ask' },
    { action: 'external_directory', resource: '*', effect: 'deny' },
    { action: 'external_directory', resource: '/owned/*', effect: 'allow' },
  ];
  assert.deepEqual(unresolvedAsks(rules), []);
  assert.equal(actionFor(rules, 'external_directory', '/owned/depot/dat/*'), 'allow');
  assert.equal(actionFor(rules, 'external_directory', '/unrelated/*'), 'deny');
  assert.equal(actionFor(rules, 'shell', 'git push'), 'allow');
});

test('allowing one external directory does not remove the default prompt elsewhere', () => {
  const ask = { action: 'external_directory', resource: '*', effect: 'ask' };
  assert.deepEqual(unresolvedAsks([ask,
    { action: 'external_directory', resource: '/owned/*', effect: 'allow' },
  ]), [ask]);
});

test('an inherited command-specific prompt is detected even if routine commands work', () => {
  const ask = { action: 'shell', resource: 'git push*', effect: 'ask' };
  const rules = [{ action: '*', resource: '*', effect: 'allow' }, ask];
  assert.equal(actionFor(rules, 'shell', 'npm test'), 'allow');
  assert.deepEqual(unresolvedAsks(rules), [ask]);
});

test('last matching rule wins and dotted filenames are literal', () => {
  const rules = [
    { action: 'read', resource: '*', effect: 'allow' },
    { action: 'read', resource: '*.env.*', effect: 'deny' },
    { action: 'read', resource: '*.env.example', effect: 'allow' },
  ];
  assert.equal(actionFor(rules, 'read', '/repo/.env.local'), 'deny');
  assert.equal(actionFor(rules, 'read', '/repo/.env.example'), 'allow');
  assert.equal(actionFor(rules, 'read', '/repo/a-env-local'), 'allow');
});

test('resolved routing rejects expensive fallback, nested delegation and lost source protection', () => {
  const source = '/owned/dat/source.json';
  const routing = [
    ['orchestrator', 'anthropic', 'claude-opus-5-5'],
    ['worker', 'anthropic', 'claude-haiku-4-5'],
    ['escalation', 'openai', 'gpt-6-astra'],
    ['reviewer', 'openai', 'gpt-6-astra'],
  ].map(([id, providerID, model]) => ({
    id, mode: id === 'orchestrator' ? 'primary' : 'subagent', model: { providerID, id: model },
    permissions: [
      { action: '*', resource: '*', effect: 'allow' },
      { action: 'edit', resource: '/owned/*', effect: 'deny' },
      { action: 'read', resource: '*.env', effect: 'deny' },
      { action: 'subagent', resource: '*', effect: 'deny' },
      ...(id === 'orchestrator' ? ['worker', 'escalation', 'reviewer'].map(resource => ({ action: 'subagent', resource, effect: 'allow' })) : []),
      ...(id === 'reviewer' ? ['edit', 'shell'].map(action => ({ action, resource: '*', effect: 'deny' })) : []),
    ],
  }));
  verifyAgentRouting(routing, source);
  const wrongModel = structuredClone(routing);
  wrongModel[1].model.id = 'claude-opus-5-5';
  assert.throws(() => verifyAgentRouting(wrongModel, source), /worker model drift/);
  const recursive = structuredClone(routing);
  recursive[1].permissions.push({ action: 'subagent', resource: '*', effect: 'allow' });
  assert.throws(() => verifyAgentRouting(recursive, source), /bypass/);
  const unsafe = structuredClone(routing);
  unsafe[2].permissions.push({ action: 'edit', resource: '*', effect: 'allow' });
  assert.throws(() => verifyAgentRouting(unsafe, source), /owned sources/);
});

test('enforcement evidence expires on guard, plugin, fixture, wait, preflight, config or CLI changes', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'harness-receipt-'));
  try {
    for (const path of harnessInputs) {
      mkdirSync(dirname(resolve(root, path)), { recursive: true });
      copyFileSync(resolve(path), resolve(root, path));
    }
    const receipt = { fingerprint: harnessFingerprint(root), version: 'fixture-cli' };
    verifyHarnessReceipt(receipt, root, 'fixture-cli');
    assert.throws(() => verifyHarnessReceipt(undefined, root, 'fixture-cli'), /rerun/);
    assert.throws(() => verifyHarnessReceipt(receipt, root, 'new-cli'), /CLI changed/);
    for (const path of harnessInputs) {
      const original = readFileSync(resolve(root, path));
      writeFileSync(resolve(root, path), Buffer.concat([original, Buffer.from('\n// changed')]));
      assert.throws(() => verifyHarnessReceipt(receipt, root, 'fixture-cli'), /Safeguards\/config changed/, path);
      writeFileSync(resolve(root, path), original);
    }
    verifyHarnessReceipt(receipt, root, 'fixture-cli');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
