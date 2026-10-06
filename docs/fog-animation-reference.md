# Native fog reference — #117

2026-10-06, **current installed DE build 185872, not pinned build 48987**.
Owner-authorized PID 22012, version `101.103.54800.0 (#185872) 25464371`.
Documentation/evidence only; no runtime implementation or parity claim.

**Result: BLOCKED for motion calibration.** The options visibly change the
cloud field and boundary, but neither editor Test nor a fresh single-player
skirmish produced measurable cloud drift. Running F11 clocks advanced; paused
clocks did not. Do not invent a direction, convert `7500` into pixels/second,
or treat the checkbox name as evidence that these captures animate.

## Settings and restoration

Original user settings, not factory defaults:

| Setting | Before / final restored value |
| --- | --- |
| Display / resolution | Full screen, 2560 × 1440 |
| Graphics preset / default zoom | Custom / 50%; no wheel/zoom commands issued |
| Enhanced Graphics (UHD) | Unchecked, greyed |
| V-Sync / FPS limit | Off / 56.00 |
| AA game objects / UI / text | All on |
| Render 3D Water / Beach Waves | Both on |
| Vignette / Map Lighting / Blood | All on |
| Advanced options / particles | Shown / High |
| Depth of Field / Bloom / Sharpen | All on, each 100% |
| Gamma intensity | 1.00 |
| Animate Fog / Animate Fog Border | Both on, each 100% |

Only the two fog checkboxes changed: **ON/ON → OFF/OFF → OFF/ON → ON/ON**.
Sliders and other settings were untouched. The first in-game restoration click
sequence failed to open Options; its misleadingly named `fog-settings-restored`
capture is **not** restoration evidence. Restoration was completed from the
main menu, confirmed, then independently reopened after the skirmish.
`fog-settings-final-readback.png` and `fog-settings-before.png` have **identical
pixels** in the complete controls rectangle `[690,260,1880,1220)`.
`fog-final-main-menu-verified.png` shows the final main menu and version.
No scenario was saved; no game/service restart, import, checkpoint or deployment
was performed. F11 was enabled for measurements; this is not a claim to restore
every non-graphics UI toggle.

## Fixture and capture method

Local evidence directory (ignored, deliberately not committed):
`/home/fraser/repos/age-of-empires/.local/worktrees/issue-117-fog-reference/.local/native/`.
All filenames below are relative to it. Preserve this directory before retiring
the worktree. Images contain owned content and must not be committed.

The supplied `macro.sh` / `native-control.ps1` drove only the foreground native
game, with 2560 × 1440 captures. Tool previews are scaled; all coordinates and
measurements here are **original screen pixels**, x rightwards, y downwards.

1. New blank editor scenario; Teutons, Dark Age, one player, custom victory with
   no conditions. Place one female Villager at `(1280,700)`; Test.
2. F11 on; move her from the central starting area toward `(700,700)`, wait
   25 wall seconds, pause. This leaves visible grass on the left, remembered
   grass on the right, and large never-explored regions above and beside them.
   `fog-fixture.png`, `fog-walk.png`, `fog-fixed-view.png` record the setup.
3. Keep the camera and villager fixed. Capture 20 frames at nominal 500 ms
   intervals for paused and running states in each checkbox combination.
   F3 toggles pause; F11 remains in every full frame. Options dialogs are absent
   from the measurement frames. Cursor rests near `(1280,90)`, outside ROIs.
4. Focused retry: a fresh single-player Random Map skirmish, inherited lobby
   Arabia, Tiny (2), Standard resources, Normal speed, Standard reveal, Conquest,
   Random civilizations; player rolled Franks versus an AI. No orders or camera
   movement. Its actual F11 speed label is **Casual – 1.5**, not an assumed
   numeric conversion from the lobby label. Capture another running/paused pair
   with both fog options on. Quit to statistics, then main menu.

`fog-series.ps1` uses Windows `CopyFromScreen`, foreground PID checks, and a
monotonic Stopwatch deadline for each capture. Its JSON logs bracket the screen
copy with Before/After times and record UTC; PNG encoding is outside that
bracket. Intervals are measured, not assumed from process-launch overhead.
No HDR/ICC calibration was made: reported RGB values are **display/sRGB byte
values**, not linear-light shader values. Full captures are `fog-SERIES-00.png`
through `-19.png`, with corresponding `fog-SERIES.json` and clock contact sheets.

