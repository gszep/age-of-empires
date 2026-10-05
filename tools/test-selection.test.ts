import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { criticalTests, getChangedFiles, selectTests } from './test-selection.mjs';

const script = fileURLToPath(new URL('./test-selection.mjs', import.meta.url));
const critical = ['src/critical.test.ts'];
let root: string;
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function write(file: string, text = 'export const value = 1;') {
  mkdirSync(dirname(resolve(root, file)), { recursive: true });
  writeFileSync(resolve(root, file), text);
}
function commit() { git('add', '.'); git('commit', '-qm', 'fixture'); }
const select = (changed = ['src/leaf.ts']) => selectTests({ root, changed, critical });
async function expectFull(changed: string[], reason: RegExp) {
  const result = await select(changed);
  expect(result).toEqual({ full: true, tests: [], reason: expect.stringMatching(reason) });
}
beforeEach(() => {
  const scratch = resolve(tmpdir(), 'opencode');
  mkdirSync(scratch, { recursive: true });
  root = mkdtempSync(resolve(scratch, 'test-selection-'));
  git('init', '-q');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  write('.gitignore', '.local/\n*.tmp\nnode_modules/\n');
  write('tsconfig.json', JSON.stringify({ compilerOptions: { module: 'ESNext', moduleResolution: 'Bundler', resolveJsonModule: true } }));
  write('src/critical.test.ts', 'import { it } from "vitest"; it("critical", () => {});');
  write('src/leaf.ts');
  write('src/barrel.ts', 'export { value } from "./leaf";');
  write('src/affected.test.ts', 'import { value } from "./barrel";');
  write('src/unrelated.ts');
  write('src/unrelated.test.ts', 'import { value } from "./unrelated";');
  write('docs/ordinary.md', '# Ordinary documentation');
  commit();
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
});
afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); });

describe('git uncertainty and change union', () => {
  it('unions committed, staged, unstaged and untracked paths, excluding ignored files', () => {
    write('src/leaf.ts', 'export const value = 2;'); commit();
    write('src/barrel.ts', 'export * from "./leaf";'); git('add', 'src/barrel.ts');
    write('src/unrelated.ts', 'export const value = 3;');
    write('src/a space\nand newline.ts');
    write('.local/ignored.ts'); write('ignored.tmp');
    expect(getChangedFiles(root)).toEqual(['src/a space\nand newline.ts', 'src/barrel.ts', 'src/leaf.ts', 'src/unrelated.ts']);
  });
  it('uses merge-base, not the base branch tip, including for explicit --base', () => {
    const start = git('rev-parse', 'HEAD');
    git('checkout', '-qb', 'upstream'); write('src/upstream.ts'); commit();
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    git('checkout', '-qb', 'feature', start); write('src/feature.ts'); commit();
    expect(getChangedFiles(root)).toEqual(['src/feature.ts']);
    expect(getChangedFiles(root, 'upstream')).toEqual(['src/feature.ts']);
  });
  it('returns a genuinely empty diff without dropping critical checks', async () => {
    expect(getChangedFiles(root)).toEqual([]);
    expect(await selectTests({ root, critical })).toMatchObject({ full: false, tests: critical });
  });
  it('fails closed when origin/main is missing even with a valid HEAD~1', async () => {
    write('src/leaf.ts', 'export const value = 2;'); commit();
    git('update-ref', '-d', 'refs/remotes/origin/main');
    expect(() => getChangedFiles(root)).toThrow();
    expect(await selectTests({ root, critical })).toMatchObject({ full: true, tests: [] });
  });
  it('does not execute shell syntax in a base ref', async () => {
    const base = 'HEAD; touch injected';
    expect(() => getChangedFiles(root, base)).toThrow();
    expect(await selectTests({ root, base, critical })).toMatchObject({ full: true });
    expect(() => readFileSync(resolve(root, 'injected'))).toThrow();
  });
  it.each(['no repository', 'unborn HEAD', 'shallow history'])('fails closed: %s', async mode => {
    if (mode === 'shallow history') write('.git/shallow', `${git('rev-parse', 'HEAD')}\n`);
    else { rmSync(resolve(root, '.git'), { recursive: true }); if (mode === 'unborn HEAD') git('init', '-q'); }
    expect(() => getChangedFiles(root)).toThrow();
    expect(await selectTests({ root, critical })).toMatchObject({ full: true, tests: [] });
  });
  it('fails closed on unmerged index entries', async () => {
    const original = git('rev-parse', 'HEAD');
    git('checkout', '-qb', 'conflict'); write('src/leaf.ts', 'export const value = 2;'); commit();
    git('checkout', '-qb', 'other', original); write('src/leaf.ts', 'export const value = 3;'); commit();
    expect(() => git('merge', 'conflict')).toThrow();
    expect(await selectTests({ root, critical })).toMatchObject({ full: true, reason: expect.stringContaining('unmerged') });
  });
});

