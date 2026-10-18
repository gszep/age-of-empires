# AoE2DE audit: transfer concepts, retain our strengths

Provenance: **AoE2DE binary audit (.local), 2026-10**, comparing executable
versions 101.103.48987.0 and 101.103.54800.0. The supplied brief, string cross-reference
digests, source-path inventory and build diffs are private inputs. This note
contains architectural observations and our decisions, not recovered code.

## Evidence boundary

Action/state, formation and desync names suggest useful investigation boundaries.
Their presence does not establish reachable behavior, exact algorithms, timing,
or the quality of the native implementation. Different log coordinate formats
do not prove that movement changed from continuous to tile-based. Different
function addresses/counts do not measure how much gameplay code changed.
The audit performed no gameplay experiment. Existing DAT/RMS/XS imports and
calibration receipts remain the source of rules; the current source pin is in
`tools/aoe2-source.json`.

## What we do better for this product — deliberately retained

These are concrete advantages for our human-play/agent-experimentation loop,
not a claim that our gameplay or performance surpasses DE.

| Our advantage | Code/evidence | Decision |
| --- | --- | --- |
| Directly inspectable, headless-testable gameplay shared with the browser | `src/sim/game.ts`, `src/headless/runner.ts`; public commands and deterministic tests | Keep one TypeScript simulation. The native World/AI/Comm/XS inventory is a responsibility map, not a reason to introduce another runtime or interpreter. |
| Explicit, serializable intent and presentation vocabulary | `Order` and `Activity` in `src/sim/types.ts`; `chooseAnimation` in `src/view/sprites.ts` | Keep tagged orders, activity names and simulation-owned timers. They are easier for our agents to inspect than an opaque numeric state contract. Do not rename them to native class names or invent a state framework from diagnostics. |
| Template/instance separation without a parallel class hierarchy | Rules bundles and `src/sim/civilizations.ts`; plain-data conversion snapshots on entities | Keep the existing split. Native master/instance type names corroborate the concept; reproducing each master subclass would add indirection without a demonstrated benefit here. |
| Small, testable household synchronization | `src/shared/checksum.ts`, `src/shared/client.ts`, JSON-wire regression tests | Keep transport-stable hashes, bounded tick playback and automatic snapshot recovery. A worldwide account/party/telemetry stack would increase maintenance for the two-machine target. |

The master/instance separation is already shared with DE, not an invention we
should attribute to the audit. Our advantage is the simpler representation and
direct test access for this project. None of these choices proves native internals
are intrinsically worse.

## Where DE offers more, and what to transfer

| Native evidence / advantage | Our gap and bounded response |
| --- | --- |
| Shared attack/gather/stop diagnostics include state, timers and transition context | Investigate representative gatherer/melee/ranged outcomes under #315. Existing orders/activities already cover the vocabulary; no timing change is justified by strings. |
| Formation diagnostics distinguish lines/columns, category widths and slot depth/offset | Our group orders send each unit toward the same target; overlap separation is not a formation. #333 proposes a deterministic slot experiment with terrain, mixed-radius and replay checks. Native spacing and assignment rules remain unknown. |
| Desync tracking/upload setting names indicate a dedicated diagnostic surface | Our recovery retained only counters and a reason string, discarding both mismatching hashes. #332 transfers the narrower concept: retain one local checksum-mismatch receipt through recovery using existing debug statistics. No native upload protocol is inferred. |
| UI, campaign and online-service inventory is much broader | Preserve the focused shared-play scope: chat is #318, a small co-op scenario is #316. A module inventory is not evidence that those features exist in our game. |
| A multi-stage terrain/sprite compositor is present | The renderer remains behind in composition scope; use the existing #149 investigation rather than compensating with unrelated art changes. |

Our existing solo resource command already serves test-play needs. Native cheat
names do not justify expanding the roster or changing shared-match admission.
Likewise, evasive/overlap diagnostics are hypotheses for controlled movement
experiments, not permission to add random tactical offsets.

## Selected slice and acceptance boundary

The #332 slice should capture expected/actual hashes, host/local/latest-received ticks,
remaining queued ticks, protocol version, player, match generation and internal
`matchSeed`. When available it should also copy launch setup (including the original
map/seed), because `matchSeed` is a mixed internal identity, not the menu seed.
Keep the receipt outside authoritative state; a recovery snapshot, a successful
hash check or a manual resync should preserve it, and a later mismatch replace it.

Acceptance should exercise JSON messages through actual client playback:
successful commands, injected divergence with a queued later tick, recovery,
detached setup metadata, tick gaps and replacement across generations. The existing
development `sim` reply exposes client statistics under
`connection.synchronization`, providing the presentation path. Such a record
identifies a divergence, not its cause; it is neither a replay nor a disk log.

Delivery/owned-checkpoint status is tracked on #332. Local raw audit files,
Microsoft assets and recovered instruction text are not publication inputs.
