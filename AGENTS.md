# Agent brief

Open Empires Lab: a deterministic, agent-native AoE2-compatible RTS slice.
`README.md` covers play/commands; `docs/architecture.md` the design decisions;
`docs/status.md` delivered scope and known discrepancies.

Start a work session by reading `docs/backlog.md` (what needs doing) and
`docs/lessons.md` (hard-won operational facts). An autonomous run works
through `docs/overnight.md` top to bottom, one verified item at a time. Before ending a session, write
new lessons to `docs/lessons.md` and keep `docs/backlog.md` and
`docs/status.md` truthful. These repo files are the project's memory — do not
rely on any external memory system.

## Non-negotiable boundaries

- `src/sim` is authoritative. Rendering, UI, agents, and imported assets never
  mutate game state directly.
- **Downloaded-content first:** before hand-authoring any gameplay value,
  visual, layout, icon, string, animation timing, or audio cue, inspect the
  patch-matched owned DAT/RMS/AI/XS, `widgetui`, graphics, localization, and
  sound metadata, and use the original local asset through a deterministic
  importer wherever it exists. Approximate only what the downloaded files do
  not represent, and record the evidence and discrepancy in `docs/status.md`.
  Do not disassemble `AoE2DE_s.exe`.
- Keep the open fallback functional for users without the owned game, but do
  not let its limitations lower the fidelity of the imported mode.
- Never commit Steam credentials, game files, converted Microsoft assets,
  `.local/`, `.tools/`, or `public/imported/`.
- Preserve the current Tailscale routes and Vite mobile URL. Never run
  `tailscale serve reset`.
- Desktop is the canonical play experience, matched closely to AoE2DE's
  presentation; mobile is a secondary remote-QA surface only.
- Do not copy GPL/AGPL code into this MIT repository.
- Never rebase or rewrite commits that exist on `origin/main`.

## Quality gate for every checkpoint

```bash
npm test
npm run build
npm run test:import
```

Also run the relevant live/headless integration test for changed boundaries.
Commit only when all gates pass, and always push after committing. Keep
model-provider tests opt-in.

## Facts you cannot infer from the code

- **Hot reload boundary:** edits to `src/view/{world,sprites,hud,assets}.ts`
  hot-swap into the running match; edits to `src/main.ts`, `src/sim/`,
  `src/protocol/`, or `src/view/iso.ts` force a full page reload (the live
  match still resumes via the dev-session snapshot).
- **Mask atlases are white RGB + alpha** because the renderer multiplies
  `material.color` through them. Packing any other colour breaks player
  colours/shadows silently; `test_import_aoe2.py` guards this.
- **WebGPU does not render in Node.** Automated visual checks go through the
  dev server's debug protocol (below) against a real browser; headless Chrome
  with SwiftShader works at ~4 fps.
- **Depot layout:** importer reads `AOE2DE_DEPOT_ROOT` (default
  `~/Steam/steamapps/content/app_813780`), the SteamCMD depot tree — not a
  normal game install. Pinned depot/manifest IDs live in
  `tools/aoe2-source.json`; setup guide in `docs/owned-assets-setup.md`.
- **DAT field navigation:** see the genieutils cheat-sheet in
  `tools/README.md` before touching `import_content.py` — do not guess
  attribute names.

## Visual debug protocol

With `npm run dev` running and the game open in a browser (or headless
Chrome), the dev server exposes a text-based window into the live match:

```bash
curl -s localhost:5173/__debug -d '{"type":"sim"}'                # tick, resources, entity counts
curl -s localhost:5173/__debug -d '{"type":"entities","owner":2}' # positions, activity, screen boxes, frames
curl -s localhost:5173/__debug -d '{"type":"pixels","entity":12}' # real rendered colours under an entity
curl -s localhost:5173/__debug -d '{"type":"pixels","rect":[0,0,400,300]}'
curl -s "localhost:5173/__debug/screenshot?x=0&y=0&w=800&h=600" -o shot.png
```

`pixels` returns mean colour and a dominant-colour histogram read back from
the actual canvas — use it to verify rendering changes (tints, masks,
visibility) numerically instead of asking a human to look. Prefer it over
screenshots; use the PNG endpoint only when geometry genuinely needs eyes.

## Working style

- Complete one playable behaviour end to end before broadening content. A
  production building without its trainable unit, or a mechanic without its
  feedback, is not complete — finish it or record the gap in
  `docs/backlog.md`.
- On a broad mandate, first turn it into an explicit checklist with a
  verification step per item; report unmet items rather than stopping quietly.
- Add tests for timing, state transitions, hidden information, replay
  determinism, protocol compatibility, and prior regressions — and for any
  convention that can fail silently. Do not test trivial getters or constants.
- Prefer narrow maintained libraries over custom commodity infrastructure,
  fixture-tested before adoption (`docs/library-strategy.md`).
- Keep documentation concise and current; delete superseded prose.
- Continue autonomously unless blocked by credentials, legal ambiguity,
  irreversible infrastructure changes, or a product decision with materially
  different outcomes.
