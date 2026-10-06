# Vikings native calibration — #301

2026-10-06, **measured on current build 185872, not pinned 48987**.
Native PID 22012, single-player editor Tests, fullscreen 2560×1440, inherited
UHD-unchecked configuration unchanged. All screenshot readings below were
**observed visually**, not extracted engine state. Casual 1.5; timing uses the
displayed game clock, not wall time. No cheats, import, service restart or
owned checkpoint. Final state: main menu, no saved scenario.

## Source comparison and limits

Read-only DAT parsing and XS inspection are retained in
`.local/native/vik-source-compare.txt` in the durable `issue-301-vikings`
worktree. These local evidence files are intentionally untracked, not shipped
assets. Source roots:

- Pinned: resolved with `tools/depot.py`, depot 813781,
  `resources/_common/dat/empires2_x2_p1.dat`, SHA256
  `ce3530df36cf0b333a9751cb0ff94460fe904f811feecec8ae9794701622b4cf`.
- Installed: `D:\SteamLibrary\steamapps\common\AoE2DE`, same relative DAT path,
  SHA256 `4aa2f0a719e88e5f1502517eddb27c669aeb40c2fe9d8c4f3eec7751c01e7baa`.

**Chieftains differs materially.** Pinned effect 517 increments resource 274
and assigns resource 33 to invoke XS function 5. Installed effect 517 has
neither command, only the cavalry/camel attack effects. Installed Castle
tooltip also omits loot. Both XS files still contain the loot function; its
mere presence does not prove activation. Do not remove pinned-mode loot to
match the current build. Tech 49 is Bogsveigar in both DATs, not Berserkergang.

Both DATs have regeneration attribute 40 for Berserk 692/694, identical
warship multiplier techs 395/501/502 (effects **394/386/383**, not effects
395/501/502), and identical inspected Galley/Fire/Demolition base cost rows.
The current Dock roster includes Hulks and Viking Fire ships; this is not a
claim of pinned roster parity. Wheelbarrow/Hand Cart multipliers also agree.

## Observations

Capture paths below are relative to this worktree's `.local/native/`.
Every full capture has a same-stem JSON action/rectangle/PID receipt.

| Outcome | Reading | Captures |
| --- | --- | --- |
| Chieftains paid research | 5000F/5000G → 4400F/4550G; button disappears | `vik-chief-hover.png`, `vik-chief-complete.png` |
| Berserk, Castle, damaged by one-shot integer Damage Object 45 | 28/65 at 00:13 → 47/65 at 00:42, +19 HP in 29 game seconds; consistent with 40 HP/minute within integer display precision | `vik-damage-target.png`, `vik-regen-start.png`, `vik-regen-end.png` |
| Viking Feudal Galley | tooltip and payment 81W/27G; 5000/5000 → 4919/4973 | `vik-feudal-galley-price.png`, `vik-feudal-galley-paid.png` |
| Viking Castle Galley | tooltip and payment 76W/25G; 5000/5000 → 4924/4975 | `vik-castle-galley-price.png`, `vik-castle-galley-paid.png` |
| Viking Imperial War Galley | tooltip and payment 72W/24G; 5000/5000 → 4928/4976 | `vik-imperial-galley-price.png`, `vik-imperial-galley-paid.png` |
| Viking Feudal Fire Galley | tooltip and payment 68W/41G; 5000/5000 → 4932/4959 | `vik-feudal-fire-price.png`, `vik-feudal-fire-paid.png` |
| Viking Castle Fire Galley | tooltip and payment 64W/39G; 4860/4945 → 4796/4906 | `vik-castle-demolition-price.png`, `vik-castle-demolition-paid.png` (misnamed; images show **Fire Galley**) |
| Viking Imperial Fire Ship | tooltip and payment 60W/37G; 4928/4976 → 4868/4939 | `vik-imperial-demolition-price.png`, `vik-imperial-demolition-paid.png` (misnamed; images show **Fire Ship**) |
| Teuton Imperial control | War Galley tooltip 90W/30G; Fire Ship tooltip/payment 75W/45G, 5000/5000 → 4925/4955 | `control-imperial-galley-price.png`, `control-imperial-fire-price.png`, `control-imperial-fire-paid.png` |
| Safe final state | main menu, same build/PID/rectangle | `vik-final-main-menu.png`, `.json` |

