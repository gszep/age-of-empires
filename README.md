# Open Empires Lab

A deterministic, agent-native 1v1 Dark-through-Imperial-Age RTS slice with an authoritative TypeScript simulation, imported AoE2DE content, an AoE2DE-style desktop viewer, and reproducible headless evaluation.

## Play

```bash
npm install
npm run dev
```

- Public open-content build: <https://empires.gszep.com/>
- Current Ysgramor solo testing: <http://localhost:5173/?solo=1> or <https://ysgramor.tail6e864b.ts.net:5173/?solo=1>
- Shared game: <http://localhost:5173/> on Ysgramor; <http://localhost:5174/> on Artemis (its local gateway joins Ysgramor).
- Tailnet imported-content verification also supports `calcifer`; both hosts are in `vite.config.ts`'s `allowedHosts`.

The installed user service already occupies port 5173. The commands above are
for a fresh standalone setup; use `npm run dev -- --port 5175` for a separate
dev server alongside the service. Current agent handoff: [docs/handoff.md](docs/handoff.md).

The desktop/laptop layout is canonical. Landscape Chrome on mobile scales the same complete composition for remote QA.

### Controls

- Every match deals one of Arabia's own biomes — the middle-eastern desert,
  two temperate greens or a Mediterranean — each with its own ground, forest,
  two forest variations and four blend terrains scattered over it in clumps, at
  the script's own percentages. Where two terrains meet the edge fades rather
  than stopping at the tile, through the reference's own blend masks; a farm
  bleeds into the ground around it the same way, and a lone tree stands on a
  patch of leaf litter.
- The map is 120x120 tiles, AoE2's "tiny", with each player's opening laid out
  at the distances the original's own random-map include uses: berries and
  sheep at ten tiles, gold and stone further out, and two forests of fifty-odd
  trees apiece — and a wood is solid, as in the original: something to walk
  round, or to wall with, until you have cut into it. You start with a scout,
  and you will need it: the town center sees eight tiles and your food is ten
  away.
- Left-click selects; drag-select chooses multiple units; shift-click adds to
  the selection and double-click takes every unit of that kind on screen.
- Right-click ground/resources/enemies issues context-sensitive move, gather, or attack orders; right-click with a production building selected sets its rally point.
- **Shift + right-click** falls in behind what a unit is already doing rather
  than replacing it, so you can lay a route or a run of jobs in one go. What is
  queued is the click, not the order it became: a waypoint onto a tree somebody
  fells meanwhile becomes a walk to where it stood.
- Select a watch tower and right-click an enemy to make it concentrate fire there; right-click bare ground to release it back to choosing its own targets.
- Move the camera with arrow keys or screen edges; mouse wheel zooms; click/drag the minimap to navigate.
- `H` selects and centers the town center; `.` cycles idle villagers.
- `Ctrl` + a letter walks your buildings of that kind one at a time, and
  `Ctrl+Shift` + the same letter selects the lot — `B` barracks, `A` archery
  range, `L` stable, `S` blacksmith, `M` market, `I` mill, `U` university,
  `V` castle, `Y` monastery, `K` siege workshop, `G` mining camp, `Z` lumber
  camp, `H` town centers, `W` wonder, `D` dock. The letters are the reference's own,
  imported from its `hotkeys.json` rather than chosen here.
- `Delete` destroys what you have selected, of your own. The town center, a
  watch tower, the monastery, the castle and the wonder ask first; everything
  else — a house, a barracks, a soldier — goes on the keypress. The list is
  the reference's own, a flag the DAT sets on exactly those five.
- Every command has a fixed cell in the fifteen-cell grid — the one the
  reference's own data gives it — and a line keeps its cell: the militia and
  the champion are both the barracks' first, Forging and Blast Furnace the
  blacksmith's first, the three ages the town center's eleventh, so nothing
  moves when a technology lands. The hotkey is the cell's letter, `Q W E R T`
  / `A S D F G` / `Z X C V B`, shown on the button: `Q` and `W` open a
  villager's economic and military build pages, `G` is stop, `Esc` is back —
  the reference's own grid layout.
- `Esc` cancels placement or opens the menu; `F3` pauses; `F10` toggles the menu.
- `F4` toggles a debug reveal of the whole map. It is strictly a view-side
  override — the simulation's fog, the AI's observation and every checksum are
  untouched, so a revealed match replays identically to a fogged one.
- **F10 → Game Settings** selects any supported map. Enter a **Seed** to
  reproduce a board, or press **Random** for a fresh seed, then **Start Game**.
  Changing a field alone leaves the current match running. The chosen map and
  seed are remembered; **Restart** repeats them. In shared play, Ysgramor
  controls these settings and Artemis sees the selected values.
