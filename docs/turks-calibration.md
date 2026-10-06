# Turks native calibration (#302)

## Status and provenance

**Partial / BLOCKED for stored fractional HP**, 2026-10-06, including the
coordinator-authorized continuation. Payment and naval measurements now complete;
ordinary Camel progression measured against a control. Measured on current build
**185872, not pinned 48987**, by owner authorization. All screenshot readings
below were **observed visually**, not extracted from native memory. Process
22012, installed at `D:\SteamLibrary\steamapps\common\AoE2DE`; 2560×1440
fullscreen, inherited UHD-unchecked configuration, unchanged during this run.
Single-player editor Tests only; no cheats, opponents or multiplayer. The
continuation used a Damage Object trigger solely for the HP experiment.

Evidence root (ignored, not distributable game assets):
`/home/fraser/repos/age-of-empires/.local/worktrees/issue-302-turks/.local/native/`.
Every named PNG has a same-stem JSON action/rectangle/process receipt, except
derived crops/contact sheets. Preserve this directory before retiring the tree.

## Observations

| Check | Turks | Teutons control | Captures relative to evidence root | Interpretation |
| --- | --- | --- | --- | --- |
| Hand Cannoneer HP | 50/50 | 40/40 | `{turks,teutons}-hp-hc.png` | Agrees with ×1.25 |
| Janissary HP | 44/44 | 35/35 | `{turks,teutons}-hp-jan.png` | Display agrees with rounding 43.75 upward; does **not** determine stored HP |
| Elite Janissary HP | 50/50 | 40/40 | `{turks,teutons}-hp-elite.png` | Agrees with ×1.25; separately placed elite, not an observed upgrade |
| Bombard Cannon HP | 100/100 | 80/80 | `{turks,teutons}-hp-bbc.png` | Agrees with ×1.25 |
| Camel Rider HP | 120/120 | 120/120 | `{turks,teutons}-hp-camel.png` | Imperial editor starts include earlier-age technologies; not evidence of a Turkish camel HP bonus |
| Paid Heavy Camel upgrade | 120 → 140 HP | Not researched | `turks-heavy-tooltip.png`, `turks-heavy-paid.png`, `turks-heavy-final.png`, `turks-stable-after.png` | Tooltip 325 food/360 gold; completed upgrade, button absent afterwards. Repeated/triggered research not tested |
| HC + Janissary enter TC | 2/15 | 2/25 | `{turks,teutons}-tc-result.png` | Both icons present; admission agrees |
| HC + Janissary enter Guard Tower | 2/5 | 2/10 | `{turks,teutons}-guard-result.png` | Both icons present; admission agrees. This is **Guard**, not Watch Tower |
| HC + Janissary enter Castle | 2/20 | 2/20 | `turks-castle-final.png`, `teutons-castle-result.png` | Both icons present; admission agrees |
| HC + Janissary enter Battering Ram | 2/6 | 2/6 | `{turks,teutons}-ram-result.png` | **Contradicted runtime rejection; repaired** |
| Initial naval setup | Failed land placement | — | `turks-ships-place.png`, `turks-second-layout.png` | Superseded by the verified water fixture below |

### Continuation: prices, naval HP and ordinary Camel progression

All values below are also **observed visually on build 185872**, not pinned
48987. W/F/G denote wood/food/gold. Control civs are named explicitly.

