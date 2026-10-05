import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// Selection only: the caller must still typecheck/build, and interpret full:true
// as the ENTIRE suite (tests:[] is not a skip). No executable config is loaded.
export const criticalTests = [
  'tools/test-selection.test.ts',
  'src/shared/checksum.test.ts',
  'src/protocol/protocol.test.ts',
];
const source = /\.[cm]?[jt]sx?$/;
const test = /\.(test|spec)\.[cm]?[jt]sx?$/;
const fixture = /(?:^|\/)(?:__[^/]+__|fixtures?|helpers?|support|generated|test-utils|test-stubs)(?:\/|\.)|(?:config|setup|test-helper)\.[cm]?[jt]sx?$/i;
const currentDocs = /^docs\/(?:status|handoff|backlog|overnight)\.md$/;
const opaqueName = /^(?:fetch|XMLHttpRequest|WebSocket|Worker|process)$/;
const ioCall = /\b(?:readFile(?:Sync)?|readdir(?:Sync)?|spawn(?:Sync)?|exec(?:File)?(?:Sync)?|fork|createRequire)\b/;
const fullSelection = reason => ({ full: true, reason, tests: [] });
const split = text => text.split('\0').filter(Boolean);
function git(root, ...args) {
  return execFileSync('git', args, {
    cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30_000, maxBuffer: 32 * 1024 * 1024,
  });
}
function checkGit(root) {
  if (resolve(git(root, 'rev-parse', '--show-toplevel').trim()) !== resolve(root))
    throw new Error('root is not the git worktree root');
  if (git(root, 'rev-parse', '--is-shallow-repository').trim() !== 'false')
    throw new Error('shallow git history');
  if (git(root, 'ls-files', '-u', '-z')) throw new Error('unmerged git index');
}

// Throws on uncertainty. selectTests turns EVERY failure into a full selection;
// never substitute HEAD~1 or report an empty diff after a failed Git command.
export function getChangedFiles(root, base = 'origin/main') {
  checkGit(root);
  const ref = git(root, 'rev-parse', '--verify', '--end-of-options', `${base}^{commit}`).trim();
  const ancestor = git(root, 'merge-base', '--all', 'HEAD', ref).trim();
  if (!/^[a-f0-9]{40,64}$/.test(ancestor)) throw new Error('ambiguous or absent merge-base');
  return [...new Set([
    ...split(git(root, 'diff', '--name-only', '--no-renames', '-z', ancestor, 'HEAD', '--')),
    ...split(git(root, 'diff', '--cached', '--name-only', '--no-renames', '-z', '--')),
    ...split(git(root, 'diff', '--name-only', '--no-renames', '-z', '--')),
    ...split(git(root, 'ls-files', '--others', '--exclude-standard', '-z')),
  ])].sort();
}

function reach(seeds, reverse) {
  const reached = new Set(seeds);
  for (const file of reached) for (const consumer of reverse.get(file) ?? []) reached.add(consumer);
  return reached;
}

