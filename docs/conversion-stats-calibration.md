# Converted-unit stats: native calibration #178

2026-10-06: **PASS for the bounded infantry stat-panel questions below**, not
closure of #178. Measured on current build **185872, not pinned 48987**;
all screenshot readings are **observed visually**. Owner authorized this build
as calibration evidence. Existing frozen donor rules agree; no runtime rewrite.

## Setup and evidence

Windows game PID **22012**, fullscreen 2560×1440, inherited UHD-unchecked
settings unchanged; no restart. Single-player editor Test, Casual 1.5.
Player 1 Teutons, Player 2 Vikings, both Castle Age. P2 personality None,
P2 allied toward P1 while P1 treats P2 as enemy: conversion without retaliation.
Civilisations verified in selected-unit panels, not inferred from colours.
Castle-start presets already grant earlier upgrades; the table records actual
displayed values, not an assumption of unupgraded units.

Local evidence root (ignored, not committed game content):
`.local/worktrees/issue-178-conversion-stats/.local/native/` relative to the
primary checkout. Every capture below has a full 2560×1440 PNG and matching
controller JSON (PID, timestamp, actions). `cs-evidence-panels-{0,1}.png` combines
unscaled panel/clock crops for review; full frames are authoritative.

All ownership changes used **actual Monk right-click conversions**. No Change
Ownership effect or proxy was used, so no proxy-equivalence claim is needed.
The sole trigger was one-shot Damage Object **17** on the donor Long Swordsman.
Two donor controls remained red and untouched; a native Teuton Long Swordsman
was the positive control for recipient research.

## Observations

Attack and armour below preserve the native panel's base+bonus notation.
Armour is melee / pierce. Speed was not shown in these panels and was not measured.

| Target/stage | HP | Attack | Armour | Capture stem; game clock |
|---|---:|---:|---|---|
| Native Teuton Long Swordsman, initially | 60/60 | 9+1 | 1+2 / 1+1 | `cs-p1-native`; 00:12 |
| Viking Long Swordsman, damaged | 55/72 | 9+1 | 1+1 / 1+1 | `cs-donor-before`; 00:12 |
| Viking Berserk | 65/65 | 12+1 | 1+1 / 1+1 | `cs-unique-before`; 00:12 |
| Native Teuton after paid Chain Mail, before conversion | 60/60 | 9+1 | 1+3 / 1+2 | `cs-p1-before-convert`; 01:21 |
| Captured Long Swordsman, first run (healing confound) | 66/72 | 9+1 | 1+1 / 1+1 | `cs-sword-captured`; 01:38 |
| Captured Berserk | 65/65 | 12+1 | 1+1 / 1+1 | `cs-berserk-captured`; 01:38 |
| Native Teuton after paid Iron Casting | 60/60 | 9+2 | 1+3 / 1+2 | `cs-p1-after-iron`; 02:54 |
| Captured Long Swordsman after same research | 72/72 | 9+1 | 1+1 / 1+1 | `cs-sword-after-iron`; 02:54 |
| Captured Berserk after same research | 65/65 | 12+1 | 1+1 / 1+1 | `cs-berserk-after-iron`; 02:54 |
| Fresh Test: wounded Viking immediately before conversion | 55/72 | 9+1 | 1+1 / 1+1 | `cs-wound-pulse-13`; 00:41 |
| Same selected unit immediately after conversion, now Teuton-owned | 55/72 | 9+1 | 1+1 / 1+1 | `cs-wound-pulse-14`; 00:42 |

Research identity/cost/queue are captured in `cs-chain-tooltip`, `cs-chain-paid`,
`cs-iron-tooltip`, `cs-iron-paid`; native-control stat changes confirm completion.
Iron Casting completion also appears in `cs-p1-after-iron`.