| Check | Turks | Control | Captures relative to evidence root |
| --- | --- | --- | --- |
| Elite Cannon Galleon tooltip | 262W/250G | Spanish 525W/500G | `cont-turks-ecg-price.png`, `cont-spanish-ecg-price.png` |
| Elite Cannon Galleon actual debit | 5000W→4738W; 5000G→4750G | Spanish 5000W→4475W | `cont-turks-ecg-paid.png`, `cont-spanish-ecg-paid.png` |
| Exact-budget acceptance | 262W→0W, research completed | — | `cont-turks-ecg262-before.png`, `cont-turks-ecg262-paid.png` |
| Bombard Tower tooltip/debit | 400F/200W; 5000F→4600F, 4738W→4538W | Byzantine tooltip 800F/400W | `cont-turks-bombtower-price.png`, `cont-turks-bombtower-paid.png`, `cont-byz-bombtower-price.png` |
| Chemistry | Already automatic at Imperial start; no paid button | Byzantine tooltip 300F/200G | `cont-turks-university.png`, `cont-byz-chemistry-price.png` |
| Elite Janissary | 850F/750G tooltip; 4600F→3750F, 4750G→4000G; upgraded Janissary 50/50 | Civ-specific, no control equivalent | `cont-turks-elitejan-price.png`, `cont-turks-elitejan-paid.png`, `cont-turks-upgraded-jan.png` |
| Artillery | 600F/650G tooltip, not half-price | Civ-specific, no control equivalent | `cont-turks-artillery-price.png` |
| Cannon Galleon HP | 150/150 | Byzantine 120/120 | `cont-{turks,byz}-ship-hp.png` |
| Elite Cannon Galleon HP | 188/188 placed and after paid promotion | Byzantine 150/150 placed | `cont-{turks,byz}-elite-ship-hp.png`, `cont-turks-upgraded-ship.png` |
| Camel Rider, Castle start | 120/120 | Byzantine 100/100 | `cont-{turks,byz}-camel-castle.png` |
| Same Camel after paid Imperial **age** | 120/120 | Byzantine 100/100 | `cont-{turks,byz}-camel-imperial.png` |
| Same Camel after paid Heavy upgrade | 140/140 | Byzantine 120/120 | `cont-turks-camel-heavy2.png`, `cont-byz-camel-heavy.png` |
| Stable after Heavy upgrade | No repeat Heavy/Imperial Camel button | Same | `cont-turks-stable-after2.png`, `cont-byz-stable-after.png` |

The exact-budget run rules out a 263-wood charge or a merely rounded display of
a 262.5-wood affordability threshold. Runtime payment was wrong and is corrected
below. Spanish research also grants that civ's gold rebate, so do not interpret
its net gold change as a pure technology price; the tooltip establishes 500G.
The Byzantine Dock lacks Elite Cannon Galleon; the empty hover attempts
`cont-byz-ecg-price*.png` are not price evidence. Spanish supplied that control.

There is no separately paid Hand Cannoneer or Bombard Cannon technology here:
DAT techs 85/188 have zero cost/time, location -1 and automatic enable effects.
Chemistry is the paid control gate. The Turkish half-price tree entries address
Bombard Tower (64) and Elite Cannon Galleon (376), not Elite Janissary (369) or
Artillery (10). Their unchanged tooltip costs agree with both DATs.

The Camel sequence is necessarily Castle start → Imperial **age** → Heavy Camel:
Heavy requires Imperial. Imperial **Camel** is a different, Hindustani-only
technology (521, civ 20, effect 577 upgrades to unit 207), not another Turkish
upgrade. Bloodlines (435, Feudal, effect 450) adds 20 HP to class 12; the editor's
earlier-age research accounts for the Turks/control offset. Native observation
supports the ordinary once-only availability/upgrade pipeline, not a Turkish HP
stacking bonus. Trigger-forced repeat activation of 235/236 remains unmeasured.

### Stored fractional HP experiment: unresolved, not rounded away

`cont-damage43.png` / `cont-damage-target.png` configure a one-shot Damage Object
43 on the Janissary. `cont-turks-damage43-result.png` shows **1/44**, alive.
This rules out truncating the starting HP to 43, but cannot distinguish stored
43.75 with a rounded current-HP display from stored 44.