function graph(root, files, seeds) {
  const configPath = resolve(root, 'tsconfig.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) throw new Error('missing or invalid tsconfig');
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  if (parsed.errors.some(error => error.code !== 18003) || parsed.projectReferences?.length)
    throw new Error('invalid tsconfig or unsupported project references');
  const reverse = new Map(), opaque = new Set(), pending = new Set(seeds);
  const cache = ts.createModuleResolutionCache(root, name => name, parsed.options);
  for (const file of pending) {
    if (!files.has(file) || !lstatSync(resolve(root, file)).isFile())
      throw new Error(`missing or non-regular source: ${file}`);
    const ast = ts.createSourceFile(file, readFileSync(resolve(root, file), 'utf8'), ts.ScriptTarget.Latest, true);
    if (ast.parseDiagnostics.length) throw new Error(`parse failure: ${file}`);
    const imports = new Set();
    function dependency(node) {
      // Vitest also accepts mock(import('./module')). Its nested import is visited.
      if (node && ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) return;
      if (!node || !ts.isStringLiteralLike(node)) throw new Error(`dynamic module dependency: ${file}`);
      imports.add(node.text);
    }
    function visit(node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier &&
          !node.isTypeOnly && !node.importClause?.isTypeOnly) dependency(node.moduleSpecifier);
      if (ts.isImportEqualsDeclaration(node) && !node.isTypeOnly && ts.isExternalModuleReference(node.moduleReference))
        dependency(node.moduleReference.expression);
      if (ts.isCallExpression(node)) {
        const name = node.expression.getText(ast);
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword || name === 'require' || name === 'require.resolve' ||
            /(?:\.|\[['"])(?:mock|doMock|unmock|doUnmock|importActual|importMock)(?:['"]\])?$/.test(name))
          dependency(node.arguments[0]);
        if (ioCall.test(name)) opaque.add(file);
      }
      // Mark global references too: aliases of fetch remain opaque. Don't mistake
      // simulation fields named `spawn` for calls to Node's subprocess API.
      // External imports below cover renamed fs/process/HTTP APIs and wrappers.
      if ((ts.isIdentifier(node) && opaqueName.test(node.text)) ||
          (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) && opaqueName.test(node.argumentExpression.text)))
        opaque.add(file);
      if (ts.isIdentifier(node) && node.text === 'require') {
        const parent = node.parent;
        const loader = ts.isPropertyAccessExpression(parent) && parent.name.text === 'resolve' ? parent : node;
        if (!ts.isCallExpression(loader.parent) || loader.parent.expression !== loader)
          throw new Error(`dynamic loader reference: ${file}`);
      }
      if (ts.isPropertyAccessExpression(node) && node.name.text === 'glob')
        throw new Error(`dynamic module discovery: ${file}`);
      if (ts.isIdentifier(node) && /^(?:eval|Function)$/.test(node.text))
        throw new Error(`dynamic code: ${file}`);
      ts.forEachChild(node, visit);
    }
    visit(ast);
    for (const specifier of imports) {
      // Only the test framework has no opaque project runtime inputs. All other
      // externals (including Node builtins) retain their downstream tests always.
      if (isBuiltin(specifier) || specifier === 'vitest') {
        if (specifier !== 'vitest') opaque.add(file);
        continue;
      }
      const found = ts.resolveModuleName(specifier, resolve(root, file), parsed.options, ts.sys, cache).resolvedModule;
      if (!found) throw new Error(`unresolved module ${specifier} from ${file}`);
      if (found.isExternalLibraryImport) { opaque.add(file); continue; }
      const local = relative(root, found.resolvedFileName).replaceAll('\\', '/');
      if (!files.has(local) || !lstatSync(resolve(root, local)).isFile())
        throw new Error(`missing or unknown dependency: ${local}`);
      if (!reverse.has(local)) reverse.set(local, new Set());
      reverse.get(local).add(file);
      if (source.test(local)) {
        if (/\.d\.[cm]?ts$/.test(local)) throw new Error(`runtime hidden by declaration: ${local}`);
        pending.add(local);
      } else if (local.endsWith('.json')) JSON.parse(readFileSync(resolve(root, local), 'utf8'));
      else opaque.add(file); // Other non-code loaders may have implicit inputs.
    }
  }
  return { reverse, opaque };
}

export async function selectTests({ root = process.cwd(), changed, base = 'origin/main', full = false, critical = criticalTests } = {}) {
  if (full) return fullSelection('requested');
  try {
    root = resolve(root);
    checkGit(root);
    changed ??= getChangedFiles(root, base);
    if (!Array.isArray(changed) || changed.some(file => typeof file !== 'string'))
      throw new Error('changed must be an array of repository-relative paths');
    const files = new Set(split(git(root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z')));
    if ([...files].some(file => test.test(file) && !/^(src|tools)\//.test(file)))
      throw new Error('test outside the supported src/tools layout');
    const tests = [...files].filter(file => /^(src|tools)\//.test(file) && test.test(file)).sort();
    if (!tests.length || critical.some(file => !tests.includes(file))) throw new Error('missing critical tests');
    for (const file of changed) {
      if (!files.has(file) || !lstatSync(resolve(root, file)).isFile())
        throw new Error(`unknown, deleted or non-regular path: ${file}`);
      if (currentDocs.test(file)) return fullSelection(`current-claims consumer: ${file}`);
      if (/^docs\/.*\.md$/.test(file)) continue;
      if (!file.startsWith('src/') || !source.test(file) || fixture.test(file))
        return fullSelection(`configuration, tool, fixture, asset or unknown input: ${file}`);
    }
    const globals = [...files].filter(file => /(?:^|\/)[^/]*config\.[cm]?[jt]s$/.test(file) || file === 'src/test-setup.ts');
    // Start with ALL tests, not just changed tests; otherwise opaque consumers and
    // broken imports in supposedly unrelated tests could silently disappear.
    const { reverse, opaque } = graph(root, files, [...tests, ...globals, ...changed.filter(file => source.test(file))]);
    const reached = reach(changed, reverse);
    if (globals.some(file => reached.has(file))) return fullSelection('global test setup/config dependency changed');
    const docs = changed.filter(file => file.endsWith('.md'));
    // With arbitrary filesystem/HTTP/process access, independence of even an
    // ordinary document is unprovable. Real-repo docs therefore usually go full.
    if (docs.length && opaque.size) return fullSelection('documentation may be consumed by opaque runtime inputs');
    const selected = new Set(critical);
    const implicit = changed.some(file => source.test(file)) ? reach(opaque, reverse) : new Set();
    for (const file of tests) if (reached.has(file) || implicit.has(file)) selected.add(file);
    return { full: false, reason: docs.length ? 'unconsumed ordinary docs; critical tests' : 'dependency graph + opaque consumers + critical tests', tests: [...selected].sort() };
  } catch (error) {
    return fullSelection(`uncertain: ${error.message}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = {};
    let json = false;
    const args = process.argv.slice(2);
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--full') options.full = true;
      else if (args[i] === '--json') json = true;
      else if (args[i] === '--base' && args[i + 1] && !args[i + 1].startsWith('--')) options.base = args[++i];
      else throw new Error('usage: node tools/test-selection.mjs [--base REF] [--full] [--json]');
    }
    const result = await selectTests(options);
    console.log(json ? JSON.stringify(result, null, 2) : `${result.full ? 'FULL' : 'SELECTED'}: ${result.reason}\n${result.tests.join('\n')}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
