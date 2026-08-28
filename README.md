# Open Empires Lab

A deterministic, agent-native 1v1 Dark-through-Imperial-Age RTS slice with an authoritative TypeScript simulation, imported AoE2DE content, an AoE2DE-style desktop viewer, and reproducible headless evaluation.

## Play

```bash
npm install
npm run dev
```

- Public open-content build: <https://empires.gszep.com/>
- Desktop development: <http://localhost:5173/>
- Tailnet imported-content verification: <https://calcifer.tail6e864b.ts.net:5173/>

The desktop/laptop layout is canonical. Landscape Chrome on mobile scales the same complete composition for remote QA.

### Controls

- The map is 120x120 tiles, AoE2's "tiny", with each player's opening laid out
  at the distances the original's own random-map include uses: berries and
  sheep at ten tiles, gold and stone further out, and two forests of fifty-odd
  trees apiece — and a wood is solid, as in the original: something to walk
  round, or to wall with, until you have cut into it. You start with a scout,
  and you will need it: the town center sees eight tiles and your food is ten
  away.
- Left-click selects; drag-select chooses multiple units.
- Right-click ground/resources/enemies issues context-sensitive move, gather, or attack orders; right-click with a production building selected sets its rally point.
- Select a watch tower and right-click an enemy to make it concentrate fire there; right-click bare ground to release it back to choosing its own targets.
- Move the camera with arrow keys or screen edges; mouse wheel zooms; click/drag the minimap to navigate.
- `H` selects and centers the town center; `.` cycles idle villagers.
- Command-grid hotkeys are shown on buttons (`Q`, `W`, `E`… across the grid, `S` to stop). `V` turns the villager's build menu between its economic and military pages.
- `Esc` cancels placement or opens the menu; `F3` pauses; `F10` toggles the menu.
- `+` and `-` step the game speed through the original's own four settings —
  Slow, Normal, Fast and Extra Fast — and then two fast-forward steps past them
  for watching a whole match go by. The game starts at **Normal**, which is the
  setting the reference's own hotkey names call "Default": every duration in the
  data is quoted in game seconds, and Normal runs 1.5 of them a second, so a
  25-second villager arrives in about 17 real seconds. The simulation's tick
  length does not change — the speed only decides how many of the same ticks a
  second holds — so a match run fast plays out exactly as it would at any other
  speed, and replays and checksums are unaffected.
- Select a building to research what it offers: sixty-six technologies, taken from the Britons' own tech tree in the owned files. The town center has Loom and the three ages; the blacksmith has the armour and attack lines; the university has Ballistics, which is what makes your arrows lead a moving target. Markets, blacksmiths, archery ranges, stables, watch towers and everything they train are Feudal; monasteries, siege workshops, universities, castles and everything they train are Castle, as in the original. The command grid only offers what the age allows, and only what the chain before it allows: Iron Casting appears once Forging is done, not beside it.
- Fifteen of those technologies are unit upgrades, and an upgrade replaces rather than adds. Research Man-at-Arms and every militia you own becomes one, wounds and all, and the barracks stops offering the militia — through to the champion, the halberdier, the arbalester and the elite longbowman. Your buildings change with the age too: the town center goes from open timber to thatch to tile to slate.
- Select a villager to place any building — the build menu has an economic and a military page, as in the original. Select a town center to train villagers, a barracks for militia and spearmen, an archery range for archers, skirmishers and cavalry archers, a stable for scout cavalry and knights, a market for trade carts, a siege workshop for battering rams and mangonels, a monastery for monks, or a castle for longbowmen (the British unique unit). Destroy the enemy town center to win.
- Both sides play the Britons, which is the civilisation the content is imported for. A civilisation is mostly what it goes without: the Britons have no Thumb Ring, no Bloodlines, no Hussar and no Paladin, and their own tree says so — the game will not offer you what they were never given.
- A monk right-clicked onto a wounded ally heals it, and onto an enemy soldier converts it to your side — it takes between five and nine seconds, and walking out of the monk's reach loses all of that work. A mangonel's stone hurts everything it lands beside, your own soldiers included, so keep them clear.
- Right-click a trade cart onto the opponent's market to open a trade route: it loads there and banks gold each time it reaches your own market, and a longer road pays more.
- Sheep join whoever walks up to them and then stand where they are: select them
  and walk them home like any other unit — a villager sent onto one works it with a shepherd's crook. Villagers hunt with a bow, so game that is walking away still gets shot: a deer startles only when something comes within a tile, hops a short way, and then grazes for a quarter of a minute. A boar charges whoever wounds it, arrow or not, so send more than one villager. Click a carcass to see how much food is left on it, and right-click any villager onto it to help eat it.
- Gather food, wood, gold, and stone. Mills, lumber camps, and mining camps shorten the walk for the resources they accept; the town center takes all four. Farms keep food coming once the berries run out, and watch towers (stone) shoot on their own.
- Units answer selections and orders in their own voice, and the game raises the original's alerts: under attack, population capped, a farm run out, a technology or an age landing.
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

Imported Microsoft content is generated under ignored `public/imported/` and is never committed. Owners can follow the cross-platform [Steam asset setup guide](docs/owned-assets-setup.md), including Linux, macOS, and Windows/WSL2 paths. Batch results, replay files, and local tool state belong under ignored `.local/`.

## Architecture

- `src/sim/` — authoritative fixed-tick rules, economy, construction, navigation, combat, visibility, commands, checksums, and example AI
- `tools/sld_layers.py` — standalone SLD decoder for every consumed layer: the BC1 main graphics, the BC4 shadow and player-colour masks (the pinned openage decoder corrupts the heap on those), and the outline layer's own command stream
- `src/protocol/` and `schemas/` — versioned observations/actions/results and JSON Schemas
- `src/headless/` — JSONL/MCP/WebSocket strategies, match/replay runner, concurrent paired batches, and opt-in live-agent check
- `src/view/` and `src/main.ts` — observation-driven WEST HUD, dimetric renderer, fog, minimap, interactions, and replay playback
- `tools/` — deterministic local DAT/SLD/widgetui import pipeline
- `deploy/` — legally isolated open-content Cloud Run deployment and operations notes
- `docs/status.md` — delivered scope, measurements, discrepancies, and verification evidence