The textbox temporarily accepted `43.875` (`cont-damage-fraction-attempt.png`),
but it was **not a valid fractional damage operation**: Test showed **45/44**
(`cont-turks-damage43875-result.png`), and the subsequent editor/copy inspection
showed Quantity **-1** (`cont-damage-copy-check.png`). Decimal `0.5` likewise
did not survive the edit. Treat this as invalid input/default healing, not an
HP threshold test. The trigger was deleted before Camel/control runs
(`cont-trigger-delete-check.png` shows no triggers). No runtime HP change is
justified. A calibrated fractional attack/other valid threshold fixture remains
necessary; simply applying integer 43/44 damage cannot settle the distinction.

The gunpowder HP observations use editor-placed units, with paid healthy elite
promotion added in the continuation. They do not establish trained-unit
initialization, wounded promotion or fractional lethal thresholds.
The simulator's 43.75 Janissary HP therefore remains inferred; changing it to
44 solely from the rounded panel would overstate the evidence. Crew speed,
building-attack contribution and garrison-arrow formulas were not calibrated.
Siege Tower and the other ram variants were not exercised natively.

## Source comparison and Camel interpretation

Read-only `genieutils` comparison used `tools/depot.py` / `tools/datq.py`'s
resolver for the pinned DAT and the installed `resources/_common/dat/empires2_x2_p1.dat`.
Full output: `dat-comparison.txt`, `dat-targeted.txt`.

- Pinned DAT has 60 civs; installed DAT has 63. The examined unit base HP
  values match: HC 40, Janissary 35/40, Bombard Cannon 80, Cannon Galleon
  120/150, Camel Rider 100 and Heavy Camel 120.
- Effects 296 (gunpowder HP), 263 (Turks tree), 224/225 (camel availability
  and upgrade), techs 235/236 and Elite Cannon Galleon tech 376 match in these
  dumps. The half-price source cost remains 525 × .5 wood and 500 × .5 gold.
- Tech 64, Bombard Tower, differs in its prerequisite tuple: pinned
  `(103,47,285,-1,-1,-1)`, installed `(103,47,-1,-1,-1,-1)`; required count
  is 2 in both. Its 800-food/400-wood base price is unchanged.
- **Techs 235/236 do not add camel HP.** Effect 224 enables unit 1755; effect
  225 upgrades 1755 and 329 to 330. The observed 120 → 140 is consistent
  with the base 100 → 120 upgrade plus the earlier-age Bloodlines +20.
  It is not a stacking-bonus measurement. Continuation confirms the same offset
  through a paid age-up and compares the Byzantine 100→100→120 progression.
  The tree's type-8 attribute-12
  commands still leave repeated/stacked activation semantics unresolved.
- Continuation dumps `cont-camel-source.txt` / `cont-final-source.txt` confirm
  Bloodlines, Elite Janissary, Artillery and the Imperial Camel civ restriction.
  Other relevant installed/pinned differences: HC tech 85 prerequisite tuple
  changes from `(103,47,285,801,-1,-1)` to `(115,47,801,-1,-1,-1)`; BBC tech
  188 changes from `(103,47,285,-1,-1,-1)` to `(115,47,-1,-1,-1,-1)`. Both
  retain required count 2, zero costs and the same enable effect. Do not transfer
  these installed prerequisite tuples into the pinned implementation.

## Reproduction, rejected setup and final state

Tested coordinates are in the evidence root's `RECIPES.md` and `macro.sh`.
Start an Imperial, one-player, custom-victory scenario, with 5000 food/wood/gold.
The first placed Janissary is at editor (1280,700), elite (1470,700), HC
(1660,700), Bombard Cannon (1280,900), Camel Rider (1470,900). TC at (700,700)
anchors the Test camera; Guard Tower (1000,500), Castle (1950,450), Stable
(2000,850), Battering Ram (1050,900). Inspect actual placement and selection.

Use the explicit selected-gunner garrison button (303,1250), then click the
host's body; resume if paused and inspect occupancy/icons. Early right-clicks
on the TC roof only moved units behind it. Those order captures are not proof
of admission. Selecting Watch Tower at Imperial found no available row;
Guard Tower was used instead. Ships and Dock were not successfully placed on
this land fixture; no naval result is claimed.

