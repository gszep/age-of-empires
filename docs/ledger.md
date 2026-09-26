# Ledger of approximations

Every value, rule or picture in imported mode that is **not** read from the
owned files, with where it came from and where it lives. `AGENTS.md`'s
"downloaded-content first" rule requires each to be recorded here the day it
ships; a reader who wants "what is hand-authored" reads this file and nothing
else. The open fallback (`src/sim/data.ts` `FALLBACK_RULES`, the fallback
palettes in `src/view`) is hand-authored by definition and is not listed.

Source classes: **owned** — read from a file (listed only where the reading
is the approximation); **engine** — behaviour the closed runtime has and the
files do not state; **inferred** — from memory of the game or its community
references, unverified against a file; **human** — a number the human read
off the reference; **measured** — fitted to a reference screenshot;
**chosen** — the agent's own number.

## Civilisation roster / selection foundation (#122)

- **Owned:** identity, era, HUD family, display/computer names and emblems come
  from `civilizations.json`/localization. Typed tree nodes, including absence,
  determine availability. DAT entities, per-civ graphics, flags, icons and voices
  are extracted independently. `M` is another file-less SLP-2260 composition
  marker (Frankish garrison graph); child layers supply the art.
- **Chosen integration policy:** the 53 base-era inventory entries are not 53
  playable profiles. Extraction and enablement are separate. Reviewed DAT-keyed
  units use supported combat mechanics, not every unit with a train location.
- **Chosen UI adaptation:** two native HTML selects extend the existing map
  menu; the label is owned `IDS_MPS_CIVILIZATION`, not a reproduction of the full
  native lobby. HUD family/emblem use metadata; other families need review.
- **Inferred presentation:** captured units retain unit-local stat snapshots
  while their art/voice lookup follows the recipient profile. The shared supported
  roster includes foreign unique definitions for capture/upgrade rendering.
- **Owned alias evidence:** the palisade's completed 789 points to head 792,
  whose stack points back. Ram technology 712 (common, Dark Age 104 prerequisite)
  upgrades tree unit 1258 to the imported 35; both Briton/Frank records share
  name ID 5094, 175 HP, speed ~0.6, workshop 49, 36 seconds and button 1. The
  reviewed `treeUnitId` spec alias and reciprocal head lookup preserve these
  permissions under typed absence denial. Cuman tech 706 has different gates
  and is not enabled by this milestone. Catalogue missing IDs exclude represented
  aliases/heads, rather than calling each a missing playable unit.

## Petard, siege tower and ram crews (#131/#161/#179/#180)

- **Owned:** petard 440 trains at castle 82: HP 50, speed .8, 65 food/20 gold,
  25 seconds; attacks 26:100, 11:500, 4:25, 20:60, 22:900; blast .5, level 2.
  Tower 1105: capacity 10, speed .96, HP 175, 100 wood/120 gold, 36 seconds at
  workshop 49, no attacks. Task 14 targets class 27; XS calls it
  `cTaskTypeUnloadOverWall`, help 26445/3123 describes crossing enemy walls.
  Both civs, tasks and ram identity aliases were inspected.
- **Inferred crew constants:** living class-6 infantry adds .05 tiles/s to a
  ram/tower and 10 class-11 attack to a ram. Villagers add neither. Tower
  archers/monks can ride without speed. DAT/tasks/XS/help establish the mechanic,
  not these constants. Passenger mask 11 is inferred from the foot/mounted
  prohibition. Contributions stay live, never in conversion snapshots; #161's
  patch-matched numeric calibration remains open.
- **Inferred petard semantics:** one blast on attack contact, none on interception/
  deletion. Reuses demolition owner immunity, full damage within radius, armour/
  elevation and centre-to-target-radius resolution. This is not established by
  the DAT's numbers (including `friendly_fire_damage = 1`).
- **Chosen landing geometry:** completed enemy wall of the task class, nearest
  cardinal face, tower outside; passengers just beyond one footprint at offsets
  0/±half of its half-extent and .1 clearance. Blocked cargo retries; double walls
  cannot be jumped. Diagonal/gate crossing, cadence and ordinary egress/destruction
  retain explicit approximations.
- **Owned feedback:** death 5461 → delta 12217 → `impact_petard.json` uses
  `impact_explosions.png` frames 90..174, 85 frames, 1.5 s, scale .6, replacing
  the parent's misleading idle filename on the saved corpse clock. Tower slots/
  flags are its own. Native sound cues remain #114. See the specialist contract.

## Briton deployed research and paid production

- **Owned, 2026-09-26:** DAT technology 461/effect 540 adds blast width .5
  and sets accuracy 100 on deployed trebuchet 42, whose baseline blast is zero.
  Technology 377 addresses both packed class 51 and deployed class 54 separately;
  applying both to one attack would double Siege Engineers. The rule resolver
  retains the deployed target identity, armour, sight and search values separately.
  XS constants name blast/search attributes 22/23 and garrison firepower 130.
- **Owned:** Shipwright 373/effect 371 multiplies ship training time by .65
  and wood cost by .8; the localized description's “50% faster” is not used to
  replace the DAT multiplier. Caravan 48/effect 482 multiplies both speed and
  work by 1.2. Work now reaches trader income, and ship training reads the
  researched duration. Existing paid entries retain their original price in
  snapshots and refunds.
- **Inferred:** active paid production keeps its purchased clock; waiting
  production takes the effective duration when it begins. Legacy saves without
  price receipts refund their current rule cost because the original payment
  cannot be reconstructed. Search radius is limited by the unit's sight for
  autonomous acquisition. Existing blast geometry/damage interpretation remains
  the shared approximation; Warwolf does not introduce a second damage model.
- **Evidence:** `briton-research.test.ts` measures splash damage and projectile
  JSON continuation, actual Siege Engineers shot/range, Shipwright completion
  and cancellation after discounts/JSON. `test_briton_research.py` connects the
  consumed values to DAT effects. The published-manifest monastery browser probe
  also clicks Warwolf and verifies damage to a neighbouring unit. Its targets
  are inside the splash boundary, rather than on a floating-point boundary.

## Converted-unit inheritance (#178)

- **Owned inspection (2026-09-24):** root resolved with the main checkout's
  `tools/depot.py`. Pinned `depot_813781/resources/_common/dat/empires2_x2_p1.dat`
  Briton/Frank unit records 8/83/125 were read, including unit-local HP, speed,
  sight, attacks and terrain restriction. Longbowman 8 exists in both DAT civ
  arrays (35 HP, speed ~0.96, sight 7), independently of train availability.
  Loom effect 22 changes villager-class HP/armour; Ballistics effect 93 changes
  projectile smart-mode, not the shooter. `xs/Constants.xs` distinguishes
  `cUpgradeUnit = 3`, unit conversion modifiers, and player resources such as
  `cAttributeConvertResistance = 77`. English help 4925 says conversion changes
  player colour/control. These sources expose the data boundaries; none of
  these inspected entries specifies runtime inheritance. The shipped English
  AoK/TC PDFs were located, but text extraction is still unavailable on this
  host (`pdftotext` absent, existing #60); they are **not** claimed inspected.
- **Inferred, community-backed policy:** the AoE II section of
  <https://ageofempires.fandom.com/wiki/Conversion> (read 2026-09-24) says
  converted unit attributes lock, retain civilisation-specific properties and
  no longer receive upgrades, with exceptions for civilisation/player-side
  properties. This is not a patch-matched DE runtime measurement. `Entity`'s
  `convertedRules` snapshots resolved unit-local rules before ownership changes;
  `unitRulesForEntity` uses that snapshot, including for captured unique units
  and passengers. HP/wounds are unchanged. Future research on either side and
  later reconversions cannot promote or alter these captured unit attributes.
  Research queues/production still use the receiving player's catalogue.
- **Explicit remaining reference gaps:** player-level attributes, build/tree
  permissions, economic gather rates/capacities and projectile Ballistics
  currently follow the recipient's existing systems. The DAT's separate task
  and projectile records motivate that distinction but do not prove the closed
  runtime's conversion exceptions. Gather-task switching (villagers/fishing
  ships), projectile smart-mode,
  special future civilisation abilities, and reconversion/passenger inheritance
  still need patch-matched DE captures before claiming full parity. No building
  conversion support is added here. Pre-existing snapshots without conversion
  provenance retain their legacy current-owner resolution; lost donor data
  cannot be reconstructed.
