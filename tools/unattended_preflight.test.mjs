import { test } from 'vitest';
import assert from 'node:assert/strict';
import { actionFor, unresolvedAsks } from './unattended_preflight.mjs';

test('default external ask is superseded by deny with a narrow depot exception', () => {
  const rules = [
    { permission: '*', pattern: '*', action: 'allow' },
    { permission: 'external_directory', pattern: '*', action: 'ask' },
    { permission: 'external_directory', pattern: '*', action: 'deny' },
    { permission: 'external_directory', pattern: '/owned/*', action: 'allow' },
  ];
  assert.deepEqual(unresolvedAsks(rules), []);
  assert.equal(actionFor(rules, 'external_directory', '/owned/depot/dat/*'), 'allow');
  assert.equal(actionFor(rules, 'external_directory', '/unrelated/*'), 'deny');
  assert.equal(actionFor(rules, 'bash', 'git push'), 'allow');
});

test('allowing one external directory does not remove the default prompt elsewhere', () => {
  const ask = { permission: 'external_directory', pattern: '*', action: 'ask' };
  assert.deepEqual(unresolvedAsks([ask,
    { permission: 'external_directory', pattern: '/owned/*', action: 'allow' },
  ]), [ask]);
});

test('an inherited command-specific prompt is detected even if routine commands work', () => {
  const ask = { permission: 'bash', pattern: 'git push*', action: 'ask' };
  const rules = [{ permission: '*', pattern: '*', action: 'allow' }, ask];
  assert.equal(actionFor(rules, 'bash', 'npm test'), 'allow');
  assert.deepEqual(unresolvedAsks(rules), [ask]);
});

test('last matching rule wins and dotted filenames are literal', () => {
  const rules = [
    { permission: 'read', pattern: '*', action: 'allow' },
    { permission: 'read', pattern: '*.env.*', action: 'deny' },
    { permission: 'read', pattern: '*.env.example', action: 'allow' },
  ];
  assert.equal(actionFor(rules, 'read', '/repo/.env.local'), 'deny');
  assert.equal(actionFor(rules, 'read', '/repo/.env.example'), 'allow');
  assert.equal(actionFor(rules, 'read', '/repo/a-env-local'), 'allow');
});