**Wound control:** the first run is not evidence that conversion heals to66.
Fresh Test restored55/72. Move the converting Monk farther away, then issue the
same real conversion and sample with F3 resume/pause pulses (0.5 wall seconds).
Pulses13→14 bracket the colour/owner change with55/72 unchanged. Pulses15–18 then
show56,58,61,63/72, confirming why late readings were confounded. No claim about
healing rate or conversion probability follows from these samples.

## Model and implementation comparison

- Sampled HP maximum, attack and armour retain donor conversion-time values,
  including the Viking HP bonus. They neither become recipient stats nor combine
  donor HP with recipient Teuton/Chain Mail armour.
- Both current and maximum HP remain55/72 across conversion. There is no rescale
  to the recipient's60 maximum. With the maximum retained, absolute-HP and
  ratio-preserving formulae are mathematically indistinguishable; this probe does
  not claim a rule for an independently changing maximum.
- Subsequent recipient Iron Casting affects the native control but neither
  converted unit. The Berserk retains its unique identity and sampled stats.
- `game.ts:updateConverter` calls `rules.ts:inheritConvertedUnit` before changing
  ownership; `unitRulesForEntity` reads the donor snapshot. Existing HP storage
  and research exclusions already implement these observations. No replacement
  algorithm, source-value adjustment, or new approximation is justified.

`conversion-inheritance.test.ts` adds an always-runnable regression using the
observed Long Swordsman HP/attack/armour inputs. Public conversion crosses JSON
mid-order, verifies wounds and retained armour, rejects former-owner control,
then researches recipient attack and checks a native/opponent control. It also
checks donor later research (implementation coverage, **not measured natively**),
actual damage4 rather than5 against the diagnostic armour6 victim, and identical
JSON continuation/hash. Research location/time and the arena are synthetic, not
claims about native Blacksmith timing. Existing unique-unit, cargo, movement,
sight/range, reconversion and replay coverage is preserved.

## Limits and handoff

No native speed, damage-per-hit, range/sight, donor-later research, tier promotion,
reconversion, economics/task switching, Ballistics, building queues/cargo, or
special-ability exception measurements were made. #178 stays open for its existing
acceptance matrix in [conversion-reference-checklist](conversion-reference-checklist.md).
This is modern-build corroboration of the legacy owned-manual rule, not evidence
that build48987 has identical exception behavior.

### Verification

Final targeted command (reads the existing primary-checkout manifest; does not
regenerate or publish content):

```sh
CIV_PROFILE_CONTENT=/home/fraser/repos/age-of-empires/public/imported/aoe2/manifest.json \
  npx vitest run src/sim/conversion-inheritance.test.ts src/sim/monastery.test.ts \
  src/sim/teutons.test.ts src/sim/transport-capacity.test.ts --maxWorkers=1
npx tsc --noEmit
git diff --check
```

**53/53 tests, four files, no skips; exit0**, 26.86s elapsed on this host.
Typecheck **exit0**, 7.71s elapsed; whitespace check passed. Receipts:
`cs-vitest-content.log`, `cs-tsc-final.log` in the evidence root. The initial
fallback-only run (`cs-vitest.log`) passed35 with18 owned-content skips in8.65s;
the final run above covers those skipped cases. No timeouts widened.
The conversion suite now accepts the same `CIV_PROFILE_CONTENT` read-only input
override as the civilisation suites, avoiding asset regeneration in a worktree.

Rejected setup/captures: the first Diplomacy tab opened P1 despite Players showing
P2; `cs-diplomacy-p2` explicitly reselected P2 and set P1 Ally before Test.
`cs-sword-after`/`cs-berserk-after` clicked former locations after captured units
had walked and show no selected stats; use `*-captured` instead. No failed click
or late healed HP reading was used as an outcome.

Final `cs-final-main-menu.png` verifies build185872 and return to main menu;
same PID22012, no scenario saved, graphics unchanged, no controller left running.
No import, owned checkpoint, commit, push, integration or service restart.
Initial worktree was clean at2b29b59: no cheap-worker partial diff, failing-check
log or separate attempt transcript was supplied here; the issue's twelve comments
and inherited native recipes were read, including their rejected attempts.
