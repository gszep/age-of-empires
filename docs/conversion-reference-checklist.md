# Conversion inheritance: native acceptance for #178

Status: **mobile-cargo rule supplied by the user and implemented; remaining
exceptions await evidence**, 2026-09-30. This is a capture protocol, not a claim
that the agent measured native DE.

The core snapshot implementation already exists. The bundled AoK manual supports
retaining conversion-time attributes and excluding later upgrades. The bundled
TC manual describes ram-passenger ejection. The user's subsequent clarification
supersedes that legacy description for mobile cargo: passengers are not converted
or ejected, remain aboard under their original owners, and can only be ejected by
the new carrier owner. Heavy nonlethal damage does not eject them. The previous
recursive mobile-capture implementation has been corrected accordingly.
Source provenance is in [shared-reference-audit.md](shared-reference-audit.md) and
[manual-audit.md](manual-audit.md). The implemented policy is in
[ledger.md](ledger.md#converted-entity-inheritance-178).

## Capture setup and controls

- Record the DE build and installed content/mods. Compare the source manifests
  with `tools/aoe2-source.json`; measurements from another build must be labelled
  as such, rather than called patch-matched.
- Use a small, flat scenario with two enemy players, no AI, generous resources,
  visibility of the test area, and separated test lanes. Keep an untouched
  scenario/save for each research ordering. Record civilisation, age, completed
  technologies and game speed for both players.
- Trigger each ownership change with an actual monk conversion. Editor/trigger
  ownership reassignment is not a substitute: it might bypass conversion logic.
- Give each measured unit a distinguishable location/name. Keep one unconverted
  donor unit and one recipient-native unit as controls. Ensure neither control
  attacks the test unit while conversion is in progress.
- Record before/after selection panels, actual orders and outcomes, not just the
  displayed attack value. Preserve the scenario/save, recording/video and a small
  result table locally. Never commit game assets or converted owned content.
- Use game-time intervals for timed work. Record failed attempts and blocked
  unloading separately from a successful conversion's effects.

## Discriminating probes

Mobile passenger retention now has an explicit user-supplied rule; the probes
below remain useful for native corroboration and the unresolved exceptions.

| Probe | Procedure and observations | Current implementation, not a reference expectation |
|---|---|---|
| Ram cargo | Garrison one identifiable infantry unit in a ram, then convert the ram using a monk with the required permissions. Leave clear land around it. Immediately inspect passenger position, owner and both populations. Repeat with researched donor infantry; separately repeat with blocked exit space. | User-supplied rule: passengers remain aboard under their original owners, without new conversion snapshots; only the new carrier owner can eject them. |
| Transport and building cargo | Repeat with a transport carrying a unit, a transport carrying a loaded ram, and a convertible garrison building. Test an immune King separately. Record every nested passenger's owner and whether/where it exits. | Mobile cargo and nested cargo retain owners/provenance. Building cargo retains the inferred capture policy, stopping at mobile carriers; building behaviour is not established by the user's mobile-carrier clarification. |
| Wounds and future upgrades | Wound a donor villager with Loom, convert it, then research recipient Loom. In a fresh run convert before donor Loom and research Loom on both sides afterwards. Record current/max HP and damage from the same unupgraded attacker. Repeat a military unit's tier upgrade, then reconvert it after both sides have researched the upgrade. | Wounds, original tier and resolved unit rules persist through both research and reconversion. |
| Villager task changes | Give only the donor economic upgrades; convert a villager while carrying wood. Record its load before/after capture. Measure wood collected and the first full-load amount, then switch it to gold. Repeat with upgrades only on the recipient, and with recipient research completed after conversion. Keep node distance and drop-site walking time out of the measured gather interval. | Task gather rate/capacity use recipient rules and later recipient research; stored unit HP/movement stay frozen. |
| Fishing ships | Convert a fishing ship on water, with identical fish type in each trial. Contrast donor-only and recipient-only economic bonuses/upgrades. Measure the first full load and time actually gathering; repeat on another supported food target. | Ship gather rate/capacity use recipient rules. This needs its own evidence; ships are not villager task variants. |
| Ballistics | Use a converted archer against a perpendicular, constant-speed walking target with enough HP to survive. Compare donor-only Ballistics, recipient-only Ballistics, neither, and recipient research after capture. Keep geometry, archer type and accuracy controls identical. Record shots/hits and target HP; repeat enough shots to distinguish targeting from random accuracy. | Projectile leading follows recipient completed research, while the shooter's unit stats remain frozen. |
| Captured unique unit | Convert a unique unit the recipient cannot train. Compare actual damage, walking time over a fixed route, firing distance and visible terrain before/after. Research donor and recipient upgrades; repeat after reconversion. | The original unit remains usable with its frozen rules despite recipient training restrictions. |
| Captured building queues | Capture a wounded production building with active training and a waiting entry; use a separate trial for active research. Record both banks, queue, rally point, HP and completion notifications. Order a fresh recipient unit afterwards and measure production time and resulting unit stats. | Old queues/rally clear without refunds. Building work rate stays frozen; new production uses recipient unit rules. |
| Player-side abilities | Compare defender Heresy before capture with attacker-only Heresy. Record target owner/death, released cargo and participating monks' faith. For every later supported civ ability, test donor-only versus recipient-only activation separately. | Heresy is read from the defender; successful conversion uses the existing faith/death lifecycle. No general claim about future abilities follows. |

Conversion probability is a separate measurement: fixed seeds/one successful
conversion cannot establish a distribution. Target-unit modifiers, resource182,
faith scheduling and min/max timing need repeated trials with explicit controls;
do not infer those rules from this inheritance matrix.

## Evidence and integration record

For each trial record:

`build; scenario/save; players/civs/ages; research before; target/cargo;
before HP/load/population; conversion time; immediate outcome;
research after; measured damage/distance/gather/shots; capture path`

After a result distinguishes policies:

1. Attach/index the native evidence and state its source/build limitations.
2. Change only the demonstrated boundary; preserve unrelated conversion rules.
3. Add a public-command outcome regression with contrasting controls. For cargo
   or provenance changes, cross a JSON save during conversion and after capture,
   then compare continuation and synchronization hashes; retain replay coverage.
4. Update the ledger and affected status/coverage text. Run relevant simulation
   tests, browser acceptance for affected player actions, and the owned checkpoint before
   any commit. Close #178 only when its acceptance questions are resolved or its
   scope is explicitly revised by the user.

## Verification before the cargo correction

On 2026-09-30 the following passed: **53 tests across four files**, with owned
content available and no skipped cases reported:

```sh
npx vitest run src/sim/conversion-inheritance.test.ts src/sim/monastery.test.ts src/sim/teutons.test.ts src/sim/transport-capacity.test.ts --maxWorkers=1
```

These cover the implemented snapshot/cargo policy, owned Loom outcomes,
Redemption/Atonement and captured buildings, Heresy, transport capacity,
JSON continuation and replay. They do not measure DE. No native conversion
capture was made during this audit; `.local/reference/index.md` currently indexes
HUD/terrain/rendering evidence, not conversion outcomes.

## Mobile-cargo correction verification

`src/sim/conversion-inheritance.test.ts` now covers retained enemy passengers in
rams/siege towers, new-owner ejection and former-owner rejection, nested transport
cargo, original-owner HP/tier research, reconversion, population, heavy nonlethal
damage and JSON continuation. Regicide's nested-carrier test now expects both
the King and its inner carrier to retain their original owner. The existing
public conversion/research replay regression remains in place.

`tools/conversion_cargo_smoke.mts` passed in owned and `OPEN_FALLBACK=1` modes:
public boarding/conversion fixture, captured-carrier HUD, reload hash and real
ejection-button click, with the released passenger still enemy-owned. These
verify the implementation of the supplied rule, not a newly made native capture.

Focused run: **147 tests across seven files passed** (conversion inheritance,
transport capacity, specialists, Regicide, civilisation bonuses, monastery and
Teutons). `npm run build:public` passed typechecking and the public Vite build.
The asset-inclusive `npm run build` exceeded 120-second and 600-second tool
deadlines after transformation; #255 tracks the unnecessary owned-asset copying
on verification builds. An initial one-worker full `npm test` also exceeded its
600-second invocation deadline while still progressing.

The subsequent optimized owned checkpoint completed **GREEN** in14m50s:
**1108 Vitest tests /89 files** (7 existing inapplicable cases skipped), public
bundle build, **159 import tests**, and real-browser debug smoke. Receipt:
`.local/gate-optimization.log`, exit0. No test timeout was widened; tests run at
two workers/nice10, and the checkpoint build omits redundant owned-asset copies while
the import tests/browser still consume owned content.
