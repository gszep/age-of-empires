/**
 * Headless match CLI.
 *
 *   npm run match -- --seed 7 --p2 builtin
 *   npm run match -- --seed 7 --p1 'cmd:python my_strategy.py' --out result.json
 *
 * Strategies: `builtin` (example AI), `idle`, or `cmd:<shell command>` for a
 * JSONL subprocess.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { FALLBACK_RULES, rulesFromManifest, type GameRules } from '../sim/data';
import { runMatch, type Strategy } from './runner';
import { builtinNoSmithStrategy, builtinStrategy, mcpStrategy, subprocessStrategy, websocketStrategy } from './strategies';
import { validateMatchConfig, explain } from '../protocol/validate';
import type { MatchConfig } from '../protocol/types';

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error(`unexpected argument: ${key ?? ''} ${value ?? ''}`.trim());
    }
    args[key.slice(2)] = value;
  }
  return args;
}

function strategyFor(name: string): Strategy {
  if (name === 'builtin') return builtinStrategy();
  if (name === 'builtin-nosmith') return builtinNoSmithStrategy();
  if (name === 'idle') return { decide: () => [] };
  if (name.startsWith('cmd:')) return subprocessStrategy(name.slice(4));
  if (name.startsWith('deadline-cmd:')) return subprocessStrategy(name.slice(13), { mode: 'deadline', deadlineMs: 100 });
  if (name.startsWith('ws:')) return websocketStrategy(name.slice(3));
  if (name.startsWith('mcp:')) return mcpStrategy({ command: 'sh', args: ['-lc', name.slice(4)] });
  throw new Error(`unknown strategy '${name}'; use builtin, idle, cmd:<shell>, deadline-cmd:<shell>, ws:<url>, or mcp:<shell>`);
}

let args: Record<string, string>;
try {
  args = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error((error as Error).message);
  console.error('usage: npm run match -- [--seed n] [--p1 builtin|idle|cmd:...] [--p2 ...] [--max-time s] [--interval s] [--out file] [--replay file]');
  process.exit(2);
}
const config: MatchConfig = { version: 1, seed: Number(args.seed ?? 1) };
if (args['max-time']) config.maxTimeSeconds = Number(args['max-time']);
if (args.interval) config.decideIntervalSeconds = Number(args.interval);
if (args.map) config.map = args.map;
if (!validateMatchConfig(config)) {
  console.error(`invalid match config ${explain(validateMatchConfig)}`);
  process.exit(2);
}

// DAT-backed rules whenever the locally imported manifest exists.
const manifestPath = args.data ?? 'public/imported/aoe2/manifest.json';
const rules: GameRules = args.data !== 'fallback' && existsSync(manifestPath)
  ? rulesFromManifest(JSON.parse(readFileSync(manifestPath, 'utf8')))
  : FALLBACK_RULES;
console.error(`rules: ${rules.origin}`);

const { result, record } = await runMatch(config, {
  1: strategyFor(args.p1 ?? 'builtin'),
  2: strategyFor(args.p2 ?? 'builtin'),
}, rules);
if (args.replay) writeFileSync(args.replay, `${JSON.stringify(record)}\n`);

const output = JSON.stringify(result, null, 2);
if (args.out) writeFileSync(args.out, `${output}\n`);
else await new Promise<void>(resolve => process.stdout.write(`${output}\n`, () => resolve()));
// Subprocess strategies keep stdin open; end explicitly once output is flushed.
process.exit(0);
