#!/usr/bin/env python3
"""Where the owned AoE2DE depot tree lives.

`AOE2DE_DEPOT_ROOT` wins — an explicit root is a deliberate choice and is
returned as given. Otherwise every known download location and every
installed-copy facade is a candidate, and a candidate is chosen only after
its DAT proves to be the pinned build (`aoe2-source.json`'s `datSha256`, the
same pin the import records as provenance). A tree that exists but is
another build — Artemis's stale SteamCMD content (#334) — is skipped rather
than silently imported against, and when candidates exist but none matches,
resolution fails loudly instead of guessing. A machine with no candidates at
all keeps the conventional default path, so source-less hosts keep skipping
owned tests exactly as before.

Both the import shell and the integration tests resolve the root through
here, so a machine that has the depots never silently runs an import-free
build or a suite that skips every test.

Installed-copy facades (docs/owned-assets-setup.md, "Using an installed
Steam copy") are found by the `aoe2de-*-facade` naming convention under
`~/.local/share/` — no one machine's path is recorded here, and a facade is
still only chosen after its DAT matches the pin.
"""

from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass
from pathlib import Path

CANDIDATES = (
    "Steam/steamapps/content/app_813780",
    ".local/share/Steam/steamcmd/linux32/steamapps/content/app_813780",
    ".local/share/Steam/steamapps/content/app_813780",
    ".steam/steam/steamapps/content/app_813780",
)
# An installed-copy facade: a `aoe2de-<build>-facade` directory under
# `~/.local/share/` whose `depot_*` entries symlink one Steam client
# installation (docs/owned-assets-setup.md). Conventional, never pinned to
# one machine, and subject to the same DAT pin check as every candidate.
FACADE_PATTERN = ".local/share/aoe2de-*-facade"

# The one file whose bytes identify the build; the same DAT datq.py reads.
DAT_RELATIVE = "depot_813781/resources/_common/dat/empires2_x2_p1.dat"
SOURCE_PIN = Path(__file__).with_name("aoe2-source.json")


# The Enhanced Graphics Pack (depot 1039811, the free UHD DLC) writes the
# base depot's graphics directory over again with every sprite at twice the
# pixel density: `<stem>_x2.sld` beside 813784's `<stem>_x1.sld`, 7372 of
# each. The importer prefers a pack file whenever the depot is present.
GRAPHICS = "depot_813784/resources/_common/drs/graphics"
UHD_GRAPHICS = "depot_1039811/resources/_common/drs/graphics"
UHD_SUFFIX = "_x2.sld"
BASE_SUFFIX = "_x1.sld"


class DepotMismatch(RuntimeError):
    """Candidate sources exist, but none of them is the pinned build."""


@dataclass(frozen=True)
class SourcePin:
    """The build every automatically chosen source must prove itself to be."""

    build: str
    dat_sha256: str


def load_pin(path: Path | None = None) -> SourcePin:
    """The committed source pin, or the one at `path` (tests use fakes)."""
    data = json.loads((path or SOURCE_PIN).read_text())
    return SourcePin(build=data["build"], dat_sha256=data["datSha256"])


def dat_path(root: Path | str) -> Path:
    """Where a source tree carries the build-identifying DAT."""
    return Path(root) / DAT_RELATIVE


def dat_sha256(root: Path | str) -> str | None:
    """The source's DAT hash, or None when the tree carries no DAT."""
    path = dat_path(root)
    if not path.is_file():
        return None
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def candidate_roots(home: Path) -> list[Path]:
    """Every source location this machine may provide, in preference order.

    The SteamCMD/Steam download locations keep their historical priority, so
    a host whose SteamCMD content is the pinned build (Ysgramor) resolves
    exactly as before; facades only ever take over when they are the match.
    """
    fixed = [home / candidate for candidate in CANDIDATES]
    facades = sorted(path for path in home.glob(FACADE_PATTERN) if path.is_dir())
    return fixed + facades


