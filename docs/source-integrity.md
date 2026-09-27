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
The current selected import passed **569/569** containers. The base counterpart
audit passed **567/569**, with only the two files above failing.

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

Restoring the missing original x1 bytes remains #119. The owned source tree was
left read-only; no zero tail was patched, no contour synthesized and no decoder
walk weakened. Re-download/revalidate the patch-matched owned source using the
pins/setup instructions before attempting a base-only import from this damaged
local depot.
