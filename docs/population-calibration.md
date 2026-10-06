# Native population-ceiling calibration (#253)

## Scope and default

**Measured on current build 185872, not pinned 48987**, on 2026-10-06.
The main-menu label is `101.103.54800.0 (#185872)`; the existing Windows
process was PID 22012. All readouts below were **observed visually**, not
extracted from engine memory. Display remained fullscreen 2560×1440, UHD
unchecked; no graphics settings or services were changed.

The prior [#280 calibration](speed-calibration.md#defaults-are-a-separate-boundary)
records that the single-player skirmish lobby's **Reset** sets Population to
**200** (`.local/native280-lobby-reset.png` in the primary checkout). This is
the accepted reset-lobby default evidence, not the earlier saved choice of 250,
and not a clean-install, multiplayer-lobby or pinned-executable measurement.
That reset was not repeated here.

## Editor method

Create a blank Default-data scenario with one player, Player 1 Goths, Pop Limit
200, and Starting Age Imperial. Set Global Victory to Custom with no conditions.
Place one female Villager and no buildings; launch the editor's Test and read
the top-bar population and age. Quit Test back to the editor between cases.
No cheats, triggers, AI opponents or resource grants were used.

Add Houses, then hold the layout fixed while changing only starting age or
civilisation. The accepted layout has **45 Houses**, counted as five screen rows
of 11/8/7/8/11, plus the original Villager. For an independent housing check,
raise only the Teuton Pop Limit to 300: the displayed denominator becomes 225.
Thus the comparisons at limit 200 have surplus housing, not just 200 housing.
Every test starts from the editor fixture; Castle versus Imperial is **not** an
observed in-match research transition.

### Observations

All crop paths below are relative to the durable worktree's
`.local/native/` (worktree: `.local/worktrees/issue-253-pop-limit` in the primary
checkout). Each is an unscaled `(x=0, y=0, width=1400, height=110)` crop of the
matching full PNG; matching JSON records capture time, PID and window rectangle.

| Civilisation / starting age | Pop Limit | Houses | Population readout | Crop |
|---|---:|---:|---:|---|
| Goths / Imperial | 200 | 0 | **1/0** | `pop-goths-imperial-no-houses-crop.png` |
| Goths / Imperial | 200 | 45 | **1/210** | `pop-goths-imperial-45-crop.png` |
| Goths / Castle | 200 | 45 | **1/200** | `pop-goths-castle-45-crop.png` |
| Teutons / Imperial | 200 | 45 | **1/200** | `pop-teutons-imperial-45-crop.png` |
| Teutons / Imperial | 300 | 45 | **1/225** | `pop-teutons-housing-control-crop.png` |

Setup evidence: `pop-goths-imperial-settings.png`,
`pop-goths-castle-settings.png`, `pop-teutons-imperial-settings.png`,
`pop-teutons-limit300-settings.png`; accepted housing layout:
`pop-layout-45.png`. The latter settings captures also show the same layout.

These observations support the implemented separation of housing and ceiling:
Gothic Imperial +10 permits 210 with sufficient housing but grants no housing
itself. Castle Goths and Imperial Teutons remain capped at 200 with that same
housing. No source-behaviour contradiction was found; no runtime code or
acceptance tests were changed.

## Failed setup attempts and limits

The inherited worker's `in-game-check` and `game-state-verify` captures were
the scenario-selection screen, not a match. Guessed skirmish coordinates and
a crop of that screen supplied no population evidence. The tracked tree had
no partial diff to preserve.

In this run, 44 initial House placement clicks produced only **38** Houses:
overlap/snapping rejected six. `pop-goths-imperial-44-houses-crop.png` actually
reads **1/190**; its filename is an attempted count, not a successful fixture.
An initial attempt to add seven more also left 1/190 because returning from Test
reset the category to Units, where the House filter had no matches
(`pop-more-houses.png`). Explicitly restoring Buildings and selecting House
created the seven missing additions. These failed setup captures are retained;
neither 1/190 result is presented as a ceiling measurement.

The private `RECIPES.md` and `macro.sh` record tested editor civ anchoring,
Castle/Imperial rows, population textbox, House search/category reset and
return-to-editor controls. Goths/Castle/200 and Teutons/Imperial/300 helper
compositions were replayed and visually checked on a fresh blank editor.
`bash -n .local/native/macro.sh` passed. This is native HUD calibration, not a
new native test of training the 201st/211th unit, death release or in-match
Imperial research. Existing simulation acceptance coverage is unchanged.
Pinned-runtime parity remains unverified (#279); this current-build evidence
does not claim to resolve it.

The game was left at the main menu, same PID, with no explicit scenario save:
`pop-final-main-menu.png`. Screenshots and control helpers remain private and
untracked. No owned checkpoint/import, deployment, service restart or push ran.
