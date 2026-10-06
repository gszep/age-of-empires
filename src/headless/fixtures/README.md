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
