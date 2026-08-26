#!/usr/bin/env python3
"""Where the owned AoE2DE depot tree lives.

`AOE2DE_DEPOT_ROOT` wins; otherwise the SteamCMD and Steam-client download
locations are tried in order. Both the import shell and the integration tests
resolve the root through here, so a machine that has the depots never silently
runs an import-free build or a suite that skips every test.
"""

from __future__ import annotations

import os
from pathlib import Path

CANDIDATES = (
    "Steam/steamapps/content/app_813780",
    ".local/share/Steam/steamcmd/linux32/steamapps/content/app_813780",
    ".local/share/Steam/steamapps/content/app_813780",
    ".steam/steam/steamapps/content/app_813780",
)


def depot_root() -> Path:
    """The first depot tree that exists, or the first candidate if none do."""
    override = os.environ.get("AOE2DE_DEPOT_ROOT")
    if override:
        return Path(override).expanduser()
    home = Path.home()
    for candidate in CANDIDATES:
        if (home / candidate).is_dir():
            return home / candidate
    return home / CANDIDATES[0]


if __name__ == "__main__":
    print(depot_root())
