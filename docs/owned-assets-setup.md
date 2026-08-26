# Use owned AoE2DE assets locally

The repository is playable without Microsoft content. Owners of **Age of Empires II: Definitive Edition** on Steam can generate the higher-fidelity local mode from their own depot files. Nothing in this process uploads game files; generated output remains ignored under `public/imported/`.

## Required patch-matched depots

The core importer consumes three independently downloaded depots. Shared UI audio uses a fourth; the English sound depot is recorded for future localized voices. The pinned IDs and manifests are authoritative in `tools/aoe2-source.json`:

| Purpose | Depot | Manifest |
|---|---:|---:|
| DAT and sound metadata | `813781` | `3067258457468070797` |
| WEST `widgetui` | `813782` | `3503932408267359574` |
| Shared Wwise audio | `813783` | `8547122694393480152` |
| SLD graphics | `813784` | `8087696953400240386` |
| English Wwise audio (optional) | `813787` | `3172067902980343375` |

You must own app `813780`. Do not share Steam credentials, depot files, converted PNGs, or generated manifests.

## 1. Download with SteamCMD

Use Valve's SteamCMD for your platform. Start it interactively so your password and Steam Guard code do not enter shell history:

```text
steamcmd
Steam> login YOUR_STEAM_ACCOUNT
Steam> download_depot 813780 813781 3067258457468070797
Steam> download_depot 813780 813782 3503932408267359574
Steam> download_depot 813780 813783 8547122694393480152
Steam> download_depot 813780 813784 8087696953400240386
Steam> download_depot 813780 813787 3172067902980343375
Steam> quit
```

On Windows the executable is normally `steamcmd.exe`. Steam prints the exact destination after each download. A Steam desktop-client console download is also usable if it creates the same depot tree.

The resulting root must have this shape:

```text
app_813780/
├── depot_813781/resources/_common/dat/empires2_x2_p1.dat
├── depot_813781/resources/_common/dat/sounds.json
├── depot_813782/widgetui/
├── depot_813783/wwise/Base.pck
├── depot_813784/resources/_common/drs/graphics/
└── depot_813787/wwise/en/Base.pck          # optional localized audio
```

A normal `steamapps/common/AoE2DE` installation is not interchangeable with this tree: independent depots can contain overlapping paths, so the importer intentionally reads Steam's `steamapps/content/app_813780/depot_*` layout.

## 2. Point the importer at `app_813780`

`tools/depot.py` looks for the tree in the usual places, in order, and both the
import script and the integration tests resolve it the same way:

```text
~/Steam/steamapps/content/app_813780
~/.local/share/Steam/steamcmd/linux32/steamapps/content/app_813780
~/.local/share/Steam/steamapps/content/app_813780
~/.steam/steam/steamapps/content/app_813780
```

For any other location, set `AOE2DE_DEPOT_ROOT` to the directory that directly contains `depot_813781`, `depot_813782`, and `depot_813784`. Without a tree in any of these, `npm run test:import` skips its integration tests rather than failing — so check the run reports tests, not skips.

### macOS

SteamCMD under a local `~/Steam` directory needs no override. For a Steam desktop-client content directory:

```bash
export AOE2DE_DEPOT_ROOT="$HOME/Library/Application Support/Steam/steamapps/content/app_813780"
```

Install prerequisites with a current Node.js/npm and Python 3; the native converter also requires Xcode command-line tools:

```bash
xcode-select --install
brew install vgmstream
```

### Linux

Common locations are:

```bash
export AOE2DE_DEPOT_ROOT="$HOME/.local/share/Steam/steamapps/content/app_813780"
# or
export AOE2DE_DEPOT_ROOT="$HOME/.steam/steam/steamapps/content/app_813780"
```

Install a current Node.js/npm plus the native build prerequisites. On Debian/Ubuntu:

```bash
sudo apt update
sudo apt install build-essential git python3 python3-dev python3-venv
# Also install vgmstream-cli from your distribution/package or upstream release.
```

### Windows with WSL2 (recommended Windows workflow)

