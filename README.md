# Open Empires Lab

A deterministic, agent-native 1v1 Dark Age RTS slice with an authoritative TypeScript simulation, imported AoE2DE content, an AoE2DE-style desktop viewer, and reproducible headless evaluation.

## Play

```bash
npm install
npm run dev
```

- Desktop: <http://localhost:5173/>
- Tailnet verification: <https://calcifer.tail6e864b.ts.net:5173/>

The desktop/laptop layout is canonical. Landscape Chrome on mobile scales the same complete composition for remote QA.

### Controls

- Left-click selects; drag-select chooses multiple units.
- Right-click ground/resources/enemies issues context-sensitive move, gather, or attack orders; right-click with a building selected sets its rally point.
- Move the camera with arrow keys or screen edges; mouse wheel zooms; click/drag the minimap to navigate.
- `H` selects and centers the town center; `.` cycles idle villagers.
- Command-grid hotkeys are shown on buttons (`Q`, `W`, `S` as applicable).
- `Esc` cancels placement or opens the menu; `F3` pauses; `F10` toggles the menu.
- Select a villager to place houses/barracks, a town center to train villagers, or a barracks to train militia. Destroy the enemy town center to win.
- Load a headless `--replay` JSON from **F10 → Load replay…**; playback verifies periodic authoritative checksums.

## Commands

```bash
npm test
npm run build
npm run import:aoe2       # local owned AoE2DE depots only
npm run test:import       # live DAT/SLD/widgetui integration
npm run match -- --seed 7 --p1 builtin --p2 idle --replay .local/match.json
npm run batch -- --matches 16 --concurrency 16 --out .local/batches/run
npm run test:live-agent   # opt-in: one bounded call using existing machine auth
```

Strategies may be `builtin`, `idle`, `cmd:<shell>`, `deadline-cmd:<shell>`, `ws:<url>`, or `mcp:<shell>`. JSONL subprocesses, WebSockets, and MCP tools all return the same versioned public commands consumed by the browser and simulation.

Imported Microsoft content is generated under ignored `public/imported/` and is never committed. Batch results, replay files, and local tool state belong under ignored `.local/`.

## Architecture

- `src/sim/` — authoritative fixed-tick rules, economy, construction, navigation, combat, visibility, commands, checksums, and example AI
- `src/protocol/` and `schemas/` — versioned observations/actions/results and JSON Schemas
- `src/headless/` — JSONL/MCP/WebSocket strategies, match/replay runner, concurrent paired batches, and opt-in live-agent check
- `src/view/` and `src/main.ts` — observation-driven WEST HUD, dimetric renderer, fog, minimap, interactions, and replay playback
- `tools/` — deterministic local DAT/SLD/widgetui import pipeline
- `docs/final-handoff.md` — delivered scope, measurements, discrepancies, and verification evidence
