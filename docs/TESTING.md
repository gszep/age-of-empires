# Verification without losing the evening to verification

Target **1–5 minutes** for normal test/build feedback. Measure wall time on the
named machine; report failures and skips separately. Human play is part of the
[verification loop](product.md), especially for animation, transitions and visuals.

## Commands

| Command | Scope |
| --- | --- |
| `npm test -- path/to/file.test.ts` | Focused Vitest file/name selection; supports `--maxWorkers=1` |
| `npm test` | Complete JavaScript/TypeScript suite; owned branches also run when local assets exist |
| `npm run test:changed` | Conservative dependency-selected tests against `origin/main` |
| `npm run verify` | Selected tests and public typecheck/build, in parallel |
| `npm run verify -- --base REV` | Explicit comparison revision; uncertain history runs full tests |
| `npm run verify:full` | All Vitest tests and public typecheck/build, in parallel |
| `npm run test:import` | Locked Python importer/source tests; needs owned inputs for fidelity coverage |
| `npm run debug:smoke` | Real-browser gameplay checks on a private server |
| `npm run verify:owned` | Full test/build, then importer tests and browser checks; stamps the commit checkpoint only on success |

Logs, per-stage statuses and elapsed time are under
`.local/verification/`; `.local/verify.ok.json` is only written on success. The
owned checkpoint retains its start-time `.local/checkpoint.ok` stamp so later edits invalidate
it. Normal verification does not pretend to have checked owned assets or pixels.

## Selection policy

The selector uses TypeScript's parser/resolver to follow actual imports and
reexports. Critical tests always run on a selected code change. Runtime file or
process dependencies must be included conservatively; unresolved dependencies,
invalid syntax, unknown paths, deleted inputs, configuration and ambiguous Git
history select the full suite. Ordinary Markdown may take a fast path only when
it is not a tested input. The selector has adversarial fixture tests.

Typecheck/build still covers the whole application. Main pushes, scheduled runs
and manual full checks never use the changed-file selector. Selection is an
iteration optimization, not permission to suppress a known failure.

## Parallelism and fixtures

Vitest uses about one worker per physical core (at least four, at most eight; half
the logical CPUs, since SMT workers slowed 18 s simulations to ~25 s on the 6-core
verification host) with file isolation intact. Explicit `--maxWorkers` and Vitest
environment overrides remain available. Vitest schedules by file, so the economy
suite, the headless victory match and the herding seeds live in separate files;
adding workers alone cannot accelerate a single serial test. Build and test use
separate logs and both statuses must pass. Import and browser checks follow those
stages.

The two herding comparison files (`src/sim/ai-herding*.test.ts`) each run two
four-minute AI games per case: ~17 s unloaded but ~31 s under full-suite worker
contention, beyond the unchanged 30 s clock (#307). `tools/verify.mjs` therefore
excludes them from the parallel `test` stage and runs them afterwards as
`test:serial` (`vitest run --maxWorkers=1`), with the same seeds, assertions and
timeout; the stage must pass. Plain `npm test` still runs them in parallel.

Keep assertions, seeds, supported profiles and durations when restructuring.
Measure a smaller fixture before claiming it establishes the same outcome.
Module exports are not a shared-memory cache across isolated workers. Fix stale
asset/code combinations before diagnosing imported-rule test failures.

Python remains an offline boundary for DAT, image and GIS libraries, not a second
simulation. The full import uses CPU/memory-aware SLD workers (maximum 16; budget
half of available memory at an estimated 2 GiB per worker). `AOE2_IMPORT_JOBS=N`
overrides scheduling through `npm run import:aoe2`; it does not change decoder
fingerprints or guarantee linear speedup. Completed atlas jobs are checkpointed
into the cache at most every 30 s (temporary file plus atomic replace), so an
interrupted import reuses finished sheets instead of decoding them again (#298).

## Public CI

PRs classify the actual merge diff. Ordinary docs-only and draft PRs skip heavy
jobs while the stable **Public checks** result still reports. Ready PRs use
conservative selection; main and nightly runs execute all public tests and build.
Superseded PR runs cancel; main runs are retained. npm download caches are restored
by PRs and written only by successful main pushes. Every run still installs the
lockfile; node_modules and owned assets are not cached or published.

No hosted owned-content check is claimed. Browser downloads are disabled in
public CI because that workflow does not run a browser; there is no unused
browser-cache layer. Automatic failure-issue/bisection automation is deferred:
first establish stable, fast full runs rather than add another maintenance system.

## Evidence

October5 economy split, unchanged two-worker fallback runs:135.82→87.72s;98 passed
and19 skipped in both layouts, with identical test names/statuses and suite bodies.
That is a single measured suite comparison, not a full-CI performance claim.
See #299 for final integrated timings and any remaining target misses.