`turks-castle-result.png` has 0/20 because the intended passengers were still
in the ram; it is not a rejection. `turks-castle-result2.png` actually shows
**Shu**, caused by a scroll-dependent civ-row click, and is excluded from the
Turks/control comparison. Corrected END-anchored selection produced
`turks-castle-final.png` showing Turks and 2/20. Failed captures are retained.

Continuation water setup: Terrain → Water category (285,1140), Giant brush
(225,1382), Water Shallow (130,944); paint (900,500), (1150,625), (900,750).
Place Cannon Galleon (1000,600), elite (1000,780), Dock (1300,500). Confirmed
water/ships/dock: `cont-dock-place.png`, `cont-turks-layout.png`.
University (1700,550), Castle (2000,800), Stable (1700,950), Janissary (1500,800)
and Camel (2050,1030) supply the other measurements. Later TC placement and
Go To Objects change the camera; use the continuation recipe, not old pixels.

No scenario was saved. The game was returned to its main menu; final continuation
capture `cont-final-main-menu.png`. No restart or graphics-setting change occurred.

## Runtime correction and checks

Building/Siege Tower admission already maps class 44 to mask bit 2. Rams with
no `passengerTypes` use a separate hardcoded class gate in `canGarrison`; it
admitted only villagers (4) and infantry (6). Added foot gunners (44) there,
without changing capacities, explicit masks, crew bonuses or other classes.
This shared gate also governs other ram-family carriers: their admission is
an extrapolation from the measured Battering Ram, not separate native coverage.

Replaced the incorrect Frank HC ram-rejection assertion with two public-command
boarding/unloading cases (Turks and Teutons, HC and Janissary), retaining
Siege Tower coverage and adding cavalry exclusion. Before the runtime fix,
both new cases failed at `canGarrison`: `ram-red.log` (2 failed, 15 deselected).

Continuation additionally corrects `researchCostFor`: truncate the transformed
technology definition's cost before applying the existing player-wide
`researchCostMod` rounding. Native establishes 262 for this half-price tech;
general truncation of other fractional definition costs is an **inferred integer
cost adapter**, not a calibration of every fractional value or modifier order.
The player-wide factor policy is deliberately unchanged (Chinese coverage still
passes); HP and unit-cost rounding are untouched. Added exact-budget rejection
at 261, acceptance/debit at 262, cancel-refund coverage, and corrected the existing
5000-style debit expectation. The two price cases failed before the fix:
`cont-price-red.log` (2 failed, 16 deselected).

Checks, from this worktree, using the preserved #188 source fixture rather
than regenerating/importing assets:

```sh
CIV_PROFILE_CONTENT=/home/fraser/repos/age-of-empires/.local/orchestrator/evidence/issue-188-turks/turks-content.json npx vitest run --maxWorkers=1 src/sim/turks.test.ts src/sim/garrison.test.ts src/sim/garrison-edges.test.ts src/sim/chinese.test.ts src/sim/byzantines.test.ts src/sim/research-queue.test.ts src/sim/market.test.ts
npx tsc --noEmit -p .
git diff --check
```

Final continuation results: **101 passed, 7 files, zero skips**, 70.26 s wall;
typecheck exit 0; diff check exit 0. Logs: `cont-targeted-vitest.log`,
`cont-tsc.log`. Earlier ram-only receipt remains 37/37 in 22.55 s.
No assertion timeout
was widened. No owned checkpoint, import, service restart, push or commit.

Remaining acceptance: stored fractional HP / fractional lethal threshold;
trigger-forced repeated camel-tech activation; native Siege Tower/arrow
contribution (explicitly skipped in this continuation). Keep #302 open.
Runtime/tests/docs are
uncommitted for coordinator review/checkpoint; no worker-owned process remains.
