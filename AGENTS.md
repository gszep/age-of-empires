# Agent execution brief

Read `docs/autonomous-plan.md`, then execute its phases in order without waiting for routine approval. Keep the implementation lean and checkpoint only working states.

## Non-negotiable boundaries

- `src/sim` is authoritative. Rendering, UI, agents, and imported assets never mutate game state directly.
- **Downloaded-content first:** before hand-authoring any gameplay value, visual, layout, icon, string, animation timing, or audio cue, inspect the patch-matched owned DAT/RMS/AI/XS, `widgetui`, graphics, localization, and sound metadata. Use the original local asset/data through a deterministic importer wherever it exists; do not redraw or eyeball an approximation merely because that is faster. Approximate only behavior or content not represented in the downloaded files, and record the evidence and discrepancy. Do not disassemble `AoE2DE_s.exe`.
- Keep a functional open fallback for users without the owned game, but do not let fallback limitations lower the fidelity of the local imported mode.
- Never commit Steam credentials, game files, converted Microsoft assets, `.local/`, `.tools/`, or `public/imported/`.
- Preserve the current Tailscale routes and Vite mobile URL. Never run `tailscale serve reset`.
- Desktop/laptop is the canonical play experience. Match AoE2DE's isometric presentation, HUD/menu layout, density, hotkeys, and pointer interactions closely. Mobile is a secondary remote-QA surface only; responsive accommodations must not distort the core design or create a separate UI.
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
