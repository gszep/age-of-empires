# Agent execution brief

Read `docs/autonomous-plan.md`, then execute its phases in order without waiting for routine approval. Keep the implementation lean and checkpoint only working states.

## Non-negotiable boundaries

- `src/sim` is authoritative. Rendering, UI, agents, and imported assets never mutate game state directly.
- Use the owned DAT/RMS/AI/XS data, open-source parsers, and documented references. Do not disassemble `AoE2DE_s.exe`.
- Never commit Steam credentials, game files, converted Microsoft assets, `.local/`, `.tools/`, or `public/imported/`.
- Preserve the current Tailscale routes and Vite mobile URL. Never run `tailscale serve reset`.
- Prefer narrow maintained libraries over custom commodity infrastructure, but fixture-test them before adoption. Follow `docs/library-strategy.md`.
- Do not copy GPL/AGPL code into this MIT repository. External tools and architectural study are acceptable.
- Avoid speculative frameworks, generic abstractions, duplicate sources of truth, and tests written only to raise coverage.

## Quality gate for every checkpoint

```bash
npm test
npm run build
npm run test:import
```

Also run the relevant live/headless integration test for changed boundaries. Keep model-provider tests opt-in and use them only when validating the actual live-agent adapter; never expose credentials or make model calls for deterministic unit tests.

## Working style

- Complete one playable behavior end to end before broadening content.
- Add tests for timing, state transitions, hidden information, replay determinism, protocol compatibility, and prior regressions.
- Do not test trivial getters, static constants, or implementation details.
- Record approximations and evidence, but keep documentation concise and current; remove superseded prose.
- Commit after each phase with a clear message only when all gates pass.
- Continue autonomously unless blocked by credentials, legal ambiguity, irreversible infrastructure changes, or a product decision with materially different outcomes.
