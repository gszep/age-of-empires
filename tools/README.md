# Local import tools

Tools in this directory define reproducible import steps. Tool installations, source game files, and generated proprietary content live in ignored directories.

```text
.tools/          external Python/openage environments
.local/aoe2de/   local source configuration and intermediate data
public/imported/ browser-ready local atlases/manifests
```

No Steam credentials, Steam configuration, DAT files, SLD files, or converted Microsoft assets belong in this repository.

See [`docs/owned-assets-setup.md`](../docs/owned-assets-setup.md) for patch-matched SteamCMD downloads and source paths on macOS, Linux, and Windows/WSL2. `npm run import:aoe2` reads `AOE2DE_DEPOT_ROOT`, defaulting to `~/Steam/steamapps/content/app_813780`.

## Pipeline

`npm run import:aoe2` (= `tools/import_aoe2.sh`) regenerates everything byte-identically:

1. `bootstrap.sh` prepares `.tools/import-venv` and the pinned openage checkout.
2. `import_content.py` reads the declarative `import-spec.json` and extracts the
   Dark Age slice (militia, villager + task variants, town center, barracks,
   house, berries, gold, oak tree) from the patch-matched DAT with
   `genieutils-py`, resolving graphic IDs from semantic slots/task fields and
   hashing every source file into `.local/aoe2de/content.json`.
3. `convert_sld.py` converts every referenced SLD main layer with pinned
   openage code and its shadow layer with `sld_shadow.py`, producing
   `public/imported/aoe2/<key>/<state>.png` plus the combined manifest.
4. `import_ui.py` extracts the WEST widget-UI subset (resource/command/map/
   bottom/menu panels, materials, entity + action + stat icons, click-sound
   aliases from `sounds.json`) into `public/imported/aoe2/ui/`, converting DDS
   through Pillow and copying PNG byte-identically.
5. When sound depot 813783 and `vgmstream-cli` are available,
   `import_audio.py` follows consumed event names through the owned PCK/BNK
   HIRC graph, extracts only referenced DIDX media, and writes deterministic
   browser-playable WAV cues under `public/imported/aoe2/audio/`.

`npm run test:import` runs the integration suite (`test_import_aoe2.py`) against
the owned fixture, including determinism checks.

## Recorded approximations and source gaps

- Forager and gold-miner work animations use the task `proceeding` graphic; the
  DAT `working` graphic is `-1` and the attack graphic is a placeholder file
  named `None` in this build.
- Main and shadow SLD layers are converted. The local shadow decoder avoids
  pinned-openage crashes, but player-color masks and outline layers remain
  unavailable; the viewer approximates player color by tinting. Each main
  atlas still converts in an isolated subprocess because openage degrades
  within one long-lived process.
- Building destruction graphics are converted without their fire-overlay delta
  graphics (for example graphic 419 deltas 12178–12183).
- Corpse/decay graphics and dead-unit chains (tree stumps) are not imported yet.
- `icons.json` stat/menu icon names (`stat_icon_*`, `submenu_*`) resolve inside
  the executable; `textures/ingame/staticons/` is imported raw and `submenu_*`
  art is absent from depot 813782. Both are recorded in the UI manifest as
  `rawTextures`/`missingMaterials`.
- The shipped `materials.json` has a few dangling texture refs (for example
  `AgeupCastleAge`, referenced by `resourcepanel.json`); these are kept as
  `unresolvedTexture` evidence instead of substituting art.

## Library notes

1. `genieutils-py` 0.1.2 parsed the downloaded `VER 8.9` DAT;
   `aoe2-genie-tooling` 1.2.4 left 22,449 bytes unparsed and is not used.
2. openage (pinned rev) converts SLD to PNG atlases with hotspot metadata; GPL
   code stays outside the TypeScript runtime.
3. Pillow decodes the DDS icon textures (BC-compressed) directly.
4. `vgmstream-cli` decodes Wwise media as an external permissively licensed
   tool; no decoder code or owned audio enters the repository.
