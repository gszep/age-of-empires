# Opt-in Wonder countdown (#110)

**Game Settings → Wonder:200 Years** enables a fixed countdown for a new match.
Completing a paid Wonder starts 1000 simulation seconds (200 years); keeping it
standing wins even while the opponent has a surviving army or town. Destroying
it cancels that deadline. Rebuilding starts a fresh one. Each completed Wonder
keeps its own deadline; the HUD shows each side's earliest surviving deadline.

The owned banner displays the year count and player number. Clicking its icon
or text focuses the Wonder without changing simulation or ordinary fog. Owned
strings announce construction, completion and destruction. The option persists
through solo setup/restart/reload, private shared setup/checkpoints/rejoin, and
v2 headless records/replays. CLI/batches accept `--wonder-victory true|false`.
It is off when omitted, preserving old matches and replay checksums. The open
fallback's existing limited building/age roster is unchanged.

## Independent source and native measurement

- Pinned Wonder276 task 120 supplies the source task identity; building costs,
  footprint, HP and construction duration remain the existing DAT import.
- Owned strings 3019–3024,3058,11300/11301 and300180/300182 supply the notices,
  years label, timer label and focus help. String9786 says300years/25 minutes,
  consistent with five game seconds per year.
- Installed DE101.103.54800.0 (#185872), not the older pinned executable:
  a controlled120-square editor fixture with an actually built Wonder announced
  **200 years**. Its displayed clock changed 17:55→23:48 while the banner changed
  199→128:353 game seconds for71integer-display years, consistent with5seconds
  per year and display rounding. Resuming the trial later reached victory with
  the opposing town center still standing.
- The fixture used an Imperial builder funded with10000wood/gold/stone, paid
 1000of each for construction, and used native Aegis to accelerate construction.
  The countdown comparison uses the game's displayed clock, not wall time.
  The opponent had a town center and None personality. Earlier house-only trials
  ended immediately and are **not** countdown evidence. A preplaced Dark-Age
  Wonder did not provide a usable construction-completion countdown.
- Captures and recipe are private in `.local/reference/index.md`, including
  `native110-completion.png`, `native110-countdown-delta.png` and
  `native110-expiry-victory.png`. Pinned-build startup currently fails with an
  access violation, tracked in#279.

## UI source and verification

`wonderpanel.json` positions a90×457 flag at a(-105,-55) anchor. Its icon and
year/owner labels are read through the existing widget geometry helper. All
banner widgets name blue`WonderBanner0` as a placeholder; importing the
`WonderBanner` material family supplies the actual blue/red player art.
The full import pipeline publishes the original PNGs and imported strings.

The browser check caught an invisible negative-z banner, then a transparent
menu-panel rectangle intercepting its clicks. Cloth is now below menu artwork,
while visible timer controls win hit testing. The passing check measures605blue
sRGB screenshot pixels with the original threshold, and performs the actual
focus click, reload, Delete/Yes cancellation, paid replacement construction and
victory. It advances the real 3500-second construction and 1000-second victory
clocks through simulation ticks; no production rule is shortened by the browser
fixture. The separate unit fixture uses fast construction but retains the full
200-year victory clock. Shared JSON followers reproduce the final ticks/winner.

Owned checkpoint GREEN on October3:1363 tests passed/8 existing skips,
build,193 owned import/tool tests and real-browser debug smoke (810 seconds).
All six selected feature receipts pass on the same non-Markdown tree; no
existing assertion or clock was relaxed.

```bash
npx vitest run src/sim/wonder.test.ts src/shared/match.test.ts --maxWorkers=1
npx tsx tools/wonder_smoke.mts
node tools/acceptance.mjs run wonder-victory "describe changed fixture scope"
```

## Explicit limits

This is a **fixed opt-in setting**, not the native automatic map-size default
table and not complete Standard victory (relic victory remains separate).
It may be selected on surveyed maps without claiming their native timer policy.
Ceiling the displayed fractional year, per-entity deadlines, cancellation on
ownership change, conquest/royal-loss precedence, destruction winning an expiry
tick race and a draw for simultaneous opposing expiries are documented integration
inferences. Multiple Wonders, native tie ordering, Atheism modifiers and other
map defaults still need their own reference acceptance. The banner uses the
default player palette and browser font rasterisation; exact compositor/SDF and
colour-blind banner parity are not established.

Source shared protocol 4 rejects older simulators. Installed protocol 2 services
remain release-pinned; this change does not deploy, reset or migrate their match.
