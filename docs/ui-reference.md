# AoE2DE UI reference sources

The strongest UI specification is the patch-matched `widgetui` content already downloaded from depot `813782`, not a third-party recreation.

## What is explicit locally

Resolve the owned root with `uv run --locked python tools/depot.py`; its
`depot_813782/widgetui/` contains the JSON screen/panel definitions and textures.

The files specify:

- a 3840×2160 reference coordinate space on major screens;
- nested viewport origins, width, height, alignment, anchors, clipping, radius, and Z order;
- widget types and names;
- normal, hover, pressed, and disabled materials;
- font index, point size, style, and RGBA text colors;
- keyboard shortcuts, focus/tab order, accessibility strings, help/tooltip IDs, and click-sound aliases.

Primary in-game references:

```text
resourcepanel.json
commandpanel.json
mappanel.json
menupanel.json
blankbottompanel.json
scorepanel.json
technologyprogresspanel.json
worldtimerpanel.json
```

Primary menu references:

```text
screenmainmenu.json
screensingleplayercreate.json
screenoptions.json
screenhotkeymenu.json
dialogingamemenu.json
dialogendgame.json
screenloadgame.json
```

`screenmainmenu.json` defines the 3840×2160 screen, focus order, and named controls. `dialogingamemenu.json`, for example, explicitly specifies a centered 950×2000 collection, 950×720 background, 56×56 close button, Escape hotkey, fonts, colors, and material states.

## Art and icon resolution

### Feedback source audit (#58)

`GameMsgPanel.json` contains nine transparent screen anchors, no ticker text.
`notificationpanel.json` defines event/chat Surrounds and MultiColorTextBoxes;
the event box supplies the HUD's message stack. `GameNotificationPanel.json`
instead defines a defeat announcement with player/civ widgets, and
`popupmessage.json` is an OK-button modal, not a notification ticker. Both are
now imported and used: the former announces the losing player's existing
score-row identity at match end; the latter acknowledges replay-loading errors.
Objective-change content belongs to #138. The full symbolic defeat template
`IDS_GAME_NOTIFICATION_PANEL_DEFEAT` and numeric OK string 4001 are imported.
`dialogyesnoboxgeneral.json` has only a centred viewport. Its sibling
`resources/_common/wpfg/dialog/dialogyesnoboxgeneral.xaml` contains the actual
in-game black/gold dialog. `tools/import_feedback.py` reads its children plus
`DialogBackgroundRect`, ButtonLarge, text, font and image resources. It also
imports `dialogendgame.xaml`, whose full-width crest/title screen supersedes
the parchment placeholder in widgetui. The replay-dialog substitution is now
only compatibility for older manifests. Import assertions retain Box, TextBox,
HotKey and per-state Color as well as the native XAML metrics and original fonts.

`UIColors.json` was already imported for player text before #58. The three
`uicolors_*.json` variants and `dat/UiColors.txt` now accompany it, source-hashed,
and populate `--ui-<tag>` / `--ui-<player-colour>-<role>` CSS custom properties.
The existing `blanktoppanel` import already supplies the top strip.

### Reference comparison (2026-09-24)

The human supplied the missing captures in the conversation: options, TC Delete,
full loss screen, Loom in progress/completed, and blocked housing. Settings:
2560×1440, HUD 100%, tooltip 75%, Normal notification duration, Readability Panels
on, colour-blind Off, unique player/health colours and Safe Delete on. Chat renders
2000×1125 previews; original PNG bytes are not stored in the local corpus, so
preview-derived measurements are not a raw-pixel oracle. The attachments and
settings are indexed in `.local/reference/index.md`.

| Surface | Reference observation / owned corroboration | Browser check |
|---|---|---|
| Completed research | box ≈(21,159), 312 wide, 32 high in preview; second line grows to ≈53 high | owned (40,305), width 600, `40*n+20` height; bold white text |
| Blocked production | separate red warning ≈(889,860), 431×70 in preview | capture-derived 828×134, centre offset +200, bottom inset 374; no warning for cap alone |
| Population flash | yellow region spans the count slot, not just its glyphs | owned `PopulationFlash` 140×72, normalized alpha 0.7 |
| Delete | black/gold frame ≈(635,437), 730×252 in preview; close button; white message | XAML-derived width 1400, auto rows, original frame slices, 560-wide buttons, 52-point owned Times/Trajan fonts |
| Loss | full-width lines, central crest, large grey title, divider and Return/Leave | owned XAML positions and textures; animated, view-only quadratic-falloff embers |

