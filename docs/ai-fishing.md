# Example fishing strategy (#91)

The example AI now completes the coastal economy through public commands: place
and finish a dock, train fishing ships, work connected known fish and bank food.
It consumes only `PlayerObservation`; it never reads the authoritative map or
calls the privileged placement predicate to choose a site.

## Owned policy read (#59)

Sources are under `depot_813781/resources/_common/ai/Promisory/`. This is a
bounded reading of relevant complete rule blocks, not a full interpreter or
claim that the entire DE AI was ported. Proprietary script text stays outside Git.

| Source | Evidence used / scope |
| --- | --- |
| `buildings.per`820–900,6380–6577 | Dock placement searches and checks buildability; fishing/water goals authorize a first dock, while wood economy and military pressure can defer it. |
| `units.per`2980–3121,12504–12509 | Conditional4/8/12-boat branches, population/resource guards, and actual `train fishing-ship` action. The local fixed cap4 is a bounded adaptation, not all those branches. |
| `watercontrol.per`1–90 | Ocean fish may be14 tiles farther than shore fish;25-tile dock-centred search; a fishing ship can explore when nearby deep fish is absent. |
| `gatherers.per`1450–1584 | Fishing can shift food-worker share toward wood, with bounded arithmetic. Existing example land-worker assignments are retained here. |
| `boarhunting.per`1–180 | Luring depends on exploration, known boar/drop-site distances and worker/food prerequisites. This read does not turn boars into ordinary gather orders. |
| `trade.per`1–175 | Escrow reset and resource/market recovery are explicit policy. No trade-policy change in this item. |
| `threats.per`1630–1719 | Military pressure and victory urgency change priorities. Naval combat/defence remains outside the small fishing adapter. |
| `researches.per`5230–5314 | Naval research is context/roster-gated, including an Antiquity branch; those technology names are not blindly added to the current profiles. |

DAT dock45 supplies150 wood,1.5-tile half-width, terrain restriction6 and hill
mode3. Fishing ship13 supplies75 wood,0.4 collision half-width, restriction13,
Dock training/button1/40 seconds. The strategy reserves those baseline prices;
the authoritative public command still charges the owner's actual rules.

## Public map contract

Observation **v8** adds `terrain`: one row of runs per map row, each run
`[length, terrainId, elevation]`. Both terrain and elevation are−1 for unexplored
tiles. Static explored ground stays known under fog; hidden neighbours never
affect run boundaries. Runs reduce the size of mostly unknown surveyed maps.
`decodeObservedTerrain` validates row coverage before the strategy uses it.
The optional TypeScript field accommodates older handcrafted fixtures; the
canonical observer always emits it. Record/result and shared-wire versions
remain unchanged because no simulation rule or command shape changed.

## Adapter decisions

- Housing, paid house/dock completion and a usable wood economy precede the
  dock. Extra camps/farms respect its wood reserve, and ship purchases account
  for already-planned wood/population spending and military-building reserves.
- Sites use explored coast, the worker's known land component, a3×3 mixed
  shore/water footprint, one-level height tolerance and coarse known-obstacle
  spacing. The best eight sites rotate on the existing three-second strategy
  clock if the public command rejects finer geometry. This is not the engine's
  `up-can-build-line` implementation.
- Fishing uses connected **known** water, not Euclidean distance across two
  lakes. Idle ships prefer nearby deep fish with the source14-tile allowance;
  a25-tile ready-dock envelope bounds work/exploration. One idle boat explores
  a known-water frontier when its component has no known fish. Working/carrying
  ships keep their simulation-managed gather/bank continuation.
- The cap is four ships including currently training boats. The example does
  not add naval attack/transport strategy, fishing traps or new technologies.
  Those broader strategy gaps remain #124/#59.

## Verification

`ai-fishing.test.ts` checks legal proposed coast across three seeds, actual paid
construction/training/gathering/deposit in fallback and owned rules, fleet-cap
spending, disconnected ponds and unchanged land-opening commands without fish.
The surveyed fixture retains the static resource memories its explored terrain
implies; the natural-opening checks below use no staged survey or stockpile.
`terrain.test.ts` checks JSON round trips, exact known values, compact unknown
rows and identical observations when hidden terrain/elevation changes.

Natural owned Node openings, player1/seeds2,3,7, first fish deposits at game
seconds693.6,752.55,644.4 with zero naval refusals. The real browser's normal
player2 AI, untouched Islands seed2, completes dock/train/deposit at601.8/822.1/
858.6 seconds in owned mode and601.8/728.6/765.1 in fallback, depositing15 food
with zero naval refusals. `tools/ai_fishing_smoke.mts` observes these transitions
without changing state, then checks real dock/ship rendering and selection.
