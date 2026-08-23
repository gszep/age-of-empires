/**
 * Headless match CLI.
 *
 *   npm run match -- --seed 7 --p2 builtin
 *   npm run match -- --seed 7 --p1 'cmd:python my_strategy.py' --out result.json
 *
 * Strategies: `builtin` (example AI), `idle`, or `cmd:<shell command>` for a
 * JSONL subprocess.
 */
import { writeFileSync } from 'node:fs';
import { runMatch, type Strategy } from './runner';
import { builtinStrategy, subprocessStrategy } from './strategies';
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
  if (name === 'idle') return { decide: () => [] };
  if (name.startsWith('cmd:')) return subprocessStrategy(name.slice(4));
  throw new Error(`unknown strategy '${name}'; use builtin, idle, or cmd:<shell command>`);
}

let args: Record<string, string>;
try {
  args = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error((error as Error).message);
  console.error('usage: npm run match -- [--seed n] [--p1 builtin|idle|cmd:...] [--p2 ...] [--max-time s] [--interval s] [--out file]');
  process.exit(2);
}
const config: MatchConfig = { version: 1, seed: Number(args.seed ?? 1) };
if (args['max-time']) config.maxTimeSeconds = Number(args['max-time']);
if (args.interval) config.decideIntervalSeconds = Number(args.interval);
if (!validateMatchConfig(config)) {
  console.error(`invalid match config ${explain(validateMatchConfig)}`);
  process.exit(2);
}

const result = await runMatch(config, {
  1: strategyFor(args.p1 ?? 'builtin'),
  2: strategyFor(args.p2 ?? 'builtin'),
});

const output = JSON.stringify(result, null, 2);
if (args.out) writeFileSync(args.out, `${output}\n`);
else console.log(output);
process.exit(0);