## Measurements

ROIs are `(left, top, width, height)`: cloud `(1750,300,640,640)`;
top-cloud `(800,140,768,352)`; remembered grass `(1190,795,210,35)`;
visible grass `(650,745,160,35)`; border `(650,470,400,170)`.
The skirmish cloud control uses `(100,380,500,620)` to avoid its larger starting
LOS and notification. Do not compare its green map lighting with the neutral
editor capture. Default is the JSON comparison profile below; an editor
lighting-profile selector was not independently read back, so its exact active
profile is not established.

RGB means and variances pool spatial pixels and all 20 frames; variances are in
squared sRGB-byte units. Temporal RMS is adjacent-frame RGB difference in bytes.

| Series / outcome | Measurement |
| --- | --- |
| ON/ON paused cloud, 9.479 s | RGB mean **38.245, 38.245, 39.110**; variance **72.468, 72.468, 75.113**; temporal RMS **0.01432**, max 1; identical first/last ROI |
| ON/ON running cloud, 9.484 s | Same RGB mean/variance; temporal RMS **0.01013**, max 1; identical first/last ROI; F11 **00:00:56 → 00:01:10** |
| ON/ON paused clock | **00:00:54 → 00:00:54**; clouds do not measurably animate while paused in this fixture |
| OFF/OFF running cloud, 9.482 s | Mean **0.490, 0.490, 1.323**; variance **1.069, 1.069, 6.201**; temporal RMS **0** |
| OFF/ON running cloud, 9.481 s | Same as OFF/OFF; no cloud field introduced by the border checkbox |
| OFF/ON running border | Temporal RMS **0**, max **0**; F11 **00:01:32 → 00:01:47** |
| Skirmish ON/ON running, 9.490 s | Cloud temporal RMS **0.000476**, max **1**; identical endpoints; F11 **00:00:48 → 00:01:02** |
| Skirmish ON/ON paused, 9.496 s | Cloud temporal RMS **0**, max **0**; clock pixels unchanged |
| Cloud drift, screen px/s | **No resolved displacement (observed 0); direction undefined**, in both running fixtures and paused controls |
| Cloud spatial scale, right ROI | FFT peak wavelength bin **202–235 px**; autocorrelation half-width **41 px x / 22 px y** |
| Cloud spatial-scale sensitivity, top ROI | FFT peak **274–320 px**, at the low-frequency limit; half-width **45 px x / 26 px y** |
| Border checkbox spatial footprint | At x=720, five-column average green difference exceeds **2/255** over **y=525…566**, **42 vertical pixels**, OFF/OFF versus OFF/ON |
| Border temporal displacement/width | **Not resolved**; the 42 px value is a static option-difference footprint, **not animation amplitude** or a normal-to-contour universal width |

OFF is near black, not mathematically black everywhere: the unchanged vignette
and postprocessing remain enabled. ON is a grey cloud field in the editor, not
necessarily brown. These qualifications matter when implementing an option-off
look or comparing unprocessed shader constants with a final screenshot.

The remembered-grass mean changes from OFF/OFF **(88.728,100.240,46.244)** to
ON/ON **(82.520,91.351,49.866)**; the visible-grass control remains exactly
**(158.702,171.057,82.783)**. Thus the options visibly affect remembered ground
as well as unseen ground, without a camera shift or global exposure change in
these controls. The border-only remembered mean is **(88.728,100.239,46.243)**.

### Analysis reproducibility and limits

Run `uv run --locked python .local/native/fog-measure.py` in this worktree.
It writes `fog-measurements.json`, cloud/grass/border crops and F11 contact sheets;
the retained command output is `fog-measurements.txt`. Supplement with
`uv run --locked python .local/native/fog-audit.py`: this checks all eight series,
clock progression, restoration, and the x=720 border measurement and writes
`fog-audit.json` (including skirmish statistics).

For spatial scale: average RGB to grey, least-squares subtract a plane, apply a
separable Hann window, average squared 2D FFT magnitudes over frames. Sum energy
in 24 logarithmic radial-frequency bins spanning 1/320…1/8 cycles/pixel. Report
the largest-energy bin, not a fitted exact wavelength. Inverse-transform that
power spectrum for the autocorrelation and find its first 0.5 crossings along
x/y. The broad field, vignette and finite crop make the peak crop-sensitive;
the two ROI results explicitly **do not establish a unique cloud-cell size**.

