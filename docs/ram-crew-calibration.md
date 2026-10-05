# Ram crew native calibration (#161)

2026-10-06: **measured on current build 185872, not pinned 48987**.
The owner authorized installed Steam DE 101.103.54800.0 as evidence for this
run. All numbers below were **observed visually**, not read from process memory.

## Method and observations

Created a blank scenario directly in the native editor, player 1 Teutons,
Dark Age, four Militia, one female Villager, one Battering Ram and one Capped
Ram. No technologies were researched. Test ran at Casual 1.5, 2560×1440.
Selected the ram and hovered its sword statistic: the native **Attacks** tooltip
reports **All Buildings** separately from Melee and Siege Weapons. This is an
attack-stat measurement, not target HP lost per hit. No armour arithmetic is
inferred from it.

Evidence paths below are relative to this durable worktree's ignored
`.local/native/` (not distributed assets).

| Ram | Living passengers | All Buildings | Melee | Siege Weapons | Capture |
|---|---|---:|---:|---:|---|
| Battering | 0 | 150 | 2 | 40 | `ram-0-attack.png` |
| Battering | 1 Militia | 160 | 2 | 40 | `ram-1-attack-r2.png` |
| Battering | 2 Militia | 170 | 2 | 40 | `ram-2-attack-r2.png` |
| Battering | 4 Militia | 190 | 2 | 40 | `ram-4-attack.png` |
| Battering | 0, after unloading | 150 | 2 | 40 | `ram-unloaded-attack-r2.png` |
| Battering | 1 Villager | 150 | 2 | 40 | `ram-vill-attack.png` |
| Capped | 0 | 160 | 3 | 50 | `capped-0-attack.png` |

The 1/2-passenger measurements were obtained by unloading from four, with the
occupancy counter and passenger icons visible in each capture. The villager
control was then boarded into the emptied ram; its icon and 1/6 counter are
visible. `attack-contact-r2.png` collects the valid 2/1/0/villager observations.
The 4-passenger capture was recovered from an accidentally reused output name;
its visible 4/6 counter, four icons and 190 readout establish the state.

## Conclusion and limits

The observed +10 All Buildings attack per Militia, zero villager attack bonus,
and unloading reversal agree with the implemented crew addition. No runtime or
test change is warranted by these observations. Absolute native baseline stats
are current-build observations, not replacements for patch-pinned DAT stats.

Speed was initially skipped; the follow-up simultaneous-race measurement below
now supports the implemented speed ratios. Capped Ram boarding
did not succeed in the optional attempt (the counter stayed 0/6); its apparent
160→160 is **not** evidence of a zero crew bonus. Siege Engineers, other infantry
classes, exact timing and pinned-runtime numeric acceptance remain unverified.

Rejected attempts are retained: `ram-1.png` used an ineffective G key;
`ram-{1,2}-attack.png` and `attack-contact.png` used the wrong unloading-icon
coordinate and actually show four passengers. `capped-1-attack.png` is empty.
Do not interpret filenames as state assertions. The prior worker's
`cap-*.png` navigation attempts remain intact; there was no partial tracked diff.

## Checks and repeatability

- `npx vitest run src/sim/specialists.test.ts src/sim/garrison-edges.test.ts`:
  **28/28 passed**, 2 files, 2.98 s; `.local/native/tests.log`.
- `npx tsc --noEmit -p .`: exit 0; `.local/native/tsc.log`.
- Existing tests/acceptance coverage unchanged. No owned checkpoint, import,
  deployment, push or commit performed.
- Tested local control recipe: `.local/native/RECIPES.md`. The scenario was not
  saved; recreate its seven units using that recipe. Native process PID 22012
was retained, with the game returned to the main menu.

## Speed — simultaneous native race, 2026-10-06

**Measured on current build 185872, not pinned 48987.** Three Teuton Battering
Rams on flat editor grass, no technologies, separately selected/ordered along
three parallel horizontal screen lanes. Top empty, middle four Militia, bottom
one female Villager. Occupancy and attack controls are observed visually in
`s2-four-verified.png` (4/6, 190), `s2-vill-verified.png` (1/6, 150).
F3 paused the game while issuing the three independent move commands (not a
formation). `race-samples.ps1` unpaused and took nine simultaneous full-window
captures, then paused again. All three continued moving before their goals.

| Passenger state | Screen x at sample 1 | Screen x at sample 7 | Displacement | Ratio to empty |
|---|---:|---:|---:|---:|
| Empty | 1393 | 1759 | 366 px | 1.000 |
| Four Militia | 1420 | 1906 | 486 px | 1.328 |
| One Villager | 1393 | 1759 | 366 px | 1.000 |

These are the rightmost blue body pixels, measured from original 2560×1440
captures (not downscaled previews). Mask: B > 65, B > 1.3R, B > 1.2G;
separate y bands 650:760, 830:955, 1020:1150 and x 1250:2400.
The integer game clock reads 04:12→04:21 in these two frames; the shared six-wall-
second interval at Casual 1.5 avoids assigning precision to integer clock edges.
The nine-frame sequences and positional measurements are `race-{0..8}.png`,
`race.json`, `race-positions.json`; `race-clocks.png` collects the visible clock.

Allow roughly ±0.02 in the ratios for animation/edge and capture quantization;
this is not a confidence interval from repeated trials. The observed 1.328 is
consistent with (0.6 + 4×0.05)/0.6 = 1.333, and the villager agrees with 1.0.
Base 0.6 and crew +0.05 are the existing `src/sim/data.ts` rules, not absolute
tile speeds independently established by this screen-space experiment. No
decisive disagreement; runtime and tests unchanged. This measures the four-
passenger aggregate, not separate speed increments for every infantry count.

The first attempt with two players admitted AI starting units; it was rejected
before measuring. The accepted race reduced Number of Players to 1 and confirmed
all eight staged units. The previous worker's infantry-only runs and failed
navigation captures remain excluded. Settings were not changed or the game
restarted. Follow-up specialist/garrison tests: 28/28; tsc exit 0, logs
`s2-tests.log` / `s2-tsc.log`. Main-menu return: `s2-final-menu.png`.
