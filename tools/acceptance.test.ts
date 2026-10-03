import { afterEach, expect, it } from 'vitest';
import { selectScenarios, validReceipt } from './acceptance.mjs';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(resolve(tmpdir(), 'acceptance-runner-')); roots.push(root);
  const write = (path: string, value: string) => {
    mkdirSync(dirname(resolve(root, path)), { recursive: true });
    writeFileSync(resolve(root, path), value);
  };
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  const command = (mode: string) => [process.execPath, '-e', `require('node:fs').appendFileSync('.local/executed', '${mode}\\n')`];
  const rule = (paths: string[], mode: string, tier = 'feature') => ({ paths, tier, source: 'Synthetic runner fixture; no browser claim', commands: [command(mode)] });
  const catalog = {
    owned: rule(['src/feature'], 'owned'), fallback: rule(['src/feature'], 'fallback'),
    shared: rule(['src/shared', 'tools/new'], 'shared'),
    soak: rule(['src/renderer'], 'soak', 'endurance'), gap: rule(['src/ai'], 'gap', 'known-gap'),
  };
  const saveCatalog = () => write('tools/acceptance.json', JSON.stringify(catalog));
  write('.gitignore', '.local/\npublic/imported/\n');
  saveCatalog();
  copyFileSync(resolve('tools/acceptance.mjs'), resolve(root, 'tools/acceptance.mjs'));
  write('src/feature.ts', 'original');
  write('tools/probe_smoke.mjs', 'const age = 0;\nconst timeout = 60000;\nassert(damage > 0);\n');
  git('init', '-q'); git('add', '.');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture');
  const run = (...args: string[]) => spawnSync(process.execPath, ['tools/acceptance.mjs', ...args], { cwd: root, encoding: 'utf8', timeout: 20_000 });
  const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
  return { root, write, git, catalog, saveCatalog, run, read };
}

it('selects overlapping feature boundaries and never accepts stale, failed or different-command receipts', () => {
  expect(selectScenarios(['tools/shared-join.mjs'])).toContain('shared');
  expect(selectScenarios(['src/sim/rules.ts'])).toContain('cargo');
  expect(selectScenarios(['docs/status.md'])).toEqual([]);
  const commands = [['npx', 'tsx', 'probe.mts']];
  const receipt = { fingerprint: 'tree-assets', state: 'passed', commands };
  expect(validReceipt(receipt, 'tree-assets', commands)).toBe(true);
  expect(validReceipt(receipt, 'changed', commands)).toBe(false);
  expect(validReceipt({ ...receipt, state: 'failed' }, 'tree-assets', commands)).toBe(false);
  expect(validReceipt(receipt, 'tree-assets', [['other']])).toBe(false);
});

it('the actual CLI selects overlapping tracked/untracked boundaries, runs commands and checks current receipts', () => {
  const f = fixture();
  f.write('src/feature.ts', 'changed');
  f.write('tools/new_smoke.mjs', 'new shared fixture');
  const plan = f.run('plan', 'HEAD');
  expect(plan.status).toBe(0);
  expect(plan.stdout).toContain('Selected scenarios: owned, fallback, shared');
  expect(existsSync(resolve(f.root, '.local/executed'))).toBe(false);
  expect(f.run('check', 'HEAD').status).toBe(1); // Missing receipts must fail.
  for (const id of ['owned', 'fallback', 'shared']) expect(f.run('run', id, 'Synthetic mode commands; no clocks changed').status).toBe(0);
  expect(f.read('.local/executed')).toBe('owned\nfallback\nshared\n');
  expect(f.run('check', 'HEAD').status).toBe(0);
  f.git('add', 'tools/new_smoke.mjs');
  expect(f.run('check', 'HEAD').status).toBe(0); // Staging is not a content change.
  f.write('src/feature.ts', 'changed again');
  expect(f.run('check', 'HEAD').status).toBe(1);
});