Age comparisons are independent editor starting-age Tests, **not paid age-up
transitions**. Castle Fire payment follows earlier Galley and Hulk payments;
its own before/after screenshots establish the delta. The captures named
`vik-{feudal,castle}-demo-*` actually show **Hulk**, not Demolition ships.
They are not Demolition evidence.

## Implementation correction

`src/sim/rules.ts` previously retained a double-precision fractional cost
through every effect and rounded only at the end. A public command regression
in `src/sim/vikings.test.ts` failed before the change: the first Fire-line
cost row paid **67W/40G**, versus native **68W/41G**. That first regression
used raw DAT floats, not the importer's six-decimal representation: the actual
imported `.9` already gave68/41 in Feudal. The imported-path discriminator is
Castle/Imperial cumulative gold **38/36 instead of39/37**. Both representations
now have public regression coverage; the importer is unchanged.

Cost effects now round the float32 result at each effect. This reproduces all
observed payments without replacing source multipliers with advertised exact
percentages: `75 × DAT(.9)` becomes float32 67.5 → 68, then 64, then 60;
gold 45 becomes 41 → 39 → 37. Exact internal engine arithmetic remains an
**inference fitted to measured outcomes**, not disassembly. Application to
other cost-effect combinations/buildings is shared behavior; the Goth follow-up
below corroborates a second civilisation, not every combination. Technology research prices use a different path and
were not changed. No loot, regeneration or gathering implementation changed.

The public test uses a trainable fallback Galley with each source cost row,
checks paid orders/refunds at all three stages and an undiscounted opponent,
and asserts base costs remain unchanged. It is not a Fire availability test.
All existing owned acceptance coverage remains intact.

## Goth review follow-up

Same current build185872/PID22012/settings; all readings **observed visually**.
One idle Villager, Barracks and Castle, 5000F/W/G at each independent editor
age start. No gatherers or passive income during the price measurements. Both
tooltip and actual resource debit were checked. `review-goth-source.txt`
compares both DATs: Goth civ3 unit costs agree; tech344/731/732/733 multiply
costs by `.85/.9375/.9465/.928571` after importer rounding. The initial log
section accidentally queried civ5 unit rows; the explicitly labelled civ3
section corrects this (same inspected prices). No source equality is inferred
from civilisation names alone.

| Age | Unit shown | Tooltip = debit | Before → after (F/W/G) | Capture stem (`-price.png`, `-paid.png`) |
| --- | --- | --- | --- | --- |
| Dark | Militia | 43F/17G | 5000/5000/5000 → 4957/5000/4983 | `goth-dark-militia` |
| Feudal | Spearman | 28F/20W | 5000/5000/5000 → 4972/4980/5000 | `goth-feudal-spear` |
| Feudal | Militia | 40F/16G | 4972/4980/5000 → 4932/4980/4984 | `goth-feudal-militia` |
| Castle | Spearman | **27F/19W** | 5000/5000/5000 → 4973/4981/5000 | `goth-castle-spear` |
| Castle | Man-at-Arms | 38F/15G | 4973/4981/5000 → 4935/4981/4985 | `goth-castle-militia` |
| Castle | Huskarl | **57F/27G** | 4935/4981/4985 → 4878/4981/4958 | `goth-castle-huskarl` |
| Castle | Pikeman, after paid upgrade | **27F/19W** | 4718/4981/4868 → 4691/4962/4868 | `goth-castle-pike` |
| Imperial | Pikeman | 25F/18W | 5000/5000/5000 → 4975/4982/5000 | `goth-imperial-pike` |
| Imperial | Long Swordsman | 35F/14G | 4975/4982/5000 → 4940/4982/4986 | `goth-imperial-militia` |
| Imperial | Huskarl (not Elite) | 53F/25G | 4940/4982/4986 → 4887/4982/4961 | `goth-imperial-huskarl` |

`goth-payment-contact.png` collects unscaled resource strips; full captures
retain unit identity, queue and age. Castle Pikeman upgrade paid160F/90G and
completed before its training measurement. The editor auto-completes earlier
age research at later starts: do not relabel the shown Man-at-Arms/Long
Swordsman as Militia, nor claim live age-transition calibration.