def resolve_root(
    home: Path | None = None,
    override: str | None = None,
    pin: SourcePin | None = None,
) -> tuple[Path, str]:
    """The source tree to import from, and the provenance of the choice.

    `override` (normally `AOE2DE_DEPOT_ROOT`) wins unvalidated: an explicit
    root is a deliberate choice, and `--check` reports its pin status rather
    than rejecting it. Otherwise the first candidate whose DAT is the pinned
    build wins. Trees of other builds are reported, not used — importing
    against the wrong build is a red owned checkpoint whose cause is the
    environment, not the code (#334). With no candidate present at all the
    conventional default is returned, so hosts without source keep skipping
    owned tests.
    """
    if override:
        return Path(override).expanduser(), "explicit AOE2DE_DEPOT_ROOT"
    home = Path.home() if home is None else Path(home)
    pin = pin or load_pin()
    existing: list[tuple[Path, str | None]] = []
    for candidate in candidate_roots(home):
        if not candidate.is_dir():
            continue
        digest = dat_sha256(candidate)
        existing.append((candidate, digest))
        if digest == pin.dat_sha256:
            return candidate, f"DAT sha256 is the pinned build {pin.build}"
    if existing:
        found = "\n".join(f"  {candidate}: DAT {digest or 'missing'}" for candidate, digest in existing)
        raise DepotMismatch(
            f"no owned AoE2DE source is the pinned build {pin.build}"
            f" (DAT sha256 {pin.dat_sha256}):\n{found}\n"
            "Set AOE2DE_DEPOT_ROOT to choose a source explicitly."
        )
    return home / CANDIDATES[0], "no source found; conventional default"


_ROOT_CACHE: dict[tuple[str | None, str], tuple[Path, str]] = {}


def depot_root() -> Path:
    """The resolved source root; `resolve_root` states the full rules."""
    override = os.environ.get("AOE2DE_DEPOT_ROOT")
    home = str(Path.home())
    if (override, home) not in _ROOT_CACHE:
        _ROOT_CACHE[(override, home)] = resolve_root(Path(home), override)
    return _ROOT_CACHE[(override, home)][0]


def check(
    home: Path | None = None,
    override: str | None = None,
    pin: SourcePin | None = None,
) -> tuple[bool, str]:
    """(ok, report) for the resolved source against the pin.

    The cheap, complete answer to "is the source I am about to import from
    the build the repo pins?" — read from the DAT's bytes, with no import
    and no manifest. Resolution has already hash-checked every candidate it
    walked; the selected root's DAT is hashed again here so the report
    states the exact bytes in play. The exit-grade fact is whether the
    *resolved* root's DAT is the pinned one, so an explicit override that
    points elsewhere is reported, not obeyed silently either way.
    """
    pin = pin or load_pin()
    lines = [f"pinned build: {pin.build}", f"pinned DAT sha256: {pin.dat_sha256}"]
    try:
        root, why = resolve_root(home, override, pin)
    except DepotMismatch as error:
        return False, "\n".join(lines) + f"\nresolution failed: {error}"
    lines.append(f"resolved root: {root} ({why})")
    digest = dat_sha256(root)
    lines.append(f"resolved DAT sha256: {digest or 'missing'}")
    if digest == pin.dat_sha256:
        return True, "\n".join(lines + ["pin check: MATCH"])
    if digest is None and "default" in why:
        hint = "no source present; owned tests skip"
    elif override:
        hint = "explicit roots are used as given; this one is not the pinned build"
    else:
        hint = "unexpected resolution"
    return False, "\n".join(lines + [f"pin check: MISMATCH ({hint})"])


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


def main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description="Resolve the owned AoE2DE depot root.")
    parser.add_argument("--check", action="store_true",
                        help="verify the resolved source's DAT against the pinned build, without importing")
    parser.add_argument("--source", type=Path, default=SOURCE_PIN,
                        help="the source pin to check against (default: tools/aoe2-source.json)")
    args = parser.parse_args(argv)
    if args.check:
        ok, report = check(override=os.environ.get("AOE2DE_DEPOT_ROOT"), pin=load_pin(args.source))
        print(report)
        return 0 if ok else 1
    try:
        print(depot_root())
    except DepotMismatch as error:
        print(f"depot: {error}", file=__import__("sys").stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