Run the repository and importer inside an Ubuntu WSL2 shell. If Windows Steam/SteamCMD downloaded into its usual C: location:

```bash
export AOE2DE_DEPOT_ROOT="/mnt/c/Program Files (x86)/Steam/steamapps/content/app_813780"
```

For a different Steam library, translate its drive similarly—for example `D:\SteamLibrary` becomes `/mnt/d/SteamLibrary`.

Reading thousands of files through `/mnt/c` works but is slower. For faster and more reliable native conversion, copy only the depot root into WSL's Linux filesystem:

```bash
mkdir -p "$HOME/Steam/steamapps/content"
cp -a "/mnt/c/Program Files (x86)/Steam/steamapps/content/app_813780" \
  "$HOME/Steam/steamapps/content/"
# The copied location is the default, so no export is needed.
```

Keep the repository itself in the WSL filesystem (for example `~/src/age-of-empires`), not under `/mnt/c`. Install prerequisites inside WSL:

```bash
sudo apt update
sudo apt install build-essential git python3 python3-dev python3-venv
# Also install the Linux vgmstream-cli inside WSL2 (not the Windows executable).
```

Use a current Node.js release inside WSL rather than the Windows Node executable. Native Windows Python/PowerShell import is not currently supported; WSL2 is the supported Windows boundary.

## 3. Verify and import

From the repository root, with `AOE2DE_DEPOT_ROOT` exported if needed:

```bash
DEPOT_ROOT="${AOE2DE_DEPOT_ROOT:-$HOME/Steam/steamapps/content/app_813780}"
test -f "$DEPOT_ROOT/depot_813781/resources/_common/dat/empires2_x2_p1.dat"
test -d "$DEPOT_ROOT/depot_813782/widgetui"
test -d "$DEPOT_ROOT/depot_813784/resources/_common/drs/graphics"
# Optional; when present, this enables authentic imported UI audio:
test -f "$DEPOT_ROOT/depot_813783/wwise/Base.pck" && command -v vgmstream-cli

npm install
npm run import:aoe2
npm run test:import
npm run dev
```

The first import bootstraps a pinned Python/openage toolchain under `.tools/` and can take several minutes. Successful output appears under `public/imported/aoe2/`; the browser detects it automatically. Re-running `npm run import:aoe2` against identical depot inputs regenerates byte-identical output.

## Remote QA over Tailscale

The dev server stays bound to loopback and is published privately to the
tailnet with [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve):

```bash
npm run dev -- --host 127.0.0.1 --port 5173
tailscale serve --bg --https=5173 5173
tailscale serve status
```

Then open `https://calcifer.tail6e864b.ts.net:5173/` from a tailnet device.
calcifer's default HTTPS route already proxies another service on port 8787 —
never run `tailscale serve reset`, which would remove it, and never use
`tailscale funnel` for this. Tailscale Serve proxies WebSocket upgrades, so
Vite HMR works; if it does not, set `hmr: { protocol: 'wss', clientPort: 5173 }`
and add the tailnet hostname to `allowedHosts` in `vite.config.ts` (never
`allowedHosts: true`).

## Troubleshooting

- **`Missing owned AoE2DE depot content`**: `AOE2DE_DEPOT_ROOT` points one level too high/low, or one depot has not finished downloading.
- **SteamCMD denies a depot/manifest**: confirm the logged-in account owns AoE2DE and completed Steam Guard authentication. Do not replace pinned manifests silently; another patch can change IDs, timings, and graphics.
- **WSL conversion is very slow**: copy `app_813780` from `/mnt/c` into the WSL filesystem as shown above.
- **Native extension compilation fails**: confirm Python headers, a C/C++ compiler, and Python's `venv` module are installed for the same Python used by the script.
- **Audio is absent**: download depot `813783`, install `vgmstream-cli`, and verify `public/imported/aoe2/audio/manifest.json` after re-importing.
- **Open fallback appears after import**: verify `public/imported/aoe2/manifest.json` and `public/imported/aoe2/ui/manifest.json` exist, then restart Vite.