describe('actual reverse graph selection', () => {
  it('includes transitive reexports + critical, excludes unrelated static tests', async () => {
    expect(await select()).toEqual({ full: false, reason: expect.stringContaining('dependency graph'), tests: ['src/affected.test.ts', ...critical] });
  });
  it.each([
    'import "./leaf";', 'export * from "./leaf";',
    'void import("./leaf");', 'void import(`./leaf`);',
    'require("./leaf");', 'require.resolve("./leaf");', 'import leaf = require("./leaf");',
    'vi.mock("./leaf");', 'vi.doMock("./leaf");', 'vi.importActual("./leaf");',
    'vi.importMock("./leaf");', 'vi.mock(import("./leaf"));',
    'import { vi as v } from "vitest"; v.mock("./leaf");', 'vi["mock"]("./leaf");',
  ])('traces %s', async text => {
    write('src/barrel.ts', text);
    expect((await select()).tests).toEqual(['src/affected.test.ts', ...critical]);
    expect((await select()).full).toBe(false);
  });
  it('uses TS extends/paths resolution, JS extension substitution, directory indexes and cycles', async () => {
    write('tsconfig.base.json', JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@leaf': ['src/leaf.ts'] } } }));
    write('tsconfig.json', '{"extends":"./tsconfig.base.json","compilerOptions":{"moduleResolution":"Bundler","module":"ESNext"}}');
    write('src/barrel.ts', 'export * from "./directory";');
    write('src/directory/index.ts', 'export * from "@leaf"; export * from "../cycle.js";');
    write('src/cycle.ts', 'export * from "./directory";');
    expect((await select()).tests).toEqual(['src/affected.test.ts', ...critical]);
    expect((await select()).full).toBe(false);
  });
  it('selects a changed test itself and does not blanket-full sim changes', async () => {
    expect((await select(['src/affected.test.ts'])).tests).toEqual(['src/affected.test.ts', ...critical]);
    write('src/sim/leaf.ts'); write('src/sim/leaf.test.ts', 'import "./leaf";');
    expect(await select(['src/sim/leaf.ts'])).toMatchObject({ full: false, tests: [...critical, 'src/sim/leaf.test.ts'] });
  });
  it('does not cache stale source graphs between calls', async () => {
    expect((await select()).tests).toContain('src/affected.test.ts');
    write('src/barrel.ts', 'export * from "./unrelated";');
    expect((await select()).tests).toEqual(critical);
  });
  it('does not mistake data fields named spawn for subprocess consumers', async () => {
    write('src/unrelated.ts', 'export const spawn = { value: 1 }; export const value = spawn.value;');
    expect(await select()).toMatchObject({ full: false, tests: ['src/affected.test.ts', ...critical] });
  });
  it('leaves type-only differences to the mandatory parent typecheck/build', async () => {
    write('src/barrel.ts', 'import type { Missing } from "./not-present"; export const value = 1;');
    expect(await select()).toMatchObject({ full: false, tests: critical });
  });
  it.each([
    'import { readFileSync as read } from "node:fs"; export const x = read("implicit");',
    'const fs = require("fs/promises"); export const x = fs.readFile("implicit");',
    'import { spawnSync as run } from "node:child_process"; export const x = run("node", ["implicit"]);',
    'import { get as request } from "node:http"; export const x = request("http://fixture");',
    'const request = fetch; export const x = request("http://fixture");',
    'export const x = globalThis["fetch"]("http://fixture");',
    'export const x = process.getBuiltinModule("fs").readFileSync("implicit");',
    'import { createRequire } from "node:module"; export const load = createRequire(import.meta.url);',
    'export const x = new Worker("implicit.js");',
  ])('always retains opaque helper downstream tests: %s', async text => {
    write('src/io.ts', text);
    write('src/io-barrel.ts', 'export * from "./io";');
    write('src/opaque.test.ts', 'import "./io-barrel";');
    expect(await select()).toMatchObject({ full: false, tests: ['src/affected.test.ts', ...critical, 'src/opaque.test.ts'] });
  });
  it('retains external library consumers even under aliased names', async () => {
    write('node_modules/opaque-lib/package.json', '{"main":"index.js"}');
    write('node_modules/opaque-lib/index.js', 'exports.read = () => {};');
    write('src/opaque.test.ts', 'import { read as loader } from "opaque-lib"; loader();');
    expect(await select()).toMatchObject({ full: false, tests: ['src/affected.test.ts', ...critical, 'src/opaque.test.ts'] });
  });
  it('does not treat a static JSON import as implicit IO, but fails full when that fixture changes', async () => {
    write('src/data.json', '{"value":1}');
    write('src/unrelated.ts', 'import data from "./data.json"; export const value = data.value;');
    expect(await select()).toMatchObject({ full: false, tests: ['src/affected.test.ts', ...critical] });
    await expectFull(['src/data.json'], /fixture/);
    write('src/data.json', '{');
    await expectFull(['src/leaf.ts'], /uncertain/);
  });
  it('discovers spec, JS, JSX, TSX and module-format tests too', async () => {
    const extra = ['src/a.spec.tsx', 'src/b.test.mts', 'tools/c.spec.mjs', 'src/d.test.jsx', 'src/e.test.cts'];
    for (const file of extra) write(file, `import "${file.startsWith('tools/') ? '../src/' : './'}leaf";`);
    expect(await select()).toMatchObject({ full: false, tests: [...extra, 'src/affected.test.ts', ...critical].sort() });
  });
});

describe('fail-full boundaries', () => {
  it.each([
    ['src/barrel.ts', 'export * from "./missing";', /unresolved/],
    ['src/barrel.ts', 'import "unknown-package";', /unresolved/],
    ['src/barrel.ts', 'export const value = ;', /parse/],
    ['src/barrel.ts', 'import(name);', /dynamic/],
    ['src/barrel.ts', 'require(name);', /dynamic/],
    ['src/barrel.ts', 'const load = require; load(name);', /dynamic/],
    ['src/barrel.ts', 'import.meta.glob("./*.ts");', /dynamic/],
    ['src/barrel.ts', 'vi.mock(name);', /dynamic/],
    ['src/barrel.ts', 'eval(code);', /dynamic/],
    ['src/barrel.ts', 'new Function(code);', /dynamic/],
    ['src/unrelated.test.ts', 'import(name);', /dynamic/],
    ['tsconfig.json', '{', /tsconfig/],
    ['tsconfig.json', '{"extends":"./missing.json"}', /tsconfig/],
    ['tsconfig.json', '{"references":[{"path":"./other"}]}', /references/],
  ])('does not hide uncertainty in %s: %s', async (file, text, reason) => {
    write(file as string, text as string);
    await expectFull(['src/leaf.ts'], reason as RegExp);
  });
  it.each(['package.json', 'package-lock.json', 'vite.config.ts', 'tools/helper.mjs', 'public/asset.png', 'src/fixtures/data.ts', 'src/test-setup.ts', 'src/maps/map.json', 'docs/current-claims.json', '.github/workflows/ci.yml', 'README.md'])('treats %s as a global input', async file => {
    write(file);
    await expectFull([file], /configuration, tool, fixture, asset or unknown/);
  });
  it('fails full for unknown paths, deleted files and renames', async () => {
    await expectFull(['src/unknown.ts'], /unknown/);
    git('mv', 'src/leaf.ts', 'src/renamed.ts');
    expect(getChangedFiles(root)).toEqual(['src/leaf.ts', 'src/renamed.ts']);
    await expectFull(getChangedFiles(root), /ENOENT|deleted/);
  });
  it('fails full for symlinked source and dependencies outside the inventory', async () => {
    rmSync(resolve(root, 'src/leaf.ts')); symlinkSync('unrelated.ts', resolve(root, 'src/leaf.ts'));
    await expectFull(['src/leaf.ts'], /non-regular/);
    rmSync(resolve(root, 'src/leaf.ts')); write('src/leaf.ts');
    write('ignored.tmp'); write('src/barrel.ts', 'import "../ignored.tmp";');
    await expectFull(['src/leaf.ts'], /unresolved|unknown dependency/);
  });
  it('requires actual critical files, never returns nonexistent paths', async () => {
    expect(await selectTests({ root, changed: ['src/leaf.ts'] })).toMatchObject({ full: true, reason: expect.stringContaining('critical') });
    rmSync(resolve(root, critical[0]));
    await expectFull(['src/leaf.ts'], /ENOENT|missing/);
  });
  it('fails full instead of overlooking tests outside the supported layout', async () => {
    write('tests/other.test.ts', 'import "../src/leaf";');
    await expectFull(['src/leaf.ts'], /outside the supported/);
  });
  it('propagates global setup and config dependencies, not only their own paths', async () => {
    for (const file of ['src/test-setup.ts', 'vite.config.ts']) {
      write(file, 'import "./' + (file.startsWith('src/') ? 'leaf' : 'src/leaf') + '";');
      await expectFull(['src/leaf.ts'], /global test setup\/config/);
      rmSync(resolve(root, file));
    }
  });
  it('only narrows ordinary docs when the complete test graph has no opaque readers', async () => {
    expect(await select(['docs/ordinary.md'])).toMatchObject({ full: false, tests: critical, reason: expect.stringContaining('unconsumed') });
    write('src/reader.test.ts', 'import { readFileSync } from "node:fs"; readFileSync(path);');
    await expectFull(['docs/ordinary.md'], /opaque/);
  });
  it.each(['status', 'handoff', 'backlog', 'overnight'])('forces full for the known current-claims document %s', async name => {
    const file = `docs/${name}.md`; write(file, '# claims');
    await expectFull([file], /current-claims/);
  });
});

describe('real CLI (selection only)', () => {
  function cli(...args: string[]) {
    return spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8' });
  }
  it('narrows the actual repository while preserving real critical and opaque consumers', async () => {
    const result = await selectTests({ root: resolve(dirname(script), '..'), changed: ['src/view/selection.ts'] });
    expect(result.full).toBe(false);
    for (const file of [...criticalTests, 'src/view/selection.test.ts', 'src/headless/headless.test.ts', 'tools/run-supervised.test.ts'])
      expect(result.tests).toContain(file);
    expect(result.tests).not.toContain('src/view/hotkeys.test.ts');
  });
  it('prints full JSON without requiring Git or running tests', () => {
    rmSync(resolve(root, '.git'), { recursive: true });
    const result = cli('--full', '--json');
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ full: true, reason: 'requested', tests: [] });
  });
  it('uses the caller cwd and explicit --base, never executes selected tests', () => {
    for (const file of criticalTests) write(file, 'throw new Error("must never execute");');
    commit();
    const base = git('rev-parse', 'HEAD');
    write('src/leaf.ts', 'export const value = 2;'); commit();
    const result = cli('--base', base, '--json');
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ full: false, tests: [...criticalTests, 'src/affected.test.ts'].sort() });
    expect(cli('--base', 'missing', '--json').stdout).toContain('"full": true');
    expect(cli('--full').stdout).toBe('FULL: requested\n\n');
  });
  it.each([['--base'], ['--wat'], ['--base', '--json']])('rejects invalid arguments %s', (...args) => {
    const result = cli(...args);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('usage:');
  });
});