it.each(['nonzero', 'missing-command', 'tree-change'])('the actual runner rejects %s and preserves failure evidence', mode => {
  const f = fixture();
  const code = mode === 'nonzero' ? 'process.exit(7)' : "require('node:fs').writeFileSync('src/feature.ts', 'edited during acceptance')";
  f.catalog.owned.commands = [mode === 'missing-command' ? ['oel-fixture-nonexistent-executable'] : [process.execPath, '-e', code],
    [process.execPath, '-e', "require('node:fs').writeFileSync('.local/later-command', 'executed')"]];
  f.saveCatalog();
  const result = f.run('run', 'owned', 'Intentional failure fixture');
  expect(result.status).toBe(1);
  const receipt = JSON.parse(f.read('.local/acceptance/owned.json'));
  expect(receipt.state).toBe('failed-or-tree-changed');
  expect(receipt.scope).toBe('Intentional failure fixture');
  expect(receipt.results).toHaveLength(mode === 'tree-change' ? 2 : 1);
  expect(existsSync(resolve(f.root, '.local/later-command'))).toBe(mode === 'tree-change');
  if (mode === 'nonzero') expect(receipt.results[0].status).toBe(7);
  if (mode === 'missing-command') expect(receipt.results[0].error).toContain('ENOENT');
  expect(f.run('check', 'HEAD').status).toBe(1);
});

it('asset metadata changes invalidate a real receipt, while Markdown-only edits do not', () => {
  const f = fixture();
  f.write('src/feature.ts', 'changed');
  f.write('public/imported/fixture/manifest.json', '{"scale":1}');
  for (const id of ['owned', 'fallback']) expect(f.run('run', id, 'Fixture metadata bound').status).toBe(0);
  f.write('notes.md', 'Documentation only');
  expect(f.run('check', 'HEAD').status).toBe(0);
  f.write('public/imported/fixture/manifest.json', '{"scale":2}');
  expect(f.run('check', 'HEAD').status).toBe(1);
});

it('an emptied scenario cannot produce a vacuous pass receipt', () => {
  const f = fixture();
  f.catalog.owned.commands = []; f.saveCatalog();
  expect(f.run('run', 'owned', 'No commands is not acceptance').status).toBe(1);
  const receipt = JSON.parse(f.read('.local/acceptance/owned.json'));
  expect(receipt.state).toBe('failed-or-tree-changed');
  expect(receipt.results).toEqual([]);
});

it('reports assertion removals, changed starting states/clocks, new fixtures and registry command changes', () => {
  const f = fixture();
  f.write('tools/probe_smoke.mjs', 'const age = 1;\nconst timeout = 90000;\n');
  f.write('tools/new fixture.test.ts', 'const suppliedResources = 1000;\n');
  f.catalog.owned.commands = [[process.execPath, '-e', 'process.exit(0)']]; f.saveCatalog();
  expect(f.run('plan', 'HEAD').status).toBe(0);
  const diff = f.read('.local/acceptance/scope-review.diff');
  for (const change of ['-assert(damage > 0);', '-const age = 0;', '+const age = 1;', '-const timeout = 60000;', '+const timeout = 90000;', '+const suppliedResources = 1000;', 'tools/acceptance.json']) {
    expect(diff).toContain(change);
  }
});

it('keeps endurance and known-gap tiers explicit without auto-running them, and fails unmapped checks', () => {
  const f = fixture();
  f.write('src/renderer.ts', 'changed'); f.write('src/ai.ts', 'changed'); f.write('src/unmapped.ts', 'new boundary');
  const plan = f.run('plan', 'HEAD');
  expect(plan.stdout).toContain('soak [endurance]');
  expect(plan.stdout).toContain('gap [known-gap]');
  expect(plan.stdout).toContain('Unmapped paths (require explicit verification choice): src/unmapped.ts');
  expect(existsSync(resolve(f.root, '.local/executed'))).toBe(false);
  expect(f.run('check', 'HEAD').status).toBe(1);
});
