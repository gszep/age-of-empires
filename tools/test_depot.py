"""`tools/depot.py` resolves the owned source deterministically (#334).

Every fixture is a fake candidate under a temporary home: a directory with a
DAT at the pinned relative path whose bytes hash to a fake pin. No test reads
the real home or the real depots, so this suite stays green on hosts with no
source at all (public CI) and on hosts whose real SteamCMD content is stale
(Artemis): neither a missing nor a wrong real tree may change the result.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from depot import (
    CANDIDATES,
    DAT_RELATIVE,
    DepotMismatch,
    check,
    candidate_roots,
    dat_sha256,
    depot_root,
    load_pin,
    resolve_root,
)

STEAMCMD = CANDIDATES[1]


def write_dat(root: Path, dat: bytes) -> Path:
    """A fake depot tree whose build-identifying DAT is `dat`."""
    path = root / DAT_RELATIVE
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(dat)
    return root


def write_pin(directory: Path, dat: bytes, build: str = "test build (#1)") -> Path:
    """A fake source pin naming `dat`'s hash as the pinned DAT."""
    path = directory / "source.json"
    path.write_text(json.dumps({"build": build, "datSha256": hashlib.sha256(dat).hexdigest()}))
    return path


class ResolutionTest(unittest.TestCase):
    def setUp(self):
        self.home = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.home, ignore_errors=True)
        self.pinned = b"the 185872 DAT, in miniature"
        self.stale = b"an older build's DAT, in miniature"
        self.pin = load_pin(write_pin(self.home, self.pinned))
        # The pin file lives beside the fake home's "depot", never in it.
        self.pin_path = self.home / "source.json"

    def resolve(self, home=None, override=None):
        return resolve_root(home or self.home, override, self.pin)

    def test_no_candidates_returns_the_conventional_default(self):
        root, why = self.resolve()
        self.assertEqual(root, self.home / CANDIDATES[0])
        self.assertIn("default", why)

    def test_matching_steamcmd_tree_is_chosen(self):
        write_dat(self.home / STEAMCMD, self.pinned)
        root, why = self.resolve()
        self.assertEqual(root, self.home / STEAMCMD)
        self.assertIn("pinned build", why)

    def test_stale_tree_is_never_silently_chosen(self):
        write_dat(self.home / STEAMCMD, self.stale)
        with self.assertRaises(DepotMismatch) as raised:
            self.resolve()
        message = str(raised.exception)
        self.assertIn(hashlib.sha256(self.stale).hexdigest(), message)
        self.assertIn(self.pin.dat_sha256, message)
        self.assertIn("AOE2DE_DEPOT_ROOT", message)

    def test_stale_tree_falls_back_to_a_matching_facade(self):
        """The #334 shape: a stale SteamCMD content tree beside a facade of
        the pinned build resolves to the facade, not the stale tree."""
        write_dat(self.home / STEAMCMD, self.stale)
        facade = write_dat(self.home / ".local/share/aoe2de-185872-facade", self.pinned)
        root, _ = self.resolve()
        self.assertEqual(root, facade)

    def test_matching_steamcmd_wins_over_a_later_facade(self):
        """Ysgramor keeps its valid SteamCMD tree even when a facade exists."""
        write_dat(self.home / STEAMCMD, self.pinned)
        write_dat(self.home / ".local/share/aoe2de-185872-facade", self.pinned)
        root, _ = self.resolve()
        self.assertEqual(root, self.home / STEAMCMD)

    def test_incomplete_tree_without_a_dat_is_skipped_and_reported(self):
        (self.home / STEAMCMD).mkdir(parents=True)
        with self.assertRaises(DepotMismatch) as raised:
            self.resolve()
        self.assertIn("missing", str(raised.exception))

    def test_every_facade_convention_directory_is_a_candidate(self):
        first = self.home / ".local/share/aoe2de-185872-facade"
        second = self.home / ".local/share/aoe2de-91425-facade"
        for facade in (first, second):
            facade.mkdir(parents=True)
        (self.home / ".local/share/aoe2de-185872-facade.txt").write_text("a file, not a facade")
        # Facades follow the fixed candidates, ordered by name so the
        # resolution is deterministic wherever several exist.
        roots = candidate_roots(self.home)
        self.assertEqual(roots[-2:], [first, second])

    def test_facades_of_other_builds_do_not_shadow_the_pin(self):
        write_dat(self.home / STEAMCMD, self.stale)
        write_dat(self.home / ".local/share/aoe2de-91425-facade", b"yet another build")
        with self.assertRaises(DepotMismatch):
            self.resolve()

    def test_explicit_override_wins_even_when_it_is_not_the_pinned_build(self):
        """An explicit `AOE2DE_DEPOT_ROOT` is a deliberate choice: it is
        returned as given (and `check` reports its pin status) rather than
        silently re-pointed at some discovered tree."""
        write_dat(self.home / STEAMCMD, self.pinned)
        override = write_dat(self.home / "chosen-explicitly", self.stale)
        root, why = self.resolve(override=str(override))
        self.assertEqual(root, override)
        self.assertIn("explicit", why)

    def test_empty_override_falls_through_to_discovery(self):
        write_dat(self.home / STEAMCMD, self.pinned)
        root, _ = self.resolve(override="")
        self.assertEqual(root, self.home / STEAMCMD)

    def test_depot_root_honors_the_environment_override(self):
        chosen = self.home / "from-the-environment"
        with mock.patch.dict(os.environ, {"AOE2DE_DEPOT_ROOT": str(chosen)}):
            self.assertEqual(depot_root(), chosen)


class CheckTest(unittest.TestCase):
    def setUp(self):
        self.home = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.home, ignore_errors=True)
        self.pinned = b"the 185872 DAT, in miniature"
        self.stale = b"an older build's DAT, in miniature"
        self.pin = load_pin(write_pin(self.home, self.pinned))

    def test_check_passes_on_a_matching_source(self):
        write_dat(self.home / STEAMCMD, self.pinned)
        ok, report = check(self.home, pin=self.pin)
        self.assertTrue(ok)
        self.assertIn("MATCH", report)
        self.assertIn(self.pin.dat_sha256, report)

    def test_check_reports_a_resolution_failure_without_raising(self):
        write_dat(self.home / STEAMCMD, self.stale)
        ok, report = check(self.home, pin=self.pin)
        self.assertFalse(ok)
        self.assertIn("resolution failed", report)
        self.assertIn(hashlib.sha256(self.stale).hexdigest(), report)

    def test_check_names_an_override_mismatch(self):
        write_dat(self.home / STEAMCMD, self.pinned)
        override = write_dat(self.home / "chosen-explicitly", self.stale)
        ok, report = check(self.home, override=str(override), pin=self.pin)
        self.assertFalse(ok)
        self.assertIn(str(override), report)
        self.assertIn("explicit roots are used as given", report)

    def test_dat_sha256_of_a_tree_without_a_dat_is_none(self):
        self.assertIsNone(dat_sha256(self.home))


class CommittedPinTest(unittest.TestCase):
    def test_the_committed_pin_is_well_formed(self):
        pin = load_pin()
        self.assertTrue(pin.build)
        self.assertRegex(pin.dat_sha256, r"^[0-9a-f]{64}$")


if __name__ == "__main__":
    unittest.main()
