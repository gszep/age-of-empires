# Civilisation expansion: audit and first playable slice

Tracking: [#122](https://github.com/gszep/age-of-empires/issues/122) is the parent
of 59 individual civilisation issues, each with source-specific findings and an
acceptance checklist. Start with [Britons #179](https://github.com/gszep/age-of-empires/issues/179)
and [Franks #180](https://github.com/gszep/age-of-empires/issues/180). The tracker
separates 53 base-era profiles from the six Antiquity-era profiles; shared engine
dependencies remain under #128 and #178. Bonus/count-prerequisite consumers and
building age stats (#123/#129/#126) have since shipped; their explicit inference
boundaries remain in `docs/ledger.md`.

## Audit checkpoint

The 2026-09-24 audit covers **59 non-Gaia civilisations** in the pinned source:
**53 base-era**, **6 antiquity-era**. It inventories every owned civilisation
tree, tree/team effect, offered research and civilisation-specific automatic
technology candidate against the current imported roster and effect decoder.
It does not make additional civilisations selectable.

Verification: `.local/civilization-audit-gate.log` is **GREEN**: 735 Vitest
tests, 100 Python/import tests, production build and real-browser debug smoke.
Focused tests also verify full owned-tree coverage, deterministic audit output,
foreign metadata detection, prerequisite classification, building work-rate
classification and public-command rejection without spending. The browser check
is the existing smoke, not a mixed-civilisation acceptance test. No test timeouts
were widened. This foundation is included in the combined wrap-up checkpoint;
`docs/handoff.md` records its final verification and remaining work.

Reproduce with:

```bash
uv run --locked python tools/audit_civilizations.py --markdown .local/civilizations-audit.md
```

## Per-player rules foundation

### Briton completion pass (2026-09-26)

The reviewed Briton roster now has no missing unit/building tree IDs in the
published catalogue. This is roster coverage, not proof that every technology
or shared game mode is complete.

- Stone/fortified walls and gates, Guard Tower/Keep, building age stats and
  Arrowslits descendants are integrated, including existing foundations and
  occupied buildings. Public wall dragging and paid upgrades have browser probes.
- Petards, Siege Towers and live ram crews are integrated with original art,
  petard explosion feedback and public wall-crossing/unload orders. Constants
  and geometry without runtime evidence remain explicit in the ledger.
- Relic pickup/carry/drop/deposit/income/loss, carried art and Drop Relic UI are
  integrated. Shared follow-up508a2f2 adds source-backed placement on Arabia,
  Black Forest and Islands plus an explicit authored-map policy; #130/#95 retain
  native placement calibration and fish gaps, not absent other-map relics.
- Devotion, Faith, Theocracy, Herbal Medicine, Block Printing and Illumination
  have gameplay consumers, including spent/recharging faith and garrison healing.
- Warwolf reaches the deployed trebuchet's actual projectile, and Siege Engineers
  reaches its damage/range without applying both form commands twice. Shipwright
  changes production time; Caravan changes trader work as well as speed.
  Paid training receipts preserve refunds across research and JSON snapshots.

The final five research consumers are now implemented: **Siphons**, random-map
**Spies**, **Guilds**, **Coinage** and **Banking**. Public buy/sell/tribute actions
validate atomically; Spies prices at acceptance and shares enemy sight; Siphons
adds a source-backed bounded charge projectile with original impact feedback.
Private published-asset browser clicks cover all five, including a live Spies
price change, actual resource transfers and 729 changed sRGB impact pixels
(`.local/britons-final-research-browser.log`). Focused outcomes cover owner
isolation and JSON continuation. This is gameplay evidence, not an inference from
the empty `missingRoster` array. Final gate **GREEN**: 906 tests / 70 files,
build, 124 owned-import tests and general browser smoke
(`.local/britons-final-gate-r1.log`), with no timeout widening.
Shared follow-ups add the locked two-player diplomacy/tribute dialog (ec26a02)
and Regicide/Treason. Unlocked diplomacy/cooperative victories are not offered;
native Regicide calibration remains #240. Charge/market runtime calibration,
relic map-generation parity and conversion questions remain explicit. The ledger
labels bounded implementation choices as inferred, not user-approved policy.
The shared Regicide checkpoint passed **960 tests /73 files**, build,
**128 owned-content tests** and general browser smoke
(`.local/regicide-gate-r3.log`), plus dedicated solo and two-client browser
acceptance. These mode results do not imply completion of further civilisations.

`civilizations.ts` now resolves each player's complete ruleset by its civilisation
key. The root remains the default civilisation and shared Gaia/map input.
Additional `GameRules.civilizations` / manifest `civilizations` entries are complete
profiles, not patches over the enemy's rules. The importer now extracts Britons,
Franks and Goths with independent bonus graphs and namespaced art/voices/icons. The
spec enables reviewed profiles after supported-gameplay browser acceptance; the 53-entry
base-era catalogue remains an inventory, not 53 playable civilisations.

Owner-specific consumers now include initial resources/stats, population,
training/queues/refunds, research/upgrade effects, construction costs/HP/footprints,
farm food, gathering, repair, combat, sight, garrison, terrain passability and
completion continuations. Terrain-layer caches include the owning rules table;
separation uses each unit's navigation grid. The HUD resolves local commands and
selected/enemy entity information separately. Restarts preserve the selected sides,
and dev reload declines a saved civilisation whose profile is no longer loaded.

`src/sim/civilizations.test.ts` uses **synthetic contrasting profiles**, not
invented Franks bonuses. It checks actual deductions, completed units/buildings,
food collected, target HP loss, visible tiles, cache isolation, research on
garrisoned units, JSON continuation and a headless mixed-record replay.
`tools/civilization_rules_smoke.mts` injects a private synthetic profile into the
normal owned manifest loader and resumes both sides. Real clicks verify prices,
unavailable unit/research filtering, trained HP and placement footprint/cost.
The owned sprite set is shared by that fixture; it is not Frankish-art acceptance.

Foundation verification: `.local/civilization-rules-gate.log` is **GREEN**:
747 Vitest tests / 57 files, 100 Python/import tests, build and general browser
smoke. The dedicated browser result is `.local/civilization-rules-smoke-r2.log`;
the first attempt checked a button before the HUD refresh, fixed by waiting for
that element. Full regeneration succeeded in `.local/civilization-rules-import.log`
with all 1,984 cached sprite atlases reused. No timeouts were widened.

**Conversion uses the documented inferred policy (#178).** It snapshots donor
unit-local rules, retains wounds and
excludes captures/passengers from future research and promotions, including after
reconversion. Synthetic public-command outcomes and owned Loom regressions cover
the implementation; JSON continuation/replay preserve the snapshot. The boundary
between frozen unit attributes and live recipient economic/player/projectile
systems is explicitly inferred in `ledger.md`. Passenger, reconversion and
economic/projectile exception evidence remains open. The user authorized the
implementation work, not this exact inheritance policy. Tests verify the chosen
implementation and do not establish patch-matched DE parity.

The #177/#178 integration checkpoint passed **797 Vitest tests / 62 files**, the
build, **108 owned-import tests**, and general browser smoke
(`.local/civ-integration-gate.log`, single Vitest worker, unchanged timeouts).
Full `npm run import:aoe2` regenerated the published manifest with 1,984 cached
atlases reused (`.local/civ-integration-import.log`). The focused six-file run
passed 147 tests (`.local/civ-integration-focused-final.log`); the private TC
browser verified replacement/expansion, red/green previews, payment, foundation
limits, completion, population and training against that manifest
(`.local/civ-integration-tc-smoke-r5.log`). Earlier smoke attempts exposed probe
camera-frame/button-click races, fixed with presentation-state waits and locator
clicks. An initial added Loom assertion used the wrong remembered melee armour;
the owned help/effect confirms +1, giving 3 damage from a 4-attack militia.
No civilisation bonuses or roster expansion are included in this checkpoint.

### Supported Britons/Franks integration verification (2026-09-25)

The subsequent bonus/roster integration gate is **GREEN: 820 Vitest tests / 64
files, build, 114 Python/import tests and real-browser debug smoke**
(`.local/civ-profiles-checkpoint-gate.log`, one Vitest worker, unchanged timeouts).
`npm run import:aoe2` repeated byte-identically for content, UI and audio manifests
(`.local/civ-profiles-verified-repeat.log`): 2,122 cached atlases and 3,944 shared
source/layer aliases. Decoder/packer functions were not changed.

The enabled published profiles pass `tools/civilization_profiles_smoke.mts`
without overrides (`.local/civ-profiles-browser-verified.log`): real menu choices,
reload and Restart, completed own unique training/absent foreign buttons,
name/icon/rendered-atlas identity, distinct castle art, Castle/Imperial payments
and once-only free farm research/new-versus-existing farm food. Advanced scenarios
are snapshot-staged; subsequent build/research/train input and gameplay clocks
are real and unmodified. The refreshed TC smoke passes too
(`.local/civ-profiles-tc-browser-verified.log`).

Integration fixes include disabled naval child filtering, ram/gate tree aliases,
preserving conversion snapshots during bonuses, and work-rate-aware observation
countdowns. Earlier gate failures exposed old root-only atlas assertions,
all-definitions-are-trainable assumptions and omitted scenario prerequisites.
Those fixtures were corrected explicitly; the AI spending fixture now supplies
its two required completed Dark-Age buildings rather than widening its clock.
Large pre-enablement manifest overrides use private HTTP/gzip because CDP's
100 MiB message limit disconnected interception. The initial namespacing import
reconverted shared canonical paths; subsequent full imports reused all atlases.

## Reading the audit output

Current scoped acceptance and remaining shared work:

| Civilisation | Remaining coverage beyond the enabled supported profile |
|---|---|
| Britons (#179) | Reviewed random-map gameplay scope accepted in db2c9c0/605f7f7 with full gates and actual browser outcomes; the shared limitations below remain explicit |
| Franks (#180) | Paid Bearded Axe/Chivalry/elite axeman acceptance and Heresy conversion-death implemented and browser-verified on2026-09-28; full gate GREEN. Shared native conversion/cargo calibration remains#178 |
| Goths (#181) | Enabled and verified through published-profile browser acceptance and a GREEN full checkpoint gate. Shared population-setting/native Incendiaries calibration remains#253/#252 |
| Shared engine | Native relic-generation calibration/fish gaps (#130/#95), unlocked diplomacy/cooperative victories beyond the current locked two-player dialog (#138), Regicide timing/preset/task calibration (#240), charge/market runtime calibration and conversion-policy parity (#178). Relic placement and playable Regicide/Treason are implemented; the ledger distinguishes mechanics from unresolved engine interpretations |

The imported catalogue now accounts for the already represented ram/tree alias,
palisade construction head and TC foundation. Raw unrepresented IDs are not a
count of distinct missing mechanics. Audit inventories alone do not establish
completion; the Briton scope is accepted through the outcome evidence above.

The JSON and per-civilisation Markdown reports stay in `.local/`. They include
source hashes, effect/attribute counts, missing unit/building IDs, prerequisite
choices and metadata inconsistencies. Counts are source-reference occurrences,
not counts of distinct missing mechanics. A missing unit ID may be an age
variant or supporting tree node. Recognised encodings are not a gameplay
fidelity certificate.

## Findings that change the implementation plan

1. **Rules must be selected per player.** At audit time `GameState.rules` contained
   one civilisation's roster and technology table. Changing
   `players[p].civilization` alone changes neither of them. Previously `civHas`
   returned true when the player's key differed from the loaded civilisation.
   The foundation above now provides that rule-selection boundary and rejects
    unloaded keys. Britons/Franks publication and selection now use that boundary;
    additional civilisations remain #122 work.
2. **Bonuses have a lifecycle.** `civs[i].tech_tree_id` and `.team_bonus_id`
   are effect IDs. Many other bonuses are automatic technologies with
   `tech.civ`, `required_techs` and `required_tech_count`. A positive required
   count with only -1 slots is not an unconditional bonus; scenario/game-mode
   candidates must not all run at match creation.
3. **Decoder support is not consumer support.** Attribute 13 now advances
   building production/research work: Briton team effect 399 is verified by
   earlier completed archers. Unsupported commands remain explicit diagnostics.
4. **Costs and free research need shared support.** Attribute 100 changes all
   unit/building resource costs; 103–106 address individual costs. Franks'
   tree effect also changes farm technologies' research cost/time. These must
   affect public-command deductions, availability, refunds and displayed prices.
5. **Prerequisite lists are not conjunctions.** The audit finds required-count
   choices across the roster. Some involve age/bookkeeping nodes rather than
   alternatives visible to the player. #129 must preserve that distinction and
   must not satisfy unknown prerequisites by silently dropping them.
6. **Alternate-era metadata is not a reliable unique-tech catalogue.**
   Achaemenid, Athenian and Spartan definitions reference Italian unique-tech
   IDs 499/494. Macedonian, Thracian and Puru definitions reference Wei IDs
   1062/1061. The audit records these foreign references explicitly. Use each
   civilisation's actual tree and DAT gates before importing playable research.
7. **Some tracker wording is stale.** Briton Yeomen is DAT technology 3,
   researched at the castle for 750 wood / 450 gold with a 60-second research
   time; it is not free.
   The patch's Frankish cavalry HP bonus is gated on Feudal Age, and its castle
   discount is staged across Castle and Imperial. Do not import remembered
   descriptions in place of these commands.

## First contrasting civilisation: Franks

### Frankish completion pass (2026-09-28)

The refreshed published profile has no missing roster entries and no offered
typed-tree research absent from its technology table. Heresy was the remaining
wholly skipped available research: technology439/effect188 now reaches the
defending player's conversion-death consumer, preserving ownership and entering
normal death feedback. Owned cost/time/icon/help remain pipeline-derived.

`src/sim/franks.test.ts` verifies paid Bearded Axe at actual added attack range,
existing/garrisoned/new elite axemen, Chivalry's actual training/research completion
against an unaffected opponent, paid Heresy and unavailable-Briton rejection,
plus JSON continuation hashes. `monastery.test.ts` covers defending versus
attacking-player Heresy, group faith and ram-passenger release. The latter cargo
policy remains explicitly inferred in the ledger/#178.

`tools/civilization_profiles_smoke.mts` now exercises real paid unique research,
elite promotion and bound elite artwork, new stable training, monastery
construction/Heresy and an enemy monk's public conversion order, in addition to
the existing menu/restart/reload, castle-cost and free-farm lifecycle checks.
Both profiles pass (`.local/franks-profiles-browser-r2.log`). The first attempt
put monastery on the wrong probe menu page; the probe now uses the maintained
`pageOf` helper, with unchanged timeouts. Full import succeeded
(`.local/franks-import.log`); five profile import tests and39 focused simulation
tests pass. Native conversion odds, cargo and other shared engine calibration
limitations remain separately tracked; these checks do not establish native
runtime parity.

Checkpoint gate GREEN (`.local/franks-gate-r2.log`):1061 Vitest tests/87 files,
build,151 owned-import tests and browser debug smoke. Three workers, unchanged
timeouts. The first gate found a missing TypeScript player-attribute union member;
it was added before the passing run. No fixture clocks were widened.

Choose **Britons versus Franks** for #122/#123. Both use the owned `CivWest`
HUD family; Franks test costs, automatic research, age gates and health while
Britons test range, gathering and production rate. Sharing a HUD family does
not establish that every castle, flag, voice or sprite is shared.

| Source | What it exercises | Acceptance outcome |
|---|---|---|
| Briton automatic tech 383 | shepherd work rate ×1.25 | more food actually gathered/banked, only by its owner |
| Briton 381 | Castle-Age TC wood cost ×0.5 | actual paid construction cost, requiring #177 availability work |
| Briton 382/403 | Castle/Imperial foot-archer range and sight, with skirmisher reversals | real attack reach and visibility at each age |
| Briton team effect 399 | archery-range work rate ×1.1 | earlier unit completion; no benefit to the opponent |
| Frankish 524 | forager work rate ×1.15 | more food actually gathered/banked, only by its owner |
| Frankish 290 | cavalry HP ×1.2, gated on Feudal Age | existing, newly trained and garrisoned cavalry agree |
| Frankish 325/330 | staged castle cost multipliers | public build deductions and HUD prices agree in both ages |
| Frankish tree effect 258 | farm-research cost/time modifiers | eligible farm upgrades arrive once, without charging research |
| Frankish team effect 403 | knight-line sight | actual revealed tiles, including after upgrades |

Franks also require their own unit availability and unique-unit/upgrade art.
Missing roster IDs are in the detailed report; copying Britons' longbowman
button into the Frankish castle is not a valid partial implementation.
Specifically, `FRANKS.json` has no Longbowman unit node: its node ID 8 is **Town
Watch, Use Type Tech**, not unit 8. The importer now denies definitions absent
from a civilisation's typed tree as well as explicit `NotAvailable` nodes.
Rule definitions needed for captured units are distinct
from permission to train them.

## Implementation checklist

### Gothic implementation pass (2026-09-28)

The profile adds Huskarl/Elite Huskarl, Hussar and Dromon, independent
availability/bonuses, architecture, flags, icons, voices and native hotkeys.
Source tree759/761 are represented by the current41/555 secondary training slot;
the DAT Anarchy effect now enables barracks production without moving the castle
button. Both source clocks and cells survive queued production and elite upgrades.
TC-annex bookkeeping activates the one-second paid Loom modifier. Hunting has
distinct output productivity, work rate and carrying capacity. Imperial's+10
unit-limit bonus changes the match ceiling rather than granting houses; see#253
for chosen default200 and remaining configuration/reference calibration.

Incendiaries was the final wholly skipped available research. It now uses dead
unit2624's own blast attacks/radius and the owned explosion feedback. The single
death feedback, non-owner damage and immediate/scuttling behaviour are documented
inferences under#252. The profile has no missing roster entries or wholly skipped
available research; that inventory is supplemented by actual outcome checks.

`src/sim/goths.test.ts` verifies13 outcomes: paid Loom, four age discounts/refunds
and building damage, Anarchy/elite/Perfusion production, a housing-versus-ceiling
production boundary, hunting consumption/banking, Incendiaries damage/death art,
Dromon volleys, captured Huskarls, unavailable fortifications and mixed replay.
The public UI probe `tools/goths_smoke.mts` passes for both pending and published
enabled profiles (`.local/goths-browser{,-pending}.log`): menu/reload/restart,
paid research, castle and barracks production including the native secondary
hotkey, elite artwork and actual Incendiaries damage with the source explosion
texture bound. Scenarios are staged; gameplay clocks and subsequent input are real.

The first import exposed a previously unhandled fileless`E` garrison-graphic
placeholder; its child layers now remain traversed. Atlas decoder/packer code
was not changed. The initial source-alias comparison exposed an extra zero attack
entry on41; nonzero attacks match. Existing building tests now respect each
profile's available tech tree: seven inapplicable Gothic stone/tower tests skip,
and public rejection is verified separately. Briton/Frank cases remain exercised.
No test or fixture clocks were widened.

Full gate GREEN (`.local/goths-gate-r2.log`):1076 Vitest tests/88 files,7 explicitly
inapplicable Gothic fortification cases skipped, build,156 owned-import tests,
and real-browser debug smoke. The first gate exposed an availability-path
performance regression: resolving all units' combat effects was unnecessary.
Only changed training-location units now need full resolution. The affected
isolated AI test measured28.4→13.1s; three seeds through12000 ticks have identical
whole-state and availability-stream hashes before/after the optimization
(`.local/goths-training-equivalence.log`). No timeout increase.

- [x] Reproducible all-civilisation coverage inventory with source provenance.
- [x] Select a contrasting second civilisation from the owned data.
- [x] Reject unloaded civilisation labels instead of silently granting the
  currently loaded rules and unrestricted availability.
- [x] Resolve rules and technology availability per player throughout simulation,
  command pricing, HUD and visibility; preserve the civilisation in AI observations
  and reject unavailable keys. Verified with synthetic profiles.
- [x] Resolve real per-civilisation sprite/voice/icon bindings and preserve
  conversion snapshots under the documented #178 policy.
- [x] Import passive/team effects and their activation gates; implement supported
  unit/building costs and building production-rate consumers.
- [x] Handle required-count prerequisites and eligible free research without
  treating scenario-only or inactive automatic candidates as unconditional.
- [x] Enable reviewed shared combat/unique-unit roster, profile art and selection UI.
- [ ] Complete every supported-era roster/effect for #179/#180.
- [ ] Verify mixed matches, age changes, already-paid queues/refunds, conversions,
  garrisons, JSON save/reload and deterministic replay through public actions.
- [x] Verify the actual selection/command UI in a private browser and run the gate.

Conversion deserves a separate reference check: changing owner must not silently
recompute the captured unit using the wrong civilisation's base stats or bonuses.
The audit inventories data; it does not establish the closed engine's conversion
  inheritance behavior, free-research timing or rounding of discounted integer costs.