The script also attempts brightness-constancy optical flow on plane-detrended,
20–200 px band-passed grey frames, excluding a 40 px margin. Median x/y flow
is zero because the input is static. Exact endpoint equality and the negligible
intermediate one-byte fluctuations are stronger evidence than a flow estimate.
No nonzero velocity or precision bound is fitted from that noise. A changing
F11 clock is the positive control against a frozen screenshot source.

For the static border footprint, compare frame 00 of `off-running` and
`border-running`, average green over x=718…722, and find rows within 450…669
whose absolute difference exceeds 2 bytes. The broader sampled cross-sections
are retained in `fog-border-width.json`; farther right, a second visible/remembered
transition and separated difference lobes make their total spans unsuitable as
one edge width. No moving border was observed from which to infer amplitude.

## Owned inputs and what they do not establish

Resolved the depot with `uv run --locked python tools/depot.py` before inspection.
The installed input root is `D:\SteamLibrary\steamapps\common\AoE2DE`.
The pinned depot root is the SteamCMD `app_813780` tree described in AGENTS.md.

| Input | Read result |
| --- | --- |
| `depot_813782/resources/_common/terrain/colorcorrection_json/colorcorrection.json` | Default: `fog_tint_color=[0.25,0.25,0.25]`, `fog_seen_land_mult=0.5`, `fog_default_resolution=[1920,1080]`, `fog_cell_size=2`, `fog_anim_speed=7500.0` |
| Same file, Default postprocessing | brightness 0.95, contrast 1.01, saturation 0.99; vignette enabled in the UI, so the final cloud colour is not a direct tint readback |
| `depot_813781/resources/_common/shaders/d3d11/CombineTerrainSpriteSMP_ps.so` | Strings include `g_Time`, `g_FogScreenULOffsets`, `g_FogTintColor`, `g_fogCellSize`, fog/border options and intensities |

Installed and depot copies are byte-identical for both files. SHA-256:

- JSON: `76a7a7e1d610f77cd4bb8f763f0b01b7f889adffd0b3120a2c3faabdbabe12c9`.
- Shader: `1426e9467e7595e3debecb4d012ee924ccde1d1859a38ae698bb1c5a26fc84aa`.

`fog_tint_color` is a multiplier/input, not a promised final sRGB mean. Naively
mapping 0.25 to 63.75 bytes does not predict the measured 38.25-byte mean of a
nonuniform cloud after composition/vignette. Neutral RGB tint is qualitatively
consistent with the grey field; its slight blue bias and variation are retained,
not fitted away. `fog_cell_size=2` has no established pixel-unit mapping here;
the measured spectrum neither validates nor disproves it. `fog_anim_speed=7500`
and `g_Time` cannot be calibrated against a static field. The camera was fixed,
so `g_FogScreenULOffsets` was not independently varied or mapped to screen/world
coordinates. No cloud texture/procedural-noise identity was recovered this run.

The shader container has RDEF/ISGN/OSGN/SHDR/STAT chunks and **no Aon9 chunk**.
`tools/probes/sm2dis.py` therefore returned no disassembly; an earlier `--help`
attempt failed because it treats its argument as a filename. Empty output is not
evidence of absent fog arithmetic. No executable was disassembled. A guessed
depot_813782 shader path also failed; discovery found the actual 813781 path.

## Acceptance / handoff

- **Pass:** settings captured and restored by pixel comparison; default-zoom
  ON/OFF/isolated-border captures; visible/remembered/unseen fixture; eight timed
  series, paused/running clock controls; colour and spatial statistics; owned
  constant provenance; final main menu, same PID.
- **Blocked:** positive drift direction/rate, temporal border width, time units,
  and a unique scale-to-`fog_cell_size` mapping. Two independent running fixtures
  were static. A coordinator-approved follow-up may investigate build/runtime
  animation enablement or recover SM4 shader arithmetic; **do not manufacture
  those values or restart the owner's game without permission**.
- The worktree initially had no #117 partial diff, prior failing checks or cheap
  worker attempt artifacts; supplied recipes covered other issues. No previous
  acceptance coverage was removed. All attempted captures are retained, including
  failed navigation/restoration attempts; only the named verified endpoints count.
- Documentation checks: `git diff --check`, measurement rerun and evidence/settings
  assertions. No build, verify/import, push, main integration or service restart.
  Native capture subprocesses completed; only the pre-existing game PID remains.
