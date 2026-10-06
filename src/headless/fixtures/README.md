# Frozen replay fixtures

Do not regenerate these recordings with the implementation under test to make
a checksum failure pass.

## `pre-packing-v5.json` (#259)

Generated from untouched commit
`61a2d738b61bec82efdd01e08f990f3347dd1df9`, using its `runMatch` and
`FALLBACK_RULES`, before the packing correction or recording-v6 adapter.
The old engine independently replayed all nine checksums before the file was
frozen. SHA-256:
`2b176dd84c0bd3533538aef381ed3b0e666dcbf8b9fa5729d5013cde5e40574d`.

This is a controlled **open-content fixture**, not an owned-content recording.
`../packing-replay.fixture.ts` shortens production/research access: a free,
zero-time Trebuchet at the TC and a free, zero-time Kataparuto effect. It does
not override packing duration. Supply the old engine's fallback to this factory
when reproducing provenance; the current factory default intentionally uses the
current engine for regression playback.

Seed259, Arabia, v5 launch,45 game seconds, decision interval0.05. Public
commands train at tick0; unpack/pack/unpack at20/140/260; research at360;
pack/unpack/pack at400/460/520. The generated unit ID is1304. Old completed
pose transitions are110/230/350/423/483/543 (90 ticks before research,23 after).
There is no direct game-state staging or snapshot in the recorded command stream.

The first test run against the uncorrected replay policy failed at tick100:
expected `5b79f6ae`, actual `49df4562`. Recording-v6 compatibility must restore
the old dynamic checksums, not replace them. The regression additionally checks
completion poses/timers, rejects relabelling as v6, and verifies that replay did
not mutate the caller's current rules.

## `pre-mongols-v4.json` (#305)

Existing pre-Mongols recording; retained unchanged. Its separate regression in
`headless.test.ts` protects absence of later feature state.

## `pre-siphons-v6.json` (#242)

Generated from untouched commit
`98979f65bd3ad49ab98bd663361e6555c27a7bbb`, using its `runMatch` and
`FALLBACK_RULES`, before the Siphons building exclusion or recording-v7 adapter.
That engine independently replayed all four checksums before freezing the file.
SHA-256:
`be9408917c8763c572ac20c6aa88e0af6f19a8f5beab4c6b5e4c65c4b9666262`.

Controlled **open-content fixture**, not an owned recording or balance preset:
`../siphons-replay.fixture.ts` supplies the inspected, researched Siphons charge
tuple to a Fire Galley, with free zero-time TC training, land passability and
enlarged sight/range so it can attack the enemy TC without a navigation fixture.
Automatic search is disabled. These test-only overrides do not override charge
eligibility, release or consumption; the engine decides those. Pass the old
engine's fallback to the factory when reproducing provenance, as with packing.

Seed242, Arabia, v6 launch,20 game seconds, decision interval0.05. Public
commands train at tick0 and attack enemy TC6 at tick20 with Fire Galley1242.
The first charged projectile is released at tick21 and charge becomes0.
No direct game-state staging or snapshot occurs in the recorded command stream.

Against the building exclusion without compatibility, the frozen regression
failed at tick100: expected `983ee1bb`, actual `0305327d`. The v7 adapter must
restore those historical checksums, not replace them. Coverage also asserts the
old projectile/charge result, rejects relabelling as v7, checks current v7
recordings, and continues marker-less/current snapshots before and after release.

## `pre-trebuchet-targeting-v7.json` (#131)

Generated from untouched commit
`1c316d84e7d65ff03e3d5b57286f000c442fd78b`, using its `runMatch` and
`FALLBACK_RULES`, before the idle-packed acquisition correction or v8 adapter.
That engine independently replayed all twelve checksums before freezing the file.
SHA-256:
`ae7ed93b06837cc14b78c709e09d7c9cbaccd51478e8db3ff4f6a6c05afad134`.

Controlled **open-content fixture**, not an owned recording or balance preset:
`../trebuchet-replay.fixture.ts` enables free zero-time TC Trebuchet training and
enlarges sight/search/deployed range to200. Packing duration, attacks, reload and
projectile values are unchanged. The engine decides automatic acquisition,
deployment and actual damage. Pass the archived engine's fallback to the factory
when reproducing provenance (or copy the factory into the archived source tree).

Seed131, Arabia, v7 launch,60game seconds, decision interval0.05. The sole public
command trains a trebuchet at TC1 at tick0. No attack or Unpack command, direct
state staging or snapshot is injected into the recording. Old automatic
acquisition starts at tick10, deployment completes at233 and enemy TC first
loses HP at660. Periodic checksums cover ticks100 through1200.

Against the corrected guard without compatibility, the frozen regression failed
at tick100: expected `15f2d14b`, actual `8c258b10`. Recordingv8 restores all old
hashes by selecting the legacy policy, not by updating expected results. Tests
also reject relabeling v7 as v8 (and the reverse), validate a current v8 run
launched with v7 input, and continue current/marker-less JSON states both before
acquisition and during legacy setup. Manual Pack suppression and its removal by
Stop remain legacy behavior; current Stop cannot enable idle deployment.

## `pre-offshore-islands-v8.json` (#95)

Generated and independently replayed before the fish correction with untouched
`94dc0ff` using its fallback rules and `runMatch`: Islands seed95, ten seconds,
idle strategies, two periodic checksums. SHA256:
`7a7eb0ff34655966924d213fbe27c38603590572e0bc60210dda46748188df07`.
This is a map/JSON continuation fixture, not fishing-economy acceptance.
Recordv9 selects offshore generation; relabeling this record must fail rather
than updating its hashes. `islands-fish.test.ts` additionally freezes initial
and tick20 whole-state digests for eight seeds against the same untouched tree.
