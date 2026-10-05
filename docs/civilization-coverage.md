# Civilisation expansion: audit and first playable slice

Tracking: [#122](https://github.com/gszep/age-of-empires/issues/122) is the parent
of 59 individual civilisation issues, each with source-specific findings and an
acceptance checklist. Start with [Britons #179](https://github.com/gszep/age-of-empires/issues/179)
and [Franks #180](https://github.com/gszep/age-of-empires/issues/180) for the historical foundation. The tracker
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
the empty `missingRoster` array. Final owned checkpoint **GREEN**: 906 tests / 70 files,
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
Franks, Goths, Teutons, Japanese, Chinese and Byzantines with independent bonus graphs and namespaced art/voices/icons. The
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
excludes converted entities from future research and promotions, including after
reconversion. Synthetic public-command outcomes and owned Loom regressions cover
the implementation; JSON continuation/replay preserve the snapshot. The boundary
between frozen unit attributes and live recipient economic/player/projectile
systems is explicitly inferred in `ledger.md`. Building-cargo, reconversion and
economic/projectile exception evidence remains open. The user authorized the
implementation work, not that entire inheritance policy. The user's 2026-09-30
mobile-cargo rule is now implemented: passengers stay aboard under their original
owners and only the carrier owner can eject them; original-owner research still
reaches those unconverted passengers, including nested cargo. Tests verify the chosen
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

The subsequent bonus/roster integration checkpoint is **GREEN: 820 Vitest tests / 64
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
countdowns. Earlier checkpoint failures exposed old root-only atlas assertions,
all-definitions-are-trainable assumptions and omitted scenario prerequisites.
Those fixtures were corrected explicitly; the AI spending fixture now supplies
its two required completed Dark-Age buildings rather than widening its clock.
Large pre-enablement manifest overrides use private HTTP/gzip because CDP's
100 MiB message limit disconnected interception. The initial namespacing import
reconverted shared canonical paths; subsequent full imports reused all atlases.

### Japanese implementation (2026-10-01)

DAT5's complete available roster now resolves, including Samurai291/Elite560
and Elite Cannon Galleon691. Existing shared units/buildings remain independently
gated per profile. Owned Japanese localization, Asia buildings/flags, unit icons,
Samurai art and Japanese voice-switch branches flow through the full pipeline.
No other civilisation is enabled by this checkpoint.

Japanese integration consumes the half-price mill/camps, Feudal infantry reload,
age-gated fishing speed/double HP, cavalry-archer anti-archer/skirmisher exception,
and Galley-line sight effects. Yasama increases both base and maximum tower
projectiles; Kataparuto modifies actual pack/unpack and deployed attack clocks.
Samurai use the bounded source task133 approach-speed mode. Native runtime
calibration of the latter two is#259; conversion retains the shared#178 policy.

`src/sim/japanese.test.ts` passes24 outcome tests: paid construction, age research,
existing/garrisoned/new infantry, actual fishing collection/banking and age
progression, visible tiles, damage exceptions, paid/refunded training, elite
upgrades, charge thresholds/cancellation, three-arrow empty-tower volleys through
Guard Tower/Keep, packing/fire timing, captured unique units, naval upgrade damage,
JSON continuation and mixed replay. Four owned Python tests cross-check source
gates, roster completeness, signed/fractional attack decoding, task fields and
unique research. The six-file shared regression pass covered80 tests before the
six extra fishing/approach cases were added; all24 final Japanese cases pass.
Receipts: `.local/japanese183-{sim-r3,source-tests,regressions}.log`.

The private browser passes both pending and **published enabled** acceptance
(`.local/japanese183-browser-r2.log`, `.local/japanese183-published-browser.log`):
real menu/restart/reload, mill placement and
50-wood payment, Samurai icon/name/training/elite art, own Asia building art,
Yasama's three live tower arrows, paid Guard Tower/Keep/Kataparuto, actual unpack
button and23-tick transition, fishing100HP/food banking and Elite Cannon Galleon
research/art/reload. The first browser attempt exposed a probe comparing the
raw editor qualifier `Trebuchet (Packed)` against the correctly normalised panel
name `Trebuchet`; the shared probe now uses the existing display-name contract.
Initial fixture corrections used source50HP fishing ships, TC garrison admission,
Euclidean movement distance and the missing-type naval upgrade row, without
widening any test clock.

Final owned checkpoint **GREEN** (`.local/japanese183-gate.log`),14m47s:
1150 Vitest tests/90 files,7 inapplicable Gothic fortification cases skipped,
public build,168 owned/Python tests and real-browser smoke. Full enabled import
completed (`.local/japanese183-enabled-import.log`), reusing3907 atlas groups.

### Chinese implementation (2026-10-01)

DAT6/tree257/team402 now has no missing available roster IDs. The pinned roster
includes Chu Ko Nu/elite, Fire Lancers/elite, Rocket Carts/heavy, Dragon Ship,
Lou Chuan and Siege Ram, with original profile-local buildings, flags, icons,
voices and unit/projectile art. Regional upgrade nodes are recognised alongside
ordinary/unique upgrades. Dragon Ship is the source's free Heavy Warships
descendant, including existing ships and later production.

The starting tech graph grants three extra villagers once, deducts200 food/50
wood and supplies15 TC housing/+7 sight. Age-gated research-cost resource85 feeds
actual command payments, tooltips and agent quotes. Hidden free team tech232
combines the farm-capacity copy with source resource69 (Farm Food Multiplier)
instead of compounding two10% bonuses. Great Wall reaches existing/occupied
structures, foundations and later construction. Pending crops keep their food.

Shared combat consumers now support sequential primary/secondary volleys,
source bulk-fire flags, charged alternate weapons with original special art and
charge HUD, target-specific Lou Chuan weapons, projectile research/redirection,
first-hit interception, armour bypass/resistance and public ground fire. Rocketry
reaches real Scorpion/Rocket Cart damage and Lou Chuan rocket art. Exact native
cadence/spread, replacement ordering and opening/bonus rounding are#260; the
ledger distinguishes source values from the deterministic integration policy.

`src/sim/chinese.test.ts` has27 outcome cases: three-map starts and reload,
TC construction without repeated grants, research payments through all ages,
farm yields, Great Wall HP, Chu Ko Nu damage/refunds/elite/capture, firearm
animation/bullets/melee/recharge, interception, ground-fire schema and splash,
regional upgrades, moving-target firearm/melee windup switching, Lou Chuan range/Chemistry/Rocketry, Scorpion/Ram damage,
Dragon Ship/Siphons, in-progress volley JSON continuation and mixed opening
replay. The focused Chinese/protocol/sprite run passed82 tests
(`.local/chinese184-sim-r4.log`, before the final switching case); the final
Chinese/building/civilisation pass has85 passing cases plus7 existing inapplicable
skips (`.local/chinese184-final-focused.log`). Four owned contracts pass
(`.local/chinese184-source-tests-r2.log`).

Both pending and **published enabled** private-browser acceptance pass:
`.local/chinese184-browser-pending.log` and
`.local/chinese184-published-browser-r3.log`. Actual menus/restart/reload, discounted
age/research payments, farm placement/yields, Great Wall, all new unit lines and
upgrades, special firearm art/three bullets/charge HUD, ground-fire button/Stop,
Dragon Ship's free upgrade and Lou Chuan's rocket change are exercised. A naval
probe failure exposed its pages-as-strings assumption: the correctly rendered
`attack-special-p1.png` was in `pages[].image`. The helper now verifies every
actual page URL. Another attempt was interrupted by an agent edit causing a full
reload/pause; the complete run was repeated with code frozen. No clock widened.

The broader checkpoint exposed old fixture assumptions: every civilisation paying200
food for Fortified Wall, every opening containing three villagers, an effect mock
omitting its real `c` field, a shooter-dispersion assertion applied to projectile
definitions, and an Incendiaries target inventory predating the captured Dragon
Ship definition. Fixtures now check live prices, an explicit three-unit crew,
source-shaped commands, shooter/projectile distinctions and actual DAT targets.
Targeted regressions pass without weakening damage or changing timeouts. Final
review also kept ground fire behind the common civilisation/match guards and
synchronised firearm-to-melee windup with the selected animation.

The complete enabled import (`.local/chinese184-enabled-import.log`) reused4101
atlas groups. The first import's canonical-namespace cache misses took about80
minutes; concrete evidence is recorded on#257, not hidden as a stalled job.

Final owned checkpoint **GREEN**, exit0,19m27s (`.local/chinese184-gate-r3.log`):
1186 Vitest tests/91 files,7 existing inapplicable Gothic fortification cases
skipped, public bundle build,172 Python/owned-content tests and real-browser
debug smoke. No test timeout or fixture clock was widened.

### Byzantine implementation (2026-10-02)

DAT7/tree256/team400 now has no missing available roster IDs. Cataphracts40/553
and Camel Riders329/330 join the existing shared roster, with independent gates,
MEDI buildings/flags/HUD, icons and voices. The source's free sight technologies,
discounted Imperial research and counter-unit prices, staged building HP and
Fire Ship/Dromon reload bonuses have public-command outcome coverage.

New shared consumers cover type101/103 multiplication, heal task amount times
work rate and resource89, fixed melee collateral from negative `blast_damage`,
and building projectile redirection. Logistica adds source infantry damage and
five-HP collateral; Greek Fire reaches actual Fire Ship range and Dromon/Bombard
Tower radius/projectile changes. Native geometry/healing/rounding remains#267;
the ledger distinguishes source facts from those integration policies.

Four source contracts pass (`.local/byzantines-source-tests-r2.log`). The52-case
focused run covers Byzantine outcomes plus Teuton, monastery and elevation
regressions (`.local/byzantines-focused-r5.log`). Fourteen Byzantine cases measure
paid ages/building wounds/foundations/new construction/sight, discounted training
and refunds, healing, Logistica damage/ally exclusion, elite/garrisoned/new units,
naval reach and reload against an opponent, tower cannon art/collateral, captured
unique stats, JSON continuation and command-record replay. Generic building
expectations now include the source Byzantine house/wall HP multipliers; existing
damage, wound and replay assertions and fixture clocks remain intact.

The complete pending-profile private browser passes
(`.local/byzantines-browser-r5.log`): menu/restart/reload, MEDI HUD/castle art,
Cataphract icon/name/training/elite and Logistica collateral, discounted Camel
Riders/elite, actual healing, house and Bombard Tower placement, free sight techs,
670/536 Imperial payment, Greek Fire, Dromon and Fire Ship upgrades/projectiles.
Earlier probe failures exposed a HUD refresh race, incorrect half-tile house
placement, and a tower target killed during setup. The final fixture stages that
target in range after paid research, at source HP, without changing clocks.

The seventh profile exposed a shared release blocker#268:551,770,741 bytes of
minified atlas metadata exceeded V8's string ceiling. Schema4 interns repeated
frame arrays to52,882,276 bytes/2334 unique arrays. Expanding the whole manifest
reproduced SHA2569380ea82b21c3108f24479a3e5e2531bdd24537137527d422c866d6875e28367
exactly. Full publication reused all4850 cached atlas groups; no decoder or PNG
changes were needed. Browser hydration preserves root/profile/annex frames and
per-use scale/pages; malformed references fail and legacy inline metadata works.

Published-enabled acceptance, frame-metadata/general-browser and owned/fallback
cargo receipts all pass (`.local/byzantines-published-acceptance.log`,
`.local/atlas268-acceptance.log`, `.local/byzantines-cargo-acceptance.log`). Final
owned checkpoint **GREEN**,13m05s:1218 TypeScript tests/100 files,8existing skips, build,
184 owned/Python tests and real-browser smoke (`.local/byzantines-gate.log`).
Live household deployment remains separately versioned in the current handoff.

## Reading the audit output

Current scoped acceptance and remaining shared work:

| Civilisation | Remaining coverage beyond the enabled supported profile |
|---|---|
| Britons (#179) | Reviewed random-map gameplay scope accepted in db2c9c0/605f7f7 with owned checkpoints and actual browser outcomes; the shared limitations below remain explicit |
| Franks (#180) | Paid Bearded Axe/Chivalry/elite axeman acceptance and Heresy conversion-death implemented and browser-verified on2026-09-28; owned checkpoint GREEN. Shared native conversion/cargo calibration remains#178 |
| Goths (#181) | Enabled and verified through published-profile browser acceptance and a GREEN owned checkpoint. Shared population-setting/native Incendiaries calibration remains#253/#252 |
| Teutons (#182) | Enabled and verified through published-profile browser acceptance and a GREEN owned checkpoint. Conversion queue/cargo/probability and zero-time grant calibration remain#178/#254 |
| Japanese (#183) | Source-backed roster, bonuses, both unique technologies, Samurai/elite and Elite Cannon Galleon; native approach/packing calibration is#259, shared conversion is#178 |
| Chinese (#184) | Source-backed complete available roster, starting/economy/fortification bonuses and regional/unique weapons; native timing, projectile ordering and rounding calibration is#260 |
| Byzantines (#185) | Source-backed roster, age/price/sight/naval/healing bonuses, Cataphracts/elite, Camel Riders/elite, Logistica and Greek Fire; native healing/blast/HP calibration is#267 |
| Shared engine | Native relic-generation/water-mask calibration (#130/#95) and remaining Islands seasons/object passes (#274), unlocked diplomacy/cooperative victories beyond the current locked two-player dialog (#138), Regicide timing/preset/task calibration (#240), charge/market runtime calibration and conversion-policy parity (#178). Relic placement, distinct seasonal fish/islet shore fish and playable Regicide/Treason are implemented; the ledger distinguishes mechanics from unresolved engine interpretations |

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

Owned checkpoint GREEN (`.local/franks-gate-r2.log`):1061 Vitest tests/87 files,
build,151 owned-import tests and browser debug smoke. Three workers, unchanged
timeouts. The first checkpoint found a missing TypeScript player-attribute union member;
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

## Teutonic implementation pass (2026-09-30)

Teutons now have their own selectable profile, source art/flags/icons/voices,
Teutonic Knight/Elite, Siege Onager and Bombard Tower. Source-backed shared
consumers include garrison capacity and maximum projectiles, heal-range changes,
conversion task permissions/ranges/windows, captured-building rule snapshots,
construction research prerequisites and fractional packed attack values.

`src/sim/teutons.test.ts` has16 passing outcome tests:36-wood farms; once-only free
Murder Holes/Herbal Medicine; extended healing and25/10 TC/tower garrisons; actual
age-dependent armour on existing, garrisoned and new units; paid Ironclad,
Crenellations and elite upgrades; ranged castle fire and infantry volley growth;
Redemption/Atonement permissions, adjacency, protected structures and retained
captured-building stats/work; Bombard Tower cannon art/damage; Siege Onager damage;
captured Teutonic Knights and mixed replay/JSON continuation. Three source import
tests verify the newly consumed task and effect encodings.

`tools/teutons_smoke.mts` passes against the **published enabled manifest**, without
an enablement override (`.local/teutons-published-browser.log`). Actual menu,
restart/reload, paid research, farm/Bombard Tower placement, original unique/elite/
Siege Onager/tower artwork, right-click permission feedback and building capture,
monk conversion, retained captured HP and the25-capacity garrison HUD are exercised.
The scenario is explicitly staged and the opposing example AI is replaced by a
passive player; simulation clocks are unchanged and later actions use real buttons
or public commands. Shared private-browser helpers live in `tools/civ_browser.mts`.

The interrupted first browser run exposed a menu-refresh race in the probe, fixed
by waiting for the villager menu before switching pages. A resumed attempt timed
out during construction while source edits could trigger a page reload; the fresh,
unchanged-source rerun and subsequent published run both pass. No timeout was
widened. The Castle-Age confirmation test was updated to include independently
researched tower types rather than assuming every tower is an upgrade descendant.

The first owned checkpoint also exposed a definition/availability mismatch: unavailable
building definitions remain available for captured/scenario entities, but their
`buildable` flag now respects the civilisation's tree. The page invariant tests
all loaded profiles and their full research sets. Mapping capacity attribute2
also activates the owned standard transport bonuses1163/1164:20/20/25/35 by age.
Four public group-boarding checks verify the exact limits; the old base-20 test
now explicitly uses Dark Age. Long AI/relic tests pass focused reruns; host Windows
game/Steam CPU contention motivated a one-worker checkpoint, without changing timeouts.
Redundant full-stat lookups for unchanged drop-site categories/attack presence
were also removed. Before/after whole-state hashes match for three seeds through
12000 ticks with both example AIs and a captured defensive structure
(`.local/teutons-rule-equivalence.log`).
Final review reproduced and fixed a captured-factory queue edge: preserving the
building's donor stats must not prevent newly ordered units from receiving their
current owner's upgrades. A public-command regression covers both active and
waiting entries while retaining the captured barracks'1.2 work rate. A legacy
import assertion was also narrowed to its original default conversion fields;
the new task metadata is checked separately against owned source records.

The owned DAT provides the new permission gates and error strings. Source-defined
windows do not establish native random odds; queue cancellation, cargo inheritance,
normal healing's zero-range sentinel and zero-time research venue/ordering remain
explicit ledger inferences. #178 and#254 retain those reference questions. Full
import completed (`.local/teutons-enabled-import.log`). Final owned checkpoint
**GREEN** (`.local/teutons-gate-r4.log`):1105 Vitest tests/89 files,7 inapplicable
Gothic fortification cases skipped, build,159 owned-import tests and real-browser
debug smoke. One worker, unchanged timeouts. Only Markdown changed afterwards.

## Gothic implementation pass (2026-09-28)

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

Owned checkpoint GREEN (`.local/goths-gate-r2.log`):1076 Vitest tests/88 files,7 explicitly
inapplicable Gothic fortification cases skipped, build,156 owned-import tests,
and real-browser debug smoke. The first checkpoint exposed an availability-path
performance regression: resolving all units' combat effects was unnecessary.
Only changed training-location units now need full resolution. The affected
isolated AI test measured28.4→13.1s; three seeds through12000 ticks have identical
whole-state and availability-stream hashes before/after the optimization
(`.local/goths-training-equivalence.log`). No timeout increase.

## Saracens (#187)

The October3 re-audit reconciles civ9/tree261/team409 with `SARACENS.json`,
English120158, original graphics/audio metadata and `Effects.xs` function7.
No Saracen-specific RMS/include branches were found in the common depot;
Promisory's Saracen research branch describes strategy rather than replacing
the DAT rules. Mameluke282/556 additions close the remaining roster coverage.
The current unique research is **Bimaristan** and **Counterweights**;
Zealotry/Madrasah are retired gated definitions.

Existing consumers implement camel HP, transport HP/capacity, faster galley
reloads, market wood discount/five-percent fee and the archer/skirmisher building
attack bonus. The new shared passive-healing consumer expands the owned XS task
into per-unit research effects and preserves conversion snapshots. Its precise
cadence, stacking, self-targeting and range geometry remain explicitly inferred
under #285, which also tracks the DAT+3 versus localization+2 team-bonus mismatch.
Aura particle feedback remains #49. The scoped implementation preserves the
shared #178 conversion and #128 research boundaries.
The original Trade Cart selection/training/graphic events are absent from both
pinned audio packs; #271 tracks these same events shared with Persians. Their three
exact aliases publish as unavailable, with no substitute audio. Remaining
Saracen cues resolve through the owned switch normally.

Reproduction: `src/sim/saracens.test.ts`, `tools/test_saracens.py` and
`tools/saracens_smoke.mts`. The full pipeline passes
(`.local/saracens-final-import.log`), as does published-enabled private-browser
acceptance (`.local/saracens-browser-r2.log`): selection/restart/reload, ORIE HUD,
castle/Mameluke/elite/camel/monk/market/ship art, paid age and unique research,
passive healing, Mameluke damage, discounted market construction/exchange and
naval upgrades. Detailed source exports stay local under `.local/saracens-*`.
Final owned checkpoint **GREEN** (`.local/saracens-final-gate.log`):1403 Vitest tests across111
files, build,204 owned-import tests and general real-browser debug smoke.
Ten Saracen-specific outcomes pass; generic profile building tests additionally
exercise Saracen age stats, armour damage and JSON continuation. Eight existing
skips remain (seven inapplicable Gothic building cases and the opt-in economy
acceptance). No test/fixture clocks were widened. Native #285/#271 and shared
fidelity gaps remain open; this receipt does not claim native calibration.

## Turks (#188; worker acceptance, 2026-10-05)

Source reconciliation uses civ 10/tree 263/team 410, `TURKS.json`, English
120159, `civilizations.json` (CivOrie, emblem, unique icon and voice switch),
DAT graphics/projectile/audio records and XS constants. The earlier September
inventory is stale: shared gunpowder, naval, specialist and building work already
provides all roster nodes except Janissary 46/557. Adding those two source units
closes `missingRoster`; it does not require invented stats or weapon behavior.
RMS/include search found the civilization constant and Gaia civilization draw,
not a Turkish player-start override. Promisory `researches.per`'s Turks branch
prioritizes Artillery/Sipahi; it does not define their effects. The generic
profile pipeline supplies starting attributes, localized names, availability,
namespaced flags/art/icons and CivOrie HUD identity.

| Area | Implemented / deferred |
| --- | --- |
| Gold mining | Tech 300: gold work rate ×1.25, not stone; real extraction and banking tested against an opponent |
| Gunpowder HP | Tech 301: ×1.25 on supported source targets, including trained Janissaries, Hand Cannoneers and Bombard Cannons |
| Scout line | Tech 452: +1 pierce armor; real arrow damage, age-command free Light Cavalry/Hussar and wounded-unit upgrades tested |
| Chemistry | Free through tree 263 cost/time commands; required-count automatic activation retained, paid age bills unchanged |
| Gunpowder research discount | Source commands halve Bombard Tower and Elite Cannon Galleon research; Janissary elite and unique-tech costs are not arbitrarily halved |
| Team bonus | Effect 410 attribute 101: ×.8 train time, unchanged unit prices/refunds; mixed Hand Cannoneer production/HP tested. Allied teams remain outside the two-enemy-seat model |
| Unique units | Janissary/Elite imported with projectile 380, original graphics/audio and accuracy; castle training/garrison/elite promotion, combat and conversion/JSON continuation tested |
| Unique techs | Sipahi HP reaches existing/garrisoned/new cavalry archers; Artillery adds range/sight/search radius to Bombard Tower, Bombard Cannon and both Cannon Galleons. Real long-range cannon impact tested |
| Availability | Complete current tree inventory; explicit unavailable Elite Skirmisher and absent foreign unique units remain rejected; captured definitions are retained |
| Source gaps | Three original Trade Cart audio events unavailable (#271), no substitutions; foreign/scenario bonus targets and unsupported source commands stay diagnostic |
| Calibration | Fractional HP, half-resource payment rounding and foot-gunner garrison adapter need native checks; shared #128/#178/#254/#260/#267 and Chemistry projectile-art limitations remain |
| Integration | Enabled. Coordinator integration (October 5) passed full regeneration, `tools/turks_smoke.mts` private-browser acceptance and the owned checkpoint; see the integration receipt below |

Reproduction: `tools/test_turks.py` extracts the source contract (six tests),
`src/sim/turks.test.ts` has eleven public-outcome cases. Set `CIV_PROFILE_CONTENT`
to a private extracted content fixture to run before full regeneration; an
explicit fixture lacking Turks fails rather than silently skipping. Without
owned content, the existing open fallback remains unchanged. Worker evidence
lives in the durable issue-188 worktree under `.local/turks-*` and
`.local/astra-reconciliation.log`; no owned content is committed.
No smoke or checkpoint result is implied by an extraction-only fixture.

## Vikings (#189)

Worker implementation (October 5): DAT civ11/tree276/team411, owned
`CivTechTrees/VIKINGS.json`, localization120160/28312/28431, `Effects.xs`
function5 and the original graphic/audio records are reconciled. HUD metadata
is **CivSlav**, not CivNorse. Unique units are Longboat250/533 and Berserk692/694;
583/683 from the abandoned worker attempt are unrelated and removed. Both
Longboats use the existing composite-ship/no-decay spec, not invented corpses.
The imported roster has no missing available tree nodes.

| Surface | Worker status |
| --- | --- |
| Infantry HP | Shared automatic416 gives +20% at Feudal;391/415 have no effects, not additional age bonuses. Existing/new/garrisoned infantry compared against Britons after both players publicly research each age. |
| Warship and Dock costs | Age-gated395/501/502 source multipliers; team411 targets Dock IDs with attribute100. Galley/Longboat wood and gold payments/refunds, fishing-ship prices, unavailable Longboat rejection, Dock payments and enemy isolation tested. |
| Free Wheelbarrow/Hand Cart | Tree276 zeros213/249 cost/time; required-count automatic research supplies Feudal/Castle gates. Paid public age completion grants each only to Vikings, charging only the age price; movement and banked loads tested.392/400 are empty markers. |
| Unique units | Both lines train/upgrade; Berserks regenerate from owned40 HP/minute field; Longboats use shared four-projectile ship attacks. Converted Berserk regeneration, Chieftains lethal attacks/loot and in-flight Longboat shots have JSON-continuation checks. The mixed opening command replay covers villager training only. |
| Unique research | Chieftains463 cavalry/camel attacks plus XS loot tasks; loot tests include pre-research, same-owner non-infantry and enemy-killer negative controls. Bogsveigar49 archer-line/Longboat attack. Obsolete Berserkergang is not offered. |
| Presentation | Source art, names, icons, CivSlav HUD and Vikings audio switch flow through existing import machinery;542/542 consumed audio aliases resolve to media in both pinned packs, without new exceptions. |
| Integration | Enabled. Coordinator integration (October 5) passed full regeneration, `tools/vikings_smoke.mts` private-browser acceptance and the owned checkpoint; see the integration receipt below |

Promisory references Viking training/research and the legacy Berserk heal timer;
the searched common XS/AI and gamedata_x2 RMS/include files supply no replacement
runtime scheduling rule. Native fidelity boundaries are explicit in the ledger
and **#301**: Chieftains' XS differs from its tooltip, regeneration cadence and
garrison/conversion semantics need native calibration, and ship price rounding
and volley geometry retain shared engine inferences. #254 tracks zero-time
research ordering, #178 conversion, #260/#272 projectile timing.

The selectable spec is enabled only after the implemented supported gameplay
passed metadata-driven outcomes. This is a worker receipt, not a claim that
Vikings has passed the final browser/checkpoint gate. Reproduce with
`tools/test_vikings.py`, the Vikings art test in `tools/test_import_aoe2.py`, and
`CIV_PROFILE_CONTENT=.local/vikings-content.json npx vitest run src/sim/vikings.test.ts src/sim/saracens.test.ts`.
Local source/audit evidence is `.local/vikings-source.log`,
`.local/vikings-scripts.log`, `.local/vikings-audio.log`; the earlier
`.local/vikings-reconciliation.md` is preserved but superseded, not trusted.
Final worker checks: 10 Vikings and 10 Saracen outcomes pass without skips;
the expanded eight-file run passes 90 tests with 6 existing manifest-dependent
skips (conversion/naval suites read the absent published manifest, not the
metadata fixture). Six Vikings Python contracts, nine selected import
regressions, `tsc --noEmit` and `git diff --check` pass. No timeout was widened.
Logs: `.local/vikings-{sim-final,python-final,import-regression-final,tsc-final}.log`.
Review follow-up strengthened the existing tests without changing runtime code:
20/20 Vikings/Saracens tests (no skips, 26.73s), six Python contracts (25.164s),
typecheck and diff checks pass. Logs: `.local/vikings-followup-{sim,python,tsc}.log`.

## Turks and Vikings integration receipt (October 5)

Both worker trees were reviewed independently (approve with nits; nits closed by
added tests) and merged together; shared `import-spec.json` arrays and these
sections were unioned. Full `npm run import:aoe2` passed
(`.local/orchestrator/import.log`). Against the published manifest the Turks,
Vikings, Saracens, garrison, conversion, transport and naval suites pass 110/110
without skips. Private-browser acceptance passed: `tools/turks_smoke.mts`
(menu/reload, ORIE HUD, castle/Janissary/elite/Hand Cannoneer/Bombard Cannon art,
paid Imperial age with free Chemistry and no opponent grant, paid
Elite Janissary/Sipahi/Artillery) and `tools/vikings_smoke.mts` (menu/reload, SLAV
HUD, free Wheelbarrow and Hand Cart on paid Castle age with no opponent grant,
Berserk/Longboat and elite art, paid Chieftains/Bogsveigar/elite research). Run them
with `npx tsx`. Elite art is checked on freshly trained elite units: existing units
promoted by an elite upgrade keep drawing the pre-upgrade texture for every
civilisation, so `tools/saracens_smoke.mts` currently fails its Elite Mameluke
check; that regression is #303, not hidden here.

The first owned checkpoint caught the shared per-profile Arrowslits test assuming
11 Keep attack for every profile; Turks receive free Chemistry at Imperial,
whose source class-3 tower effect adds 1. The test now reads that amount from the
profile's own Chemistry effects. The rerun owned checkpoint is GREEN: 1604 tests/131
files with 8 existing skips, public build, 219 owned-import tests and real-browser
smoke in 458s (`.local/verification/1791204915172-217224/`). Native calibration
remains #302 (Turks) and #301 (Vikings); Trade Cart audio gaps #271.

## Implementation checklist

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
- [x] Complete playable roster/research coverage for Britons, Franks, Goths,
  Teutons, Japanese, Chinese, Byzantines and Saracens, retaining the listed shared engine/reference gaps.
- [x] Verify mixed matches, age changes, already-paid queues/refunds, conversions,
  garrisons, JSON save/reload and deterministic replay through public actions.
- [x] Verify the actual selection/command UI in a private browser and run the owned checkpoint.

Conversion deserves a separate reference check: changing owner must not silently
recompute the captured unit using the wrong civilisation's base stats or bonuses.
The audit inventories data; it does not establish the closed engine's conversion
  inheritance behavior, free-research timing or rounding of discounted integer costs.
