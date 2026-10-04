# Native match-speed calibration

## Current Steam build, 2026-10-04 (#280)

Direct desktop evidence identifies **101.103.54800.0 (#185872)**. This is
newer than the pinned owned executable; these observations do not establish
pinned-runtime parity or resolve its startup problem (#279).

The measurement match was a two-player Tiny Islands skirmish, Vikings versus
Standard Byzantine AI, default data, Standard resources/ages/victory, population
250, cheats allowed but unused, speed unlocked. The human side remained idle.
Display: fullscreen 2560×1440, default zoom50%, Enhanced Graphics unchecked,
V-Sync off, initially FPS limit120. Water/waves, map lighting, bloom, sharpen,
depth of field and anti-aliasing were enabled. The game remained foreground.

### Method and observations

Enable the ordinary F11 clock (F11 cycles ordinary clock, diagnostic clock, off).
Choose speed with the owned `VK_ADD`/`VK_SUBTRACT` bindings from
`resources/_common/dat/hotkeys.json`. Capture the clock at four absolute
Stopwatch deadlines spaced60 wall seconds apart. Record monotonic times immediately
before/after `CopyFromScreen`, plus UTC. PNG saving occurs after that bracket.
The largest capture bracket was under29ms; displayed seconds introduce about
one game second of endpoint-difference uncertainty. Rates below are rounded
observations, not replacements for the nominal speed constants.

| Native label | FPS limit | Four displayed game times | Game seconds / ~180 wall seconds | Observed rate |
|---|---:|---|---:|---:|
| Normal1.7 | 120 | 06:18,07:56,09:33,11:11 | 293 | 1.628 |
| Casual1.5 | 120 | 13:17,14:47,16:16,17:46 | 269 | 1.494 |
| Slow1.0 | 120 | 19:29,20:29,21:29,22:29 | 180 | 1.000 |
| Fast2.0 | 120 | 24:29,26:29,28:29,30:29 | 360 | 2.000 |
| Normal1.7, repeat | 120 | 32:33,34:11,35:49,37:27 | 294 | 1.633 |
| Normal1.7 | 56 | 39:06,40:46,42:26,44:06 | 300 | 1.667 |

All runs used the same match and process. Only the FPS limit was changed for the
last run. This demonstrates a measurable timing difference associated with the
frame-cap change in this session; it does not identify the engine's scheduling
algorithm or exclude every other host variable. The Normal label alone cannot
certify a sustained1.700 wall-clock ratio. Copying1.628 or1.667 into our fixed-rate
simulation would overfit one native setup. Mechanic probes should measure native
game-clock intervals, rather than convert wall time using the displayed label.

### Defaults are a separate boundary

The actual **Options → Game → Reset to defaults → Yes** action displayed **Casual**
in the Game Speed selector. Confirming and returning to this already-running
Normal match left its F11 label **Normal1.7**. Therefore the reset preference and
the active match speed must not be conflated. This is a pane-reset observation,
not a clean-install or reset-lobby/new-match measurement.

Follow-up: a newly launched editor test used **Casual1.5**, and returning to the
single-player skirmish lobby also displayed **Casual**. However, the skirmish
lobby's own **Reset** button changed its speed to **Normal**, population to200,
map toCoastal and civilizations toRandom. Starting that reset lobby produced a
real game-clock label **Normal1.7** (captured at00:24).

Thus the Game-pane default and the skirmish-lobby default are demonstrably
different in this current build. Our fresh **Normal** choice matches the observed
reset skirmish/new-match path; it must not be described as the universal default
of every native options pane. Existing saved index semantics and nominal
Slow/Casual/Normal/Fast multipliers remain as delivered by70bda6c. Pinned-build
timing/defaults and native multiplayer-lobby defaults remain unverified.

### Local evidence

Owned screenshots remain private under `.local/`:

- `calibration-20261004-native-start.png`: build label.
- `calibration-20261004-native-{settings,graphics,game-settings,lobby}.png`:
  initial display/game/lobby settings.
- `native280-20261004-{normal,casual,slow,fast,normal-repeat,normal-fps56}-{0..3}.png`
  and the corresponding `.json`: clock captures and timestamp brackets.
- `native280-20261004-fps60-setting.png`: despite the initial filename, the
  captured slider explicitly reads **56**, which is the value actually applied.
- `native280-20261004-reset-{dialog,result,applied}.png`: reset confirmation,
  Casual selector, and continuing Normal match.
- `native285-test-loaded.png`: newly launched editor test atCasual1.5.
- `native280-new-lobby-after-reset.png`, `native280-lobby-reset.png`,
  `native280-reset-lobby-match.png`: Casual inherited by skirmish, its Reset
  switching toNormal, and the launched Normal1.7 match.

No runtime value, replay state, fixture assertion or test timeout was changed for
these observations.
