# Research choices for the play-and-experiment loop

Reviewed October 5, 2026 against primary project documentation and papers. These
are useful methods, not a claim that the project implements “state of the art”.
Version-specific test guidance below matches our installed Vitest 3, rather than
assuming the latest release has the same API. The owner priorities are in
[product.md](product.md).

## Apply to the current engineering round

| Source | Useful idea | Decision and cost boundary |
| --- | --- | --- |
| [Vitest 3 parallelism/performance](https://v3.vitest.dev/guide/improving-performance.html) and [related tests](https://v3.vitest.dev/guide/cli.html#vitest-related) | File-level parallelism, profiling and import-related selection; high worker counts can bottleneck on one Vite coordinator. | Split the measured serial suite, use CPU-aware bounded workers and conservative selection. Preserve isolation. Do not assume workers parallelize individual test bodies or share a setup-module cache. Benchmark before adding sharding. |
| [Paseo's selector](https://github.com/gszep/paseo/blob/main/scripts/ci-selection.mjs) | Compiler-resolved dependency reachability, critical tests, opaque runtime consumers and full-run fallback. | Adapt the policy to this single package, not its monorepo machinery. No guessed diff base, silent unresolved imports or skipping known failures. Main/scheduled full tests remain the backstop. |
| [GitHub dependency caching](https://docs.github.com/en/actions/using-workflows/caching-dependencies-to-speed-up-workflows) | Restore downloaded packages, still install the lockfile, separate cache restoration from publication. | PRs restore; trusted main runs may publish. Do not cache node_modules or proprietary assets. Additional cache/bisect infrastructure must earn its maintenance cost. |

The suggested Paseo `docs/TESTING.md` and PR #40 were not available at review
time; the current primary source was `scripts/ci-selection.mjs`. Do not repeat
unverified before/after timings from a different repository.

## Inform the next playable scenario, not a framework rewrite

1. **Executable scenario constraints.**
   [Togelius et al., multiobjective StarCraft map exploration (2010)](https://doi.org/10.1109/ITW.2010.5593346)
   and [Smith & Mateas, answer-set PCG (2011)](https://doi.org/10.1109/TCIAIG.2011.2158545)
   motivate explicit playability measures: routes, required resources, arrival
   windows and reachable objectives. Use small deterministic checks and seeded
   experiments first; do not add an answer-set solver. Competitive fairness and
   cooperative historical asymmetry require different checks.

2. **Structured generation with validation between stages.**
   [Word2World (2024)](https://arxiv.org/abs/2405.06686) explores staged generation
   from narrative to game worlds. For us: historical accounts → sourced/inferred
   scenario description → terrain/objectives → executable checks → human play.
   Existing Ajv can validate data once a real scenario contract exists. The paper
   does not establish historical accuracy or justify an unrestricted generator.

3. **Human feedback that can be reproduced.**
   [Deep RL from human preferences (2017)](https://arxiv.org/abs/1706.03741)
   demonstrates learning from short human comparisons. Borrow the narrow lesson:
   ask concrete perceptual questions with enough context to reproduce them.
   Existing seeds, replays and the debug bridge are the first implementation;
   no reward model or video-evaluation pipeline is required to fix an animation.

4. **Geography with provenance.**
   [STAC](https://github.com/radiantearth/stac-spec) is a useful metadata reference,
   not a proposed dependency. Preserve the source, licence, CRS, geographic extent,
   resolution, retrieval/observation dates and transforms in terrain descriptors.
   Existing Windsor/Senlac imports already cover parts of this. A Vienna campaign
   still needs a verified non-British data source and explicit handling of modern
   terrain versus historical reconstructions.

## Defer until meaningful self-play is possible

[Re-evaluating Evaluation (2018)](https://arxiv.org/abs/1806.02643) and
[PSRO (2017)](https://arxiv.org/abs/1711.00832) address evaluation and strategic
diversity that a single rating can hide. Start with an opponent matchup table and
paired/held-out seeds; use [OpenSpiel](https://github.com/google-deepmind/open_spiel)
as a reference rather than importing its framework into the runtime.

[AlphaEvolve (2025)](https://arxiv.org/abs/2506.13131) is relevant to the eventual
loop of program candidates plus automatic evaluators. The prerequisite is an
environment whose measurements mean something. No evolutionary coordinator,
league, reward-learning system or campaign generator is introduced by this round.
