# Native menu evidence: pause menu, main menu, match setup (#349)

Evidence pass of October 31, 2026, corrected the same day after independent
review. Owned evidence for the in-game menu flow; the parallel REA worker owns
binary handler correlation. Nothing here came from the game binary: every fact
below was read from text assets, and every guess is labelled **inference** or
**proposal**.

## Provenance

- Depot root resolved with `uv run --locked python tools/depot.py`:
  `/home/gszep/.local/share/Steam/steamcmd/linux32/steamapps/content/app_813780`
  (UI tree in `depot_813781/resources/_common/wpfg`).
- Locale strings resolved from
  `depot_813781/resources/en/strings/key-value/key-value-strings-utf8.txt`
  with `grep -m1 -E "^\"?<id>\b"` (other languages exist beside `en`).
- **Units:** every inspected screen uses `d:DesignWidth="3840"
  d:DesignHeight="2160"`. All dimensions below are **XAML layout units on
  those inspected design canvases**, not universal CSS pixels. The repo's HUD
  helpers rescale such values through `--ui-scale`
  (`src/view/feedback.ts` `px()` = `calc(Npx * var(--ui-scale))`;
  `src/view/style.css` sets `--ui-scale` on `#hud`), so an implementation
  must route these numbers through that scaling rather than copying them as
  screen pixels.
- Files read: `dialog/dialogingamemenu.xaml`,
  `screen/screensimplemainmenu.xaml`, `screen/ScreenSinglePlayerCreate.xaml`,
  `screen/ScreenLoadGame.xaml` (lines 1–38),
  `tab/tabsingleplayercreategamesettings.xaml`,
  `tab/tabsingleplayercreatemapsettings.xaml`,
  `SystemResourcesCreatePlayerItem.xaml`, `systemresourcesbuttonlarge.xaml`
  (including the `ButtonImage` style at line 552), `SystemResourcesFont.xaml`,
  `systemresourcesimages.xaml` (key lookups), `tools/import_feedback.py`,
  `src/view/hud.ts` (menu section), `src/main.ts` (menu callbacks and
  simulation loop; §6).

## 1. In-game menu (pause) dialog — observed

`dialog/dialogingamemenu.xaml`, root `Age2DialogIngameMenu`:

- A full-canvas `ButtonCloseBackground` (`ButtonMixerTransparent`, margin
  `-640,0,-640,0`, `IsTabStop="False"`) is declared. Its presence is
  observed; **that clicking it closes the dialog is engine-side behaviour,
  not proven by this XAML** (inference from naming and margins).
- The dialog itself: a centered `Grid MinWidth="1100" MinHeight="100"` with a
  `Rectangle` filled by `Age2NineSliceShinyEffect`:
  `NineSliceTexture={StaticResource dialog2_9slice}`
  (`/resources/dialog/dialog_popup2_9slice.png`, 9-slice P1 `84,133`,
  P2 `133,84`, TextureSize `300,300`) with shiny mask
  `dialog_popup2_9slice_Blurmask.png`. The swipe shader parameters carry
  `PixelLeft="1280" PixelTop="700"`; the actual dialog placement is engine
  layout, not asserted here.
- Close (X) button top-right: width 85, height 87,
  `Style={StaticResource ButtonImage}`,
  `Background={StaticResource button_large_normal}`, icon
  `{StaticResource button_close_cross}`
  (`/resources/button_small/Cross_yellowgradient.png`), TextLocale `10824`
  ("Close"), HelpLocale `300360`. Note the `ButtonImage` style itself
  declares state brushes `button_player_icon_{normal,hover,active,disable}`
  (`systemresourcesbuttonlarge.xaml` lines 552–561).