- `?seed=` still works for direct links (`?seed=3` has a pond in a wood around
  tile 11,62). The first visit defaults to Arabia, seed 42; later visits use
  the last chosen setup unless the URL overrides it.
- `?map=` in the URL picks the board: `islands` (one island each, sea
  between; the shore and the water are where terrain blending shows best),
  `black-forest`, `senlac` (the real ground
  at Battle, East Sussex), `windsor` (392x392 real ground at 15 m/tile around
  Windsor Castle, the Long Walk, Snow Hill and the Thames), `painted-proof`, or nothing for Arabia. Real-ground maps
  use Environment Agency LIDAR/VOM. Asking explicitly always deals a fresh board.
- `+` and `-` step the game speed through the original's own four settings —
  Slow, Normal, Fast and Extra Fast — and then two fast-forward steps past them
  for watching a whole match go by. The game starts at **Normal**, which is the
  setting the reference's own hotkey names call "Default": every duration in the
  data is quoted in game seconds, and Normal runs 1.5 of them a second, so a
  25-second villager arrives in about 17 real seconds. The simulation's tick
  length does not change — the speed only decides how many of the same ticks a
  second holds — so a match run fast plays out exactly as it would at any other
  speed, and replays and checksums are unaffected.
- Select a building to research what it offers: technologies taken from the Britons' own tech tree in the owned files. The town center has Loom and the three ages; the blacksmith has the armour and attack lines; the university has Ballistics, which is what makes your arrows lead a moving target. Markets, blacksmiths, archery ranges and stables arrive in Feudal; monasteries, siege workshops, universities and castles in Castle. Further technologies and unit upgrades wait on the Imperial Age. The command grid only offers what the age and prerequisite chain allow: Iron Casting appears once Forging is done, not beside it.
- A unit upgrade replaces rather than adds. Research Man-at-Arms and every militia you own becomes one, wounds and all, and the barracks stops offering the militia — through to the champion, the halberdier, the arbalester and the elite longbowman. Active and waiting training entries upgrade too. Your buildings change with the age: the town center goes from open timber to thatch to tile to slate.
- A selected production building shows the active unit beside its creation percentage. Below it, consecutive **waiting** units of the same type share a portrait with a count, keeping separate batches in queue order. These counts exclude the active unit. Click a batch portrait to cancel one waiting entry and refund its cost without interrupting current progress; the active portrait cancels the current unit and starts the next. The command-grid cancel button still removes the last entry.
- Training queues may exceed available housing. A completed unit waits at **100%** with “You need to build more houses.” until population space becomes available; then it emerges and the next queued unit starts training.
- Half your villagers are women, at the odds the reference's own
  `objreplacement.json` states, each with her own art and voice; who is who is
  a view-side roll, so a replay never notices.
- Select a villager to place land and shoreline buildings — the build menu has an economic and a military page, as in the original. Select a town center to train villagers, a barracks for militia and spearmen, an archery range for archers, skirmishers and cavalry archers, a stable for scout cavalry and knights, a market for trade carts, a siege workshop for battering rams, mangonels and scorpions, a monastery for monks, a castle for longbowmen (the British unique unit), or a dock — placed across a shoreline — for fishing ships, transports, trade cogs and warships. Destroy the enemy town center to win.
- Both sides play the Britons, which is the civilisation the content is imported for. The ages, the tech tree and the civilisation all come from the owned files, so without them the open fallback plays Dark through Castle only. A civilisation is mostly what it goes without: the Britons have no Thumb Ring, no Bloodlines, no Hussar and no Paladin, and their own tree says so — the game will not offer you what they were never given.
- A monk right-clicked onto a wounded ally heals it, and onto an enemy soldier converts it to your side — it takes between five and nine seconds, and walking out of the monk's reach loses all of that work. A mangonel's stone hurts everything it lands beside, your own soldiers included, so keep them clear.
- Scorpion bolts pass through enemies in a line, sparing allies. With owned content, research Heavy Scorpion at the siege workshop in the Imperial Age to upgrade the line.
- Right-click a trade cart onto the opponent's market to open a trade route: it loads there and banks gold each time it reaches your own market, and a longer road pays more.
- On `?map=islands` the sea is full of fish. Right-click a fishing ship onto one and it works the school and banks food at the dock; a villager can cast for a fish from the beach and bank at the dock, the mill or the town center.
- The current Britons dock roster includes the Galley, Hulk, Fire Galley and Demolition Raft lines, plus Cannon Galleons in Imperial after Chemistry. **Medium Warships** upgrades the galley, fire and hulk lines together; **Heavy Warships** upgrades to Galleons and Fast Fire Ships. Demolition ships detonate in close combat. Britons have neither Carracks nor Elite Cannon Galleons.
- Board a **Transport Ship** by selecting land units and right-clicking the ship beside the coast. It carries up to **20** passengers, who still count against population. Select the loaded ship, choose **Unload (Q)**, then click the destination shore. Passengers retain carried resources; sinking the transport loses its cargo.
- From Feudal Age, select a fishing ship and use **Build Fish Trap** to place one on water. A trap costs **100 wood**, supplies **700 food**, and reserves one fishing ship while it gathers and banks at the dock. Rebuild an exhausted trap with another build order.
- A **Trade Cog** trades with another player's dock and banks the gold at your own dock, like a trade cart's sea-going counterpart.
- Shore fish spawn only beside beach tiles; start a new Islands match to apply placement changes to an older saved board.
- Killed sheep and deer lose **0.25 food per game second**, and boar lose **0.4**,
  even unattended. The example AI finishes one herd animal before killing the next.