The browser smoke writes 2560×1440 local confirmation, notification, housing and
defeat screenshots under `.local/issue58-*-owned.png`, plus the generic popup at
2000×1125. Numeric tests verify geometry, source image reconstruction, frame
contribution at full opacity (sRGB 78,76,73 versus 240,240,240), and generic-popup
alpha (120,120,120 matching the dimmed plane). The end-screen tests verify changing
ember pixels and public Return/Leave behaviour without mutating the finished game.

This corrects the screenshot-visible structural mismatches; it does not claim
pixel-identical font rasterization, glint, dimmer values or ember trajectories.
Those are explicit ledger approximations. The human could not reproduce the
generic OK modal and accepted its owned widget artwork/layout without runtime
capture; that verification limit does not block #58.

`materials.json` contains about 4,410 material definitions connecting widget states to texture references, blend modes, colors, and fonts. `icons.json` maps semantic/icon indexes to named materials. The corresponding local art is under:

```text
widgetui/textures/ingame/
widgetui/textures/menu/
widgetui/textures/ingame/panels/WEST/
```

The WEST directory contains the resource, selection, command, minimap, menu, top, and bottom panel artwork needed for the initial skin. DDS unit/building/action icons can be converted locally with Pillow.

## Audio triggers

Widget definitions contain 283 explicit `ClickSound` assignments, primarily:

```text
?button_ui
?button_tab
?button_select
?button_gfx
```

The downloaded core file:

```text
resources/_common/dat/sounds.json
```

maps these aliases to Wwise events such as:

```text
button_ui     → Play_Button_UI
button_tab    → Play_Button_Paper
button_select → Play_Button_Select
button_gfx    → Play_Button_GFX
```

It also names gameplay/UI events including errors, population warnings, technology completion, gather-point placement, notifications, chat, and under-attack alerts.

The JSON does not explicitly assign hover audio; that behavior is likely a default in the closed widget runtime. Actual payloads are in sound depot `813783` (`Base.pck`/`Base.1.pck`, about 983 MiB installed). The importer now resolves consumed event names through the bank HIRC graph and decodes referenced media with external `vgmstream-cli`; `button_ui` is the first wired cue.

## What is not fully specified

There is no known complete official JSON Schema or public interaction-state-machine specification. Some controls are injected by the executable: `screenmainmenu.json`, for example, lists named controls and tab order while its visible background has no static child buttons. Thus the local files provide excellent geometry/style/focus/audio-trigger evidence but not every click destination or runtime rule.

Menu navigation should be reconstructed from:

1. shipped screen/dialog names, button names, `TabOrder`, `Page`, and `Tab` references;
2. official support/learn-to-play flows;
3. current-build screenshots or controlled recordings;
4. focused validation in the owned game where behavior remains ambiguous.

Do not infer a complete navigation graph from filenames alone.

## Useful online references

- [AoE2DE UI Layout Editor](https://jonasbl3.github.io/AoE2DE-UI-editor/) visually loads and edits shipped widget JSON. Its source repository has no detected license, so use the tool/reference but do not copy its code.
- [Ch4nKyy/age2de-ui](https://github.com/Ch4nKyy/age2de-ui) demonstrates practical panel modifications and live-reload behavior; verify its license before code reuse.
- [Official AoE Modding Hub](https://support.ageofempires.com/hc/en-us/p/ModHub) and [Return of Rome mod updates](https://support.ageofempires.com/hc/en-us/articles/15607286588948-Return-of-Rome-Mod-Updates) document support for `icons.json`, `materials.json`, `morematerials.json`, and `sounds.json`.
- [Official control/resources guide](https://www.ageofempires.com/learn-to-play/control-resources-aoe2/) identifies the intended HUD regions and player-facing roles.
- StepS's [AoE2DE Audio Modding Guide](https://steamcommunity.com/sharedfiles/filedetails/?id=1915891079) and linked UI-sound spreadsheet are the strongest community Wwise event references.

## Implementation policy

Treat the installed widget files as local reference inputs. Build a small extractor that emits only the dimensions, state names, texture/icon references, hotkeys, tab order, and sound aliases consumed by our interface. Generated Microsoft content stays ignored. Our committed code implements the responsive web layout and interaction logic; an open fallback skin preserves repository usability without owned assets.
