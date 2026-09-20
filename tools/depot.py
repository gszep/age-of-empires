#!/usr/bin/env python3
"""Where the owned AoE2DE depot tree lives.

`AOE2DE_DEPOT_ROOT` wins; otherwise the SteamCMD and Steam-client download
locations are tried in order. Both the import shell and the integration tests
resolve the root through here, so a machine that has the depots never silently
runs an import-free build or a suite that skips every test.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

CANDIDATES = (
    "Steam/steamapps/content/app_813780",
    ".local/share/Steam/steamcmd/linux32/steamapps/content/app_813780",
    ".local/share/Steam/steamapps/content/app_813780",
    ".steam/steam/steamapps/content/app_813780",
)


# The Enhanced Graphics Pack (depot 1039811, the free UHD DLC) writes the
# base depot's graphics directory over again with every sprite at twice the
# pixel density: `<stem>_x2.sld` beside 813784's `<stem>_x1.sld`, 7372 of
# each. The importer prefers a pack file whenever the depot is present.
GRAPHICS = "depot_813784/resources/_common/drs/graphics"
UHD_GRAPHICS = "depot_1039811/resources/_common/drs/graphics"
UHD_SUFFIX = "_x2.sld"
BASE_SUFFIX = "_x1.sld"


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


def uhd_graphics_dir(root: Path | None = None) -> Path | None:
    """The pack's graphics directory when it is downloaded, else None."""
    directory = (root or depot_root()) / UHD_GRAPHICS
    return directory if directory.is_dir() else None


@dataclass(frozen=True)
class Graphics:
    """The sprite directories an import reads: the base depot's, and the
    pack's when it is downloaded."""

    base: Path
    uhd: Path | None = None

    @classmethod
    def of(cls, graphics: "Path | Graphics", uhd: Path | None = None) -> "Graphics":
        return graphics if isinstance(graphics, Graphics) else cls(graphics, uhd)

    def source(self, file_name: str) -> tuple[Path, int]:
        """The SLD to decode for a DAT graphic's `file_name`, and its scale.

        The DAT names the base file (`..._x1`); the pack's `..._x2` twin wins
        when it exists and is not empty -- `u_shp_merchant_ship` is zero bytes
        in both depots -- at scale 2, twice the pixels per screen unit.
        Everything else, and every base file, is scale 1.
        """
        base = self.base / f"{file_name}.sld"
        if self.uhd is not None and base.name.endswith(BASE_SUFFIX):
            uhd = self.uhd / (base.name[: -len(BASE_SUFFIX)] + UHD_SUFFIX)
            if uhd.is_file() and uhd.stat().st_size > 0:
                return uhd, 2
        return base, 1

    def path(self, name: str) -> Path:
        """Where a content entry's `source` file lives: a `_x2` name in the
        pack, anything else beside the base depot's graphics."""
        if self.uhd is not None and name.endswith(UHD_SUFFIX):
            return self.uhd / name
        return self.base / name


if __name__ == "__main__":
    print(depot_root())
