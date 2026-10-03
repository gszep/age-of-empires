/** Explicit feature acceptance receipts. The ordinary gate is not a substitute. */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const registry = JSON.parse(readFileSync(resolve(root, 'tools/acceptance.json'), 'utf8'));
export function selectScenarios(files, catalog = registry) {
  return Object.entries(catalog).filter(([, rule]) => files.some(file => rule.paths.some(prefix => file.startsWith(prefix)))).map(([id]) => id);
}
export function fingerprint(directory = root) {
  const hash = createHash('sha256');
  const paths = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: directory, encoding: 'utf8' })
    .split('\0').filter(path => path && !path.endsWith('.md')).sort();
  for (const path of paths) hash.update(path).update(existsSync(resolve(directory, path)) ? readFileSync(resolve(directory, path)) : '<deleted>');
  function metadata(path) {
    if (!existsSync(path)) return;
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
      const file = resolve(path, entry.name);
      if (entry.isDirectory()) metadata(file);
      else if (entry.name.endsWith('.json')) hash.update(file.slice(directory.length)).update(readFileSync(file));
    }
  }
  metadata(resolve(directory, 'public/imported'));
  return hash.digest('hex');
}
export function validReceipt(receipt, expected, commands) {
  return receipt?.fingerprint === expected && receipt?.state === 'passed'
    && JSON.stringify(receipt.commands) === JSON.stringify(commands);
}

export function scopeReview(directory, base, untracked) {
  const tracked = execFileSync('git', ['diff', '--unified=3', base, '--', '*test*', '*smoke*', '*fixture*', 'tools/acceptance.json'],
    { cwd: directory, encoding: 'utf8' });
  // git diff ignores untracked files, even though they affect scenario selection
  // and the receipt fingerprint. Show new fixtures before they are staged too.
  const additions = untracked.filter(path => /test|smoke|fixture/.test(path)).map(path => {
    const diff = spawnSync('git', ['diff', '--no-index', '--', '/dev/null', path], { cwd: directory, encoding: 'utf8' });
    if (diff.error || ![0, 1].includes(diff.status)) throw new Error(diff.error?.message ?? diff.stderr);
    return diff.stdout;
  });
  return tracked + additions.join('');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [action, name = 'HEAD', ...note] = process.argv.slice(2);
  mkdirSync(resolve(root, '.local/acceptance'), { recursive: true });
  if (action === 'run') {
    const scenario = registry[name];
    if (!scenario) throw new Error(`Unknown scenario ${name}`);
    if (!note.length) throw new Error('Supply a scope note: changed assertions/preconditions/clocks, or explicitly none');
    const before = fingerprint();
    const results = [];
    for (const [command, ...args] of scenario.commands) {
      const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', env: process.env });
      results.push({ status: result.status, error: result.error?.message });
      if (result.status !== 0) break;
    }
    const passed = results.length > 0 && results.length === scenario.commands.length && results.every(result => result.status === 0) && before === fingerprint();
    const receipt = { fingerprint: before, commands: scenario.commands, source: scenario.source, scope: note.join(' '),
      state: passed ? 'passed' : 'failed-or-tree-changed', results, at: new Date().toISOString() };
    writeFileSync(resolve(root, `.local/acceptance/${name}.json`), JSON.stringify(receipt, null, 2));
    process.exitCode = passed ? 0 : 1;
  } else if (action === 'plan' || action === 'check') {
    const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
    const files = [...new Set([
      ...execFileSync('git', ['diff', '--name-only', '-z', name], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean),
      ...untracked,
    ])];
    const selected = selectScenarios(files);
    console.log('Selected scenarios:', selected.join(', ') || '(none in the current registry)');
    const expected = action === 'check' ? fingerprint() : undefined;
    for (const id of selected) {
      const rule = registry[id];
      let receipt; try { receipt = JSON.parse(readFileSync(resolve(root, `.local/acceptance/${id}.json`), 'utf8')); } catch {}
      console.log(`${id} [${rule.tier}]: ${rule.source}`);
      if (action === 'check' && !validReceipt(receipt, expected, rule.commands)) { console.log('  NO CURRENT PASS RECEIPT'); process.exitCode = 1; }
    }
    const uncovered = files.filter(file => /^(src|tools)\//.test(file) && !selectScenarios([file]).length);
    console.log('Unmapped paths (require explicit verification choice):', uncovered.join(', ') || '(none)');
    if (action === 'check' && uncovered.length) process.exitCode = 1;
    const scopeDiff = scopeReview(root, name, untracked);
    writeFileSync(resolve(root, '.local/acceptance/scope-review.diff'), scopeDiff);
    console.log('Review changed assertions, fixture states and clocks: .local/acceptance/scope-review.diff');
  } else throw new Error('Usage: node tools/acceptance.mjs plan|check base-ref OR run scenario scope-note');
}
