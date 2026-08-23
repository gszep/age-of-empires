/**
 * Concurrent seeded match batches in isolated Node processes.
 *
 *   npm run batch -- --matches 16 --seed-start 1 --out .local/batches/run1
 *
 * Paired seeds: every seed runs twice with sides swapped so strategy
 * asymmetries cancel. Each match writes a result and a replayable record;
 * every record is re-simulated and checksum-verified afterwards.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { join } from 'node:path';
import { replayRecord } from './runner';
import { FALLBACK_RULES, rulesFromManifest, type GameRules } from '../sim/data';
import { existsSync } from 'node:fs';
import type { MatchRecord, MatchResult } from '../protocol/types';

interface Job {
  id: string;
  seed: number;
  p1: string;
  p2: string;
  swapped: boolean;
}

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i]?.startsWith('--') || argv[i + 1] === undefined) throw new Error(`bad argument ${argv[i]}`);
    args[argv[i].slice(2)] = argv[i + 1];
  }
  return args;
}

function runJob(job: Job, outDir: string, maxTime: string, data: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', [
      'tsx', 'src/headless/cli.ts',
      '--seed', String(job.seed),
      '--p1', job.p1,
      '--p2', job.p2,
      '--max-time', maxTime,
      '--data', data,
      '--out', join(outDir, `result-${job.id}.json`),
      '--replay', join(outDir, `replay-${job.id}.json`),
    ], { stdio: ['ignore', 'ignore', 'inherit'] });
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`match ${job.id} exited ${code}`)));
  });
}

/** Wilson 95% confidence interval for a win proportion. */
export function wilson(successes: number, trials: number): [number, number] {
  if (!trials) return [0, 1];
  const z = 1.96;
  const p = successes / trials;
  const denominator = 1 + z * z / trials;
  const centre = p + z * z / (2 * trials);
  const margin = z * Math.sqrt((p * (1 - p) + z * z / (4 * trials)) / trials);
  return [(centre - margin) / denominator, (centre + margin) / denominator];
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const matches = Number(args.matches ?? 16);
  const seedStart = Number(args['seed-start'] ?? 1);
  const p1 = args.p1 ?? 'builtin';
  const p2 = args.p2 ?? 'builtin';
  const paired = (args.paired ?? 'true') !== 'false';
  const maxTime = args['max-time'] ?? '1800';
  const outDir = args.out ?? `.local/batches/${Date.now()}`;
  const concurrency = Number(args.concurrency ?? Math.min(cpus().length, matches));
  mkdirSync(outDir, { recursive: true });

  const jobs: Job[] = [];
  const seedCount = paired ? Math.ceil(matches / 2) : matches;
  for (let i = 0; i < seedCount; i++) {
    const seed = seedStart + i;
    jobs.push({ id: `${seed}-a`, seed, p1, p2, swapped: false });
    if (paired && jobs.length < matches) jobs.push({ id: `${seed}-b`, seed, p1: p2, p2: p1, swapped: true });
  }
  jobs.length = Math.min(jobs.length, matches);

  const started = Date.now();
  const queue = [...jobs];
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (queue.length) {
      const job = queue.shift()!;
      await runJob(job, outDir, maxTime, args.data ?? 'public/imported/aoe2/manifest.json');
      console.error(`done ${job.id}`);
    }
  }));
  const wallSeconds = (Date.now() - started) / 1000;

  // Verify every record replays to identical checksums.
  const manifestPath = args.data ?? 'public/imported/aoe2/manifest.json';
  const rules: GameRules = args.data !== 'fallback' && existsSync(manifestPath)
    ? rulesFromManifest(JSON.parse(readFileSync(manifestPath, 'utf8')))
    : FALLBACK_RULES;
  let replayFailures = 0;
  let simulatedSeconds = 0;
  const outcomes: { job: Job; result: MatchResult }[] = [];
  for (const job of jobs) {
    const result = JSON.parse(readFileSync(join(outDir, `result-${job.id}.json`), 'utf8')) as MatchResult;
    const record = JSON.parse(readFileSync(join(outDir, `replay-${job.id}.json`), 'utf8')) as MatchRecord;
    const replay = replayRecord(record, rules);
    if (!replay.ok) {
      replayFailures++;
      console.error(`replay mismatch ${job.id} at tick ${replay.mismatchTick}`);
    }
    simulatedSeconds += result.timeSeconds;
    outcomes.push({ job, result });
  }

  // "p1 strategy" wins account for swapped sides in paired runs.
  const decided = outcomes.filter(o => o.result.winner);
  const strategyOneWins = decided.filter(o =>
    o.job.swapped ? o.result.winner === 2 : o.result.winner === 1).length;
  const [low, high] = wilson(strategyOneWins, decided.length);

  const summary = {
    matches: jobs.length,
    concurrency,
    paired,
    strategies: { one: p1, two: p2 },
    strategyArtifacts: {
      builtinAi: createHash('sha256').update(readFileSync('src/sim/ai.ts')).digest('hex'),
      one: createHash('sha256').update(p1).digest('hex'),
      two: createHash('sha256').update(p2).digest('hex'),
    },
    decided: decided.length,
    timeouts: outcomes.length - decided.length,
    strategyOneWins,
    strategyOneWinRate: decided.length ? strategyOneWins / decided.length : null,
    strategyOneWinRate95: [low, high],
    replayFailures,
    wallSeconds,
    simulatedSeconds,
    throughput: simulatedSeconds / wallSeconds,
    results: outcomes.map(o => ({ id: o.job.id, winner: o.result.winner ?? null, timeSeconds: o.result.timeSeconds })),
  };
  writeFileSync(join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
  if (replayFailures) process.exitCode = 1;
}

const isDirectRun = process.argv[1]?.endsWith('batch.ts');
if (isDirectRun) await main();