- **No heading element** and **no "Resume" button** exist in this dialog. The
  content is one `StackPanel x:Name="ButtonList"` inside a 100/*/80 row grid.
- All stack buttons default to `Visibility="Collapsed"`. **Runtime visibility
  and enabled-state policy remain unverified.** `ButtonLarge` supplies
  disabled-state triggers (§2); collapsed defaults do not establish how native
  unavailability is presented. Greying unsupported actions is **our product
  policy**, not a demonstrated native match or deviation.
- The stack has **19 positions in fixed XAML order**; every stack button uses
  `Style={StaticResource ButtonLarge}` and `Margin="130,25"`:

| Pos | x:Name | TextLocale | English (observed) |
|----|--------|-------------|--------------------|
| 1 | ButtonInvites | 300008 | Invitations |
| — | Spacer | — | (Separator, height 40, collapsed) |
| 2 | ButtonQuit | 9273 | Quit Current Game |
| 3 | ButtonResign | 9280 | Resign |
| 4 | ButtonStatistics | 9271 | Statistics |
| 5 | ButtonSave | 9272 | Save Game |
| 6 | ButtonLoad | 9276 | Load Game |
| 7 | ButtonSpectateCA | 19353 | Spectate With CA |
| 8 | ButtonChapter | 9289 | Save Chapter |
| 9 | ButtonOptions | 9274 | Options |
| 10 | ButtonRestart | 9279 | Restart |
| 11–18 | Button9…Button16 | — | eight placeholders, `Content="button N"`, no locale |
| 19 | ButtonCancel | 19240 | Cancel |

- Which buttons are visible and enabled per game state is runtime behaviour
  and is **not established** by these assets; see §8.
- The dialog contains no map/population/seed/civilisation controls and no
  replay loader. Those belong to separate full screens (§4, §5).

## 2. Button material facts — style declarations, not runtime observations

`systemresourcesbuttonlarge.xaml`, style `ButtonLarge` (used by every
in-game menu stack button; the X close uses `ButtonImage`):

- `FontSize 52`, `FontWeight Bold`, default `Height 100`,
  `BorderThickness 4` with `ControlBorderBrush`, `ControlDropShadowBig`
  effect, text style `TextBlockButtonBig`.
- State brushes: `button_large_normal` / `button_large_hover` /
  `button_large_active` / `button_large_disable` →
  `/resources/button_large/button_large_{normal,hover,active,disabled}.png`.
- The style declares disabled/pressed triggers (Disabled brush +
  `ControlBorderDisabledBrush` border and forced-white text; pressed shows
  the active brush with white text). **These are style declarations; where
  the engine applies `IsEnabled=False` at runtime is not shown by these
  files.** For the pause dialog specifically, all stack buttons default
  Collapsed; neither runtime visibility nor enabled-state policy is verified.
- Focused (not captured) shows the hover brush.

Fonts (`SystemResourcesFont.xaml`, `wpfg/fonts/`):

- `Body`/headings = **Trajan Pro** (`TrajanPro-Regular.ttf`), buttons =
  `TrajanPro-Bold.ttf`, `Body2` = Times New Roman (`timesbd.ttf`); other
  shipped faces include Georgia, **Book Antiqua (`BKANT.TTF`)**,
  **Palatino Linotype (`PalatinoLinotype.ttf` — a separate file/face from
  Book Antiqua)**, Segoe UI, Malgun Gothic, Microsoft YaHei, Nirmala, Arial.

**Importer cross-check — static approximation, not full fidelity.**
`tools/import_feedback.py` already extracts `dialog2_9slice`,
`button_large_normal/hover/active/disable`, `button_close_cross`, `panel00`,
9-slice geometry and the three fonts (`body`/`heading`/`button`), and
`src/view/native-feedback.ts` exposes them as
`--native-button-{normal,hover,active,disable}` CSS variables plus
`slices()`/`buttonText()` helpers (consumed by `src/view/diplomacy.ts` and
`src/view/options.ts`). That list **excludes**:

- `dialog2_9slice_blurmask` — the shiny mask this dialog's
  `Age2NineSliceShinyEffect` requires;
- any `button_player_icon_*` material — the state brushes the close button's
  `ButtonImage` style declares (`systemresourcesbuttonlarge.xaml` 552–561).

The repo's generic CSS treatment also lacks the native disabled/pressed text
treatment (forced-white text, disabled border brush). The already-imported
set therefore supports a **static approximation** of the pause dialog —
frame, button backgrounds, close cross, fonts — not full fidelity; gaps are
itemised in §9.

## 3. Main menu — observed

`screen/screensimplemainmenu.xaml` (3840×2160 design canvas):

- Left DLC bar (width 260 at x=8, `ribbon00_CA` nine-slice) with three
  `Age2ButtonSwapGameVariant` toggles (200×200, AoE2/RoR/Chronicles logos).
- Main ribbon width 970 at x=265 (`ribbon00_CB` nine-slice + blur mask),
  rows: `MainMenuLogo`, buttons, `mainmenu_hr` divider (544×96,
  `/resources/mainmenu/mainmenu_hr.png`), buttons, build label.
- Non-Chronicles button stack (top→bottom), all width 754. Several entries
  are declared alongside a *disabled twin* control; **only the Single Player,
  Co-Op, Multiplayer and Mods twins declare
  `ForegroundBrush={StaticResource button_player_icon_disable}` — the Learn
  to Play and Editors twins are declared without that brush, so do not
  generalise one disabled treatment across all twins.** How the engine picks
  between twin and normal control is runtime behaviour, not in these files.

| Order | x:Name | Locale | English | Style/size | Twin foreground brush |
|---|---|---|---|---|---|
| 1 | ButtonSingleplayerDialog | 9202 | Single Player | ButtonImageMix, 754×325, `button_image_singleplayer.png` | `ButtonSingleplayerDisabled`: yes |
| 2 | ButtonLearnDialog | 9503 | Learn to Play | ButtonLarge | `ButtonLearnDialogDisabled`: none declared |
| 3 | ButtonCoop | 10035 | Co-Op Campaigns | ButtonLarge | `ButtonCoopDisabled`: yes |
| 4 | ButtonMultiplayer | 9203 | Multiplayer | ButtonImageMix 754×325 `button_image_multiplayer.png` | `ButtonMultiplayerDisabled`: yes |
| 5 | ButtonEditor | 9256 | Editors | ButtonImageMix 754×264 `button_image_editor.png` | `ButtonEditorDisabled`: none declared |
| 6 | ButtonMods | 9543 | Mods | ButtonLarge | `ButtonModsDisabled`: yes |
| 7 | ButtonMoreContent | IDS_MORE_CONTENT | More Content | ButtonLarge + red "New" badge (10710) | — |
| 8 | ButtonExit | 9207 | Exit | ButtonLarge | — (no twin) |

- The screen also embeds `panel/panelplayerlogin.xaml`,
  `panel/panelevents.xaml` frames, a purchase banner and build labels.
  Background screen: `screenmainmenubackground.xaml`.

## 4. Match setup — observed

`screen/ScreenSinglePlayerCreate.xaml` (`Age2ScreenSinglePlayerCreate`,
`Tab0Name="GameSettings"`):

- Full screen over a `ribbon00_AA` nine-slice background; top frame
  `panel/paneltopnavigation.xaml`; bottom `ribbon00_AB` strip (height 190).
- **Bottom action bar** (Canvas.Bottom 24), four `ButtonLarge` 723×105 in a
  row, in order: Technology Tree (9799) | Reset (4012) | Randomize (13577) |
  **Start Game** (9710; help 30207 "Click to start the game.").
- Left panel (`panel00` nine-slice): "Player"/"Team" subheadings and eight
  `Age2CreatePlayerItem` slots (`Player0…Player7`, SlotIndex 0–7).
- Player slot template (`SystemResourcesCreatePlayerItem.xaml`): ready circle
  checkbox, civ icon 120×120, player icon 132×132 (4px border), name combo
  (height 66 on `GradientBlackBrushRight`), two height-50 buttons hidden in
  single player, **civ picker `ButtonCivName` ButtonLarge width 620 height
  66**, colour combo 116×66, team combo 116×66, vertical "Host" label.
- Right column width 2158: `Age2TabPanel` with tabs **Game Settings** (9682)
  and **Map** (10010); a LobbySettings tab is commented out.
- Game Settings tab (`tab/tabsingleplayercreategamesettings.xaml`), two
  columns of `LabelComboBoxSmall` (20px vertical rhythm):
  Data Mod: (170043), Game Mode: (200018), AI Difficulty: (13513),
  Resources: (13514), **Population:** (13516), Game Speed: (9796) |
  Reveal Map: (13522), Starting Age: (13515), Ending Age: (13563),
  Treaty Length: (13590), **Victory:** (13518), Score (13520);
  then "Advanced Settings" (13568) over a yellow 4px rule with checkboxes
  Lock Speed (13525), Allow Cheats (13526), Turbo Mode (13567), Full Tech
  Tree (13524), Record Game (13542), Lock Teams (13523).
- Map tab (`tab/tabsingleplayercreatemapsettings.xaml`): **Map Style:** (13560)
  combo, **Location:** (13511) label + `ButtonMapLocation` ButtonLarge
  **width 626, height 66**, **Map Size:** (13512) combo, "Team Settings"
  (200026) over a yellow rule with checkboxes Team Together (13521), Shared
  Exploration (13565), Team Positions (13566); map icon image 420×420
  (`/resources/mapicons/cm_generic.png`).
- The Game Mode (200018) and Victory (13518) combos are **declared with these
  labels**; that their runtime choices include Regicide and Wonder victory is
  engine-populated and **not proven by these files**.
- **No seed field exists on this screen.** Our seed input is a lab extension,
  not native; the same applies to our regicide/wonder checkboxes versus
  native combos.

## 5. Adjacent screens

- `screen/ScreenLoadGame.xaml` (read lines 1–38): over `ribbon00_AA` and the
  `paneltopnavigation.xaml` frame, it embeds **two `Age2Frame`s in the same
  grid row — `Saves` → `tab/tabLoadGameSaves.xaml` and `Replays` →
  `tab/tabLoadGameReplays.xaml` (lines 32–33)**, plus a busy animation. This
  proves saves and replays are separate native surfaces inside one screen;
  the navigation route to this screen is engine-side, not shown here.
- `screen/screenoptions.xaml` plus option tabs
  `taboptionsaudio/game/graphics/interface/hotkeys.xaml` (existence; internals
  partly extracted by `import_feedback.py`).
- `dialog/dialogsimplesettingsmenu.xaml` exists as a distinct small settings
  dialog (candidate in-game options surface; internals unread).
- `screen/ScreenQuickPlay.xaml`, `screen/ScreenLoadScenario.xaml`,
  `ScreenSelectScenario.xaml`, `screenmapselection.xaml` exist for the
  single-player navigation graph (engine-side routing, not asserted).

## 6. What the current app combines (observed in `src/view/hud.ts` lines 383–408)

`#menu-dialog` merges, in one box: Resume/Restart/Options buttons, the whole
`#map-setup` form (map type, regicide checkbox, population, wonder checkbox,
seed, Start Game) and a replay file input. Natively these are separate
surfaces: the pause dialog (§1), the match-setup screen (§4) and the
Load Game screen (§5). The end dialog (`#end-dialog`) already follows the
native `dialogendgame.xaml` pattern via `import_feedback.py`.

Menu visibility is not simulation pause: `toggleMenu()` only toggles the
`hidden` class (`src/view/hud.ts` 774–777). The local simulation continues
when unpaused and the match is not over (`src/main.ts` 2152–2157); the
Resume callback explicitly calls `setPaused(false)` (489–491). These are
current app source facts, not native pause semantics or browser-test results.

## 7. Proposed structure and action mapping — proposal (inference)

Separate the current dialog into native-modelled surfaces, reusing the
already imported `dialog2` nine-slice, `--native-button-*` states and fonts
(static approximation per §2):

**A. In-game menu dialog** (dialog2 nine-slice, X close width 85 height 87,
ButtonLarge stack, native order preserved). Unsupported actions stay **greyed
in place** as our product policy; native runtime visibility and enabled-state
policy are unverified. Proposed mapping, not delivered functionality:

| Native button | Locale | Our mapping |
|---|---|---|
| Cancel (position 19) | 19240 | **working** — closes the dialog (our Resume) |
| X close | 10824 | **working** |
| Options | 9274 | **working** — opens the existing options overlay |
| Restart | 9279 | **working** — confirm first via the native yes/no dialog pattern (`dialogyesnoboxgeneral.xaml`, already imported) |
| Resign | 9280 | **working** — routes to the existing resign/end flow |
| Quit Current Game | 9273 | disabled until a start destination exists (§C); no reload fallback in this pause-only slice |
| Save Game | 9272 | disabled (no save system yet) |
| Load Game | 9276 | disabled (native home is the Load Game screen, §5) |
| Statistics | 9271 | disabled |
| Save Chapter | 9289 | disabled (unsupported) |
| Spectate With CA | 19353 | disabled (native action unsupported; handler semantics unverified) |
| Invitations | 300008 | disabled (unsupported, native top slot) |

The replay file input moves out of this dialog (§9 keeps it reachable).

**B. Match setup screen** (before a match starts; not reachable from pause):
two player slots with civ picker buttons (Britons + Inca roster), Game
Settings tab (Population combo, Victory combo, Game Mode combo; remaining
combos present-but-disabled), Map tab (Location combo = our map list; Map
Size if supported; Map Style disabled), bottom bar TechTree | Reset |
Randomize | Start Game with unsupported entries disabled. Our regicide and
wonder options become combo entries by design choice (labelled lab mapping,
not a native claim); the seed input remains a labelled lab extension.

**C. Start/main menu** (if scheduled): native ribbon order Single Player
(opens B) | Learn to Play | Co-Op Campaigns | Multiplayer | Editors | Mods |
More Content | Exit, with disabled twins where features do not exist, and
the replay loader behind a Load Game entry (native §5).

**Separate lab extension (future, outside the pause-only slice):** expose
`?agents=2` model spectators through a clearly labelled **Model spectators
(lab)** entry, not a native menu action.

**File ownership for the next stage** (cross-checked): DOM and callbacks in
`src/view/hud.ts`; reuse `src/view/native-feedback.ts` (slices, buttonText,
button state CSS vars); a new `src/view/match-setup.ts`/`menu-dialog.ts`
split keeps `hud.ts` bounded; strings via the existing `this.strings` map,
optionally extended from the owned key-value table. **Static approximation
only:** the pause dialog's frame, button backgrounds, close cross and fonts
are already extracted, but the shiny/blur-mask materials and
`button_player_icon_*` state brushes are not (§2); any additional art
(main-menu ribbon, simplemainmenu button images, map icons, blur masks)
would extend `tools/import_feedback.py` `image_names` — an importer edit
needs a coordinator-owned import slot, not a worker-side regeneration.

## 8. Minimal handler questions for targeted decompiles (assets cannot answer)

1. `Age2DialogIngameMenu`: which of the 11 named stack buttons the engine
   makes visible and enabled for (a) single-player skirmish, (b) campaign,
   (c) multiplayer, (d) spectator — and confirmation that `ButtonCancel`,
   `ButtonClose` and `ButtonCloseBackground` are the close/resume affordances.
2. Main-menu Single Player click target: `ScreenSinglePlayerCreate` vs
   `screenQuickPlay.xaml` (the navigation graph is engine-side).
3. `ButtonReset` / `ButtonRandomize` semantics on the setup screen (what
   state they reset/randomize; whether any seed is involved).
4. Which surface the in-game Options button opens: `screenoptions.xaml` vs
   `dialogsimplesettingsmenu.xaml`.
5. Pause dialog key bindings (Esc/F10), controller focus order and whether
   opening/closing the dialog changes pause state in each game mode.

## 9. Implementation recommendation (concise, proposal)

- **Stage the pause dialog first, static layout + current actions only.**
  Wire Cancel/X (close), Options (existing overlay), Restart (confirm then
  restart) and Resign. **Quit Current Game stays disabled until a start
  destination exists**; do not add §7C or a reload fallback to this slice.
  Every other unsupported native slot appears greyed per our product policy,
  not a proven match with or deviation from native runtime behaviour.
- **Do not strand reachable features mid-migration:** until the replacement
  surfaces (§7B setup screen, §5 load-game screen) exist, keep the existing
  Settings entry, replay loading and the Ysgramor host restriction reachable
  from the dialog.
- **Document omitted effects explicitly** in the implementation notes:
  `Age2SwipeEffect`/`Age2BlurEffect` entrance swipes,
  `Age2NineSliceShinyEffect` shine (blur mask not imported),
  `ControlDropShadowBig`, the native disabled/pressed text whitening, and
  the party-lock overlay.
- **Checks for the implementing stage (real browser):**
  1. Actual Cancel, X, Options and Restart clicks behave as mapped
     (Restart confirms first).
  2. Disabled actions render greyed and do nothing on click — present, not
     removed.
  3. Scaled fit: the dialog stays correctly sized and usable under the
     existing `--ui-scale` factors.
  4. State/RNG isolation: from identical initial state and seed, compare a
     run with menu open/close and disabled-button interactions against a
     control run at **equal simulation ticks**, with **identical gameplay
     commands at identical ticks**. Authoritative state and RNG must match;
     elapsed wall time or ticks advancing while the menu is open is not
     itself a failure.
  5. Test pause/resume semantics separately, starting both paused and
     unpaused and covering local/shared modes as applicable. Check visibility
     toggles separately from Resume's explicit unpause (§6); any proposed
     change must state its policy, not assume opening the menu auto-pauses.
  6. Loaded material URLs: every `wpfg/` manifest URL the dialog uses
     resolves (no 404s/texture misses) — assert on the loaded page, not the
     file list.

## 10. Uncertainties and unverified items

- Everything in §7 and §9 is proposal, not observed native flow; §8 items
  are engine-side and need the REA worker's targeted decompiles.
- `dialogsimplesettingsmenu.xaml` and `screenoptions.xaml` internals were not
  read this pass (file-level facts only).
- The `PixelLeft 1280 / PixelTop 700` shader parameters are recorded, not
  interpreted as dialog position.
- Whether the repo already imports the owned key-value string table for HUD
  strings was not verified; current HUD strings are hand-maintained.
- `ScreenLoadGame.xaml` was read only to line 38; tab internals
  (`tabLoadGameSaves/Replays.xaml`) are unread.
