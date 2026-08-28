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
tools/gate.sh          # npm test, npm run build, npm run test:import
```

Run it through that script rather than by hand. Piping a step to `tail` hands
`&&` the status of `tail`, which is always 0, so a broken build sails into a
commit — that happened twice in one run, once in an ad-hoc chain and once in
the first script written to replace it.

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
  attribute names. When the sheet lacks a field, ask the DAT itself:
  `.tools/import-venv/bin/python tools/datq.py fields|get|grep <expr>`,
  then extend the sheet.

## Visual debug protocol

With `npm run dev` running and the game open in a browser (or headless
Chrome), the dev server exposes a text-based window into the live match:

```bash
curl -s localhost:5173/__debug -d '{"type":"sim"}'                # tick, resources, entity counts
curl -s localhost:5173/__debug -d '{"type":"entities","owner":2}' # positions, activity, screen boxes, frames
# `entities` also reports `amount`/`resourceKind` (what is left on a node or a
# carcass) and `frame` (the sprite index actually drawn); `sim` reports
# `selected` and `flashTarget` (whose marker is blinking as the last order's
# target) — a variant or highlight question is a field to read rather than a
# screenshot to squint at.
curl -s localhost:5173/__debug -d '{"type":"entities","dead":true}'  # corpses too
curl -s localhost:5173/__debug -d '{"type":"pixels","entity":12}' # real rendered colours under an entity
curl -s localhost:5173/__debug -d '{"type":"pixels","rect":[0,0,400,300]}'
curl -s "localhost:5173/__debug/screenshot?x=0&y=0&w=800&h=600" -o shot.png
```

The same endpoint plays the match, so a state that only exists once someone
acts — a trained unit, a rally flag, a corpse — can be reached without a
human. Commands go through `applyCommand`, the public entry every strategy
uses, so nothing here reaches a state a player could not:

```bash
curl -s localhost:5173/__debug -d '{"type":"command","command":{"kind":"train","player":1,"buildingId":1,"unit":"villager"}}'
curl -s localhost:5173/__debug -d '{"type":"select","ids":[1]}'   # what the HUD shows
curl -s localhost:5173/__debug -d '{"type":"look","entity":12}'   # centre the camera
```

Two things about this endpoint that will waste an afternoon otherwise. It
broadcasts to **every** page attached to the dev server and answers with
whichever replies first, so a browser tab somebody left open on 5173 answers
from its own match — for anything you intend to *measure*, start a private Vite
server on its own port and open the only page attached to it (pass `root` and
`configFile` to `createServer`, or it takes the working directory as the
project and serves a 404). And `entities` returns at most 200 matches, which on
a 120x120 map is well short of gaia's resources.

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
- Never wait on a job with `pgrep -f`/`pkill -f` — the pattern matches the
  waiting shell's own command line, so the loop never ends (sixteen ran all
  night once). Start the job with a handle (`run_in_background`, or
  `job & echo $! > .local/job.pid`) and wait on the handle:
  `tools/wait_for.sh pid|file|gone <target> [timeout]`. A run that started
  background work ends with a hygiene pass — list what it left running, kill
  the litter, and name what deliberately survives.
- In interactive sessions, verify lightly but always: before handing a change
  over, run the tests that touch the changed code (the full gate still runs
  at commit time), and first ask what the reference implementation actually
  does — read the owned data, and search the internet when the owned files
  do not answer. If still blocked on missing information, report it to the
  human, who may provide it manually, rather than approximating.
- Prefer narrow maintained libraries over custom commodity infrastructure,
  fixture-tested before adoption (`docs/library-strategy.md`).
- Keep documentation concise and current; delete superseded prose.
- Continue autonomously unless blocked by credentials, legal ambiguity,
  irreversible infrastructure changes, or a product decision with materially
  different outcomes.