- Sheep join whoever walks up to them and then stand where they are: select them
  and walk them home like any other unit — a villager sent onto one works it with a shepherd's crook. Villagers hunt with a bow, so game that is walking away still gets shot: a deer startles only when something comes within a tile, hops a short way, and then grazes for a quarter of a minute. A boar charges whoever wounds it, arrow or not, so send more than one villager. Click a carcass to see how much food is left on it, and right-click any villager onto it to help eat it.
- Gather food, wood, gold, and stone. Mills, lumber camps, and mining camps shorten the walk for the resources they accept; the town center takes all four. Farms keep food coming once the berries run out, and watch towers (stone) shoot on their own.
- Each farm supports one villager, including while that farmer walks back to deposit food. Sending a group onto a farm assigns surplus villagers to nearby free farms, or leaves them idle when none is available.
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

## Two-machine shared play

For solo testing against the AI on the same server, open
**<http://localhost:5173/?solo=1>** (or add `solo=1` to your usual Tailscale
link). Map and seed options work normally, e.g. `?solo=1&map=islands&seed=7`.
Remove `solo=1` to rejoin the shared match.

Ysgramor hosts one authoritative match; Artemis joins as player 2 and reads
its artwork from its own disk. Each player has their own camera, selection,
fog and HUD. The host sends snapshots on join/reconnect and ordered commands
between them; both browsers run the same simulation and compare checksums.

```bash
# Ysgramor (in place of npm run dev)
npm run shared:host

# Artemis: game code comes from Ysgramor, artwork from this public directory
MATCH_ASSETS=/path/to/local/public npm run shared:join
```

On Ysgramor open the usual `http://localhost:5173/` or existing Tailscale
link. **On Artemis open <http://localhost:5174/>**. A remote web page cannot
read the local Steam installation; the join service is what serves the local
import. It never falls back to downloading a missing texture from Ysgramor.
Base and Enhanced Graphics Pack imports both work, independently per machine.

`node tools/install-shared.mjs host` (Ysgramor) or
`node tools/install-shared.mjs join /path/to/local/public` (Artemis) installs
the user service `open-empires-shared`, starting automatically with the user
session. See [shared-play setup and checks](docs/shared-play.md).

Imported Microsoft content is generated under ignored `public/imported/` and is never committed. Owners can follow the cross-platform [Steam asset setup guide](docs/owned-assets-setup.md), including Linux, macOS, and Windows/WSL2 paths. Batch results, replay files, and local tool state belong under ignored `.local/`.

## Architecture

- `src/sim/` — authoritative fixed-tick rules, economy, construction, navigation, combat, visibility, commands, checksums, and example AI
- `tools/sld_layers.py` — standalone SLD decoder for every consumed layer: the BC1 main graphics, the BC4 shadow and player-colour masks (the pinned openage decoder corrupts the heap on those), and the outline layer's own command stream
- `src/protocol/` and `schemas/` — versioned observations/actions/results and JSON Schemas
- `src/headless/` — JSONL/MCP/WebSocket strategies, match/replay runner, concurrent paired batches, and opt-in live-agent check
- `src/view/` and `src/main.ts` — observation-driven WEST HUD, dimetric renderer, fog, minimap, interactions, and replay playback
- `src/sim/mapgen.ts` — the original's own two generator primitives, the
  biomes `Arabia.rms` rolls between, and the terrain passes that dress a board
- `tools/import_blends.py` — the terrain blend masks, decoded from
  `blendomatic_x1.dat` and grouped by the neighbour each one faces
- `tools/` — deterministic local DAT/SLD/widgetui/blendomatic/hotkey/strings/
  font import pipeline, run in that order by `tools/import_aoe2.sh`
- `deploy/` — legally isolated open-content Cloud Run deployment and operations notes
- `docs/status.md` — delivered scope, measurements and verification; `docs/ledger.md` — every approximation and its source
