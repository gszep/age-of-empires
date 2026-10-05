# Owned SLD source integrity (#119 / #247)

The 2026-09-27 source walk established why the base monk's outline failed.
Both affected files contain a long all-zero tail starting at exactly1048576
bytes (1MiB), despite retaining their declared full file lengths:

| Base depot813784 file | Bytes | First invalid container location | SHA-256 |
| --- | ---: | --- | --- |
| `u_monk_west_attackB_x1.sld` |1115756|frame677, outline layer length0 at1048664|`50190c5c4144840f143def77120bf30c3d78c010621acc512bd7b7c5fd282e72`|
| `u_monk_west_idleA_x1.sld` |1261220|frame808, player-colour layer length0 at1048596; preceding outline row13 crosses into the zero tail|`01a6c8942e089e49253715da60e034ece2c43b8ffd5b2a7ff2f9f0e221f1de06`|

Monk death, decay and walk complete exact container and outline walks. This is
incomplete source data, not evidence for an alternative outline command format.
The main-layer reader could previously walk zero-filled bogus empty frames after
the damage, so the problem was not limited to a missing contour. The x2 sources
are complete and their contours already work.

## Reproduce without changing sources

```sh
uv run --locked python tools/sld_integrity.py
uv run --locked python tools/sld_integrity.py --base
uv run --locked python tools/sld_integrity.py /absolute/path/to/file.sld
```

Without filenames, the audit inventories all SLD references in the current
`.local/aoe2de/content.json`, including additional existing profiles and annexes.
`--base` checks their x1 counterparts. It reports filenames, errors, hashes,
sizes and the start of any all-zero tail; exit1 means at least one invalid file.
That September27 selected import passed **569/569** containers. Its base
counterpart audit passed **567/569**, with only the two files above failing.

The validator memory-maps files read-only and checks signature/frame start,
supported layer bits, length-field bounds, alignment and exact declared-frame
coverage through EOF. It supports the documented14-byte stable frame start.
It is a structural check, not an official Steam manifest checksum validator or
a replacement for pixel/mask decoding.

## Import behavior

The full atlas step validates every selected source **before cache lookup or
output publication**. A cache hit cannot conceal an incomplete input. A failed
source leaves the last published manifest intact; a synthetic integration test
checks that with a matching cache fingerprint. The pixel decoder and its cache
fingerprint are unchanged, so complete sources retain byte-identical cached art.

## Verified recovery (2026-09-28)

The owner downloaded depot813784, manifest8087696953400240386, into a fresh
destination after repeating the default-destination download failed to restore
the files. SteamCMD's own help documents the explicit destination argument:

```text
download_depot 813780 813784 8087696953400240386 0 /home/fraser/repos/age-of-empires/.local/monk119-recovery
```

The two clean files retain their original lengths, but have these SHA-256 hashes:

| File | Recovered SHA-256 |
| --- | --- |
| `u_monk_west_attackB_x1.sld` | `523c885807d9bed54dc863f7d5c154efc45ae7074a924facf4e5db5045c4e9df` |
| `u_monk_west_idleA_x1.sld` | `b1b20ac3324312563ab062b6e3fc3a8a515c2970398c1d9e2a411c5778079872` |

Both pass exact container validation; the recovered base source inventory passes
**569/569** (`.local/monk119-base-audit.json`). A detached worktree at
`.local/monk119-base` ran **`npm run import:aoe2`**, with a private depot-root
overlay linking the recovered graphics and original DAT/UI, without the UHD or
optional audio depots. The full pipeline exited0 (`.local/monk119-import.log`),
and its manifest has **no skipped masks**. Monk idle-outline contains960 frames,
attack-outline720, both at **scale1**. No decoder or cache fingerprint changed.

The maintained `composite_outline_smoke.mts` now accepts `CONTOUR_KIND=monk`,
`CONTOUR_ANIMATION=idle|attack`, `CONTOUR_SCALE=1`, and an absolute
`CONTOUR_ROOT` pointing at that isolated import worktree. Idle and attack-art
fixtures both pass real-browser A/B checks over the native TC occluder:

- Idle:355 changed sRGB pixels, all355 player-blue;204 opaque samples.
- Attack:356 changed sRGB pixels, all356 player-blue;205 opaque samples.
- Both: correct contour/occluder/placement order, delayed load, expiration and
  reload, empty-frame hiding, pixel-identical camera round trip, no page errors,
  unchanged simulation hash. Logs: `.local/monk119-{idle,attack}-browser.log`.
- Existing Galley and villager contour probes also pass against the normal x2
  installation (`.local/monk119-{galley,villager}-regression.log`).
- Owned checkpoint is GREEN (`.local/monk119-gate.log`, exit0):997 Vitest
  tests/81 files, build,149 Python/owned-source tests and real-browser debug
  smoke. Three workers, unchanged timeouts; only Markdown edits after checkpoint start.

These are render fixtures for both recovered atlases, not a new claim about
monk conversion gameplay animation. Import decoding covers the complete masks;
browser pixel checks sample a paused pose, not every direction/frame.

**Installation complete:** the owner copied both verified files back into the
default depot on2026-09-28, preserving the `.sld.damaged` backups. Read-only
verification confirmed both canonical files match the recovered SHA-256 hashes
above, and `tools/sld_integrity.py --base` now passes569/569 against the default
depot. This completes #119. The current x2 installation is unaffected. No source
bytes were synthesized and no walk invariant was weakened.

## Additional consumed source, 2026-10-02 (#277)

The expanded seven-profile inventory now names1170 sources. A read-only base
audit passes1169 and finds one newly consumed, truncated Slavic monk file:

| Source | Bytes | SHA-256 |
| --- | ---: | --- |
| Default `u_monk_slav_idleA_x1.sld` |1048576|`2df303beb29a66105b7abc2a7925c7c34f01422e29b3bed619152eabfc80c2a0`|
| Existing recovery copy |1388644|`51d11bb341508500ee69e4292225836f8211674d7f9a919aa1561bab5fad03b4`|

The default file fails at frame745/layer2: length468 at byte1048192 crosses EOF.
The original#119 recovery directory contains the complete file from the same
pinned resources manifest8087696953400240386. Every recovered consumed source
passes validation (1170/1170); comparing all1170 files against the default depot
finds this one difference only. Receipts:
`.local/cache257-default-base-audit.json` and
`.local/cache257-source-comparison.json`.

The default depot remains read-only; owner copy-back and revalidation are#277.
The failed private cache study stopped before atlas publication. Its subsequent
isolated study uses a read-only view of the complete recovery depot. Production
x2 assets and Artemis's previously verified x1 publication are unaffected; this
does not reopen the successful Western monk repair.