- **Evidence:** `src/sim/conversion-inheritance.test.ts` uses deliberately
  synthetic contrasting profiles and public monk orders, research, movement,
  combat, boarding/unloading and construction. It measures retained wounds,
  damage/armour, sight/range, speed, promotion exclusion, recipient farm food,
  JSON save continuation (transport-stable synchronization hash), and a recorded
  train/convert/research replay. Waypoint/overlap separation costs up to part of
  one initial movement tick, so the one-second displacement check allows 0.05
  tiles (3 donor vs 0.6 recipient); no test timeout was widened. Two owned Loom
  cases additionally measure preserved wounded HP and militia damage (3 with
  donor Loom's +1 melee armour, 4 without), despite subsequent recipient/donor
  research. Integration guards corpse/blast lookup for non-unit resource nodes;
  animals remain valid unit-rule consumers.

## HUD feedback (#58)

- **Owned notifications:** `notificationpanel.json` origin (40,305), 600-wide
  BlackPanel Surround, grid step 32, inset (10,10), line size 40. The old 250-high
  template is a maximum, not a fixed-height box: **human capture** (2026-09-24,
  2560×1440, HUD 100%, Normal notifications, Readability Panels on) shows one
  line at 60 reference pixels including padding, two at 100. Bold white text
  replaces the template's brown placeholder; the HUD's existing 0.70 widget
  text scale remains **inferred**. Localized prompts 10213/10214, Yes/No
  4003/4004, research template 37157 and creation template 37159 are **owned**.
  UIColors palettes and UiColors.txt tags retain source alpha.
- **Native confirmation:** the empty `widgetui/dialogyesnoboxgeneral.json` has
  a substantive sibling in `wpfg/dialog/dialogyesnoboxgeneral.xaml`. The latter,
  `DialogBackgroundRect`, ButtonLarge and text/font resources now supply the
  black/gold frame, 560-wide buttons, 85×87 close button, 52-point Times New Roman
  Bold message and Trajan Pro Bold buttons. This supersedes reuse of the replay
  parchment dialog. Nine-slice PNG pixels and source dimensions are imported;
  auto row layout is mapped to CSS. Browser line-height 1.15, disabled kerning,
  drop shadow and 92% black modal dimmer are **inferred** from the supplied
  capture, not closed-runtime values. Browser focus/tab behaviour is used;
  simulation continues while confirmation is open. DAT eligibility and explicit
  mixed-selection No semantics are preserved; lifecycle abort dispatches no
  command. Captured match identity is checked before deletion.
- **Chosen feedback policy:** five recent messages, six wall-clock seconds per
  message, oldest overflow eviction, existing 250 ms panel fade; wrapping text
  scrolls to the newest line. The template's brown MultiColorTextBox placeholder
  is replaced with the owned White tag for readability over BlackPanel art.
  Font-face/index mapping and 0.70 text scale reuse the existing HUD inference.
  Attack/farm alert wording is project text after inspecting owned localization
  and sound aliases; research and newly created units use owned templates.
- **Blocked production:** warning requires an owned producer whose paid unit
  is ready but cannot fit under the population cap, matching the simulation's
  actual wait condition. Being at the cap with no blocked producer does not
  show it. Red wording 3075 is **owned**. The 828×134 panel, centre +200 from
  viewport centre, bottom inset 374 and 34-reference-pixel bold Times text are
  **human-capture-derived/inferred** from the supplied 2000×1125 preview of the
  2560×1440 screenshot; the nine-cell art is owned. `PopulationFlash` supplies
  its 140×72 box and normalized yellow alpha 0.7; one-second blinking is chosen.
- **Global queue:** `technologyprogresspanel.json` supplies origin (0,115),
  width 3050 and height 150. The screenshot's two-row setting gives 75×75 cells.
  Research/unit art is owned; click selects the producer through the existing
  view callback. One entry per paid slot, active/pending rows, green/yellow/red
  overlay amounts and count typography are **inferred** integration, not a
  complete reconstruction of engine aggregation. No production rules change.
- **Palette scope:** URL-selected CSS palette applies to player text; imported
  tags supply lower-HUD healthy bars and modal backdrop. The UI variants do not
  change sprite ramps, world health bars or minimap colours. #141 owns the
  future options-screen control. `GameMsgPanel.json` supplies nine empty full-
  screen anchors, not the message typography described in the original issue.
- **Defeat announcement:** collection origin (1140,110), 520×100 Surround,
  75×75 civilisation icon, 42×42 number badge and label at x=144.5 are **owned**
  from `GameNotificationPanel.json`; wording is the full symbolic localization
  key `IDS_GAME_NOTIFICATION_PANEL_DEFEAT`. Substituting the loser's existing
  score-row name/colour/civ icon for the template's Ashley/FlatColor/red
  placeholders is **inferred** runtime binding. It appears when the current
  two-player match reports a winner and expires after six wall-clock seconds
  (**chosen**, matching the message policy); it does not change defeat rules.
  The ObjectiveChangeAnchor belongs to future objectives work under #138.
- **Full end screen:** `wpfg/dialog/dialogendgame.xaml` supplies the 5160×1352
  frame at (-660,316), row layout, 200-point Trajan Pro title, divider and
  626-wide Return/Leave buttons. Frame/crest PNGs, separator, fonts, gradients
  and strings 9004/9005 plus `IDS_RETURN_TO_MAP`/`IDS_LEAVE_MAP` are **owned**.
  Shiny2's centre-preserving horizontal slices are mapped to a CSS grid;
  glint modulation is not reproduced. The supplied loss capture corroborates
  the crest/line/button positions. Browser line metrics/kerning and dimmer
  remain **inferred**. Return dismisses without changing the finished match;
  Leave opens this project's existing match launcher, since it has no DE
  postgame/main-menu shell. This is **chosen** navigation, not an imported
  achievements screen. Dismissal survives view hot reload.
- **End-screen embers:** `emberwindow.xaml` and `applicationwindow.xaml` bind
  alpha/additive overlays; `ember_ps.so`'s documented SM2 stream supplies a
  procedural capsule-distance quadratic fade. No ember emitter parameters or
  texture were found in the enumerated WPFG/particle resources. The browser
  pre-rasterizes that falloff and animates 900 independently seeded motes at
  30 fps; distribution, velocity, warm colours and scale are **chosen/inferred**
  from the human's animated-lights description and screenshot, not a measured
  DE trajectory. It uses no simulation RNG and stops on dismissal/destruction.
- **Generic OK popup:** `popupmessage.json` provides the centred 1280×720
  viewport, parchment, message rectangle, 442×60 button at (420,575), normal
  38-point and hover/pressed 45-point sizes; OK is owned string 4001. Using this
  modal for malformed/incompatible replay files and shared-mode replay refusal
  is **chosen project error presentation**, not an assertion about DE's error
  routing. Existing diagnostic wording is retained. Imported parchment corners
  preserve source alpha instead of painting the open-fallback beige behind it.
  Native modal focus/Escape behaviour and the existing 0.70 text scale remain
  approximations. The human explicitly accepted owned-source treatment without
  a runtime screenshot on 2026-09-24; this is not a #58 blocker or a claim of
  screenshot equivalence.

## Simulation

### Town-center construction (#177)

The importer follows completed unit 109's `building.head_unit` to 621, whose
`stack_unit_id` points back to 109. **Owned** construction values (Britons and
Franks): 275 wood + 100 stone, 150 seconds, villager builder 118, button 11.
The finished unit retains its HP, annexes, hill mode 2, five population and
drop-site roles. Tech-tree building connection 621 enables through tech 187,
whose only prerequisite is Castle Age tech 102; there is no other building
prerequisite. Connection 109 has no enabling research. The age upgrade effects
also replace construction heads (621 → 617/484/597), with the same base cost,
button and time. This change implements no civilisation discounts.

**Inferred engine interpretation**, supported by owned data/scripts rather than
a DE runtime capture: before that age, allow a replacement only if the player
has no living TC, counting foundations immediately. `Constants.xs` names
resource 218 `FeudalTownCenterLimit` (Briton/Frank initial value 1), and resource
48 `TownCenterUnavailable` (0). `Promisory/buildings.per` 204–229 explicitly
rebuilds when the TC count is below one and no pending TC exists, without an
age condition; 399–413 additionally checks `town-center-foundation` (621).
DAT shadow techs 308/722 name the foundation and early TC but contain no
replacement predicate. We represent the finished building and foundation as
one entity, so one live-entity count implements the slot reservation. Dead
TCs/rubble do not consume it. Before-Castle construction has no additional
building prerequisite in the inspected sources. The diagnostic limit message
is project wording. Cuman early expansion and scenario TC prohibitions are
outside this Briton/Frank prerequisite; resource 218 is not treated as a live
counter. Old manifests missing construction-head metadata use the transcribed
open-rule cost/time/button until regeneration.

Verification: `src/sim/town-center.test.ts`, focused owned importer test
`test_town_center_construction_uses_the_head_not_the_finished_building`, and
`tools/town_center_smoke.mts` (private browser; `TC_CONTENT` optionally overlays
freshly extracted TC metadata in memory without publishing a partial import).

| What | Shipped as | Source | Where | Issue |
|---|---|---|---|---|
| Slope-sensitive building placement | DAT `hillMode` 0 allows any relief, 2 requires equal levels, 3 permits a maximum-minus-minimum of one level over every covered tile; old manifests use the transcribed open-rule modes. Unused/unrecognized nonzero modes use flat-only treatment | Building mode **owned** from `unit.hill_mode`, including Thracian barracks 0 versus Briton 3 and both TCs 2. Mode meanings **community-documented** in [UGC attribute 187](https://ugc.aoe2.rocks/general/attributes/attributes/#187-hill-mode). Applying them to half-open tile-centre samples, fractional survey differences and all one-level corner orientations is **inferred**, not a patch-matched runtime measurement of DE's discrete slope/corner topology. Existing red/green preview and rejected-click feedback reuse authoritative legality; diagnostic “placement is on unsuitable elevation” is project wording after inspecting owned placement messages 3094–3096 | `import_content.py`, `data.ts`, `elevation.ts`, `game.ts` | #176; exact topology remains #134 |
| Starting town-center pads | At match generation, level only tiles inside each player TC footprint to its centre tile's authored level; never mutate baked source arrays or terraform later construction | **chosen** minimal playability edit. Windsor's original starts span levels 0–1 and 1–2, violating owned TC `hill_mode` 2; Senlac and current generated starts already pass. Renderer, fog and combat receive the resulting authoritative grid before the initial visibility pass | `game.ts` `createGame`, `elevation.ts` `levelStartingFootprint` | #176 |
| Elevation combat | post-armour damage ×1.25 downhill, ×0.75 uphill, ×1 on equal ground; retains fractional HP, including multiplying the existing minimum damage; projectile origin versus each victim's impact-time tile level | **inferred** base multipliers from [community Elevation article](https://ageofempires.fandom.com/wiki/Elevation#Age_of_Empires_II). Owned tutorial 73020 confirms higher-ground advantage. XS `cAttributeElevationBonusHigher/Lower` (211/212) and `ElevationDamageHigher/Lower` (272/273) are modifiers: Gaia/Britons/Franks all zero in the pinned DAT; Tatar effect adds 0.25 to 211 and Georgian effect adds −0.15 to 273. Those are not the base rule. Launch-point lifetime, victim-at-impact timing, fractional survey comparisons and minimum-damage ordering are inferred integration, not runtime-measured; civilisation modifiers remain #123 | `sim/elevation.ts`, `game.ts` | #134 |
| Generated hills | Arabia non-extreme global roll; Black Forest clearing/forest passes; mirrored cost-grown footprints eroded inward into one-level eight-neighbour terraces, preserving a four-tile starting square; independent seed stream | Heights/counts/chances **owned** from `Arabia.rms` 265–278/897–925 and `Black_Forest.rms` 298–315; flat baseline 2 from help 30534, normalized to zero. **Chosen** growth/erosion, 100×100 quota scaling inherited from this generator, start protection and independent stream. Actual RMS spawn placeholders/biome-specific spawn elevation and engine `cleanElevation` are not reproduced; maxima are ceilings, not guaranteed peaks. Water remains flat; surveys are untouched; ordinary slopes retain existing traversal and LOS, cliffs require explicit geometry/obstructions | `mapgen.ts` `generateHills` | #134 |
| Stationary collision tie-break | add a 1e-6-tile, entity-id/golden-angle perturbation to collision normals; contact distance remains the sum of unit radii | **chosen** numerical symmetry breaking for #83's reproduced arrival line, not DE formation geometry. Inspected owned `selection_group_def.json` (selection categories) and `hotkeys.json` (box/line/staggered/flank actions 84–87); neither specifies collision resolution. Uses existing DAT-backed radii and no simulation RNG; explicit formation slots remain unimplemented | `nav.ts` `separateUnits` | #83 |
| Starting resources | 200 food / 200 wood / 100 gold / 200 stone | game setting (the reference's Standard); the DAT's `civs[1].resources[0..3]` are 0 | `data.ts` `rulesFromManifest` | #109 |
| Herdable claim rule | claimed by whoever comes within its line of sight | inferred rule; the distance is the DAT's `line_of_sight` (3) | `data.ts` `animal`, `game.ts` | — |
| Training beyond housing | paid queues may exceed the population cap; the active unit finishes at 100% and waits until its full population cost fits, then releases before the next entry trains | **inferred** engine timing from #143's reference behavior; housing message **owned** string 3005 (also 20607), production-halted strings 3075/3076 corroborate the state. Reuses the existing population-cap cue for a one-shot message and keeps the same message in the selected blocked producer's status; exact reference alert timing/layout not measured | `game.ts` `updateBuildingProduction`, `main.ts` | #143 |
| Drop-site acceptance | building resource sets and task-specific return-site lists come from worker DAT sites intersected with JSON worker/class/resource rows; a carried load retains its gathering task | **owned** `dropsites.json` plus `bird.drop_sites`/tasks; Gaia-only target classes come from the already imported resource rather than empty player DAT slots. Open/older manifests retain transcribed defaults. JSON target-state transitions are outside the current entity-state representation; imported `acceptsLivestock` is metadata, not livestock-delivery behavior | `import_content.py` `import_drop_sites`, `data.ts`, `game.ts` `nearestDropSite` | #52; livestock follow behavior remains #136 |
| Speed / train / reload / frame defaults when a manifest field is absent | `?? 0.8`, `?? 25`, `?? 2`, `?? 10` | chosen; only reached when a manifest key is missing (`imported-rules.test.ts` holds the stated ones) | `data.ts` `rulesFromManifest` | — |
| Game-speed multipliers | 1.0 / 1.5 / 1.7 / 2.0 | inferred (Steam, AoEZone threads); the names and the Default are owned strings 20033-20036 | `main.ts` | — |
| A foundation's line of sight | 0 | chosen against observed behaviour (issue #1); DAT has no construction-time LOS | `visibility.ts` | — |
| Conversion odds | uniform over the DAT's 5-9 s window | chosen shape; both ends owned | `game.ts` | — |
| Converted-unit stat inheritance | unit-local rules snapshot before ownership/passenger ownership changes; stored HP/wounds persist; later research/promotions skip captures | **Inferred**, community-backed policy; see the detailed remaining economic/projectile/reconversion/passenger gaps above. Synthetic outcomes, owned Loom combat/HP and JSON/replay verify this implementation, not DE parity. User-approved policy permits the limited supported mixed-profile milestone while those reference questions remain open | `game.ts` `updateConverter`, `rules.ts` `unitRulesForEntity`, `types.ts` | #178 remains open |
| Blast falloff | none inside `blast_width` | chosen; DAT states no falloff | `game.ts` | — |
| Scorpion bolt travel and contact | swept circle, one hit per enemy, no friendly damage, full shooter attack on the intended target and projectile attacks on others; travels maximum range +3 | **inferred** engine interpretation of owned hit/vanish mode 1; extra three tiles and friendly immunity corroborated by [community Scorpion article](https://ageofempires.fandom.com/wiki/Scorpion_(Age_of_Empires_II)); radius, speed, primary/collateral attacks and upgrade effects owned | `game.ts` `releaseAttack`, `updateProjectiles` | #127 |
| Miss scatter, fallback rules only | 1 tile | chosen; imported units use `accuracy_dispersion` | `game.ts` `MISS_TILES` | — |
| Trade gold | `bird.work_rate` × travel seconds, capped at `resource_capacity`, paid on arrival | chosen substitution; the community's 0.46/tile and DE's pay-both-ends are not in the files | `game.ts` | — |
| Trebuchet packed/unpacked pairing | named by hand (331 ↔ 42) | chosen; task 109 names no target unit | `data.ts` | — |
| Farm re-sow from the mill | option, off by default | engine convenience; DAT gives the farm one build location | `game.ts` | — |
| Farm reservation and overflow | current gather order reserves a farm during travel and banking; surplus direct orders choose a visible free farm within 3×LOS of the clicked farm, otherwise idle; one participating builder becomes its farmer | single-worker limit **owned** (farm help string 26149); reservation lifetime, overflow search and deterministic first-worker/lowest-id legacy conflict resolution **inferred** | `game.ts` `farmAvailable`, `nearbyFreeFarm` | #82 |
| Enemy farms | only the owner's farms are gatherable | existing limitation; owned string 26149 permits abandoned enemy farms | `game.ts` `isGatherable` | #156 |
| Gathering after camp construction | participating lumber-camp builders choose trees; mining-camp builders choose nearest gold/stone; mill builders choose berries/free owned farms; queued orders take precedence | target categories checked against owned `resources/_common/dat/dropsites.json` (562/584/68; farms `worker_num: 0`); narrower mill policy **human-specified** in #79, not the full food drop-off list. Worker-centred nearest selection, existing visible 3×LOS bound, elbow-room filter, id tie-break and priority over adjacent same-kind construction **inferred**; no full reachability guarantee | `game.ts` `workAfterBuilding` | #79 |
| Fishing continuation | check clearance outside the entire resource footprint; after banking a vanished node's load, return to the ship's last working position before selecting visible fish | half-extents **owned**: DAT Gaia 458 deep fish 1×1, 69 shore fish 0.5×0.5; ship 13 collision 0.4×0.4, LOS 5, terrain row 13. Remembered-position return and existing visible 3×LOS search **inferred**; the ship's owned `bird.search_radius = 12` has not been established as this task's continuation radius. No unseen fish are selected and no global reachability guarantee is added | `game.ts` `hasElbowRoom`, `updateGatherer`; `types.ts` `fishingPosition` | #87 |
| Example AI construction continuity | do not retask active builders; houses/ranges fall back to the other existing building-position lists | **chosen** strategy, not an imported engine rule. #79 changed idle-worker timing and exposed abandoned foundations and exhausted position lists on seed 7; passive-opponent victory retains its 2400-second bound | `ai.ts`, `ai-construction.test.ts` | #79; related #146, #86 |
| AI recovery of paid house foundations | one replacement per unstaffed owned house, oldest id first; prefer idle villagers, then nearest gatherer with id tie-break; reserve assignments against the rest of the same decision and keep builders out of demolition | **chosen** strategy. Owned `ai/Promisory/buildings.per` lines 1284–1304 exclude active builders when placing another house and reassign builders to pending houses; lines 11916–11929 also assign house builders. These support reassignment but do not specify our selection policy. Observation v2 exposes own `buildTargetId` instead of guessing assignments from proximity. Presence of `buildProgress`, including a rounded 1, identifies unfinished foundations. Reachability of a still-assigned builder remains the navigation system's responsibility | `ai.ts`, `observe.ts`, `ai-house-recovery.test.ts` | #146 |
| AI mill redundancy and camp supply | scan known unserved nodes rather than stopping at the nearest served node; exclude fish from the land economy's mill targets; unfinished camps still block another placement, including rounded 100% foundations. Mills require supply outside the existing mill's 8-tile service bound plus the 4.5-tile maximum placement radius, and a snapped placement farther than 8 tiles from existing mills. Lumber/mining camps retain the shorter-walk criterion | **chosen** strategy implementing #147's human distinction between mills and potentially useful adjacent lumber/mining camps; reuses existing 8/4.5 constants, not an owned minimum-mill-distance rule. Owned `Promisory/buildings.per` 3899–3911 explicitly considers a second mill for additional/distant forage; 2032–2042 permits adjacent lumber dropsites. DAT mill 68 collision half-extent 1 confirms the 2×2 placement. Selection still uses known resource memory and centre distances, not path-cost or a full resource-cluster model | `ai.ts` `supply` and camp loop; `ai-camps.test.ts` | #147 |
| AI Feudal infrastructure reserve | reserve the next archery range's 175 wood, then blacksmith's 150, against extra camps/farms and archer training; housing, first drop sites and first farm remain available; release once both buildings exist | **chosen** strategy fixing #86's repeated small-purchase starvation, reusing existing building prices. Owned `Promisory/buildings.per` 11217–11239 explicitly targets and builds a blacksmith after a lumber camp; our reserve and exceptions are not an import of its goal system. Fresh imported seeds 1/7 now finish blacksmiths; seed 42 finishes a range and wins before its smith. Further building/unit policy remains #124 | `ai.ts`, `ai-military-buildings.test.ts` | #86 |
| Repair targets beyond the class table (a farm) | repairs at the building rate | chosen | `game.ts` | — |
| `garrison_heal_rate` unit | hit points a second | inferred | `game.ts` | — |
| Briton relics | Gaia285 pickup → carrier286 → monastery104, persisted identity, gold income and drop/death release | **Owned** monk125 task132 (target285, result286, range0), carrier task136 (target104, result125, range1), Gaia285 HP30/radius0.5, resource191=30, original relic/carry art. Per-minute interpretation, integer banking with persisted fraction, nearest non-full owned monastery, unchanged monk collider/stat snapshot, damage immunity and deterministic release point are **inferred** integration. Reuses public ungarrison; Drop Relic wording is owned40106/41106, icon/cell reuse and count/faith text are **chosen** UI. Transport sinking retains existing passenger-loss policy. No relic victory (#110) | `relics.ts`, `game.ts`, `sprites.ts`, `main.ts` | #130 |
| Briton monastery research consumers | Devotion/Faith delay enemy conversion, Theocracy spares other participants' faith, Illumination accelerates recharge, Block Printing extends actual conversion range, Herbal Medicine increases actual garrison healing | **Owned** effects46/45 add1/4 to178/179;494 sets193;219 multiplies class18 attribute10 by1.875;220 adds3 range;41 multiplies class3/52 attribute108 by6. Monk reload1.6 as faith points/sec over100, additive seconds and participant charge policy are **inferred** engine semantics atop the existing uniform conversion window. `convertedRules` remains locked; player resources remain live. No new conversion permissions, chance or healing modifiers | `monastery.ts`, `rules.ts`, `import_content.py`; owned offered-tech assertions + outcome tests | #128 |
| Briton relic placement slice | Tiny Arabia: one central + two/player, independently seeded after the existing opening | Counts, distance32/spacing24 from **owned** modern Arabia BALANCED `includes/relics.inc`; box distances, approximate central strip/player zones, cardinal reachability and obstacle clearance are **chosen**. Exact actor areas/cliff/forest constraints are not reproduced. Other maps remain without relic placement in this bounded change; no Black Forest relaxation or invented Islands islet | `relic-placement.ts` | #130/#95 |
| Unsupported relic thresholds | Non-stockpile technology costs disable automatic nodes; legacy automatic699–702 return no technology/effects | **Owned** resource7 costs on699–702 are count prerequisites lost by old extraction. **Chosen fail-closed guard**, not implementation of Lithuanian bonuses or resource counters | `technologies.ts`, `import_content.py` | #130 |
| Market exchange / Guilds | public 100/500-unit buy/sell orders, shared prices, owner-specific researched fee, atomic rejection, JSON continuation and observation quotes | **Owned** resources78=.3 and T15→effect15 sets .15; localization41072–41078 specifies 100-unit clicks/500-unit Shift batches and changing prices; definitive hotkeys S/D/F and X/C/V determine wood/food/stone cells7–9/12–14. Inspected DAT market84 has no price tasks; XS names the fee, and `ai/AiBuilder/market.per` queries prices without defining the curve. Initial bases100 wood/food,130 stone; ±3/lot,20–10000 bounds, ceiling buy/floor sell and global price persistence are **inferred closed-engine policy**, not DAT values or measured DE parity | `market.ts`, `main.ts`, observation v6 | #128/#179 |
| Tribute / Coinage / Banking | full recipient credit; sender additionally pays same-resource fee; completed sender market required; current 1v1 may tribute its opponent | **Owned** resource46=.3; T23→effect23 sets .2, T17→effect17 sets0; localization30353–30356 describes resource tribute, fees and 100/500 amounts. `widgetui/diplomacy.json` supplies the source UI context. Ceiling fee, safe-integer amount validation and a compact Pay Tribute page on the market (rather than a full diplomacy dialog) are **chosen** integration. CTRL-all tribute and diplomacy/team settings are not implemented. These technologies do not alter trade-cart income | `market.ts`, `main.ts` | #128/#179; diplomacy surface #138 |
| Random-map Spies | live 200-gold-per-enemy-villager cost at command acceptance, HUD and observations; includes garrisoned living villagers; completed research shares all enemy unit/building LoS while keeping orders/queues private | **Owned** T408→effect420 sets resource183=1, base cost200/research1s/castle82/slot14; help28408 states the per-villager formula, enemy sight and locked-team ally exclusion. Current1v1 has no allied players. Zero villagers means zero price; no additional engine cap is inferred. Permanent research uses the existing journal. Regicide/Treason and its repeated400-gold action are not implemented | `technologies.ts`, `visibility.ts`, `main.ts`, observation v6 | #179 |
| Siphons charge | only Fire Galley/Fire Ship/Fast Fire Ship mode6/event0/target64; ready normal attacks release one additional explosive projectile; one charge recovers at .04/s and keeps its reservoir through conversion/saves | **Owned** T909/effect915 sets attributes62=6,59=1 on1103/529/532; University209,45s,100food/175gold. Creatable fields name projectile2629: speed3, blast.5/level2, its own class attacks; smart mode1, arc.45, vanish mode2. Tracking677→graphic3823 names `flamethrower_flame`; dying graphic12726 names `impact_grenade` (85 original frames90–174,1.5s,scale.2). Full initial charge, one extra projectile per ready normal swing, no repeated damaging ticks during the retained impact, and ordinary blast friendly-fire are **inferred bounded engine semantics**, not a general charge engine or runtime calibration. Original impact art expires on saved simulation time; relics are immune to splash | `fire-charge.ts`, `game.ts`, `sprites.ts`, `tools/naval.py` | #179 |
| Garrison firepower and volley resolution | positive firepower multiplies ranged DPS; a negative value adds its magnitude as flat DPS (villager −2.5 → 2.5 DPS); sum contributions, divide by the researched building's pierce DPS, floor and cap; an absent primary projectile consumes neither the nominal base arrow nor its maximum slot | signed field **owned**; sign meaning **community-documented** in [UGC attribute 130](https://ugc.aoe2.rocks/general/attributes/attributes/#130-garrison-firepower). Ranged-DPS basis, flooring and absent-primary slot interpretation **inferred** engine integration, tested through actual released volleys. Replaces the old fixed-one-arrow treatment; not claimed as a patch-matched runtime measurement | `game.ts` `volleyArrows` | #137 |
| Town bell recall and return | nearest eligible owned villagers first, stable ID ties, up to free TC capacity minus incoming garrison reservations; remember interrupted order/queue, bank carried loads on entry, restore work on bell release; newer orders cancel the remembered task; newly trained villagers shelter while the bell rings | toggle/return behavior **owned** help 41111, button actions 163/165 at cell 14 with icons 49/61; cue aliases `townbell_start/stop` **owned**. Global nearest-worker selection with no radius cutoff, reservation policy, preserving manually sheltered units and new-villager handling **chosen/inferred**; exact DE bell search radius/overflow routing is not stated by inspected files | `game.ts`, `main.ts`, observation v5 | #137 |
| Production and ram shelter | self-rally holds trainees; type-0 producers refuse returning units; overflow emerges outside. Rams carry infantry/villagers, reject archers/cavalry, unload to passable land and release on destruction where possible | self-rally **owned** help 4944; production capacity 10/type 0, ram 35/422 capacity 6 **owned**. Filtering/egress **inferred/chosen**; live crew constants and their remaining calibration caveat are recorded above | `data.ts`, `game.ts` | #137/#161 |
| Garrison categories by DAT class | editor table | chosen | `game.ts` `GARRISON_CATEGORY` | — |
| Shift-click queue count | 5 | inferred (the reference's count); `hotkeys.json` binds nothing | `main.ts` | — |
| Shift-click route: an unshifted order or Stop clears the route | rule | inferred | `game.ts` | — |
| Delete confirmation | `hero_mode` bit 32 | owned (corrected from "buildings ask") | `data.ts` | — |
| Auto-continue bound | 3 × line of sight, visible only | chosen; the human asked for "approximately their line of sight" | `game.ts` | — |
| Carcass food spoilage | sheep/deer lose 0.25 food/s, boar 0.4 after death, independent of gathering; fractional progress removes whole food units | rates **owned**: live Gaia DAT units 594/65/48 `resource_decay`, distinct from dead-unit type-12 lifetime. Whole-food accounting and starting decay immediately on death **chosen** integration with integer gathering. Corpse remains edible until empty; existing corpse visual lifetime remains separate | `import_content.py`, `data.ts`, `game.ts` | #85 |
| Coordinated herd feeding | AI chooses one known edible animal: carcass first, then an already assigned animal, then nearest home/id; automatic same-kind continuation prefers carcasses and already assigned animals within its existing visible bound | **human-requested** one-at-a-time policy in #85. Owned `Promisory/gatherers.per` 3753–3812 tracks current/next livestock and directs 1–7 shepherds to current livestock (8+ may use next); our single-target policy, rankings and corpse observation v4 are **chosen**, not a full import of that strategy. Own gather target IDs are public only to their owner | `ai.ts`, `observe.ts`, `game.ts` `nextToWork` | #85 |
| A claimed sheep stands still | rule | chosen at the human's request (reference follows) | `game.ts` | #136 |
| Corpse window, fallback rules only | 3 s | chosen | `game.ts` | — |
| Animal think interval | 5 ticks | chosen | `game.ts` `ANIMAL_INTERVAL` | — |
| Engagement tolerances | `radius + 1.6`, margins 0.15-0.4, spawn ring +0.2, node pop ≤ 0.12 | chosen | `game.ts` | — |
| Villager task gathering | hunter 0.41/35, farmer 0.53/10, shepherd 0.33/10, forager 0.31/10, fisher 0.43/10, lumberjack 0.39/10, gold miner 0.38/10, stone miner 0.36/10 (rate/capacity); each variant's technology effects | **owned** DAT `bird.work_rate`/`resource_capacity` on 122/259/592/120/56/123/579/124, already published as `villager-*.gather`; open fallback copies these numbers. Heavy Plow gives farmer +1 capacity; Wheel Barrow's patch-specific class-4 multiplier is **1.2695**, Hand Cart's 1.5. Existing whole-resource collection rounds fractional capacity upward (**inferred**, not reference-measured); switching tasks uses the new target's capacity and banks an overfull load first (**inferred**). A carried load remembers its task if its source disappears; legacy loads lacking both source and task default to forager | `data.ts` `villagerGather`, `game.ts` `rateOn`/`holdOf` | #132 |
| Technology prerequisites and automatic bonuses | full nonnegative DAT prerequisite IDs plus `required_tech_count`; foreign/disabled alternatives remain unsatisfied. Completed buildings supply `building.tech_id`. Initial tree/team effects and eligible locationless/free research activate once in completion order | gates, IDs, costs, amounts and triggers **owned**; fixed-point activation order, historical building-trigger persistence and free research requiring its completed research building are **inferred engine semantics**. Positive counts with empty lists remain blocked. Legacy manifests retain their former all-listed path | `import_content.py`, `technologies.ts`, `game.ts`; [contract](civilization-bonuses.md) | #123/#129/#179/#180 |
| Bonus prices and production | cost multipliers in completion order, then nearest whole resource (half up); production/research advances by building work rate | multipliers **owned**: TC wood ×0.5; castle ×0.85 then ×0.882353; range work ×1.1. Rounding/tick quantization **inferred**: TC wood 138, castle stone 553/488 are implementation outcomes, not DE measurements. Existing HP policy adds max-HP delta preserving absolute damage; converted entities skip bulk HP/upgrades | `rules.ts`, `game.ts` | #123/#178 |
| Bonus scope and remaining effects | current 1v1 applies each player's own team effect; unsupported commands/attributes retained as `unmodelled`. No allied teams, timed locationless research or general enable/disable-unit effect execution | **owned** commands retained as diagnostics; range/sight, gathering, production, prices and cavalry HP have consumers. Search radius 23, building age-stat replacements, conversion/relic resources and other unsupported effects remain gaps | `civilizationBonuses.nodes`, `import_content.py` | #123/#128/#126/#130/#179/#180 |
| Unmodelled attributes 23, 130, 48, 49 | recorded per technology, not applied | owned but unmodelled | manifest `unmodelled` | #128 |
| Named player-attribute coverage | all named DAT initial values imported; research-aware consumers for farm food, repair, relic gold, conversion resistance windows and Theocracy. Other resource effects remain unmodelled; initial food/population/score entries are not live counters | names/indices **owned** from XS, values **owned** from configured civ. Lower-first-letter keys and legacy `FarmFood` → `farmFoodAmount` remain schema conventions | `import_content.py`, `rules.ts`, `monastery.ts`, `relics.ts` | #53/#128/#130 |
| Skipped technologies | not researchable, reason each | owned | manifest `skippedTechnologies` | #128, #97 |
| Building age and paid upgrades | stable age variants select HP/armour/LOS; paid tower/wall/gate upgrades replace kind, retaining damage and scaling foundation gains by built fraction | baselines, IDs, costs/gates/armour **owned**; absolute damage retention, fractional foundation scaling and shared gate HP **inferred**. Generic sole-age rows 71/72 normalize into baselines with `includedTechs` preventing graph reapplication; source float precision retained | `tools/buildings.py`, `rules.ts`, `game.ts`; building contract | #126/#179/#180 |
| Stone/fortified gate topology and art | four-tile construction, two-tile owner doorway, solid posts, two axes preserved by upgrade; previews supply closed/open parts/flags, heads supply construction, rubble/collapse includes posts | geometry, links and graphics **owned**; shared HP, owner passage and proximity-open display **inferred**. Diagonal placement/native timing remain #133 | `import_content.py`, `nav.ts`, `sprites.ts` | #126 roster slice |
| Stone/fortified wall frames | x=0, y=1, post/junction=2, horizontal/vertical screen diagonals=3/4 | **Measured** by composing owned x2 frames at hotspots divided by scale (`tools/probes/building_wall_art.py`). Neighbour-footprint junction selection **inferred**; palisades keep their separate mapping | `sprites.ts` `wallShape` | #126 roster slice |
| Mirror-symmetric board | exact mirror | chosen divergence; the paired batch rests on it | `mapgen.ts` | — |
| Black Forest seed 7 | one far-gold pair dropped | chosen compromise | `mapgen.ts` | — |
| Straggler clearance, neutral wood counts | scaled from the script | chosen | `mapgen.ts` | — |
| Water-masking depth chain | applied as the converged rule (shallow ≤ 5 tiles) | chosen; the include grows clumps | `mapgen.ts` | #95 |
| Single land tiles at sea | dropped | chosen (no RMS evidence) | `mapgen.ts` | — |
| Beach sweep | every land tile with open water among eight neighbours becomes Beach | **inferred**; scripts confirm only that the engine does a sweep | `mapgen.ts` | #113 |
| Dock placement | reaches the water and touches the land | inferred | `game.ts` `placementLegal` | — |
| Naval roster and research | current Britons galley/fire/demolition/hulk lines, Cannon Galleon, transport and trade cog; no unavailable Carrack/Elite Cannon Galleon | **owned** DAT and `CivTechTrees/BRITONS.json`; shared researches 34/35, including automatic children 911/246 with sole prerequisite 35; cannon unit prerequisite 47. Normal projectile/volley attack timing uses existing simulation rules; the Hulk's negative class-21 attack subtracts before the minimum damage (**inferred** arithmetic, not a reference damage measurement) | `tools/naval.py`, `import_content.py`, `data.ts`, `game.ts` | #97 |
| Ship composites and fire shot | flatten owned file-bearing hull/sail deltas in layer order with their own frame clocks, offsets and colour/shadow/outline masks; file-less fire projectile 676 uses `flamethrower_flame` | composite graphics **owned**, including placeholder W/X and file-less SLP -1 parents; underwater alpha from owned palette. Flame atlas/29 frames/scale endpoints **owned**; binding to projectile 676, mean start scale and one puff per projectile with flight-normalized animation **inferred**, not the closed engine's emitter. Hull occlusion decides the whole ship's contour | `naval.py`, `sprites.ts` | #97 |
| Demolition detonation | contact attack or lethal damage detonates once at the DAT radius; enemy units/buildings take full shared-class damage; friendly units are spared; deletion does not detonate | radius/attacks and self-destruction wording **owned**; interpretation of blast level 66 as low-bit level 2, full damage without falloff, death-trigger/friendly-fire rules **inferred** | `game.ts` `kill`, `applyBlast` | #97 |
| Transport boarding/unloading | 20 land passengers; board at interaction range, preserve loads/population; Unload selects a shore, retains cargo offshore or when blocked; cargo is lost on sinking and changes owner with a converted carrier | capacity and load/unload action **owned** unit 545/help 26443; unload strings 3053/4107, definitive hotkey Q in `hotkeys.json`. Adjacent landing samples (32 angles at carrier radius + passenger radius + 0.6), land-only eligibility, cargo conversion/loss and targeting-path semantics **inferred**; reuses the ungarrison icon | `game.ts`, `main.ts` | #97 |
| Fish Trap economy | ship-built water-only trap, 100 wood, 700 food, one reserved fishing ship, manual rebuilding on depletion; ship's 0.24/s × task factor 1.45, dock drop-off | cost, resource 88, builder 13, task factor **owned**. Build duration derived as DAT 40 / (0.24 × build task 3.57); applying that work-rate interpretation and the existing multi-builder rule, exclusive reservation, open-water placement and no automatic reseed **inferred**. Fishing Lines/Gillnets affect collection/carry; construction uses the imported baseline duration | `import_content.py`, `game.ts` | #97 |
| Trade Cog income | dock-to-foreign-dock round trips, 0.375375 per travel second, capacity 200 | work rate/capacity/dock target **owned**; travel-time income reuses the existing trade-cart approximation rather than reproducing DE's distance formula | `game.ts` `updateTrader` | #97 |
| A ship is afloat or nowhere; final approach slides along the bank | rule | inferred from the table's shape | `game.ts` `groundAllows`, `moveTowardOnGround` | — |
| `FISH_A` (salmon) | dealt as the snapper | chosen | `mapgen.ts` | #95 |
| Placement-side neighbourhood | any of the eight neighbouring tiles satisfies the DAT's `placement_side_terrain` alternatives | inferred engine interpretation; the shore fish's beach IDs 2/35 are owned | `mapgen.ts` `dealFish` | #145 |
| Islands resource islets | not dealt | — | `mapgen.ts` | #95 |
| The AI never orders a villager onto a boar | rule | chosen (deliberate) | `ai.ts` | — |
| AI tuning constants | `ARMY_BEFORE_AGE`, `FARM_SPOTS`, camp costs… | chosen; strategy, not fidelity | `ai.ts` | #124 |
| The wonder wins nothing | rule | decision pending | `game.ts` | #110 |
| Relics | absent | deliberate | — | #130 |
| The 2026-08-28 genie-rms read | algorithm understanding only; code written fresh | GPL source read, recorded under #112 | `mapgen.ts` | #142 |

## View

| What | Shipped as | Source | Where | Issue |
|---|---|---|---|---|
| Sprite page residency | 512 MiB soft budget, 60 s warm grace, 120 s idle expiry, 1 s sweep; scene requests override the budget, terrain/water pinned | **chosen** application memory policy, not DE runtime constants. #170's normal-gathering soak increased grace from 10 s: 586 → 44 evictions over seven-minute windows, at 1,051 → 1,459 MiB resident sprite data. Owned x2 dimensions supply byte estimates. Off-camera and remembered art remain active; expired art may be absent during PNG reload. Compressed upload remains #163 | `sprite-residency.ts` | #152, #170 |
| Order-flash cadence and colour | 0.2 s on/off for 1.2 s, marker colour | chosen; `unit_selection_color_1/2` hold palette 0, no widget | `main.ts` `ORDER_FLASH_*` | — |
| Occlusion contour threshold | ≥ half the sprite's box covered | chosen (stands in for the per-pixel test) | `sprites.ts` `HIDDEN_FRACTION` | — |
| World render-pass ordering | existing pass bases with each old within-pass depth/piece key mapped by `k / (1 + abs(k))`; bodies/scatter, projectiles, contours and rally flags cannot cross into other passes or placement overlays | **chosen** rendering implementation, extending the existing ground-layer policy rather than recovering the DE compositor. Relative body/piece ordering is preserved; piece offsets belong inside the bounded key. Near/far owned readbacks agree (321 Galley / 147 villager blue pixels), placement overlays cover every opaque contour sample, camera round trips and fog checks pass | `render-order.ts`, `sprites.ts`, `scatter.ts`; full reference compositor remains #149 | #238 |
| Context cursor bindings | owned native CUR files, actual header dimensions/hotspots; bindings follow the first selected unit's pure order plan, defensive targeting or a producer's rally command. Build/repair/unload modes take precedence; unsupported repair targets use CSS `not-allowed` | images/hotspots **owned** from `resources/_common/cursors`; selecting the `32x32` filename family and mapping current actions/group priority are **inferred** integration, not a recovered DE cursor-state table. `flag32x32.cur` is actually 48×48 with hotspot (9,43); convert is (15,15). Missing assets use the ordinary CSS cursor | `import_ui.py`, `view/cursors.ts`, `game.ts` `resolveUnitOrder`/`planContextCommand`, `main.ts` | #51 |
| Remembered Gaia interaction | hover/picking/selection read last-seen positions and metadata instead of hidden live objects; a vanished remembered target falls back to moving to the clicked last-seen location | **chosen** integration with existing authoritative visibility/memory; prevents the old picker bypass for unseen Gaia from leaking through new cursor feedback. Stale-target movement is a project UX fallback, not a measured DE command-resolution rule | `view/selection.ts` `contextTargets`, `main.ts`, `game.ts` `applyCommand` | #51 |
| Sprite shadow profile/composition | imported Default `shadow_strength` (1.0) and black `shadow_color`, applied to the owned mask over the ground | values **owned**, imported from `colorcorrection.json`; using Default for every biome and direct alpha blending rather than DE's final compositor remains **inferred**. The extra 0.55 multiplier was removed after the human rejected #88's first visual fix | `sprites.ts` `configureShadow`, `import_content.py` `shadow_profile` | #149 |
| World terrain hillshade | `+dx-dy` over shared corner heights, applied to base terrain and blend overlays; existing strength 0.035, base 0.82, normalized-altitude contribution 0.16 and clamp 0.68–1 retained | Direction **human/reference-informed** by the 2026-09-22 editor capture (index records orientation only; original bytes/height grid unavailable). Strength/altitude/clamp remain **chosen**, not DE shader equivalence. Owned `TerrainSolid_vs/ps` transform/sample the tile; `TerrainAttributes_ps` samples `g_LightmapTexture` into output zw, and `CombineTerrainSpriteSMP_ps` names base/ambient/diffuse lighting. Our vertex shade is not that lightmap/compositor. **Measured** normalized linear-sRGB 5×5 world crops at 2/3 native projection scale: imported right faces 0.946/0.948, left 0.809/0.809; before correction front faces were both ≈0.949. The unshaded identical-geometry/UV draw cancels texture variation; no absolute reference RGB calibration is claimed | `world.ts` `createGround`, `tools/world_relief_smoke.mts` | #160; full composite #149 |
| Selection outline width and colour, scene background | 2.5 px, `0xf5f0dc`, `0x18140c` | chosen | `main.ts`, `world.ts` | — |
| Damage soot curve | linear in hit points lost | chosen; the shader's curve is unread | `sprites.ts` | — |
| Which build targets take the seed-sowing graphic | the farm | inferred (engine rule) | `sprites.ts` | — |
| Farm furrow pitch | `FARM_TILES_PER_SPAN = 10` (twelve furrows across) | **human** ("approx 12"); `terrain_dimensions` shown not to mean tiles per span | `world.ts` | — |
| Farm furrow orientation | quarter turn | human ("amend by 90 degrees"), retired by the handedness flip | `world.ts` | — |
| Fog edge softness | `FOG_EDGE_INNER/OUTER` 0.425/0.575 | chosen, then halved by eye | `world.ts` | — |
| Fog sampler | cubic B-spline | chosen; the shader names bilinear (pulls the contour inward a fraction of a tile) | `world.ts` | — |
| Fog levels | unseen 1.0, explored 0.5 | owned (`colorcorrection.json`); black-when-animate-off from the option's string and web reading | `world.ts` | #117 |
| Whole sprites at a fog boundary | ground fog below bodies; current visibility admits the whole sprite; last-seen sprites retain opaque silhouettes with RGB ×0.5; scenery obeys its anchor tile too | **human** comparison supplied for #88 shows whole trees over the ground contour; reusing Default's explored-ground multiplier for remembered sprites is **inferred**, pending the full reference compositor | `world.ts`, `sprites.ts` `dimFogSnapshot`, `scatter.ts` | #88, #149 |
| Blend shapes | classic 31-mask topology remains for land/farms and old imports; water-family transitions use extracted DE square windows | **owned** red-channel pixels from `terrain/blends/{waterwater,watershore,shallowswater}.png`, source hashes published. **Inferred** 64×64 border/corner/hole windows, four diamond quarters for adjacent edge pairs, and maximum-alpha unions of authored edge fades for opposite/three-edge cases; the exact engine UV table is not stated by `TerrainBlend_vs/ps`. Square tile-axis UVs are required: the classic masks instead occupy an isometric diamond. No synthetic noise or alpha remapping. All 31 renderer orientations are checked against the imported pixels (775 linear-sRGB samples, max alpha error 0.002); source-contour variation and import determinism are tested. Islands before/after crops supplement the measurements, not an exact matched-reference contour fit. Land-family DE windows and remaining visual calibration stay with #116/#113 | `world.ts`, `assets.ts`, `import_blends.py`, `tools/shore_blend_smoke.mts` | #148, #116, #113 |
| Land crossings through the overlay masks, both ways | the higher terrain over the lower's tile at shape × its `overlay_mask_name`, and the lower back over the higher's tile the same way | owned: `TerrainBlend_ps` gates the layer by `g_MaskTexture` at the tile's uv; **inferred**: that the pass runs both ways (the reference's sand-to-grass crossing is a band of each in the other, and one way exposes the tile's edge), and that `g_OverlayForEdges` is on for land and off for water (the reference's shore is a rim; the water mask is a marble that exposed the tile) | `world.ts` `masked` | #116 |
| Water surface arithmetic | `Water_ps`'s SM2 build, read: height field summed over rgb, three drifting layers, central difference at 0.05, normal over 0.1, dome through `skyDomeMtx`, glint at `specularPower` | owned; register map c0 = (seaFloorIntensity, skyIntensity, specularIntensity, specularPower), c1 = (waveAnimationSpeed, waveRepeatLength, waveAmplitude, mapScale), c2 = (seaFloorScale, lightDirection), c3-c5 specularColor/waterColour/skyColor, c6-c7.xy skyDomeMtx, c7.z time, c7.w terrainScale, c8.x SampleBlendTexture; s4 surface, s5 floor, s0 dome, s1 visibility, s2 depth, s3 beach blend | `water.ts` | #94 |
| Water world frame | world x = tile -x, world y = tile +y; the eye looks along world (1, -1) at 30 degrees | measured: the sun `(0.7, -0.68, 0.45)` reaches the eye only from beyond the surface, and the surface's rows lie at the down-left tile axis's 155 degrees in the reference | `water.ts` `VIEW` | #94 |
| Water `g_terrainScale` | 1, so the Default preset repeats every `20 * 0.0045 * mapWidth` tiles (10.8 on 120) | engine-set, unstated; measured: the reference's streaks decorrelate along their length at that repeat's rate | `water.ts` `TERRAIN_SCALE` | #94 |
| Water `g_time` unit | seconds times the preset's `water_normals_def.velocity` (0.125 in every preset), on the wall clock | inferred: the velocity has no shader input of its own; at a second per second the human found the drift fast | `water.ts` | #94 |
| Water dome orientation | the dome's v not turned over: a flat sea looks up the lower-right quarter (83, 126, 169) | measured: the only quarter whose body sits under both of the reference's zones at one weight | `water.ts` `skyDomeMatrix` | #94 |
| Water surface weight | `1 - (1 - opacity/255)^2` = 0.235 for the 32/255 classes, summed in linear light | measured: the 2026-09-19 composite's rim and open sea sit above their textures by one weight in all three channels (six numbers within 4%); the form is two layers of the stated opacity, whether the engine draws two is unread | `water.ts` `surfaceOpacity` | #94 |
| Water glint scale | 0.15 of the shader's, standing in for `g_VisibilityTexture`'s blue channel, which the engine fills | measured: at 1 a white dash on every mirroring facet, and the reference's open sea has none (99.9th percentile 16 over the mean at 0.52 of 1080p; 0.15 gives 13, 0.3 gives 25) | `water.ts` `GLINT_SCALE` | #94 |
| Water shimmer | three fifths of the reference's fine contrast (high-pass std 3.2 against 5.2 at 0.52 of 1080p), symmetric as the reference's is | measured gap; the wobble reads a smooth quarter of the dome | `water.ts` | #94, #113 |
| Shore foam frame placement | one 256-texel frame in each shore-side water tile's own 96x48 screen rectangle; `diag` for a single land edge, `ortho` across two adjacent ones; the far side is the frame turned over | owned: `WaveAnim_ps` (white at the atlas's red), the frames' 45/0-degree crests and their roll; **measured** (`islands-coast-2026-09-19.png`): the reference's band is ten pixels with a two-pixel core at its 0.8 zoom, which is the frame at one tile, and the crest's arrival at 82 texels then lands three pixels inside the tile edge; **inferred**: that a stepped pair takes `ortho`, and the quarter turn for a run down the screen (the reference shows no such run) | `foam.ts` | #89 |
| Shore foam tempo and phase | 28 frames a second through a loop of 112, the sequence's last sixteen frames faded over its first (the 128th to the first is a cut, five times any other step, which ran along the coast as a wave); the human times DE's roll at about four seconds; a coast rolls together, each tile's phase a fiftieth of the roll on from its neighbour's along either axis (a coin per tile made each tile's crest leap on its own), the mirrored pair changing every twelve tiles | chosen; the reference shows a stretch at one point of the roll | `foam.ts` `FRAME_RATE`, `PHASE_TILES`, `VARIANT_TILES` | #89 |
| Shore foam gaps | no frame on a water tile tucked into a corner (land on two adjacent sides and on a flanking diagonal) or in a one-tile channel (land on opposite sides) | inferred from `islands-coast-gaps-2026-09-19.png`: the cove's inner edges and an inward bend carry none, straight runs and stair-steps do | `foam.ts` | #89 |
| Shore foam strength | the frames' alpha at 0.4 | measured: the reference's band along a straight shore is red +25 to +60 over the water's 80 with no bright core (white at 0.15-0.35) where the frames carry 0.3-0.75; the blend state is the engine's | `foam.ts` `STRENGTH` | #89 |
| Default zoom | 0.8 | measured (the reference's default draws the 2x assets at 0.80) | `main.ts` | — |
| DE's default zoom | 0.80 of ours (a 77-px tile) | measured: a 143-texel mangrove stands 115 px, the water's repeat vector is (404, 202) px | `docs/status.md` | — |
| Minimap wood overlay | use Forest terrain slot 10's imported relief palette for live and remembered trees unless the node has its own colour; flat RGB (21,118,21) | palette **owned**: terrain `colors` (197,235,53) through `original.pal` gives (37,116,57)/(21,118,21)/(0,114,0). Tree units 349/351/348 have `minimap_color=0`; using the forest palette for their existing resource-dot overlay is **inferred**, supported by DE Desert Islands reference pixels near (21,117,21). Replaces the scaled-image sample (41,140,33) in imported mode; resource-dot geometry remains approximate | `minimap.ts` | #96 |
| Minimap relief classification | choose the imported light/flat/dark shade from the sign of `dHeight/dx - dHeight/dy`; clamp boundaries, leave plateaus neutral, treat magnitude ≤1e-6 as numerical flatness | colours **owned**. Screen-right lighting **reference-informed** by the human's 2026-09-22 editor screenshot: +x projects down-left and +y down-right, so the provisional `-dx-dy` axis was wrong. Four-neighbour classification, equal axis weights, diagonal/corner treatment and tolerance remain **inferred/chosen**; no original height grid or raw reference-pixel comparison. Fog attenuation remains separate; missing shade metadata uses flat colour | `minimap.ts` `minimapReliefShade` | #96 |
| Minimap building squares | uniform snapped 2×2 backing pixels for live and remembered buildings, about 3×3 CSS pixels in the 2000px reference; farms hidden by DAT minimap_mode 0 | **measured** compact blue markers in `hud-bottom-2026-09-17.png`, sRGB; treating all mode-1 buildings uniformly **inferred**, since DAT and MapView state no per-building marker size | `minimap.ts` `drawBuilding` | #84 |
| Fogged minimap dim | `REMEMBERED_FACTOR` 0.55 | chosen | `minimap.ts` | — |
| Minimap flare | 4 s pulsing ring | chosen; `sounds.json` names the cue only | `minimap.ts` `FLARE_MS` | — |
| Double-click window | 350 ms | chosen | `main.ts` | — |
| HUD text | Georgia Bold at 0.70 × PointSize, Palatino's lining digits | measured against the SDF atlas (`combined.txt`); the atlas itself is the face | `hud.ts`, CSS | #92 |
| Font index → face mapping | inferred | inferred | `import_ui.py` | — |
| Names drop a trailing parenthetical qualifier | rule | chosen; the file's own buildable gate argues for it | `names.ts` | — |
| Stop / Back / Cancel / pack / unpack / build-page cells | the cells the layout leaves | chosen | `main.ts` | — |
| Training queue runtime placement | 70px portraits at Progress's x, 4px below its bottom; active portrait at the same x and StatusLabel's y; adjacent equal kinds grouped with counts | **measured** from the human's 2000×1125 barracks-queue screenshot (2026-09-20): active ≈(482,978), queue ≈(482,1029), 36px portraits at 36–37px pitch, groups 3/3/1; `commandpanel.json` gives the status/bar boxes but QueueButtons has no runtime geometry | `hud.ts` `setTrainingQueue`, `style.css` | #140 |
| Grouped queue interaction and active tint | groups count waiting units only; clicking a group cancels its first waiting entry; separate active portrait cancels index 0; green fill at 30% opacity tracks progress | **human-confirmed**: active militia is additional to the first three waiting militia. **Chosen**: cancellation within a waiting group and tint alpha; wrapping tested through 14 alternating waiting entries plus the active unit (15 total) | `hud.ts`, `style.css` | #140 |
| The AI's computer name | dealt by seed from `civilizations.json`'s table | chosen dealing, owned table | `ai.ts` | — |
| Under-attack alert rearm | 10 s | chosen; `sounds.json` names the cue, not its rearm | `cues.ts` `ALERT_INTERVAL` | — |
| Fallow-farm alert grace | 0.5 game seconds | chosen | `cues.ts` `RESEED_GRACE` | — |
| Aesthetic scatter | view-only sprites | chosen (the script deals objects) | `world.ts` | — |
| Nearctic snow dusting | not dealt | tried, reverted | — | #118 |
| Deer startle | hop 1.5 tiles, rest 14-20 s | inferred (AoE wiki); the 1-tile trigger is the DAT's `search_radius` | `data.ts` | — |
| The monk's occlusion contour | absent at x1 | decoder invariant fails on the base depot's outline layers; the pack's x2 layers pass it, so with the pack the monk has its contour | manifest `skippedMasks` | #119 |
| Which file the Enhanced Graphics Pack draws, and at what size | the DAT's `<stem>_x1.sld` becomes the pack's `<stem>_x2.sld`, drawn at half size | inferred: the DAT names `_x1` only; the pack ships a `_x2` for each and its drawn pixels sit within one x1 pixel of the x1 art's once halved about the hotspot (`test_the_pack_sources_every_sprite_at_twice_the_density`); `widgetui/build_atlas.ps1` states the UI's UHD level is twice HD, nothing states the sprites' | `depot.py` `Graphics.source`, `sprites.ts` `applyFrame` | #151 |
| Shared-match presentation pacing | 100 ms wall-clock input buffer; yield after a 4 ms work batch (or 32 messages); linear position interpolation between adjacent simulated ticks | chosen engineering policy for household play, not read DE networking behaviour; fixed-timestep and lockstep sources in `docs/shared-play.md` | `src/shared/playback.ts`, `src/shared/client.ts`, `main.ts` | #153 |
| Shared snapshot compression | negotiate permessage-deflate for snapshots ≥1 KiB, no context takeover; ordinary server ticks/settings/errors stay plain | **chosen** transport policy using the existing `ws` implementation and its default compression level, not DE networking behaviour; extension opt-out preserves the same raw JSON protocol | `src/shared/snapshot-compression.ts`, `server.ts` | #174 |
| Map selection UI | compact native map/seed controls in the existing menu, rather than the full reference catalogue; positive uint32 seeds, blank for a clock-generated seed | chosen project layout/policy after inspecting `screenmapselection.json` and `editorbottommappanel.json`; labels and standard map names imported from strings 9472, 9682, 9691, 10107, 10658, 10875, 10878, 10885; surveyed/proof names are project names | `hud.ts`, `match-setup.ts`, `import_content.py` | #144 |

## Adding a row

A row is added in the same commit as the value. "Where" is a file and a
symbol; "Source" is one of the classes above; an inferred rule says so even
when the result looks right. When a row is later read from a file, delete it
— `git log` keeps the record.