**Review decision: retain the shared per-effect rounding.** Castle Spearman
food35→30→28→27, and Huskarl gold35 follows the same chain. Final-only rounding
would yield26 for both, contradicting native debits. No Viking/Goth special-case
or grouping exception was introduced. Public Gothic tests cover all four
arithmetic stages and three cost rows; untrainable early-age source rows are
arithmetic fixtures, not native availability measurements. Owned-profile tests
also train/refund real Spearmen and Huskarls at the measured ages. The shared
consumer's civilisation/Shipwright scope is enumerated in the ledger.

### Optional forager check

Viking one-player fixture, one Forage Bush and distant Mill, no other food
income, initial5000F. Feudal full carry **13** (`carry-feudal-load.png`,01:07),
then food **5013**, carry0 (`carry-feudal-bank-paused.png`,01:22). Castle full
carry **20** (`carry-castle-full-load.png`,01:30), then food **5020**, carry0
(`carry-castle-bank-paused.png`,01:45). Both agree with the existing integer
gather/bank path. These integer UI observations do not expose hidden fractional
storage or prove multi-trip accumulation. No gather runtime/test change needed;
the existing owned Vikings banking regression exercises these outcomes.

## Rejected attempts and unresolved work

- Initial two-player Test let the enemy Monk convert the Berserk before
  research (`vik-chief-hover.png`). Rejected as a kill/loot measurement.
- Removed the Monk, researched Chieftains, then attempted the Villager attack.
  The target had fled into fog (`vik-villager-before.png`); the later idle
  Berserk/unchanged gold do **not** establish a kill or zero reward.
- No accepted Villager/Monk/Trade Cart/Trade Cog kill delta. Current Chieftains
  source mismatch blocks using this installation to validate pinned loot.
- Regeneration sample establishes rate consistency only: cadence, elite
  upgrade, conversion, garrison addition and clamping remain uncalibrated.
- Demolition costs, exact-resource affordability/refunds natively and live
  age-transition rounding remain unmeasured. Forager first-trip UI outcomes are
  measured above; hidden fractional storage/long-run accumulation remain open.
- The broad `/mnt/c` source search timed out; no lingering process. Replaced
  by reading PID 22012's executable path and accessing the known install.

## Checks and bounded handoff

Initial public targeted run: `npx vitest run src/sim/vikings.test.ts
src/sim/rules-cache.test.ts src/sim/naval.test.ts
src/sim/economy-technologies.test.ts src/sim/economy-training.test.ts
--maxWorkers=1`: **44 passed, 16 skipped**, 30.84 s before the review follow-up.
Ten skips are the preserved owned Vikings suite (no local manifest); six are
owned technology tests. No import was run to satisfy them.

Initial typecheck caught an invalid fixture `key` property; removed rather
than suppressed. Final `npx tsc --noEmit -p .` and `git diff --check` passed.
Final typecheck and rerun logs: `.local/native/vik-tsc.log`
and `vik-tests.log`. Pre-fix failure: `vik-regression-before.log`.
The review follow-up uses a frozen copy of the coordinator's existing extracted
content, not a new import: `.local/native/review-content.json`, SHA256
`5d8aefb84c3ab0c62483ce1af25603b97ce47760bd467175545ddd4f74538f19`.
Requested nine-suite run uses `CIV_PROFILE_CONTENT` pointing at that file:

```sh
CIV_PROFILE_CONTENT="$PWD/.local/native/review-content.json" npx vitest run \
  src/sim/goths.test.ts src/sim/byzantines.test.ts \
  src/sim/civilization-bonuses.test.ts src/sim/teutons.test.ts \
  src/sim/japanese.test.ts src/sim/saracens.test.ts src/sim/vikings.test.ts \
  src/sim/turks.test.ts src/sim/chinese.test.ts --maxWorkers=1
npx tsc --noEmit -p .
git diff --check
```

**161 passed, zero skipped, nine suites, 129.72s; typecheck and diff-check
passed.** No clocks widened, assertions weakened or owned suites skipped.
Logs/handles: `review-tests.log`, `review-tsc.log`, `review-checks.pid` (completed
wrapper868235), `review-checks.exit` (`vitest=0 tsc=0`). No probe/check process
remains. Final safe-state receipt: `review-final-main-menu.png/json`.

Runtime/tests remain uncommitted for coordinator review/checkpoint. #301 remains
open for full calibration; **PASS for review requests1–3**, plus the optional
first-trip forager observation. Optional Demolition measurement was deferred;
the original loot/source-version and other listed gaps are not closed.
