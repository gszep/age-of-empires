# AoE2DE UI reference sources

The strongest UI specification is the patch-matched `widgetui` content already downloaded from depot `813782`, not a third-party recreation.

## What is explicit locally

`~/Steam/steamapps/content/app_813780/depot_813782/widgetui/` contains 133 JSON screen/panel definitions and their textures.

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
